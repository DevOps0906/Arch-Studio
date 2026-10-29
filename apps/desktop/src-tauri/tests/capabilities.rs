//! 허용 명령 밖 invoke 거부 증명(capabilities/main.json).
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

/// 메인 창에서 명령을 부르고, 거부되면 오류 문자열을 돌려준다.
fn invoke(cmd: &str) -> Result<(), String> {
    let app = arch_studio_desktop_lib::builder(mock_builder())
        .build(tauri::generate_context!())
        .expect("앱 빌드");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("메인 창");
    get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("URL"),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[test]
fn capability_allows_app_version() {
    assert!(invoke("plugin:app|version").is_ok());
}

#[test]
fn capability_denies_commands_outside_allowlist() {
    for cmd in [
        "plugin:window|set_title",
        "plugin:webview|create_webview_window",
        "plugin:app|app_hide",
        "plugin:fs|read_file",
        "not_registered_command",
    ] {
        let err = invoke(cmd).expect_err(cmd);
        assert!(
            err.contains("not allowed") || err.contains("not found"),
            "{cmd}: {err}"
        );
    }
}
