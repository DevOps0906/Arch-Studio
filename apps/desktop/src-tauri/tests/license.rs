//! AR-06-041 통합 테스트: 040(Node signing.ts)이 서명한 교차 벡터를 Rust가 같은 규약으로 검증하는지,
//! 운영 키 고리에 테스트 키가 없는지, IPC 명령 계약(`license_verify`·`device_hash_get`).
use std::collections::BTreeMap;
use std::sync::Arc;

use arch_studio_desktop_lib::commands::license::{
    KeychainClockStore, LicenseService, LicenseState, CLOCK_ACCOUNT,
};
use arch_studio_desktop_lib::commands::secrets::{BackendError, MemoryBackend, SecretBackend};
use arch_studio_desktop_lib::device::{
    current_device_hash, DeviceIdSource, RawDeviceId, StaticDeviceId,
};
use arch_studio_desktop_lib::license::codec::{b64url_decode, parse_date, parse_instant};
use arch_studio_desktop_lib::license::rule_pack::{admit_rule_pack, RulePackRejection};
use arch_studio_desktop_lib::license::{
    evaluate, ClockLoad, ClockRecord, ClockStore, KeyRing, LicenseVerdict, MemoryClockStore,
    VerifyInput, LICENSE_CONTEXT, PRODUCTION_LICENSE_KEYS, PRODUCTION_RULEPACK_KEYS,
    RULEPACK_CONTEXT, TEST_PUBLIC_KEYS,
};
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

fn vectors() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/license/vectors.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("vectors.json")).expect("JSON")
}

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn ring_of(v: &Value) -> KeyRing {
    let entries: Vec<(String, [u8; 32])> = v
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, h)| (k.clone(), hex32(h.as_str().unwrap())))
        .collect();
    let refs: Vec<(&str, [u8; 32])> = entries.iter().map(|(k, h)| (k.as_str(), *h)).collect();
    KeyRing::from_raw(&refs).unwrap()
}

fn issued(v: &Value) -> i64 {
    parse_instant(v["issued_at"].as_str().unwrap()).unwrap()
}

#[test]
fn contexts_match_040_vectors() {
    let v = vectors();
    assert_eq!(
        v["license_context"].as_str().unwrap().as_bytes(),
        LICENSE_CONTEXT
    );
    assert_eq!(
        v["rulepack_context"].as_str().unwrap().as_bytes(),
        RULEPACK_CONTEXT
    );
}

#[test]
fn device_hash_matches_node_formula() {
    let v = vectors();
    let src = StaticDeviceId(Some(v["raw_device_id"].as_str().unwrap().to_string()));
    assert_eq!(
        current_device_hash(&src).as_deref(),
        v["device_hash"].as_str()
    );
}

#[test]
fn cross_vectors_from_040_signing() {
    let v = vectors();
    let keys = ring_of(&v["keys"]);
    let device = v["device_hash"].as_str().unwrap();
    let now = issued(&v) + 3600;
    let files = v["files"].as_object().unwrap();
    assert!(files.len() >= 15, "벡터 수");
    for (name, case) in files {
        let file = case["file"].to_string();
        let input = VerifyInput {
            keys: &keys,
            device_hash: Some(device),
            now,
            build_date: parse_date("2027-01-01"),
        };
        let (verdict, _) = evaluate(Some(&file), &input, ClockLoad::Missing);
        assert_eq!(verdict.state(), case["expect"].as_str().unwrap(), "{name}");
        // Node 참조 검증기(서명·kid만)가 통과시킨 것은 Rust도 서명 단계를 통과해야 한다(일치 확인).
        if case["node_verify"] == "ok" {
            assert!(
                !matches!(
                    verdict,
                    LicenseVerdict::InvalidSignature | LicenseVerdict::UnknownKid
                ),
                "{name}: Node는 서명 유효, Rust는 {verdict:?}"
            );
        } else {
            assert!(verdict.license().is_none(), "{name}");
        }
    }
    // 대표 벡터의 해석 값.
    let input = VerifyInput {
        keys: &keys,
        device_hash: Some(device),
        now,
        build_date: parse_date("2027-01-01"),
    };
    let check = |name: &str| {
        evaluate(
            Some(&files[name]["file"].to_string()),
            &input,
            ClockLoad::Missing,
        )
        .0
    };
    match check("perpetual") {
        LicenseVerdict::Valid(l) => {
            assert_eq!(l.payload().sku(), "perpetual_standard");
            assert_eq!(l.payload().updates_until(), Some("2027-10-28"));
            assert_eq!(l.payload().issued_at(), "2026-10-29T03:04:05Z");
            assert!(l.payload().offline_valid_until().is_none());
            // 040 computeLicenseRightsExpiry: 5키 = issued_at + 30일.
            let e = l.payload().rights_expiry().cloned().unwrap();
            for k in [
                e.web_edit,
                e.desktop_edit,
                e.ai_render,
                e.ai_chat,
                e.cloud_review,
            ] {
                assert_eq!(k.as_deref(), Some("2026-11-28T03:04:05Z"));
            }
            assert!(l.rights().desktop_edit && l.build_eligible());
        }
        other => panic!("{other:?}"),
    }
    match check("trial") {
        LicenseVerdict::Valid(l) => {
            assert_eq!(
                l.payload().offline_valid_until(),
                Some("2026-11-02T00:00:00Z")
            );
            assert!(l.payload().features().drafting_watermark);
        }
        other => panic!("{other:?}"),
    }
    match check("sub_ext") {
        LicenseVerdict::Valid(l) => {
            let r = l.rights();
            assert!(r.ai_render && r.ai_chat && r.web_edit);
            assert_eq!(l.payload().granted_rights().unwrap().devices_max, Some(2));
        }
        other => panic!("{other:?}"),
    }
    match check("unicode") {
        LicenseVerdict::Valid(l) => {
            assert_eq!(l.payload().seat_id(), Some("좌석-\"따옴표\"-\\-\u{1}-✓"));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn cross_vectors_expire_and_roll_back() {
    let v = vectors();
    let keys = ring_of(&v["keys"]);
    let device = v["device_hash"].as_str().unwrap();
    let file = v["files"]["trial"]["file"].to_string();
    let until = parse_instant("2026-11-02T00:00:00Z").unwrap();
    let at = |now: i64, prev: Option<ClockRecord>| {
        let input = VerifyInput {
            keys: &keys,
            device_hash: Some(device),
            now,
            build_date: None,
        };
        // 기록 있음(빈 초기값). 기록 없음 규칙은 단위 테스트가 따로 본다.
        let blank = ClockRecord {
            last_seen: i64::MIN,
            max_issued_at: i64::MIN,
        };
        evaluate(
            Some(&file),
            &input,
            ClockLoad::Record(prev.unwrap_or(blank)),
        )
        .0
        .state()
    };
    assert_eq!(at(until - 1, None), "valid");
    assert_eq!(at(until, None), "expired");
    // 만료 뒤 시계를 되돌리면 시계 이상.
    let rec = ClockRecord {
        last_seen: until + 86_400,
        max_issued_at: issued(&v),
    };
    assert_eq!(at(until - 86_400, Some(rec)), "clock_anomaly");
}

#[test]
fn cross_vector_rule_pack_manifest() {
    let v = vectors();
    let keys = ring_of(&v["keys"]);
    let packs = ring_of(&v["rulepack_keys"]);
    let device = v["device_hash"].as_str().unwrap();
    let input = VerifyInput {
        keys: &keys,
        device_hash: Some(device),
        now: issued(&v) + 60,
        build_date: None,
    };
    let lic = evaluate(
        Some(&v["files"]["perpetual"]["file"].to_string()),
        &input,
        ClockLoad::Missing,
    )
    .0;
    assert!(matches!(lic, LicenseVerdict::Valid(_)));
    let pack = b64url_decode(v["rulepack"]["pack_b64url"].as_str().unwrap()).unwrap();
    let rp = &v["rulepack"];
    let ok = admit_rule_pack(&lic, &packs, &rp["valid"].to_string(), pack.clone()).unwrap();
    assert_eq!(ok.manifest().version, "2026.10.1");
    for bad in ["license_prefix", "no_prefix"] {
        assert_eq!(
            admit_rule_pack(&lic, &packs, &rp[bad].to_string(), pack.clone()).unwrap_err(),
            RulePackRejection::InvalidSignature,
            "{bad}"
        );
    }
    // 규칙 팩 키는 라이선스 고리에 없다(도메인·고리 분리).
    assert_eq!(
        admit_rule_pack(&lic, &keys, &rp["valid"].to_string(), pack.clone()).unwrap_err(),
        RulePackRejection::UnknownKid
    );
    // 자격 밖(라이선스 만료) → 엔진 전달 0.
    let expired = evaluate(
        Some(&v["files"]["perpetual"]["file"].to_string()),
        &VerifyInput {
            now: issued(&v) + 31 * 86_400,
            ..input
        },
        ClockLoad::Missing,
    )
    .0;
    assert_eq!(
        admit_rule_pack(&expired, &packs, &rp["valid"].to_string(), pack).unwrap_err(),
        RulePackRejection::NotEntitled
    );
}

#[test]
fn production_keyrings_exclude_test_keys() {
    let v = vectors();
    let fixture_keys: Vec<[u8; 32]> = ["keys", "rulepack_keys"]
        .iter()
        .flat_map(|k| v[*k].as_object().unwrap().values())
        .map(|h| hex32(h.as_str().unwrap()))
        .collect();
    for ring in [
        KeyRing::production_license(),
        KeyRing::production_rulepack(),
    ] {
        for k in &fixture_keys {
            assert!(!ring.contains_public_key(k), "운영 고리에 테스트 키");
        }
        assert!(ring
            .kids()
            .iter()
            .all(|k| !k.to_ascii_lowercase().contains("test")));
    }
    // 상수 슬롯이 고리로 모두 올라간다(잘못된 상수가 조용히 빈 고리가 되지 않게).
    assert_eq!(
        KeyRing::production_license().kids().len(),
        PRODUCTION_LICENSE_KEYS.len()
    );
    assert_eq!(
        KeyRing::production_rulepack().kids().len(),
        PRODUCTION_RULEPACK_KEYS.len()
    );
    // 컴파일 가드용 거부 목록(TEST_PUBLIC_KEYS)이 교차 벡터 공개키를 모두 담는다(벡터 키를 바꾸면 함께 갱신).
    for k in &fixture_keys {
        assert!(TEST_PUBLIC_KEYS.contains(k), "거부 목록에 없는 픽스처 키");
    }
    // 운영 슬롯 상수는 오류 없이 고리가 된다(오류면 production_*()이 조용히 빈 고리가 된다).
    assert!(KeyRing::from_raw(PRODUCTION_LICENSE_KEYS).is_ok());
    assert!(KeyRing::from_raw(PRODUCTION_RULEPACK_KEYS).is_ok());
    // 라이선스·규칙 팩 운영 키는 서로 다르다.
    for (_, a) in PRODUCTION_LICENSE_KEYS {
        assert!(PRODUCTION_RULEPACK_KEYS.iter().all(|(_, b)| a != b));
    }
    // 키 파일에는 공개키 상수만(개인키 형식 문자열 없음).
    let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/keys/mod.rs")).unwrap();
    for bad in ["PRIVATE KEY", "-----BEGIN", "SigningKey", "ARCH_TEST_ONLY"] {
        assert!(!src.contains(bad), "{bad}");
    }
}

#[test]
fn fixtures_do_not_contain_private_keys() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/license/vectors.json"
    ))
    .unwrap();
    assert!(text.contains("ARCH_TEST_ONLY"));
    for bad in ["PRIVATE KEY", "302e020100300506032b6570"] {
        assert!(!text.contains(bad), "{bad}");
    }
}

#[test]
fn keychain_clock_store_roundtrip_and_isolation() {
    let backend = Arc::new(MemoryBackend::default());
    let store = KeychainClockStore::new(backend.clone());
    assert_eq!(store.load(), ClockLoad::Missing);
    let rec = ClockRecord {
        last_seen: 10,
        max_issued_at: 5,
    };
    store.save(rec);
    assert_eq!(store.load(), ClockLoad::Record(rec));
    assert_eq!(backend.accounts(), vec![CLOCK_ACCOUNT.to_string()]);
    // 형식 오류(정상 경로에서는 생기지 않음)는 기록 없음이 아니라 Corrupt(시계 이상).
    for garbage in [&b"garbage"[..], b"v1:1", b"\xff\xfe", b""] {
        backend.set(CLOCK_ACCOUNT, garbage).unwrap();
        assert_eq!(store.load(), ClockLoad::Corrupt, "{garbage:?}");
    }
    // 읽기 실패는 Unreadable(덮어쓰지 않음).
    assert_eq!(
        KeychainClockStore::new(Arc::new(FailingBackend)).load(),
        ClockLoad::Unreadable
    );
    // 화면 비밀 허용 키 밖이다.
    assert!(!arch_studio_desktop_lib::commands::secrets::ALLOWED_KEYS.contains(&CLOCK_ACCOUNT));
}

/// 항상 실패하는 키체인(잠김·접근 거부 흉내).
struct FailingBackend;

impl SecretBackend for FailingBackend {
    fn get(&self, _: &str) -> Result<Option<Vec<u8>>, BackendError> {
        Err(BackendError::Unavailable)
    }
    fn set(&self, _: &str, _: &[u8]) -> Result<(), BackendError> {
        Err(BackendError::Unavailable)
    }
    fn delete(&self, _: &str) -> Result<(), BackendError> {
        Err(BackendError::Unavailable)
    }
}

/// 조회 횟수를 세는 기기 ID 출처.
struct CountingDevice {
    raw: String,
    calls: std::sync::atomic::AtomicUsize,
}

impl DeviceIdSource for CountingDevice {
    fn raw_id(&self) -> Option<RawDeviceId> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        RawDeviceId::new(&self.raw)
    }
}

#[test]
fn service_keychain_garbage_is_clock_anomaly_and_device_hash_is_cached() {
    let v = vectors();
    let backend = Arc::new(MemoryBackend::default());
    let device = Arc::new(CountingDevice {
        raw: v["raw_device_id"].as_str().unwrap().to_string(),
        calls: Default::default(),
    });
    let now = issued(&v) + 2 * 86_400;
    let service = LicenseService::new(
        ring_of(&v["keys"]),
        device.clone(),
        Arc::new(KeychainClockStore::new(backend.clone())),
        Arc::new(move || now),
        parse_date("2027-01-01"),
    );
    let file = v["files"]["perpetual"]["file"].to_string();
    // 키체인 항목이 형식 오류면 시계 이상(기록 삭제와 같은 "열린 채 실패"가 아니다). 기록은 그대로.
    backend.set(CLOCK_ACCOUNT, b"garbage").unwrap();
    assert_eq!(service.verify(Some(&file)).state(), "clock_anomaly");
    assert_eq!(
        backend.get(CLOCK_ACCOUNT).unwrap().as_deref(),
        Some(&b"garbage"[..])
    );
    // 항목 삭제 + 1일 넘은 파일 → expired(온라인 refresh 필요), 기록을 새로 만들지 않는다.
    backend.delete(CLOCK_ACCOUNT).unwrap();
    assert_eq!(service.verify(Some(&file)).state(), "expired");
    assert_eq!(backend.get(CLOCK_ACCOUNT).unwrap(), None);
    // 반복 호출해도 기기 ID 조회는 한 번(프로세스 수명 캐시).
    for _ in 0..20 {
        let _ = service.verify(Some(&file));
        let _ = service.device_hash().unwrap();
    }
    assert_eq!(device.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn device_hash_failure_is_not_cached() {
    struct Flaky(std::sync::atomic::AtomicUsize, String);
    impl DeviceIdSource for Flaky {
        fn raw_id(&self) -> Option<RawDeviceId> {
            let n = self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            (n > 0).then(|| RawDeviceId::new(&self.1)).flatten()
        }
    }
    let v = vectors();
    let src = Arc::new(Flaky(
        Default::default(),
        v["raw_device_id"].as_str().unwrap().to_string(),
    ));
    let service = LicenseService::new(
        ring_of(&v["keys"]),
        src.clone(),
        Arc::new(MemoryClockStore::default()),
        Arc::new(|| 0),
        None,
    );
    assert!(service.device_hash().is_err());
    assert_eq!(
        service.device_hash().unwrap(),
        v["device_hash"].as_str().unwrap()
    );
    assert_eq!(
        service.device_hash().unwrap(),
        v["device_hash"].as_str().unwrap()
    );
    assert_eq!(src.0.load(std::sync::atomic::Ordering::SeqCst), 2);
}

// ---- IPC ----

fn local_url() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

struct Harness {
    window: WebviewWindow<MockRuntime>,
    store: Arc<MemoryClockStore>,
}

fn harness(device: Option<&str>, now: i64) -> Harness {
    let v = vectors();
    let store = Arc::new(MemoryClockStore::default());
    let service = LicenseService::new(
        ring_of(&v["keys"]),
        Arc::new(StaticDeviceId(device.map(str::to_string))),
        store.clone(),
        Arc::new(move || now),
        parse_date("2027-01-01"),
    );
    let app = arch_studio_desktop_lib::builder(mock_builder())
        .manage(LicenseState(Arc::new(service)))
        .build(tauri::generate_context!())
        .expect("앱 빌드");
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("메인 창");
    Harness { window, store }
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
fn ipc_license_verify_states_and_no_leak() {
    let v = vectors();
    let raw = v["raw_device_id"].as_str().unwrap().to_string();
    let h = harness(Some(&raw), issued(&v) + 3600);
    let file = v["files"]["perpetual"]["file"].to_string();
    let ok = call(&h.window, "license_verify", json!({ "file": file })).unwrap();
    assert_eq!(ok["state"], "valid");
    let lic = &ok["license"];
    assert_eq!(lic["sku"], "perpetual_standard");
    assert_eq!(lic["source"], "license");
    assert_eq!(lic["rights"]["desktop_edit"], true);
    assert_eq!(lic["rights_expiry"]["desktop_edit"], "2026-11-28T03:04:05Z");
    assert_eq!(lic["build_eligible"], true);
    // 응답에 기기 해시·kid·서명·payload 원문 없음.
    let text = ok.to_string();
    let f = &v["files"]["perpetual"]["file"];
    for s in [
        v["device_hash"].as_str().unwrap(),
        f["sig"].as_str().unwrap(),
        &f["payload"].as_str().unwrap()[..32],
        "test-lic-a",
        &raw,
    ] {
        assert!(!text.contains(s), "{s}");
    }
    let rec = h.store.get().unwrap();
    assert_eq!(rec.max_issued_at, issued(&v));

    // 실패 상태는 상태 이름만.
    for (name, state) in [
        ("other_device", "device_mismatch"),
        ("no_prefix_sig", "invalid_signature"),
        ("rulepack_prefix_sig", "invalid_signature"),
        ("duplicate_key_signed", "malformed"),
    ] {
        let r = call(
            &h.window,
            "license_verify",
            json!({ "file": v["files"][name]["file"].to_string() }),
        )
        .unwrap();
        assert_eq!(r, json!({"state": state, "license": null}), "{name}");
    }
    for args in [json!({}), json!({"file": null}), json!({"file": ""})] {
        let r = call(&h.window, "license_verify", args).unwrap();
        assert_eq!(r, json!({"state": "absent", "license": null}));
    }
    let big = "x".repeat(16 * 1024 + 1);
    let r = call(&h.window, "license_verify", json!({ "file": big })).unwrap();
    assert_eq!(r, json!({"state": "malformed", "license": null}));
    // 문자열이 아닌 입력은 역직렬화 단계에서 거부(경로·객체를 받지 않는다).
    assert!(call(
        &h.window,
        "license_verify",
        json!({"file": {"path": "/etc/passwd"}})
    )
    .is_err());
    // 기록은 실패 호출로 바뀌지 않는다.
    assert_eq!(h.store.get().unwrap(), rec);
}

#[test]
fn ipc_device_hash_get() {
    let v = vectors();
    let raw = v["raw_device_id"].as_str().unwrap().to_string();
    let h = harness(Some(&raw), 0);
    let r = call(&h.window, "device_hash_get", json!({})).unwrap();
    assert_eq!(r, v["device_hash"]);
    assert!(!r.to_string().to_lowercase().contains(&raw.to_lowercase()));

    let h = harness(None, 0);
    let err = call(&h.window, "device_hash_get", json!({})).unwrap_err();
    assert_eq!(
        err,
        json!({"code": "DEVICE_UNAVAILABLE", "detail": "device"})
    );
    // 기기 식별자를 못 읽으면 검증도 실패 닫힘.
    let r = call(
        &h.window,
        "license_verify",
        json!({ "file": v["files"]["perpetual"]["file"].to_string() }),
    )
    .unwrap();
    assert_eq!(r["state"], "device_mismatch");
}

#[test]
fn ipc_rejects_unregistered_license_commands() {
    let h = harness(None, 0);
    for cmd in [
        "license_activate",
        "license_store_set",
        "device_raw_id_get",
        "license_verify_path",
    ] {
        let err = call(&h.window, cmd, json!({})).expect_err(cmd).to_string();
        assert!(
            err.contains("not allowed") || err.contains("not found"),
            "{cmd}: {err}"
        );
    }
}

#[test]
fn production_service_with_empty_slots_fails_closed() {
    // 운영 키가 아직 없으므로 040 벡터도 unknown_kid여야 한다(테스트 키 비포함 증명).
    let v = vectors();
    let keys = KeyRing::production_license();
    let input = VerifyInput {
        keys: &keys,
        device_hash: v["device_hash"].as_str(),
        now: issued(&v),
        build_date: None,
    };
    let states: BTreeMap<String, &str> = v["files"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, c)| {
            (
                k.clone(),
                evaluate(Some(&c["file"].to_string()), &input, ClockLoad::Missing)
                    .0
                    .state(),
            )
        })
        .collect();
    if PRODUCTION_LICENSE_KEYS.is_empty() {
        assert!(states.values().all(|s| *s == "unknown_kid"), "{states:?}");
    }
    for s in states.values() {
        assert_ne!(*s, "valid");
    }
}

#[test]
fn build_date_shape_for_release_assertion() {
    use arch_studio_desktop_lib::commands::license::is_build_date_shape;
    assert!(is_build_date_shape(Some("2026-10-29")));
    for bad in [
        None,
        Some(""),
        Some("2026/10/29"),
        Some("2026-10-2"),
        Some("2026-10-290"),
        Some("20a6-10-29"),
    ] {
        assert!(!is_build_date_shape(bad), "{bad:?}");
    }
}
