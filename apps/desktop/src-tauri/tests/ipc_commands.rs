//! IPC 경유 명령 검증(AR-06-006): 가짜 대화상자로 가져오기·내보내기, 로컬 DB 계약,
//! 화면이 준 경로·SQL을 받는 명령이 없음을 확인한다.
use std::path::PathBuf;
use std::sync::Arc;

use arch_studio_desktop_lib::commands::local_db::{LocalDb, LocalDbState};
use arch_studio_desktop_lib::commands::{FileFilter, FilePicker, PickerState};
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

/// 플랫폼별 로컬 출처(Windows는 http://tauri.localhost, 그 밖은 tauri://localhost).
fn local_url() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

struct Fake(Option<PathBuf>);
impl FilePicker for Fake {
    fn pick_open(&self, _: FileFilter) -> Option<PathBuf> {
        self.0.clone()
    }
    fn pick_save(&self, _: FileFilter, _: &str) -> Option<PathBuf> {
        self.0.clone()
    }
}

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("arch-ipc-{tag}-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn app(picked: Option<PathBuf>, db_dir: &std::path::Path) -> WebviewWindow<MockRuntime> {
    let app = arch_studio_desktop_lib::builder(mock_builder())
        .manage(PickerState(Arc::new(Fake(picked))))
        .manage(LocalDbState(LocalDb::open(db_dir)))
        .build(tauri::generate_context!())
        .expect("앱 빌드");
    WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("메인 창")
}

fn call(
    w: &WebviewWindow<MockRuntime>,
    cmd: &str,
    body: InvokeBody,
    headers: tauri::http::HeaderMap,
) -> Result<InvokeResponseBody, Value> {
    get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: local_url().parse().expect("URL"),
            body,
            headers,
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

fn json_call(w: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    call(w, cmd, InvokeBody::Json(args), Default::default()).map(|b| match b {
        InvokeResponseBody::Json(s) => serde_json::from_str(&s).expect("JSON"),
        InvokeResponseBody::Raw(_) => panic!("JSON 응답 기대"),
    })
}

#[test]
fn fs_open_import_returns_raw_bytes_from_picked_file() {
    let dir = temp_dir("fs");
    let file = dir.join("plan.dxf");
    std::fs::write(&file, b"0\nEOF\n").unwrap();
    let w = app(Some(file), &dir);
    let res = call(
        &w,
        "fs_open_import",
        InvokeBody::Json(json!({"kind": "dxf"})),
        Default::default(),
    )
    .expect("가져오기");
    match res {
        InvokeResponseBody::Raw(b) => assert_eq!(b, b"0\nEOF\n"),
        InvokeResponseBody::Json(_) => panic!("원시 응답 기대"),
    }
}

#[test]
fn fs_open_import_ignores_screen_path_and_rejects_oversize() {
    let dir = temp_dir("fs-big");
    let big = dir.join("big.dxf");
    std::fs::File::create(&big)
        .unwrap()
        .set_len(20 * 1024 * 1024 + 1)
        .unwrap();
    let w = app(Some(big), &dir);
    let err = json_call(
        &w,
        "fs_open_import",
        json!({"kind": "dxf", "path": "C:/Windows/win.ini"}),
    )
    .unwrap_err();
    assert_eq!(err["code"], "AR055");
    let bad_kind = json_call(&w, "fs_open_import", json!({"kind": "C:/x.dxf"})).unwrap_err();
    assert!(bad_kind.is_string(), "역직렬화 거부: {bad_kind}");
}

#[test]
fn export_save_file_writes_raw_body() {
    let dir = temp_dir("export");
    let target = dir.join("out.dxf");
    let w = app(Some(target.clone()), &dir);
    let mut headers = tauri::http::HeaderMap::new();
    headers.insert("x-export-format", "dxf".parse().unwrap());
    let res = call(
        &w,
        "export_save_file",
        InvokeBody::Raw(b"0\nSECTION\n".to_vec()),
        headers,
    )
    .expect("내보내기");
    let InvokeResponseBody::Json(s) = res else {
        panic!("JSON 응답 기대");
    };
    let v: Value = serde_json::from_str(&s).unwrap();
    assert_eq!(v["bytes"], 10);
    assert!(!s.contains("out.dxf"), "경로 원문 노출: {s}");
    assert_eq!(std::fs::read(&target).unwrap(), b"0\nSECTION\n");
}

#[test]
fn export_save_file_requires_format_header_and_raw_body() {
    let dir = temp_dir("export-bad");
    let w = app(Some(dir.join("x.dxf")), &dir);
    let err = call(
        &w,
        "export_save_file",
        InvokeBody::Raw(b"x".to_vec()),
        Default::default(),
    )
    .unwrap_err();
    assert_eq!(err["code"], "INVALID_INPUT");
    let mut headers = tauri::http::HeaderMap::new();
    headers.insert("x-export-format", "dxf".parse().unwrap());
    let err = call(
        &w,
        "export_save_file",
        InvokeBody::Json(json!({"path": "C:/x.dxf"})),
        headers,
    )
    .unwrap_err();
    assert_eq!(err["code"], "INVALID_INPUT");
    assert!(!dir.join("x.dxf").exists());
}

#[test]
fn local_db_contract_over_ipc() {
    let dir = temp_dir("db");
    let w = app(None, &dir);
    let id = uuid::Uuid::now_v7().to_string();
    let input = json!({
        "id": id, "name": "주택", "schemaVersion": 1, "engineVersion": "0.1.0",
        "designModel": "{\"schema_version\":1}", "expectedVersion": null
    });
    let saved = json_call(&w, "local_db_save_project", json!({"input": input})).unwrap();
    assert_eq!(saved["version"], 1);
    let mut next = input.clone();
    next["expectedVersion"] = json!(1);
    assert_eq!(
        json_call(&w, "local_db_save_project", json!({"input": next})).unwrap()["version"],
        2
    );
    let stale = json_call(&w, "local_db_save_project", json!({"input": next})).unwrap_err();
    assert_eq!(stale["code"], "VERSION_CONFLICT");
    let got = json_call(&w, "local_db_get_project", json!({"id": id})).unwrap();
    assert_eq!(got["version"], 2);
    let list = json_call(&w, "local_db_list_projects", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    let mut with_sql = input.clone();
    with_sql["sql"] = json!("DROP TABLE projects");
    assert!(json_call(&w, "local_db_save_project", json!({"input": with_sql})).is_err());
    let inj = json_call(&w, "local_db_get_project", json!({"id": "x' OR 1=1 --"})).unwrap_err();
    assert_eq!(inj["code"], "INVALID_INPUT");
    // 클라우드 사본 연결(AR-06-077): camelCase 왕복, 모르는 필드 거부.
    assert!(json_call(&w, "local_db_get_cloud_link", json!({"id": id}))
        .unwrap()
        .is_null());
    let cloud = uuid::Uuid::now_v7().to_string();
    let link = json!({"projectUuid": cloud, "cloudVersion": 1});
    json_call(
        &w,
        "local_db_set_cloud_link",
        json!({"id": id, "link": link}),
    )
    .unwrap();
    assert_eq!(
        json_call(&w, "local_db_get_cloud_link", json!({"id": id})).unwrap(),
        link
    );
    let extra = json!({"projectUuid": cloud, "cloudVersion": 2, "path": "../x"});
    assert!(json_call(
        &w,
        "local_db_set_cloud_link",
        json!({"id": id, "link": extra})
    )
    .is_err());
    json_call(
        &w,
        "local_db_delete_project",
        json!({"id": id, "expectedVersion": 2}),
    )
    .unwrap();
    assert!(json_call(&w, "local_db_get_project", json!({"id": id}))
        .unwrap()
        .is_null());
}

/// 명령 시그니처에 경로·SQL 인자가 없다(정적 검사).
#[test]
fn no_command_takes_path_or_sql_argument() {
    let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/commands");
    let mut commands = 0;
    for entry in std::fs::read_dir(src_dir).unwrap() {
        let src = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        for part in src.split("#[tauri::command").skip(1) {
            let sig_start = part.find("fn ").expect("fn");
            let sig_end = part[sig_start..].find('{').expect("{") + sig_start;
            let sig = part[sig_start..sig_end].to_ascii_lowercase();
            commands += 1;
            for banned in ["path", "sql", "query", "table", "file_name", "dir"] {
                assert!(!sig.contains(banned), "명령 인자 금지어 {banned}: {sig}");
            }
        }
    }
    // 이름 집합 일치는 tests/capabilities.rs의 command_names_match_across_build_handler_and_capability가 보증한다.
    assert!(commands >= 9, "명령 소스 파싱 실패: {commands}");
}

/// rasterize_svg(AR-06-080): SVG 문자열 → 원시 PNG, 상한·옵션·경로 인자, 오류에 SVG 원문 없음.
/// 앱 전체 관문(동시 1건)을 쓰므로 한 테스트 안에서 순서대로 부른다.
#[test]
fn rasterize_svg_over_ipc() {
    let dir = temp_dir("raster");
    let w = app(None, &dir);
    let leak = "SECRET-SVG-CONTENT";
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 1000 500"><title>{leak}</title><rect width="1000" height="500" fill="#fff"/><line x1="0" y1="0" x2="1000" y2="500" stroke="#000" stroke-width="10"/></svg>"##
    );
    let res = call(
        &w,
        "rasterize_svg",
        InvokeBody::Json(json!({"svg": svg, "options": {"widthPx": 200}})),
        Default::default(),
    )
    .expect("래스터화");
    let InvokeResponseBody::Raw(png) = res else {
        panic!("원시 응답 기대");
    };
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert!(!String::from_utf8_lossy(&png).contains(leak));

    let reject = |args: Value| -> Value {
        let e = call(
            &w,
            "rasterize_svg",
            InvokeBody::Json(args),
            Default::default(),
        )
        .expect_err("거부 기대");
        assert!(!e.to_string().contains(leak), "오류에 SVG 원문: {e}");
        e
    };
    let big = format!("{svg}{}", " ".repeat(8 * 1024 * 1024));
    assert_eq!(
        reject(json!({"svg": big, "options": {"widthPx": 10}}))["code"],
        "AR055"
    );
    assert_eq!(
        reject(json!({"svg": svg, "options": {"widthPx": 50000}}))["code"],
        "AR055"
    );
    let img = svg.replace(
        "</svg>",
        &format!(r#"<image href="C:/{leak}.png" width="1" height="1"/></svg>"#),
    );
    let e = reject(json!({"svg": img, "options": {"widthPx": 10}}));
    assert_eq!(e["code"], "INVALID_INPUT");
    assert_eq!(e["detail"], "element");
    assert_eq!(
        reject(json!({"svg": format!("<svg>{leak}"), "options": {"widthPx": 10}}))["code"],
        "INVALID_INPUT"
    );
    assert_eq!(
        reject(json!({"svg": svg, "options": {"widthPx": 10, "dpi": 96}}))["code"],
        "INVALID_INPUT"
    );
    // 경로·URL 인자는 받지 않는다: 알 수 없는 옵션 필드는 역직렬화 거부, svg 없이 path만 주면 거부.
    assert!(
        reject(json!({"svg": svg, "options": {"widthPx": 10, "path": "C:/x.png"}})).is_string()
    );
    assert!(reject(json!({"path": "C:/x.svg", "options": {"widthPx": 10}})).is_string());
    assert!(!dir.join("x.png").exists());
}
