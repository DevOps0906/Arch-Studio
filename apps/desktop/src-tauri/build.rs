/// 앱 명령 목록. 명령별 allow-/deny- 권한이 자동 생성되고, capabilities/에 준 것만 화면이 부를 수 있다.
const APP_COMMANDS: &[&str] = &[
    "local_db_list_projects",
    "local_db_get_project",
    "local_db_save_project",
    "local_db_delete_project",
    "fs_open_import",
    "export_save_file",
    "secret_get",
    "secret_set",
    "secret_delete",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("tauri-build 실패");

    // tauri-build는 앱 바이너리에만 매니페스트를 넣는다. 테스트 실행 파일에도 넣어야
    // Windows에서 tauri::test가 STATUS_ENTRYPOINT_NOT_FOUND 없이 뜬다.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if windows_msvc {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-manifest.xml");
        println!("cargo:rerun-if-changed=test-manifest.xml");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
