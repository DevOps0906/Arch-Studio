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
    "license_verify",
    "device_hash_get",
    "rasterize_svg",
    "rule_pack_install",
    "rule_pack_load",
];

#[path = "keys/parse.rs"]
mod key_parse;

/// 운영 공개키를 환경 변수에서 읽어 `OUT_DIR/production_keys.rs`를 만든다(AR-06-042 P12).
fn inject_public_keys() {
    println!("cargo:rerun-if-env-changed=ARCH_LICENSE_PUBKEYS");
    println!("cargo:rerun-if-env-changed=ARCH_RULEPACK_PUBKEYS");
    println!("cargo:rerun-if-changed=keys/parse.rs");
    let read = |name: &str| {
        let raw = std::env::var(name).unwrap_or_default();
        key_parse::parse_key_list(&raw).unwrap_or_else(|e| panic!("{name}: {e}"))
    };
    let license = read("ARCH_LICENSE_PUBKEYS");
    let rulepack = read("ARCH_RULEPACK_PUBKEYS");
    key_parse::check_disjoint(&license, &rulepack).unwrap_or_else(|e| panic!("{e}"));
    if std::env::var("PROFILE").as_deref() == Ok("release")
        && (license.is_empty() || rulepack.is_empty())
    {
        panic!("릴리스 빌드에는 ARCH_LICENSE_PUBKEYS·ARCH_RULEPACK_PUBKEYS(운영 공개키)가 필요하다(AR-06-042 P12)");
    }
    let mut src = String::from("// build.rs가 생성(AR-06-042). 손으로 고치지 않는다.\n");
    src.push_str("/// 라이선스 파일 서명 공개키(`arch-license-v1\\n` 도메인).\n");
    src.push_str(&key_parse::render_const("LICENSE_KEYS", &license));
    src.push_str("/// 규칙 팩 매니페스트 서명 공개키(`arch-rulepack-v1\\n` 도메인).\n");
    src.push_str(&key_parse::render_const("RULEPACK_KEYS", &rulepack));
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    std::fs::write(out.join("production_keys.rs"), src).expect("production_keys.rs 쓰기");
}

fn main() {
    inject_public_keys();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("tauri-build 실패");

    // tauri-build는 앱 바이너리에만 매니페스트를 넣는다. rustc-link-arg-tests는
    // 통합 테스트에만 적용되므로 일반 linker 인자로 단위 테스트도 포함한다.
    // tauri-build의 기본 삽입은 꺼서 앱 리소스와 중복되지 않게 한다.
    // test-manifest.xml은 tauri-build 기본값과 같은 Common Controls v6 의존성이다.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if windows_msvc {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-manifest.xml");
        println!("cargo:rerun-if-changed=test-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
