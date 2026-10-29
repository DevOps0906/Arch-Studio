//! 허용 명령 밖 invoke 거부 증명(capabilities/main.json).
use std::path::PathBuf;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

/// 플랫폼별 로컬 출처(Windows는 http://tauri.localhost, 그 밖은 tauri://localhost).
fn local_url() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

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
            url: local_url().parse().expect("URL"),
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
        "plugin:fs|write_file",
        "plugin:sql|load",
        "plugin:sql|execute",
        "plugin:sql|select",
        // 등록돼 있지만(dialog 플러그인) capability 밖이라 거부되어야 한다.
        "plugin:dialog|open",
        "plugin:dialog|save",
        "plugin:dialog|message",
        "not_registered_command",
    ] {
        let err = invoke(cmd).expect_err(cmd);
        assert!(
            err.contains("not allowed") || err.contains("not found"),
            "{cmd}: {err}"
        );
    }
}

/// 앱 명령은 capability로 허용된다(상태 미등록 오류는 나도 "not allowed"는 아니다).
#[test]
fn capability_allows_app_commands() {
    for cmd in [
        "local_db_list_projects",
        "local_db_get_project",
        "local_db_save_project",
        "local_db_delete_project",
        "fs_open_import",
        "export_save_file",
        "secret_get",
        "secret_set",
        "secret_delete",
    ] {
        if let Err(err) = invoke(cmd) {
            assert!(
                !err.contains("not allowed") && !err.contains("not found"),
                "{cmd}: {err}"
            );
        }
    }
}

/// 따옴표로 둘러싼 문자열 목록에서 값만 뽑는다.
fn quoted(block: &str) -> Vec<String> {
    block
        .split('"')
        .enumerate()
        .filter(|(i, _)| i % 2 == 1)
        .map(|(_, s)| s.to_string())
        .collect()
}

/// `marker` 뒤 첫 `open`..`close` 사이 구간.
fn between<'a>(src: &'a str, marker: &str, open: char, close: char) -> &'a str {
    let from = src.find(marker).unwrap_or_else(|| panic!("{marker} 없음")) + marker.len();
    let start = src[from..].find(open).expect("여는 괄호") + from + 1;
    let end = src[start..].find(close).expect("닫는 괄호") + start;
    &src[start..end]
}

/// build.rs `APP_COMMANDS` = lib.rs `generate_handler!` = capabilities/main.json `allow-*` (같은 집합).
/// 한쪽만 고치면(예: 명령 등록 후 capability 누락) 여기서 실패한다.
#[test]
fn command_names_match_across_build_handler_and_capability() {
    use std::collections::BTreeSet;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let read = |p: &str| std::fs::read_to_string(root.join(p)).expect(p);

    let build: BTreeSet<String> = quoted(between(
        &read("build.rs"),
        "APP_COMMANDS: &[&str] = &",
        '[',
        ']',
    ))
    .into_iter()
    .collect();

    let lib = read("src/lib.rs");
    let handler: BTreeSet<String> = between(&lib, "generate_handler!", '[', ']')
        .split(',')
        .map(|p| p.trim().rsplit("::").next().unwrap_or("").to_string())
        .filter(|n| !n.is_empty())
        .collect();

    let cap: serde_json::Value =
        serde_json::from_str(&read("capabilities/main.json")).expect("main.json");
    let allowed: BTreeSet<String> = cap["permissions"]
        .as_array()
        .expect("permissions 배열")
        .iter()
        .filter_map(|p| p.as_str()?.strip_prefix("allow-"))
        .map(|n| n.replace('-', "_"))
        .collect();

    assert!(build.len() >= 9, "APP_COMMANDS 파싱 실패: {build:?}");
    assert_eq!(build, handler, "build.rs APP_COMMANDS != generate_handler!");
    assert_eq!(
        build, allowed,
        "build.rs APP_COMMANDS != capability allow-*"
    );
}
