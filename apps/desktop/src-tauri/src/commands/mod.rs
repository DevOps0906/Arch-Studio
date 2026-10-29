//! 앱 명령(AR-06-006). 화면이 준 문자열 경로·임의 SQL을 받는 명령은 두지 않는다.
//! 파일 경로는 Rust가 연 OS 대화상자에서만 얻고, 로그·오류에는 경로 원문 대신 `path_hash`만 쓴다.

pub mod export;
pub mod fs;
pub mod local_db;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};

/// 화면 오류 코드(04_API.md 7.3). AR 코드 외 값은 화면 흐름용 내부 코드다.
pub mod code {
    /// 파일 쓰기 실패(디스크 공간·권한·경로).
    pub const WRITE_FAILED: &str = "AR052";
    /// 파일 크기 초과(DXF 20MB, IFC/.3dm 100MB).
    pub const TOO_LARGE: &str = "AR055";
    /// 로컬 DB 손상·열기 실패.
    pub const DB_UNAVAILABLE: &str = "AR060";
    /// 마이그레이션 중단, 읽기 전용 모드.
    pub const DB_READ_ONLY: &str = "AR061";
    /// 사용자가 대화상자를 닫음.
    pub const CANCELLED: &str = "CANCELLED";
    /// 파일 읽기 실패.
    pub const READ_FAILED: &str = "READ_FAILED";
    /// 입력 형식 오류(id·확장자·크기 등).
    pub const INVALID_INPUT: &str = "INVALID_INPUT";
    /// 대상 프로젝트 없음(삭제 포함).
    pub const NOT_FOUND: &str = "NOT_FOUND";
    /// expected_version 불일치.
    pub const VERSION_CONFLICT: &str = "VERSION_CONFLICT";
}

/// 명령 오류. `detail`에는 경로 원문·좌표·사용자 입력 값을 넣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub detail: String,
}

impl AppError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    /// io 오류는 종류만 남긴다(메시지에 경로가 섞일 수 있다).
    pub fn io(code: &'static str, err: &std::io::Error) -> Self {
        Self::new(code, format!("{:?}", err.kind()))
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for AppError {}

/// 대화상자 파일 형식 필터.
#[derive(Debug, Clone, Copy)]
pub struct FileFilter {
    pub name: &'static str,
    pub extensions: &'static [&'static str],
}

/// OS 파일 대화상자. 테스트는 가짜 구현으로 바꾼다.
/// 블로킹 호출이므로 비동기 명령에서 `spawn_blocking` 안에서만 부른다.
pub trait FilePicker: Send + Sync {
    fn pick_open(&self, filter: FileFilter) -> Option<PathBuf>;
    fn pick_save(&self, filter: FileFilter, default_name: &str) -> Option<PathBuf>;
}

/// 관리 상태로 등록하는 대화상자.
#[derive(Clone)]
pub struct PickerState(pub Arc<dyn FilePicker>);

/// tauri-plugin-dialog Rust API로 여는 실제 대화상자. JS 쪽 `plugin:dialog|*` 권한은 주지 않는다.
pub struct TauriPicker<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> TauriPicker<R> {
    fn dialog(&self, filter: FileFilter) -> tauri_plugin_dialog::FileDialogBuilder<R> {
        use tauri::Manager;
        use tauri_plugin_dialog::DialogExt;
        let mut builder = self
            .0
            .dialog()
            .file()
            .add_filter(filter.name, filter.extensions);
        if let Some(window) = self.0.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        builder
    }
}

impl<R: tauri::Runtime> FilePicker for TauriPicker<R> {
    fn pick_open(&self, filter: FileFilter) -> Option<PathBuf> {
        self.dialog(filter)
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
    }

    fn pick_save(&self, filter: FileFilter, default_name: &str) -> Option<PathBuf> {
        self.dialog(filter)
            .set_file_name(default_name)
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    }
}

/// SHA-256 소문자 16진수.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// 경로 원문 대신 기록하는 해시(앱 솔트 SHA-256, 05_DATA_MODEL.md 2.16 `exports.path_hash`).
const PATH_HASH_SALT: &[u8] = b"com.archstudio.desktop/path-hash/v1\0";

pub fn path_hash(path: &Path) -> String {
    let mut input = PATH_HASH_SALT.to_vec();
    input.extend_from_slice(path.to_string_lossy().as_bytes());
    sha256_hex(&input)
}

/// 실제 확장자(소문자). 없으면 빈 문자열.
pub fn extension_lower(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn path_hash_hides_path_and_is_stable() {
        let p = Path::new("C:/Users/someone/도면/a.dxf");
        let h = path_hash(p);
        assert_eq!(h.len(), 64);
        assert_eq!(h, path_hash(p));
        assert!(!h.contains("someone"));
        assert_ne!(h, path_hash(Path::new("C:/Users/someone/도면/b.dxf")));
    }

    #[test]
    fn io_error_detail_has_kind_only() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "C:/secret/path.dxf");
        let e = AppError::io(code::WRITE_FAILED, &err);
        assert_eq!(e.detail, "NotFound");
    }
}
