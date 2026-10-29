//! Arch Studio 데스크톱 셸. 명령은 `commands/`에 있고 여기 한 곳에서 등록한다.
//! 새 명령은 build.rs `APP_COMMANDS`와 capabilities/ 에 함께 추가하고 보안 리뷰를 거친다.

pub mod commands;

use std::sync::Arc;

use commands::local_db::{LocalDb, LocalDbState};
use commands::{code, AppError, PickerState, TauriPicker};
use tauri::Manager;

/// 앱 빌더. 명령 등록만 한다(상태는 `run`의 setup에서, 테스트는 가짜로 등록).
/// 대화상자 플러그인은 Rust API용이며 `plugin:dialog|*` 권한은 capability에 주지 않는다.
pub fn builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::local_db::local_db_list_projects,
            commands::local_db::local_db_get_project,
            commands::local_db::local_db_save_project,
            commands::local_db::local_db_delete_project,
            commands::fs::fs_open_import,
            commands::export::export_save_file,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    builder(tauri::Builder::default())
        .setup(|app| {
            app.manage(PickerState(Arc::new(TauriPicker(app.handle().clone()))));
            let db = match app.path().app_data_dir() {
                Ok(dir) => LocalDb::open(&dir),
                Err(_) => Err(AppError::new(code::DB_UNAVAILABLE, "app_data_dir")),
            };
            app.manage(LocalDbState(db));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Arch Studio 셸 실행 실패");
}
