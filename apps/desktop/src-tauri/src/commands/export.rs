//! 내보내기 저장(AR-06-006). 화면은 바이트(원시 IPC 본문)와 형식 헤더만 보낸다.
//! 경로는 Rust가 연 저장 대화상자에서만 얻고, 같은 폴더 임시 파일에 쓴 뒤 rename. 실패는 AR052.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use super::fs::{DXF_MAX_BYTES, MODEL_MAX_BYTES};
use super::{
    code, extension_lower, path_hash, sha256_hex, AppError, FileFilter, FilePicker, PickerState,
};

/// 형식 헤더 이름(값: dxf·svg·pdf·png·ifc·gltf·3dm).
pub const FORMAT_HEADER: &str = "x-export-format";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Dxf,
    Svg,
    Pdf,
    Png,
    Ifc,
    Gltf,
    Rhino3dm,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "dxf" => Self::Dxf,
            "svg" => Self::Svg,
            "pdf" => Self::Pdf,
            "png" => Self::Png,
            "ifc" => Self::Ifc,
            "gltf" => Self::Gltf,
            "3dm" => Self::Rhino3dm,
            _ => return None,
        })
    }

    fn filter(self) -> FileFilter {
        let (name, extensions): (&'static str, &'static [&'static str]) = match self {
            Self::Dxf => ("DXF 도면", &["dxf"]),
            Self::Svg => ("SVG 이미지", &["svg"]),
            Self::Pdf => ("PDF 문서", &["pdf"]),
            Self::Png => ("PNG 이미지", &["png"]),
            Self::Ifc => ("IFC 모델", &["ifc"]),
            Self::Gltf => ("glTF 모델", &["gltf"]),
            Self::Rhino3dm => ("Rhino 모델", &["3dm"]),
        };
        FileFilter { name, extensions }
    }

    /// 본문 상한: DXF 20MiB, 나머지 100MiB.
    pub fn max_bytes(self) -> u64 {
        match self {
            Self::Dxf => DXF_MAX_BYTES,
            _ => MODEL_MAX_BYTES,
        }
    }

    fn default_name(self) -> String {
        format!("export.{}", self.filter().extensions[0])
    }
}

/// 저장 결과. 경로 원문 대신 `path_hash`(exports 테이블 기록용).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path_hash: String,
    pub bytes: u64,
    pub sha256: String,
}

/// 같은 폴더 임시 파일 → fsync → rename. 실패하면 임시 파일을 지우고 AR052.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::new(code::WRITE_FAILED, "no_parent"))?;
    let tmp = dir.join(format!(".arch-export-{}.tmp", uuid::Uuid::now_v7()));
    let result = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    result.map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::io(code::WRITE_FAILED, &e)
    })
}

/// 본문 검사: 비어 있으면 INVALID_INPUT, 형식별 상한 초과는 AR055.
pub fn check_body(format: ExportFormat, len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(AppError::new(code::INVALID_INPUT, "empty"));
    }
    if len as u64 > format.max_bytes() {
        return Err(AppError::new(
            code::TOO_LARGE,
            format.max_bytes().to_string(),
        ));
    }
    Ok(())
}

/// 저장 대화상자. 취소는 Ok(None), 고른 확장자가 형식과 다르면 INVALID_INPUT.
pub fn pick_target(
    picker: &dyn FilePicker,
    format: ExportFormat,
) -> Result<Option<PathBuf>, AppError> {
    let filter = format.filter();
    let Some(path) = picker.pick_save(filter, &format.default_name()) else {
        return Ok(None);
    };
    if !filter.extensions.contains(&extension_lower(&path).as_str()) {
        return Err(AppError::new(code::INVALID_INPUT, "extension"));
    }
    Ok(Some(path))
}

/// 고른 경로에 쓰고 결과(경로 원문 없음)를 만든다.
pub fn write_export(path: &Path, bytes: &[u8]) -> Result<ExportResult, AppError> {
    write_atomic(path, bytes)?;
    Ok(ExportResult {
        path_hash: path_hash(path),
        bytes: bytes.len() as u64,
        sha256: sha256_hex(bytes),
    })
}

/// 검사 → 저장 대화상자 → 쓰기. 취소는 Ok(None).
pub fn export_with_picker(
    picker: &dyn FilePicker,
    format: ExportFormat,
    bytes: &[u8],
) -> Result<Option<ExportResult>, AppError> {
    check_body(format, bytes.len())?;
    match pick_target(picker, format)? {
        Some(path) => write_export(&path, bytes).map(Some),
        None => Ok(None),
    }
}

/// 원시 본문(바이트)을 저장 대화상자로 고른 위치에 쓴다.
#[tauri::command]
pub async fn export_save_file(
    request: Request<'_>,
    picker: State<'_, PickerState>,
) -> Result<Option<ExportResult>, AppError> {
    let format = request
        .headers()
        .get(FORMAT_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(ExportFormat::parse)
        .ok_or_else(|| AppError::new(code::INVALID_INPUT, "format"))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::new(code::INVALID_INPUT, "body"));
    };
    check_body(format, bytes.len())?;
    // 대화상자만 블로킹 스레드에서 연다. 본문은 복사하지 않고 빌린 채로 쓴다.
    let picker = picker.0.clone();
    let target = tauri::async_runtime::spawn_blocking(move || pick_target(&*picker, format))
        .await
        .map_err(|_| AppError::new(code::WRITE_FAILED, "join"))??;
    match target {
        Some(path) => write_export(&path, bytes).map(Some),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(Option<PathBuf>);
    impl FilePicker for Fake {
        fn pick_open(&self, _: FileFilter) -> Option<PathBuf> {
            None
        }
        fn pick_save(&self, _: FileFilter, _: &str) -> Option<PathBuf> {
            self.0.clone()
        }
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arch-export-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftovers(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count()
    }

    #[test]
    fn writes_and_replaces_atomically() {
        let dir = temp_dir();
        let target = dir.join("a.dxf");
        std::fs::write(&target, b"old").unwrap();
        let res = export_with_picker(&Fake(Some(target.clone())), ExportFormat::Dxf, b"new")
            .unwrap()
            .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert_eq!(res.bytes, 3);
        assert_eq!(res.sha256, sha256_hex(b"new"));
        assert_eq!(res.path_hash, path_hash(&target));
        assert!(!res.path_hash.contains("a.dxf"));
        assert_eq!(leftovers(&dir), 0);
    }

    #[test]
    fn cancel_returns_none() {
        assert_eq!(
            export_with_picker(&Fake(None), ExportFormat::Pdf, b"x").unwrap(),
            None
        );
    }

    #[test]
    fn write_failure_is_ar052_without_path() {
        let dir = temp_dir();
        let target = dir.join("missing-subdir").join("a.dxf");
        let err = export_with_picker(&Fake(Some(target)), ExportFormat::Dxf, b"x").unwrap_err();
        assert_eq!(err.code, code::WRITE_FAILED);
        assert!(!err.detail.contains("missing-subdir"));
    }

    #[test]
    fn target_is_directory_is_ar052_and_cleans_tmp() {
        let dir = temp_dir();
        let target = dir.join("folder.dxf");
        std::fs::create_dir_all(&target).unwrap();
        let err = write_atomic(&target, b"x").unwrap_err();
        assert_eq!(err.code, code::WRITE_FAILED);
        assert_eq!(leftovers(&dir), 0);
    }

    #[test]
    fn picked_extension_must_match_format() {
        let dir = temp_dir();
        for name in ["a.exe", "a", "a.dxf.bat"] {
            let target = dir.join(name);
            let err = export_with_picker(&Fake(Some(target.clone())), ExportFormat::Dxf, b"x")
                .unwrap_err();
            assert_eq!(err.code, code::INVALID_INPUT, "{name}");
            assert!(!target.exists());
        }
        let upper = dir.join("A.DXF");
        assert!(export_with_picker(&Fake(Some(upper)), ExportFormat::Dxf, b"x").is_ok());
    }

    #[test]
    fn body_over_format_limit_is_ar055() {
        let over_dxf = (DXF_MAX_BYTES + 1) as usize;
        assert_eq!(
            check_body(ExportFormat::Dxf, over_dxf).unwrap_err().code,
            code::TOO_LARGE
        );
        assert!(check_body(ExportFormat::Pdf, over_dxf).is_ok());
        assert!(check_body(ExportFormat::Ifc, MODEL_MAX_BYTES as usize).is_ok());
        for f in [
            ExportFormat::Png,
            ExportFormat::Gltf,
            ExportFormat::Rhino3dm,
        ] {
            assert_eq!(
                check_body(f, MODEL_MAX_BYTES as usize + 1)
                    .unwrap_err()
                    .code,
                code::TOO_LARGE
            );
        }
    }

    #[test]
    fn empty_bytes_and_unknown_format_rejected() {
        assert_eq!(
            export_with_picker(&Fake(None), ExportFormat::Dxf, b"")
                .unwrap_err()
                .code,
            code::INVALID_INPUT
        );
        assert!(ExportFormat::parse("exe").is_none());
        assert!(ExportFormat::parse("../a.dxf").is_none());
    }
}
