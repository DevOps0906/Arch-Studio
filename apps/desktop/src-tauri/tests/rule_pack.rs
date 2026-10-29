//! AR-06-042 규칙 팩 설치·불러오기 통합 테스트(계획 공격 P1·P2·P4·P6·P7·P8·P12·P13).
//! 키는 ARCH_TEST_ONLY 시드로 테스트 안에서만 만든다(라이브러리·운영 고리에 없음).
use std::path::{Path, PathBuf};
use std::sync::Arc;

use arch_studio_desktop_lib::commands::license::LicenseService;
use arch_studio_desktop_lib::commands::rule_pack::{
    RulePackService, RulePackState, MANIFEST_FILE, PACK_FILE, QUARANTINE_DIR,
};
use arch_studio_desktop_lib::device::{current_device_hash, StaticDeviceId};
use arch_studio_desktop_lib::license::codec::{b64url_encode, parse_date, parse_instant};
use arch_studio_desktop_lib::license::rule_pack::{
    compare_versions, valid_version, MAX_PACK_BYTES,
};
use arch_studio_desktop_lib::license::{
    KeyRing, MemoryClockStore, LICENSE_CONTEXT, RULEPACK_CONTEXT,
};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

const MACHINE: &str = "4c4c4544-0042-3510-8051-b4c04f4e3332";
const LIC_KID: &str = "unit-lic-1";
const PACK_KID: &str = "unit-pack-1";
const PACK_KID_2: &str = "unit-pack-2";
const ISSUED: &str = "2026-10-29T03:04:05Z";

fn key(label: u8) -> SigningKey {
    // ARCH_TEST_ONLY: 테스트 전용 시드(운영 고리에 없음).
    SigningKey::from_bytes(&[label; 32])
}

fn ring(entries: &[(&str, &SigningKey)]) -> KeyRing {
    let raw: Vec<(&str, [u8; 32])> = entries
        .iter()
        .map(|(k, s)| (*k, s.verifying_key().to_bytes()))
        .collect();
    KeyRing::from_raw(&raw).unwrap()
}

fn envelope(sk: &SigningKey, ctx: &[u8], body: &[u8], kid: &str, body_key: &str) -> String {
    let mut msg = ctx.to_vec();
    msg.extend_from_slice(body);
    let sig = sk.sign(&msg);
    json!({ body_key: b64url_encode(body), "sig": b64url_encode(&sig.to_bytes()), "kid": kid })
        .to_string()
}

fn device_hash() -> String {
    current_device_hash(&StaticDeviceId(Some(MACHINE.into()))).unwrap()
}

/// 영구 라이선스 파일(updates_until 2027-10-28). `plan`이면 체험(rule_pack_updates 값 지정).
fn license_file(source: &str, rule_pack_updates: bool) -> String {
    let perpetual = source == "license";
    let payload = json!({
        "v": 1, "license_id": if perpetual { json!("33333333-3333-4333-8333-333333333333") } else { Value::Null },
        "org_id": "11111111-1111-4111-8111-111111111111", "app_id": "arch",
        "sku": if perpetual { "perpetual_standard" } else { "trial" }, "source": source,
        "updates_until": if perpetual { json!("2027-10-28") } else { Value::Null },
        "activation_id": "22222222-2222-4222-8222-222222222222", "device_hash": device_hash(),
        "issued_at": ISSUED, "kid": LIC_KID,
        "offline_valid_until": if perpetual { Value::Null } else { json!("2026-11-05T00:00:00Z") },
        "features": {"drafting_watermark": false, "rule_pack_updates": rule_pack_updates, "cloud_review": true, "ai_render": false}
    });
    envelope(
        &key(1),
        LICENSE_CONTEXT,
        payload.to_string().as_bytes(),
        LIC_KID,
        "payload",
    )
}

fn pack_body(version: &str, extra: &str) -> Vec<u8> {
    format!("{{\"version\":\"{version}\",\"x\":\"{extra}\"}}").into_bytes()
}

fn manifest(version: &str, pack: &[u8], published_at: &str, kid: &str) -> Value {
    let sha: String = Sha256::digest(pack)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    json!({
        "v": 1, "app_id": "arch", "version": version, "published_at": published_at,
        "basis_date": "2026-10-14", "sha256": sha, "bytes": pack.len(), "kid": kid
    })
}

fn signed(sk: &SigningKey, kid: &str, m: &Value) -> String {
    envelope(
        sk,
        RULEPACK_CONTEXT,
        m.to_string().as_bytes(),
        kid,
        "manifest",
    )
}

fn sign_pack(version: &str, pack: &[u8]) -> String {
    signed(
        &key(9),
        PACK_KID,
        &manifest(version, pack, "2026-10-20T00:00:00Z", PACK_KID),
    )
}

fn temp_root(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("arch-rulepack-{tag}-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn service_at(root: Option<&Path>, now: i64) -> RulePackService {
    let license = Arc::new(LicenseService::new(
        ring(&[(LIC_KID, &key(1))]),
        Arc::new(StaticDeviceId(Some(MACHINE.into()))),
        Arc::new(MemoryClockStore::default()),
        Arc::new(move || now),
        parse_date("2026-10-01"),
    ));
    RulePackService::new(
        ring(&[(PACK_KID, &key(9)), (PACK_KID_2, &key(10))]),
        license,
        root.map(|r| r.join("rule-packs")),
    )
}

/// 규칙 팩 고리를 지정한 서비스(키 회전 시나리오).
fn service_with_ring(root: &Path, now: i64, pack_ring: KeyRing) -> RulePackService {
    let license = Arc::new(LicenseService::new(
        ring(&[(LIC_KID, &key(1))]),
        Arc::new(StaticDeviceId(Some(MACHINE.into()))),
        Arc::new(MemoryClockStore::default()),
        Arc::new(move || now),
        parse_date("2026-10-01"),
    ));
    RulePackService::new(pack_ring, license, Some(root.join("rule-packs")))
}

fn sign_pack_2(version: &str, pack: &[u8]) -> String {
    signed(
        &key(10),
        PACK_KID_2,
        &manifest(version, pack, "2026-10-20T00:00:00Z", PACK_KID_2),
    )
}

fn quarantined(root: &Path) -> Vec<String> {
    std::fs::read_dir(root.join("rule-packs").join(QUARANTINE_DIR))
        .map(|d| {
            let mut v: Vec<String> = d
                .filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            v.sort();
            v
        })
        .unwrap_or_default()
}

fn now() -> i64 {
    parse_instant(ISSUED).unwrap() + 60
}

#[test]
fn install_then_load_roundtrip() {
    let root = temp_root("roundtrip");
    let s = service_at(Some(&root), now());
    let lic = license_file("license", true);
    assert_eq!(s.load(Some(&lic)).state, "missing");
    let pack = pack_body("2026.10.0", "a");
    let r = s.install(Some(&lic), &sign_pack("2026.10.0", &pack), &pack);
    assert_eq!(r.state, "installed");
    assert_eq!(r.version.as_deref(), Some("2026.10.0"));
    let l = s.load(Some(&lic));
    assert_eq!(l.state, "ok");
    let p = l.pack.unwrap();
    assert_eq!(p.text.as_bytes(), &pack[..]);
    assert_eq!(p.version, "2026.10.0");
    assert_eq!(p.sha256.len(), 64);
    assert!(!format!("{p:?}").contains("\"x\""), "Debug는 본문을 가린다");
    // 고정 파일 이름만 쓴다.
    let dir = root.join("rule-packs").join("2026.10.0");
    assert!(dir.join(MANIFEST_FILE).is_file() && dir.join(PACK_FILE).is_file());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn forged_or_swapped_packs_are_rejected_before_writing() {
    let root = temp_root("forged");
    let s = service_at(Some(&root), now());
    let lic = license_file("license", true);
    let pack = pack_body("2026.10.0", "a");
    let good = sign_pack("2026.10.0", &pack);
    // 본문 바꿔치기.
    let mut other = pack.clone();
    other[2] = b'X';
    assert_eq!(
        s.install(Some(&lic), &good, &other).state,
        "content_mismatch"
    );
    // 라이선스 접두로 서명한 매니페스트(도메인 교차).
    let m = manifest("2026.10.0", &pack, "2026-10-20T00:00:00Z", PACK_KID);
    let cross = envelope(
        &key(9),
        LICENSE_CONTEXT,
        m.to_string().as_bytes(),
        PACK_KID,
        "manifest",
    );
    assert_eq!(
        s.install(Some(&lic), &cross, &pack).state,
        "invalid_signature"
    );
    // 모르는 kid, 다른 키로 서명.
    assert_eq!(
        s.install(Some(&lic), &signed(&key(11), "nope", &m), &pack)
            .state,
        "unknown_kid"
    );
    assert_eq!(
        s.install(Some(&lic), &signed(&key(11), PACK_KID, &m), &pack)
            .state,
        "invalid_signature"
    );
    // 경로 조작 버전(서명돼 있어도 형식 위반).
    for v in ["../2026.10.0", "2026.10.0/..", "2026.1.0", "2026.10.0\\x"] {
        let bad = manifest(v, &pack, "2026-10-20T00:00:00Z", PACK_KID);
        assert_eq!(
            s.install(Some(&lic), &signed(&key(9), PACK_KID, &bad), &pack)
                .state,
            "malformed",
            "{v}"
        );
    }
    // 크기 상한(파싱 전).
    let huge = vec![b' '; MAX_PACK_BYTES + 1];
    assert_eq!(s.install(Some(&lic), &good, &huge).state, "too_large");
    assert_eq!(
        s.install(Some(&lic), &"x".repeat(9000), &pack).state,
        "too_large"
    );
    assert!(
        !root.join("rule-packs").exists()
            || std::fs::read_dir(root.join("rule-packs"))
                .unwrap()
                .next()
                .is_none(),
        "거부된 팩은 쓰지 않는다"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn downgrade_conflict_and_resign_rules() {
    let root = temp_root("monotonic");
    let s = service_at(Some(&root), now());
    let lic = license_file("license", true);
    let p0 = pack_body("2026.10.0", "a");
    let p1 = pack_body("2026.10.1", "b");
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.10.1", &p1), &p1)
            .state,
        "installed"
    );
    // 롤백(낮은 버전) 거부.
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.10.0", &p0), &p0)
            .state,
        "downgrade"
    );
    // 같은 버전, 다른 본문(이중 게시) 거부.
    let p1b = pack_body("2026.10.1", "c");
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.10.1", &p1b), &p1b)
            .state,
        "conflict"
    );
    // 같은 버전·같은 본문 재설치는 멱등.
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.10.1", &p1), &p1)
            .state,
        "already_installed"
    );
    // 키 회전 재서명: 같은 본문을 새 kid로 → 매니페스트만 교체.
    let resigned = signed(
        &key(10),
        PACK_KID_2,
        &manifest("2026.10.1", &p1, "2026-10-20T00:00:00Z", PACK_KID_2),
    );
    assert_eq!(
        s.install(Some(&lic), &resigned, &p1).state,
        "already_installed"
    );
    let on_disk =
        std::fs::read_to_string(root.join("rule-packs/2026.10.1").join(MANIFEST_FILE)).unwrap();
    assert_eq!(on_disk, resigned);
    // 높은 버전은 설치되고 불러오기는 최고 버전.
    let p2 = pack_body("2026.11.0", "d");
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.11.0", &p2), &p2)
            .state,
        "installed"
    );
    assert_eq!(s.load(Some(&lic)).pack.unwrap().version, "2026.11.0");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn tampered_cache_is_invalid_not_silent_fallback() {
    let root = temp_root("tamper");
    let s = service_at(Some(&root), now());
    let lic = license_file("license", true);
    let p0 = pack_body("2026.10.0", "a");
    let p1 = pack_body("2026.10.1", "b");
    s.install(Some(&lic), &sign_pack("2026.10.0", &p0), &p0);
    s.install(Some(&lic), &sign_pack("2026.10.1", &p1), &p1);
    let path = root.join("rule-packs/2026.10.1").join(PACK_FILE);
    std::fs::write(&path, pack_body("2026.10.1", "z")).unwrap();
    assert_eq!(
        s.load(Some(&lic)).state,
        "invalid",
        "낮은 버전으로 조용히 내려가지 않는다"
    );
    // 정상 팩 재설치로 복구(손상 폴더 교체).
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.10.1", &p1), &p1)
            .state,
        "installed"
    );
    assert_eq!(s.load(Some(&lic)).state, "ok");
    // 남은 임시 폴더·버전 아닌 이름은 무시하고, 설치 때 임시 폴더를 지운다.
    std::fs::create_dir_all(root.join("rule-packs/.tmp-left")).unwrap();
    std::fs::create_dir_all(root.join("rule-packs/9999.99.999x")).unwrap();
    assert_eq!(s.load(Some(&lic)).pack.unwrap().version, "2026.10.1");
    let p2 = pack_body("2026.12.0", "e");
    s.install(Some(&lic), &sign_pack("2026.12.0", &p2), &p2);
    assert!(!root.join("rule-packs/.tmp-left").exists());
    // 폴더 이름과 서명된 버전이 다르면(옮겨 놓은 폴더) 믿지 않는다.
    std::fs::rename(
        root.join("rule-packs/2026.12.0"),
        root.join("rule-packs/2027.01.0"),
    )
    .unwrap();
    assert_eq!(s.load(Some(&lic)).state, "invalid");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn entitlement_is_checked_on_install_and_every_load() {
    let root = temp_root("entitle");
    let lic = license_file("license", true);
    let pack = pack_body("2026.10.0", "a");
    let m = sign_pack("2026.10.0", &pack);
    let s = service_at(Some(&root), now());
    // 라이선스 없음·위조 라이선스 → 설치 0.
    assert_eq!(s.install(None, &m, &pack).state, "not_entitled");
    assert_eq!(s.install(Some("{}"), &m, &pack).state, "not_entitled");
    // updates_until(2027-10-28) 다음 날 00:00 KST 이후 게시된 팩은 영구 라이선스 자격 밖.
    let late = pack_body("2027.11.0", "late");
    let late_m = signed(
        &key(9),
        PACK_KID,
        &manifest("2027.11.0", &late, "2027-10-28T15:00:00Z", PACK_KID),
    );
    assert_eq!(s.install(Some(&lic), &late_m, &late).state, "not_entitled");
    // 체험인데 rule_pack_updates=false → 자격 밖.
    assert_eq!(
        s.install(Some(&license_file("plan", false)), &m, &pack)
            .state,
        "not_entitled"
    );
    assert_eq!(s.install(Some(&lic), &m, &pack).state, "installed");
    // 같은 폴더, 31일 뒤(권리 재확인 기한 지남) → 불러오기 거부.
    let later = service_at(Some(&root), now() + 31 * 86_400);
    assert_eq!(later.load(Some(&lic)).state, "not_entitled");
    assert_eq!(later.load(None).state, "not_entitled");
    // 설치 폴더 없음(앱 데이터 폴더를 못 얻음).
    let none = service_at(None, now());
    assert_eq!(none.load(Some(&lic)).state, "missing");
    assert_eq!(none.install(Some(&lic), &m, &pack).state, "write_failed");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn key_rotation_skips_unknown_kid_and_recovers_on_higher_install() {
    // 보안 리뷰 #2: 고리에서 kid를 뺀 빌드로 바뀌면 그 kid로 서명된 상위 폴더 때문에 영구 invalid가 되면 안 된다.
    let root = temp_root("rotate");
    let lic = license_file("license", true);
    let old = service_at(Some(&root), now()); // 고리 = {PACK_KID, PACK_KID_2}
    let p9 = pack_body("2026.09.0", "a");
    let p12 = pack_body("2026.12.0", "b");
    assert_eq!(
        old.install(Some(&lic), &sign_pack("2026.09.0", &p9), &p9)
            .state,
        "installed"
    );
    assert_eq!(
        old.install(Some(&lic), &sign_pack_2("2026.12.0", &p12), &p12)
            .state,
        "installed"
    );
    assert_eq!(old.load(Some(&lic)).pack.unwrap().version, "2026.12.0");

    // 회전: PACK_KID_2 제거(유출 대응 빌드).
    let rotated = service_with_ring(&root, now(), ring(&[(PACK_KID, &key(9))]));
    let l = rotated.load(Some(&lic));
    assert_eq!(l.state, "ok", "모르는 kid 폴더는 건너뛴다");
    assert_eq!(l.pack.unwrap().version, "2026.09.0");
    // 롤백 기준은 검증된 최고 버전(2026.09.0): 더 낮은 버전은 여전히 거부.
    let p8 = pack_body("2026.08.0", "z");
    assert_eq!(
        rotated
            .install(Some(&lic), &sign_pack("2026.08.0", &p8), &p8)
            .state,
        "downgrade"
    );
    // 더 높은 버전 설치 → 성공, 검증 안 되는 상위 폴더(2026.12.0)는 격리.
    let p10 = pack_body("2026.10.0", "c");
    assert_eq!(
        rotated
            .install(Some(&lic), &sign_pack("2026.10.0", &p10), &p10)
            .state,
        "installed"
    );
    assert!(!root.join("rule-packs/2026.12.0").exists());
    let q = quarantined(&root);
    assert_eq!(q.len(), 1);
    assert!(q[0].starts_with("2026.12.0-"), "{q:?}");
    assert_eq!(rotated.load(Some(&lic)).pack.unwrap().version, "2026.10.0");
    // 설치 이후 롤백 기준은 2026.10.0.
    assert_eq!(
        rotated
            .install(Some(&lic), &sign_pack("2026.09.0", &p9), &p9)
            .state,
        "downgrade"
    );
    // 같은 본문을 남은 kid로 재서명한 2026.12.0은 다시 설치된다(격리 폴더는 버전 계산에 들어가지 않음).
    assert_eq!(
        rotated
            .install(Some(&lic), &sign_pack("2026.12.0", &p12), &p12)
            .state,
        "installed"
    );
    assert_eq!(rotated.load(Some(&lic)).pack.unwrap().version, "2026.12.0");

    // 모든 폴더가 모르는 kid면 쓸 수 있는 팩이 없다(missing).
    let empty = service_with_ring(&root, now(), ring(&[(PACK_KID_2, &key(10))]));
    assert_eq!(empty.load(Some(&lic)).state, "missing");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn tampered_higher_folder_stays_invalid_until_verified_install() {
    // 변조(서명 불일치·해시 불일치)는 모르는 kid와 달리 건너뛰지 않는다.
    let root = temp_root("tamper-high");
    let lic = license_file("license", true);
    let s = service_at(Some(&root), now());
    let p0 = pack_body("2026.10.0", "a");
    let p1 = pack_body("2026.11.0", "b");
    s.install(Some(&lic), &sign_pack("2026.10.0", &p0), &p0);
    s.install(Some(&lic), &sign_pack("2026.11.0", &p1), &p1);
    let top = root.join("rule-packs/2026.11.0");
    // (a) 서명 불일치: 알려진 kid, 다른 키로 서명.
    let forged = signed(
        &key(11),
        PACK_KID,
        &manifest("2026.11.0", &p1, "2026-10-20T00:00:00Z", PACK_KID),
    );
    std::fs::write(top.join(MANIFEST_FILE), &forged).unwrap();
    assert_eq!(s.load(Some(&lic)).state, "invalid");
    // (b) 해시 불일치.
    std::fs::write(top.join(MANIFEST_FILE), sign_pack("2026.11.0", &p1)).unwrap();
    std::fs::write(top.join(PACK_FILE), pack_body("2026.11.0", "x")).unwrap();
    assert_eq!(s.load(Some(&lic)).state, "invalid");
    // 같은 버전 정상 재설치로 복구(교체), 또는 더 높은 검증 버전 설치로 복구(격리).
    let fake_top = root.join("rule-packs/2027.01.0");
    std::fs::create_dir_all(&fake_top).unwrap();
    std::fs::write(fake_top.join(MANIFEST_FILE), &forged).unwrap();
    std::fs::write(fake_top.join(PACK_FILE), &p1).unwrap();
    assert_eq!(s.load(Some(&lic)).state, "invalid");
    // 낮은 버전 재설치(2026.10.0, 이미 있음)는 상위 변조 폴더를 치우지 않는다(조용한 하향 없음).
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.10.0", &p0), &p0)
            .state,
        "already_installed"
    );
    assert_eq!(s.load(Some(&lic)).state, "invalid");
    let p2 = pack_body("2026.12.0", "c");
    assert_eq!(
        s.install(Some(&lic), &sign_pack("2026.12.0", &p2), &p2)
            .state,
        "installed"
    );
    assert!(!fake_top.exists());
    assert_eq!(
        quarantined(&root).len(),
        1,
        "2027.01.0만 격리(2026.11.0은 아래 버전이라 그대로)"
    );
    assert!(top.exists());
    assert_eq!(s.load(Some(&lic)).pack.unwrap().version, "2026.12.0");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn version_is_canonical() {
    for ok in [
        "2026.01.0",
        "2026.12.999",
        "2026.10.1",
        "2026.10.10",
        "0000.01.0",
    ] {
        assert!(valid_version(ok), "{ok}");
    }
    for bad in [
        "2026.00.0",
        "2026.13.0",
        "2026.10.00",
        "2026.10.01",
        "2026.10.1000",
        "2026.1.0",
        "2026.10.",
        "2026..0",
        "2026.10.0.0",
        "+026.10.0",
        "2026.10.-1",
        "２026.10.0",
    ] {
        assert!(!valid_version(bad), "{bad}");
    }
}

#[test]
fn version_order_is_numeric() {
    use std::cmp::Ordering::*;
    assert_eq!(compare_versions("2026.10.10", "2026.10.9"), Greater);
    assert_eq!(compare_versions("2026.09.0", "2026.10.0"), Less);
    assert_eq!(compare_versions("2027.01.0", "2026.12.99"), Greater);
    assert_eq!(compare_versions("2026.10.0", "2026.10.0"), Equal);
}

// ---- IPC ----

fn local_url() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

fn window(service: RulePackService) -> WebviewWindow<MockRuntime> {
    let app = arch_studio_desktop_lib::builder(mock_builder())
        .manage(RulePackState(Arc::new(service)))
        .build(tauri::generate_context!())
        .expect("앱 빌드");
    WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("메인 창")
}

fn call(w: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: local_url().parse().expect("URL"),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| match b {
        InvokeResponseBody::Json(s) => serde_json::from_str(&s).expect("JSON"),
        InvokeResponseBody::Raw(_) => panic!("JSON 응답 기대"),
    })
}

#[test]
fn ipc_install_and_load_return_state_names_only() {
    let root = temp_root("ipc");
    let w = window(service_at(Some(&root), now()));
    let lic = license_file("license", true);
    let pack = pack_body("2026.10.0", "a");
    let m = sign_pack("2026.10.0", &pack);
    let r = call(
        &w,
        "rule_pack_install",
        json!({ "licenseFile": lic, "signedManifest": m, "pack": String::from_utf8(pack.clone()).unwrap() }),
    )
    .unwrap();
    assert_eq!(r, json!({ "state": "installed", "version": "2026.10.0" }));
    // 실패 응답에는 서명·본문·경로가 없다.
    let bad = call(
        &w,
        "rule_pack_install",
        json!({ "licenseFile": lic, "signedManifest": m, "pack": "{\"tampered\":1}" }),
    )
    .unwrap();
    assert_eq!(bad, json!({ "state": "content_mismatch", "version": null }));
    let text = bad.to_string();
    assert!(!text.contains("tampered") && !text.contains(&root.to_string_lossy().to_string()));
    let l = call(&w, "rule_pack_load", json!({ "licenseFile": lic })).unwrap();
    assert_eq!(l["state"], "ok");
    assert_eq!(l["pack"]["text"], String::from_utf8(pack).unwrap());
    assert_eq!(
        call(&w, "rule_pack_load", json!({})).unwrap(),
        json!({ "state": "not_entitled", "pack": null })
    );
    // 경로·URL을 받는 명령은 없다.
    for cmd in [
        "rule_pack_install_path",
        "rule_pack_download",
        "rule_pack_delete",
    ] {
        let err = call(&w, cmd, json!({})).expect_err(cmd).to_string();
        assert!(
            err.contains("not allowed") || err.contains("not found"),
            "{cmd}: {err}"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}
