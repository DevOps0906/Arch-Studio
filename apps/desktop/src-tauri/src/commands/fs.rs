//! 파일 가져오기(AR-06-006). 경로 인자 없이 Rust가 OS 대화상자를 열고, 고른 파일만 읽는다.
//! 한 핸들로 열어 일반 파일·크기를 확인하고, 상한(실제 확장자 기준)을 넘으면 읽기 전에 AR055.

use std::io::Read;
use std::path::Path;

use serde::Deserialize;
use tauri::ipc::Response;
use tauri::State;

use super::{code, extension_lower, AppError, FileFilter, FilePicker, PickerState};

pub const DXF_MAX_BYTES: u64 = 20 * 1024 * 1024;
pub const MODEL_MAX_BYTES: u64 = 100 * 1024 * 1024;

/// 가져오기 종류. 화면은 종류만 고르고 경로는 넘기지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum ImportKind {
    #[serde(rename = "dxf")]
    Dxf,
    #[serde(rename = "ifc")]
    Ifc,
    #[serde(rename = "3dm")]
    Rhino3dm,
}

impl ImportKind {
    fn filter(self) -> FileFilter {
        match self {
            Self::Dxf => FileFilter {
                name: "DXF 도면",
                extensions: &["dxf"],
            },
            Self::Ifc => FileFilter {
                name: "IFC 모델",
                extensions: &["ifc"],
            },
            Self::Rhino3dm => FileFilter {
                name: "Rhino 모델",
                extensions: &["3dm"],
            },
        }
    }

    /// 실제 확장자 → (종류, 상한).
    fn from_path(path: &Path) -> Option<(Self, u64)> {
        match extension_lower(path).as_str() {
            "dxf" => Some((Self::Dxf, DXF_MAX_BYTES)),
            "ifc" => Some((Self::Ifc, MODEL_MAX_BYTES)),
            "3dm" => Some((Self::Rhino3dm, MODEL_MAX_BYTES)),
            _ => None,
        }
    }
}

/// 대화상자가 돌려준 경로만 읽는다. 확장자가 요청 종류와 다르면 거부.
pub fn read_picked(path: &Path, kind: ImportKind) -> Result<Vec<u8>, AppError> {
    let Some((actual, limit)) = ImportKind::from_path(path) else {
        return Err(AppError::new(code::INVALID_INPUT, "extension"));
    };
    if actual != kind {
        return Err(AppError::new(code::INVALID_INPUT, "extension"));
    }
    let file = std::fs::File::open(path).map_err(|e| AppError::io(code::READ_FAILED, &e))?;
    let meta = file
        .metadata()
        .map_err(|e| AppError::io(code::READ_FAILED, &e))?;
    if !meta.is_file() {
        return Err(AppError::new(code::READ_FAILED, "not_file"));
    }
    if meta.len() > limit {
        return Err(AppError::new(code::TOO_LARGE, limit.to_string()));
    }
    read_limited(file, meta.len(), limit)
}

/// 상한+1까지만 읽는다. 확인과 읽기 사이에 파일이 커졌으면 AR055.
fn read_limited(reader: impl Read, len_hint: u64, limit: u64) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::with_capacity(len_hint.min(limit) as usize);
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::io(code::READ_FAILED, &e))?;
    if bytes.len() as u64 > limit {
        return Err(AppError::new(code::TOO_LARGE, limit.to_string()));
    }
    Ok(bytes)
}

/// 대화상자 → 읽기. 취소는 CANCELLED.
pub fn open_with_picker(picker: &dyn FilePicker, kind: ImportKind) -> Result<Vec<u8>, AppError> {
    let path = picker
        .pick_open(kind.filter())
        .ok_or_else(|| AppError::new(code::CANCELLED, "dialog"))?;
    read_picked(&path, kind)
}

/// 가져올 파일을 대화상자로 골라 원시 바이트로 돌려준다.
#[tauri::command]
pub async fn fs_open_import(
    picker: State<'_, PickerState>,
    kind: ImportKind,
) -> Result<Response, AppError> {
    let picker = picker.0.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || open_with_picker(&*picker, kind))
        .await
        .map_err(|_| AppError::new(code::READ_FAILED, "join"))??;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fake(Option<PathBuf>);
    impl FilePicker for Fake {
        fn pick_open(&self, _: FileFilter) -> Option<PathBuf> {
            self.0.clone()
        }
        fn pick_save(&self, _: FileFilter, _: &str) -> Option<PathBuf> {
            None
        }
    }

    fn temp_file(name: &str, len: u64) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arch-fs-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        let f = std::fs::File::create(&p).unwrap();
        f.set_len(len).unwrap();
        p
    }

    #[test]
    fn reads_picked_file() {
        let p = temp_file("a.DXF", 0);
        std::fs::write(&p, b"0\nSECTION\n").unwrap();
        assert_eq!(
            open_with_picker(&Fake(Some(p)), ImportKind::Dxf).unwrap(),
            b"0\nSECTION\n"
        );
    }

    #[test]
    fn cancel_is_reported() {
        let err = open_with_picker(&Fake(None), ImportKind::Dxf).unwrap_err();
        assert_eq!(err.code, code::CANCELLED);
    }

    #[test]
    fn dxf_over_20mb_is_ar055_before_read() {
        let p = temp_file("big.dxf", DXF_MAX_BYTES + 1);
        let err = open_with_picker(&Fake(Some(p.clone())), ImportKind::Dxf).unwrap_err();
        assert_eq!(err.code, code::TOO_LARGE);
        let at_limit = temp_file("edge.dxf", DXF_MAX_BYTES);
        assert_eq!(
            read_picked(&at_limit, ImportKind::Dxf).unwrap().len() as u64,
            DXF_MAX_BYTES
        );
    }

    #[test]
    fn model_limit_is_100mb_by_actual_extension() {
        let ok = temp_file("m.ifc", DXF_MAX_BYTES + 1);
        assert!(read_picked(&ok, ImportKind::Ifc).is_ok());
        let big = temp_file("m.3dm", MODEL_MAX_BYTES + 1);
        assert_eq!(
            read_picked(&big, ImportKind::Rhino3dm).unwrap_err().code,
            code::TOO_LARGE
        );
    }

    #[test]
    fn extension_mismatch_and_unknown_are_rejected() {
        let ifc = temp_file("m.ifc", 10);
        assert_eq!(
            read_picked(&ifc, ImportKind::Dxf).unwrap_err().code,
            code::INVALID_INPUT
        );
        let exe = temp_file("m.exe", 10);
        assert_eq!(
            read_picked(&exe, ImportKind::Dxf).unwrap_err().code,
            code::INVALID_INPUT
        );
    }

    #[test]
    fn file_grown_after_check_is_ar055() {
        // 메타데이터로는 상한 안이었지만 실제로는 더 많이 읽히는 경우.
        let grown = std::io::Cursor::new(vec![0u8; 11]);
        assert_eq!(
            read_limited(grown, 5, 10).unwrap_err().code,
            code::TOO_LARGE
        );
        let exact = std::io::Cursor::new(vec![0u8; 10]);
        assert_eq!(read_limited(exact, 5, 10).unwrap().len(), 10);
    }

    #[test]
    fn directory_is_not_read() {
        let dir = std::env::temp_dir().join(format!("arch-fs-dir-{}.dxf", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        let err = read_picked(&dir, ImportKind::Dxf).unwrap_err();
        assert_eq!(err.code, code::READ_FAILED);
        assert!(!err.detail.contains("arch-fs-dir"));
    }
}
