//! license 단위 테스트. 키는 ARCH_TEST_ONLY 시드로 테스트 안에서만 만든다(라이브러리·운영 고리에 없음).
use super::codec::{b64url_encode, parse_instant};
use super::rule_pack::{admit_rule_pack, pack_entitled, RulePackRejection};
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

const DEVICE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_DEVICE: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KID: &str = "unit-lic-1";
const ISSUED: &str = "2026-10-29T03:04:05Z";
const DAY: i64 = 86_400;

fn key(label: u8) -> SigningKey {
    // ARCH_TEST_ONLY: 테스트 전용 시드.
    SigningKey::from_bytes(&[label; 32])
}

fn ring(entries: &[(&str, &SigningKey)]) -> KeyRing {
    let raw: Vec<(&str, [u8; 32])> = entries
        .iter()
        .map(|(k, s)| (*k, s.verifying_key().to_bytes()))
        .collect();
    KeyRing::from_raw(&raw).unwrap()
}

fn issued() -> i64 {
    parse_instant(ISSUED).unwrap()
}

fn perpetual() -> Value {
    json!({
        "v": 1, "license_id": "33333333-3333-4333-8333-333333333333",
        "org_id": "11111111-1111-4111-8111-111111111111", "app_id": "arch",
        "sku": "perpetual_standard", "source": "license", "updates_until": "2027-10-28",
        "activation_id": "22222222-2222-4222-8222-222222222222", "device_hash": DEVICE,
        "issued_at": ISSUED, "kid": KID, "offline_valid_until": null,
        "features": {"drafting_watermark": false, "rule_pack_updates": true, "cloud_review": true, "ai_render": false},
        "rights_expiry": {
            "web_edit": "2026-11-28T03:04:05Z", "desktop_edit": "2026-11-28T03:04:05Z",
            "ai_render": "2026-11-28T03:04:05Z", "ai_chat": "2026-11-28T03:04:05Z", "cloud_review": "2026-11-28T03:04:05Z"
        }
    })
}

fn trial() -> Value {
    let mut p = perpetual();
    let o = p.as_object_mut().unwrap();
    o.insert("license_id".into(), Value::Null);
    o.insert("sku".into(), json!("trial"));
    o.insert("source".into(), json!("plan"));
    o.insert("updates_until".into(), Value::Null);
    o.insert("offline_valid_until".into(), json!("2026-11-02T00:00:00Z"));
    o.remove("rights_expiry");
    p
}

fn sign_bytes(sk: &SigningKey, context: &[u8], bytes: &[u8], kid: &str) -> String {
    let mut msg = context.to_vec();
    msg.extend_from_slice(bytes);
    let sig = sk.sign(&msg);
    json!({"payload": b64url_encode(bytes), "sig": b64url_encode(&sig.to_bytes()), "kid": kid})
        .to_string()
}

fn sign(sk: &SigningKey, payload: &Value) -> String {
    sign_bytes(
        sk,
        LICENSE_CONTEXT,
        payload.to_string().as_bytes(),
        payload["kid"].as_str().unwrap(),
    )
}

fn input<'a>(keys: &'a KeyRing, now: i64) -> VerifyInput<'a> {
    VerifyInput {
        keys,
        device_hash: Some(DEVICE),
        now,
        build_date: parse_date("2027-01-01"),
    }
}

/// 기록은 있으나 아직 아무 값도 본 적 없는 상태(기록 없음 규칙과 분리해 다른 규칙을 시험할 때 쓴다).
/// 기록 없음(`ClockLoad::Missing`)·형식 오류·읽기 실패는 `clock_store_*` 테스트가 따로 시험한다.
const BLANK: ClockLoad = ClockLoad::Record(ClockRecord {
    last_seen: i64::MIN,
    max_issued_at: i64::MIN,
});

fn eval(keys: &KeyRing, file: &str, now: i64, prev: Option<ClockRecord>) -> LicenseVerdict {
    evaluate(
        Some(file),
        &input(keys, now),
        prev.map_or(BLANK, ClockLoad::Record),
    )
    .0
}

/// 시드 고정 xorshift(속성 테스트용, 의존성 없음).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn contexts_are_fixed_and_distinct() {
    assert_eq!(LICENSE_CONTEXT, b"arch-license-v1\n");
    assert_eq!(LICENSE_CONTEXT.len(), 16);
    assert_eq!(RULEPACK_CONTEXT, b"arch-rulepack-v1\n");
    assert_ne!(LICENSE_CONTEXT, RULEPACK_CONTEXT);
    assert!(!RULEPACK_CONTEXT.starts_with(LICENSE_CONTEXT));
    assert!(!LICENSE_CONTEXT.starts_with(RULEPACK_CONTEXT));
}

#[test]
fn valid_perpetual_and_trial() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    match eval(&keys, &sign(&sk, &perpetual()), issued() + DAY, None) {
        LicenseVerdict::Valid(l) => {
            assert!(l.rights.desktop_edit && l.rights.view_export);
            assert!(!l.rights.ai_render && !l.rights.web_edit);
            assert!(l.build_eligible);
        }
        v => panic!("{v:?}"),
    }
    match eval(&keys, &sign(&sk, &trial()), issued() + DAY, None) {
        LicenseVerdict::Valid(l) => assert!(l.rights.desktop_edit),
        v => panic!("{v:?}"),
    }
}

#[test]
fn absent_and_size_limits() {
    let keys = ring(&[(KID, &key(1))]);
    for f in [None, Some(""), Some("  \n")] {
        assert_eq!(
            evaluate(f, &input(&keys, 0), BLANK).0,
            LicenseVerdict::Absent
        );
    }
    let big = " ".repeat(MAX_FILE_BYTES + 1);
    assert_eq!(eval(&keys, &big, 0, None), LicenseVerdict::Malformed);
    // payload 상한 초과(서명은 유효해도 디코드 전에 거부).
    let mut p = perpetual();
    p["sku"] = json!("x".repeat(MAX_PAYLOAD_BYTES));
    let f = sign(&key(1), &p);
    assert!(f.len() <= MAX_FILE_BYTES + 4096);
    assert!(matches!(
        eval(&keys, &f, issued(), None),
        LicenseVerdict::Malformed
    ));
    let deep = format!("{}{}", "[".repeat(5000), "]".repeat(5000));
    assert_eq!(eval(&keys, &deep, 0, None), LicenseVerdict::Malformed);
    for junk in [
        "{}",
        "[]",
        "null",
        "{\"payload\":1,\"sig\":\"\",\"kid\":\"k\"}",
        "not json",
    ] {
        assert_eq!(
            eval(&keys, junk, 0, None),
            LicenseVerdict::Malformed,
            "{junk}"
        );
    }
}

#[test]
fn tampered_payload_bytes_never_valid_seeded() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let bytes = perpetual().to_string().into_bytes();
    let mut msg = LICENSE_CONTEXT.to_vec();
    msg.extend_from_slice(&bytes);
    let sig = b64url_encode(&sk.sign(&msg).to_bytes());
    let mut rng = Rng(0x0041_0001);
    for _ in 0..400 {
        let mut t = bytes.clone();
        let i = rng.below(t.len() as u64) as usize;
        t[i] ^= 1 << rng.below(8);
        let f = json!({"payload": b64url_encode(&t), "sig": sig, "kid": KID}).to_string();
        let v = eval(&keys, &f, issued(), None);
        assert_eq!(v, LicenseVerdict::InvalidSignature, "byte {i}");
    }
}

#[test]
fn signature_bit_flips_rejected() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f: Value = serde_json::from_str(&sign(&sk, &perpetual())).unwrap();
    let sig = codec::b64url_decode(f["sig"].as_str().unwrap()).unwrap();
    for bit in 0..512 {
        let mut s = sig.clone();
        s[bit / 8] ^= 1 << (bit % 8);
        let mut g = f.clone();
        g["sig"] = json!(b64url_encode(&s));
        let v = eval(&keys, &g.to_string(), issued(), None);
        assert!(
            matches!(v, LicenseVerdict::InvalidSignature),
            "bit {bit}: {v:?}"
        );
    }
    // 서명 길이·인코딩 변형.
    for bad in ["", "AAAA", &"A".repeat(88)] {
        let mut g = f.clone();
        g["sig"] = json!(bad);
        assert_eq!(
            eval(&keys, &g.to_string(), issued(), None),
            LicenseVerdict::Malformed
        );
    }
}

#[test]
fn domain_separation_and_kid_rules() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let bytes = perpetual().to_string().into_bytes();
    for ctx in [
        &b""[..],
        RULEPACK_CONTEXT,
        b"arch-license-v1",
        b"arch-license-v2\n",
        b"arch-license-v1\r\n",
    ] {
        assert_eq!(
            eval(&keys, &sign_bytes(&sk, ctx, &bytes, KID), issued(), None),
            LicenseVerdict::InvalidSignature,
            "{:?}",
            String::from_utf8_lossy(ctx)
        );
    }
    // 고리에 없는 kid / 바깥 kid만 바꿈 / 다른 키로 서명.
    let other = key(2);
    let keys2 = ring(&[(KID, &sk), ("unit-lic-2", &other)]);
    assert_eq!(
        eval(
            &keys,
            &sign_bytes(&sk, LICENSE_CONTEXT, &bytes, "unit-lic-x"),
            issued(),
            None
        ),
        LicenseVerdict::UnknownKid
    );
    assert_eq!(
        eval(
            &keys2,
            &sign_bytes(&other, LICENSE_CONTEXT, &bytes, "unit-lic-2"),
            issued(),
            None
        ),
        LicenseVerdict::InvalidSignature
    );
    assert_eq!(
        eval(
            &keys2,
            &sign_bytes(&other, LICENSE_CONTEXT, &bytes, KID),
            issued(),
            None
        ),
        LicenseVerdict::InvalidSignature
    );
    for bad_kid in ["", "a b", &"k".repeat(65), "../x"] {
        let f = sign_bytes(&sk, LICENSE_CONTEXT, &bytes, bad_kid);
        assert_eq!(eval(&keys, &f, issued(), None), LicenseVerdict::Malformed);
    }
}

#[test]
fn field_rules_after_signature() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let cases: Vec<(&str, Value)> = vec![
        ("app_id", json!("fortune")),
        ("v", json!(2)),
        ("device_hash", json!(DEVICE.to_uppercase())),
        ("issued_at", json!("2026-10-29")),
        ("offline_valid_until", json!("soon")),
        ("updates_until", Value::Null),
        ("source", json!("gift")),
        ("features", json!({"drafting_watermark": false})),
        ("rights", json!({"desktop_edit": "yes"})),
        ("rights_expiry", json!({"desktop_edit": "tomorrow"})),
    ];
    for (field, value) in cases {
        let mut p = perpetual();
        p[field] = value;
        assert_eq!(
            eval(&keys, &sign(&sk, &p), issued(), None),
            LicenseVerdict::Malformed,
            "{field}"
        );
    }
    // 중복 키(마지막 값이 이기는 파서와의 해석 차이 차단).
    let text = perpetual().to_string().replacen(
        "\"app_id\":\"arch\"",
        "\"app_id\":\"arch\",\"app_id\":\"arch\"",
        1,
    );
    assert_eq!(
        eval(
            &keys,
            &sign_bytes(&sk, LICENSE_CONTEXT, text.as_bytes(), KID),
            issued(),
            None
        ),
        LicenseVerdict::Malformed
    );
    let text = perpetual().to_string().replacen(
        "\"desktop_edit\":\"2026-11-28T03:04:05Z\"",
        "\"desktop_edit\":\"2026-11-28T03:04:05Z\",\"desktop_edit\":\"2099-01-01T00:00:00Z\"",
        1,
    );
    assert_eq!(
        eval(
            &keys,
            &sign_bytes(&sk, LICENSE_CONTEXT, text.as_bytes(), KID),
            issued(),
            None
        ),
        LicenseVerdict::Malformed
    );
    // 바깥 파일 중복 키.
    let f = sign(&sk, &perpetual());
    let dup = f.replacen("{", &format!("{{\"kid\":\"{KID}\","), 1);
    assert_eq!(eval(&keys, &dup, issued(), None), LicenseVerdict::Malformed);
    // 모르는 필드는 서명된 서버 값이라 받아들인다(앞으로의 필드 추가 호환).
    let mut p = perpetual();
    p["future_field"] = json!({"x": 1});
    assert!(matches!(
        eval(&keys, &sign(&sk, &p), issued(), None),
        LicenseVerdict::Valid(_)
    ));
}

#[test]
fn device_mismatch_and_unavailable() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    for dev in [Some(OTHER_DEVICE), None, Some("")] {
        let inp = VerifyInput {
            device_hash: dev,
            ..input(&keys, issued())
        };
        assert_eq!(
            evaluate(Some(&f), &inp, BLANK).0,
            LicenseVerdict::DeviceMismatch
        );
        assert_eq!(evaluate(Some(&f), &inp, BLANK).1, None);
    }
}

#[test]
fn clock_rollback_boundaries() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let now = issued() + 5 * DAY;
    let rec = |last| ClockRecord {
        last_seen: last,
        max_issued_at: issued(),
    };
    // 허용 오차 경계.
    assert!(matches!(
        eval(&keys, &f, now, Some(rec(now + CLOCK_TOLERANCE_SECS))),
        LicenseVerdict::Valid(_)
    ));
    let (v, next) = evaluate(
        Some(&f),
        &input(&keys, now),
        ClockLoad::Record(rec(now + CLOCK_TOLERANCE_SECS + 1)),
    );
    match v {
        LicenseVerdict::ClockAnomaly(l) => assert_eq!(l.rights, EffectiveRights::VIEW_EXPORT_ONLY),
        v => panic!("{v:?}"),
    }
    assert_eq!(next, None, "되돌림 때 기록을 낮추지 않는다");
    // 기록을 지워도(저장 초기화) issued_at 하한은 남는다.
    assert!(matches!(
        eval(&keys, &f, issued() - CLOCK_TOLERANCE_SECS - 1, None),
        LicenseVerdict::ClockAnomaly(_)
    ));
    assert!(matches!(
        eval(&keys, &f, issued() - CLOCK_TOLERANCE_SECS, None),
        LicenseVerdict::Valid(_)
    ));
    // 허용 오차 안의 되돌림은 판정 시각을 기록 쪽으로 올린다(만료 직전 되돌림 무효).
    let expiry = issued() + PERPETUAL_RIGHTS_SECS;
    assert!(matches!(
        eval(&keys, &f, expiry - 60, Some(rec(expiry + 1))),
        LicenseVerdict::Expired(_)
    ));
}

#[test]
fn rights_expiry_and_offline_boundaries() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    // 영구: rights_expiry(30일) 경계.
    let f = sign(&sk, &perpetual());
    let r = issued() + 30 * DAY;
    assert!(matches!(
        eval(&keys, &f, r - 1, None),
        LicenseVerdict::Valid(_)
    ));
    assert!(matches!(
        eval(&keys, &f, r, None),
        LicenseVerdict::Expired(_)
    ));
    // 영구 + rights_expiry 없음(074 이전 파일) → 보수적 issued_at + 30일.
    let mut p = perpetual();
    p.as_object_mut().unwrap().remove("rights_expiry");
    let f = sign(&sk, &p);
    assert!(matches!(
        eval(&keys, &f, r - 1, None),
        LicenseVerdict::Valid(_)
    ));
    assert!(matches!(
        eval(&keys, &f, r, None),
        LicenseVerdict::Expired(_)
    ));
    // 영구 + 확장 값이 30일보다 길어도 서버가 clamp하므로 파일 값을 따른다(여기서는 서명된 값 그대로).
    // 플랜: offline_valid_until 경계.
    let f = sign(&sk, &trial());
    let until = parse_instant("2026-11-02T00:00:00Z").unwrap();
    assert!(matches!(
        eval(&keys, &f, until - 1, None),
        LicenseVerdict::Valid(_)
    ));
    match eval(&keys, &f, until, None) {
        LicenseVerdict::Expired(l) => assert_eq!(l.rights, EffectiveRights::VIEW_EXPORT_ONLY),
        v => panic!("{v:?}"),
    }
    // 플랜 + offline_valid_until 없음 → issued_at + 7일.
    let mut p = trial();
    p["offline_valid_until"] = Value::Null;
    let f = sign(&sk, &p);
    assert!(matches!(
        eval(&keys, &f, issued() + 7 * DAY - 1, None),
        LicenseVerdict::Valid(_)
    ));
    assert!(matches!(
        eval(&keys, &f, issued() + 7 * DAY, None),
        LicenseVerdict::Expired(_)
    ));
    // 권리별 만료: ai_chat만 먼저 끝남, null은 오프라인 한도로.
    let mut p = trial();
    p["rights"] = json!({"web_edit": true, "desktop_edit": true, "view_export": true, "ai_render": true, "ai_chat": true, "cloud_review": false, "devices_max": 2});
    p["rights_expiry"] = json!({"ai_chat": "2026-10-30T00:00:00Z", "ai_render": null});
    let f = sign(&sk, &p);
    let t = parse_instant("2026-10-30T00:00:00Z").unwrap();
    match eval(&keys, &f, t, None) {
        LicenseVerdict::Valid(l) => {
            assert!(!l.rights.ai_chat && l.rights.ai_render && l.rights.web_edit);
            assert!(!l.rights.cloud_review && l.rights.desktop_edit);
        }
        v => panic!("{v:?}"),
    }
    match eval(&keys, &f, t - 1, None) {
        LicenseVerdict::Valid(l) => assert!(l.rights.ai_chat),
        v => panic!("{v:?}"),
    }
    // desktop_edit을 주지 않는 파일은 만료가 아니라 유효 + 편집 false.
    let mut p = trial();
    p["rights"] = json!({"desktop_edit": false, "web_edit": true});
    match eval(&keys, &sign(&sk, &p), issued(), None) {
        LicenseVerdict::Valid(l) => assert!(!l.rights.desktop_edit && l.rights.web_edit),
        v => panic!("{v:?}"),
    }
}

#[test]
fn older_file_after_newer_is_expired() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let store = MemoryClockStore::with(ClockRecord {
        last_seen: issued(),
        max_issued_at: issued(),
    });
    let old = sign(&sk, &perpetual());
    let mut newer = perpetual();
    newer["issued_at"] = json!("2026-10-30T00:00:00Z");
    let newer = sign(&sk, &newer);
    let now = issued() + 2 * DAY;
    assert!(matches!(
        verify_license(Some(&old), &input(&keys, now), &store),
        LicenseVerdict::Valid(_)
    ));
    assert!(matches!(
        verify_license(Some(&newer), &input(&keys, now), &store),
        LicenseVerdict::Valid(_)
    ));
    assert!(matches!(
        verify_license(Some(&old), &input(&keys, now), &store),
        LicenseVerdict::Expired(_)
    ));
    assert!(matches!(
        verify_license(Some(&newer), &input(&keys, now), &store),
        LicenseVerdict::Valid(_)
    ));
}

#[test]
fn clock_record_is_monotonic_seeded() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let store = MemoryClockStore::default();
    let mut rng = Rng(0x0041_0002);
    let mut prev = ClockRecord {
        last_seen: i64::MIN,
        max_issued_at: i64::MIN,
    };
    for _ in 0..1000 {
        let now = issued() + rng.below(40 * DAY as u64) as i64 - DAY;
        let _ = verify_license(Some(&f), &input(&keys, now), &store);
        let cur = store.get().unwrap_or(prev);
        assert!(cur.last_seen >= prev.last_seen && cur.max_issued_at >= prev.max_issued_at);
        prev = cur;
    }
    // 실패 파일은 기록을 바꾸지 않는다.
    let before = store.get();
    let _ = verify_license(Some("garbage"), &input(&keys, i64::MAX / 2), &store);
    assert_eq!(store.get(), before);
}

#[test]
fn clock_record_codec() {
    let r = ClockRecord {
        last_seen: 1_793_243_045,
        max_issued_at: -5,
    };
    assert_eq!(ClockRecord::decode(&r.encode()), Some(r));
    for bad in ["", "v2:1:2", "v1:1", "v1:1:2:3", "v1:a:2"] {
        assert_eq!(ClockRecord::decode(bad), None, "{bad}");
    }
}

#[test]
fn build_eligibility() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let at = |build: Option<&str>| {
        let inp = VerifyInput {
            build_date: build.and_then(parse_date),
            ..input(&keys, issued())
        };
        evaluate(Some(&f), &inp, BLANK)
            .0
            .license()
            .unwrap()
            .build_eligible
    };
    assert!(at(Some("2027-10-28")));
    assert!(!at(Some("2027-10-29")));
    assert!(!at(None), "빌드 날짜 모르면 영구는 실패 닫힘");
    let t = sign(&sk, &trial());
    assert!(
        evaluate(Some(&t), &input(&keys, issued()), BLANK)
            .0
            .license()
            .unwrap()
            .build_eligible
    );
}

#[test]
fn failures_and_debug_leak_nothing() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let fv: Value = serde_json::from_str(&f).unwrap();
    let secrets = [
        fv["sig"].as_str().unwrap().to_string(),
        fv["payload"].as_str().unwrap()[..24].to_string(),
        DEVICE.to_string(),
        "22222222-2222".to_string(),
        "11111111-1111".to_string(),
    ];
    let verdicts = [
        eval(&keys, &f, issued(), None),
        eval(&keys, &f, issued() + 31 * DAY, None),
        eval(&keys, &f, issued() - DAY, None),
        evaluate(
            Some(&f),
            &VerifyInput {
                device_hash: Some(OTHER_DEVICE),
                ..input(&keys, issued())
            },
            BLANK,
        )
        .0,
        eval(&ring(&[]), &f, issued(), None),
        eval(&keys, &f.replace('A', "B"), issued(), None),
    ];
    for v in &verdicts {
        let printed = format!("{v:?} {:?}", v.license());
        for s in &secrets {
            assert!(!printed.contains(s.as_str()), "{printed}");
        }
    }
    assert_eq!(format!("{:?}", verdicts[0]), "LicenseVerdict(valid)");
}

#[test]
fn keyring_rules_and_test_kid_guard() {
    let sk = key(1);
    let pk = sk.verifying_key().to_bytes();
    assert_eq!(
        KeyRing::from_raw(&[("a", pk), ("a", pk)]).unwrap_err(),
        KeyRingError::DuplicateKid
    );
    assert_eq!(
        KeyRing::from_raw(&[("a b", pk)]).unwrap_err(),
        KeyRingError::InvalidKid
    );
    // 작은 차수 점(항등원).
    let mut identity = [0u8; 32];
    identity[0] = 1;
    assert_eq!(
        KeyRing::from_raw(&[("a", identity)]).unwrap_err(),
        KeyRingError::InvalidKey
    );
    assert!(has_test_kid(&[("prod-1", pk), ("x-TeSt-2", pk)]));
    assert!(!has_test_kid(&[("prod-1", pk), ("tes", pk)]));
    assert!(!has_test_kid(PRODUCTION_LICENSE_KEYS));
    assert!(!has_test_kid(PRODUCTION_RULEPACK_KEYS));
    let prod = KeyRing::production_license();
    assert!(!prod.contains_public_key(&pk));
    assert!(format!("{prod:?}").starts_with("KeyRing"));
}

// ---- 규칙 팩 ----

const PACK_KID: &str = "unit-pack-1";

fn manifest(pack: &[u8], published_at: &str) -> Value {
    use sha2::{Digest, Sha256};
    let hex: String = Sha256::digest(pack)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    json!({"v": 1, "app_id": "arch", "version": "2026.10.1", "published_at": published_at,
        "basis_date": "2026-10-01", "sha256": hex, "bytes": pack.len(), "kid": PACK_KID})
}

fn sign_manifest(sk: &SigningKey, ctx: &[u8], m: &Value) -> String {
    let bytes = m.to_string().into_bytes();
    let mut msg = ctx.to_vec();
    msg.extend_from_slice(&bytes);
    json!({"manifest": b64url_encode(&bytes), "sig": b64url_encode(&sk.sign(&msg).to_bytes()), "kid": m["kid"]})
        .to_string()
}

fn valid_license(p: Value) -> LicenseVerdict {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let v = eval(&keys, &sign(&sk, &p), issued(), None);
    assert!(matches!(v, LicenseVerdict::Valid(_)));
    v
}

#[test]
fn rule_pack_admission() {
    let pk = key(9);
    let packs = ring(&[(PACK_KID, &pk)]);
    let pack = b"{\"rules\":[]}".to_vec();
    let lic = valid_license(perpetual());
    let m = sign_manifest(
        &pk,
        RULEPACK_CONTEXT,
        &manifest(&pack, "2026-10-20T00:00:00Z"),
    );
    let ok = admit_rule_pack(&lic, &packs, &m, pack.clone()).unwrap();
    assert_eq!(ok.bytes(), &pack[..]);
    assert_eq!(ok.manifest().version, "2026.10.1");
    assert!(!format!("{ok:?}").contains("rules"));

    // 다른 도메인·접두 없음·라이선스 고리.
    for ctx in [LICENSE_CONTEXT, &b""[..], b"arch-rulepack-v2\n"] {
        let m = sign_manifest(&pk, ctx, &manifest(&pack, "2026-10-20T00:00:00Z"));
        assert_eq!(
            admit_rule_pack(&lic, &packs, &m, pack.clone()).unwrap_err(),
            RulePackRejection::InvalidSignature
        );
    }
    let lic_ring = ring(&[(KID, &key(1))]);
    assert_eq!(
        admit_rule_pack(&lic, &lic_ring, &m, pack.clone()).unwrap_err(),
        RulePackRejection::UnknownKid
    );
    // 본문 바꿔치기·크기 불일치.
    let mut other = pack.clone();
    other[0] = b'[';
    assert_eq!(
        admit_rule_pack(&lic, &packs, &m, other).unwrap_err(),
        RulePackRejection::ContentMismatch
    );
    let mut longer = pack.clone();
    longer.push(b' ');
    assert_eq!(
        admit_rule_pack(&lic, &packs, &m, longer).unwrap_err(),
        RulePackRejection::ContentMismatch
    );
    // 매니페스트 형식.
    for (field, value) in [
        ("app_id", json!("other")),
        ("v", json!(2)),
        ("version", json!("26.10.1")),
        ("sha256", json!("ABC")),
        ("published_at", json!("2026-10-20")),
    ] {
        let mut mm = manifest(&pack, "2026-10-20T00:00:00Z");
        mm[field] = value;
        assert_eq!(
            admit_rule_pack(
                &lic,
                &packs,
                &sign_manifest(&pk, RULEPACK_CONTEXT, &mm),
                pack.clone()
            )
            .unwrap_err(),
            RulePackRejection::Malformed,
            "{field}"
        );
    }
}

#[test]
fn rule_pack_never_admitted_without_valid_license() {
    let pk = key(9);
    let packs = ring(&[(PACK_KID, &pk)]);
    let pack = b"{}".to_vec();
    let m = sign_manifest(
        &pk,
        RULEPACK_CONTEXT,
        &manifest(&pack, "2026-10-20T00:00:00Z"),
    );
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let not_valid = [
        LicenseVerdict::Absent,
        LicenseVerdict::Malformed,
        LicenseVerdict::UnknownKid,
        LicenseVerdict::InvalidSignature,
        LicenseVerdict::DeviceMismatch,
        eval(&keys, &f, issued() + 31 * DAY, None),
        eval(&keys, &f, issued() - DAY, None),
    ];
    for v in &not_valid {
        assert!(!matches!(v, LicenseVerdict::Valid(_)));
        assert_eq!(
            admit_rule_pack(v, &packs, &m, pack.clone()).unwrap_err(),
            RulePackRejection::NotEntitled,
            "{v:?}"
        );
    }
}

#[test]
fn rule_pack_updates_until_boundary_kst() {
    let lic = valid_license(perpetual()); // updates_until 2027-10-28
                                          // 경계 = 2027-10-29T00:00:00+09:00 = 2027-10-28T15:00:00Z (서버 eligible_rule_packs와 같음).
    let limit = parse_instant("2027-10-28T15:00:00Z").unwrap();
    assert!(pack_entitled(&lic, limit - 1));
    assert!(!pack_entitled(&lic, limit));
    let pk = key(9);
    let packs = ring(&[(PACK_KID, &pk)]);
    let pack = b"{}".to_vec();
    for (at, ok) in [
        ("2027-10-29T00:00:00+09:00", false),
        ("2027-10-28T23:59:59+09:00", true),
    ] {
        let m = sign_manifest(&pk, RULEPACK_CONTEXT, &manifest(&pack, at));
        assert_eq!(
            admit_rule_pack(&lic, &packs, &m, pack.clone()).is_ok(),
            ok,
            "{at}"
        );
    }
    // 플랜: rule_pack_updates 플래그.
    let t = valid_license(trial());
    assert!(pack_entitled(&t, limit + 1000 * DAY));
    let mut p = trial();
    p["features"]["rule_pack_updates"] = json!(false);
    assert!(!pack_entitled(&valid_license(p), issued()));
}

#[test]
fn rule_pack_entitlement_property_seeded() {
    let pk = key(9);
    let packs = ring(&[(PACK_KID, &pk)]);
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let pack = b"{\"r\":1}".to_vec();
    let mut rng = Rng(0x0041_0003);
    let limit_base = parse_date("2026-12-31").unwrap();
    for _ in 0..300 {
        let uu = limit_base + rng.below(400) as i64;
        let mut p = perpetual();
        p["updates_until"] = json!(codec::format_instant(uu * DAY)[..10]);
        let now = issued() + rng.below(40 * DAY as u64) as i64 - 2 * DAY;
        let lic = eval(&keys, &sign(&sk, &p), now, None);
        let published = updates_limit_secs(uu) + rng.below(4 * DAY as u64) as i64 - 2 * DAY;
        let m = sign_manifest(
            &pk,
            RULEPACK_CONTEXT,
            &manifest(&pack, &codec::format_instant(published)),
        );
        let admitted = admit_rule_pack(&lic, &packs, &m, pack.clone()).is_ok();
        let expect = matches!(lic, LicenseVerdict::Valid(_)) && published < updates_limit_secs(uu);
        assert_eq!(
            admitted, expect,
            "uu={uu} published={published} now={now} {lic:?}"
        );
    }
}

// ---- 보안 리뷰 지적 수정(AR-06-041 후속) ----

#[test]
fn small_order_r_signature_needs_verify_strict() {
    use curve25519_dalek::edwards::EdwardsPoint;
    use curve25519_dalek::scalar::Scalar;
    use curve25519_dalek::traits::Identity;
    use ed25519_dalek::Verifier;
    use sha2::{Digest, Sha512};

    // ARCH_TEST_ONLY: 테스트 전용 비밀 스칼라(운영 키 아님). 공개키 A = a·B는 작은 위수가 아니다.
    let a = Scalar::from_bytes_mod_order([7u8; 32]);
    let pk = EdwardsPoint::mul_base(&a).compress();
    let keys = KeyRing::from_raw(&[(KID, pk.to_bytes())]).unwrap();
    let body = perpetual().to_string().into_bytes();
    let mut msg = LICENSE_CONTEXT.to_vec();
    msg.extend_from_slice(&body);
    // R = 항등원(위수 1, 작은 위수). s = k·a 이면 [s]B − [k]A = 항등원 = R 이라 느슨한 검증식은 성립한다.
    let r = EdwardsPoint::identity().compress();
    let h = Sha512::new()
        .chain_update(r.as_bytes())
        .chain_update(pk.as_bytes())
        .chain_update(&msg)
        .finalize();
    let mut wide = [0u8; 64];
    wide.copy_from_slice(&h);
    let s = Scalar::from_bytes_mod_order_wide(&wide) * a;
    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(r.as_bytes());
    sig[32..].copy_from_slice(s.as_bytes());

    // 전제: 느슨한 `verify`는 받아들이고 `verify_strict`만 거부한다(이 벡터는 strict 분기만 시험한다).
    let vk = VerifyingKey::from_bytes(&pk.to_bytes()).unwrap();
    assert!(vk.verify(&msg, &Signature::from_bytes(&sig)).is_ok());
    assert!(vk
        .verify_strict(&msg, &Signature::from_bytes(&sig))
        .is_err());

    let f = json!({"payload": b64url_encode(&body), "sig": b64url_encode(&sig), "kid": KID})
        .to_string();
    assert_eq!(
        eval(&keys, &f, issued(), None),
        LicenseVerdict::InvalidSignature
    );
}

#[test]
fn offline_limit_boundary_when_desktop_right_outlives_it() {
    // desktop_edit 권리 기한이 오프라인 한도보다 길면 경계는 오프라인 한도 검사(`effective_now >= t`)만이 정한다.
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let mut p = trial();
    p["rights_expiry"] = json!({"desktop_edit": "2026-12-31T00:00:00Z"});
    let f = sign(&sk, &p);
    let until = parse_instant("2026-11-02T00:00:00Z").unwrap();
    match eval(&keys, &f, until - 1, None) {
        LicenseVerdict::Valid(l) => assert!(l.rights().desktop_edit),
        v => panic!("{v:?}"),
    }
    match eval(&keys, &f, until, None) {
        LicenseVerdict::Expired(l) => assert_eq!(l.rights(), EffectiveRights::VIEW_EXPORT_ONLY),
        v => panic!("{v:?}"),
    }
}

#[test]
fn future_clock_lock_recovers_only_with_fresh_newer_file() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let old = sign(&sk, &perpetual());
    // 시계를 1년 뒤로 잘못 맞춘 채 한 번 열었던 기록.
    let locked = ClockRecord {
        last_seen: issued() + 365 * DAY,
        max_issued_at: issued(),
    };
    let real_now = issued() + 2 * DAY;
    assert!(matches!(
        eval(&keys, &old, real_now, Some(locked)),
        LicenseVerdict::ClockAnomaly(_)
    ));
    // 옛 파일 재제출은 (발급 직후 시각이어도) 재설정하지 못한다: issued_at이 max_issued_at보다 크지 않다.
    assert!(matches!(
        eval(&keys, &old, issued(), Some(locked)),
        LicenseVerdict::ClockAnomaly(_)
    ));

    // 서버가 막 발급한 새 파일(issued_at = N).
    let n = real_now;
    let mut p = perpetual();
    p["issued_at"] = json!(codec::format_instant(n));
    let newer = sign(&sk, &p);
    for (now, ok) in [
        (n, true),
        (n + CLOCK_TOLERANCE_SECS, true),
        (n - CLOCK_TOLERANCE_SECS, true),
        (n + CLOCK_TOLERANCE_SECS + 1, false),
        (n - CLOCK_TOLERANCE_SECS - 1, false),
    ] {
        let (v, next) = evaluate(Some(&newer), &input(&keys, now), ClockLoad::Record(locked));
        if ok {
            assert!(matches!(v, LicenseVerdict::Valid(_)), "{now}: {v:?}");
            let next = next.unwrap();
            assert_eq!(
                next.last_seen,
                now.max(n),
                "last_seen = max(now, issued_at)"
            );
            assert_eq!(next.max_issued_at, n);
        } else {
            assert!(matches!(v, LicenseVerdict::ClockAnomaly(_)), "{now}: {v:?}");
            assert_eq!(next, None);
        }
    }

    // 저장소를 통한 흐름: 복구 뒤 옛 파일은 롤백 규칙으로 expired, 새 파일은 계속 valid.
    let store = MemoryClockStore::with(locked);
    assert!(matches!(
        verify_license(Some(&newer), &input(&keys, n), &store),
        LicenseVerdict::Valid(_)
    ));
    assert_eq!(
        store.get(),
        Some(ClockRecord {
            last_seen: n,
            max_issued_at: n
        })
    );
    assert!(matches!(
        verify_license(Some(&old), &input(&keys, n + 60), &store),
        LicenseVerdict::Expired(_)
    ));
    assert!(matches!(
        verify_license(Some(&newer), &input(&keys, n + DAY), &store),
        LicenseVerdict::Valid(_)
    ));
    // 같은 새 파일을 다시 내도 재설정은 한 번뿐(issued_at = max_issued_at): 시계를 되돌리면 다시 시계 이상.
    assert!(matches!(
        verify_license(Some(&newer), &input(&keys, n), &store),
        LicenseVerdict::ClockAnomaly(_)
    ));
}

#[test]
fn build_ineligible_disables_desktop_edit_only() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual()); // updates_until 2027-10-28
    for build in [Some("2027-10-29"), None] {
        let inp = VerifyInput {
            build_date: build.and_then(parse_date),
            ..input(&keys, issued() + DAY)
        };
        match evaluate(Some(&f), &inp, BLANK).0 {
            LicenseVerdict::Valid(l) => {
                assert!(!l.build_eligible(), "{build:?}");
                assert!(
                    !l.rights().desktop_edit,
                    "{build:?}: 업데이트 기간 밖 빌드는 편집 불가"
                );
                assert!(l.rights().view_export, "{build:?}: 열람·내보내기 유지");
            }
            v => panic!("{build:?}: {v:?}"),
        }
    }
    // 기간 안 빌드는 편집 가능.
    match eval(&keys, &f, issued() + DAY, None) {
        LicenseVerdict::Valid(l) => assert!(l.build_eligible() && l.rights().desktop_edit),
        v => panic!("{v:?}"),
    }
    // 플랜은 빌드 날짜와 무관.
    let t = sign(&sk, &trial());
    let inp = VerifyInput {
        build_date: None,
        ..input(&keys, issued() + DAY)
    };
    match evaluate(Some(&t), &inp, BLANK).0 {
        LicenseVerdict::Valid(l) => assert!(l.build_eligible() && l.rights().desktop_edit),
        v => panic!("{v:?}"),
    }
}

#[test]
fn clock_store_corrupt_is_anomaly_unless_fresh() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    for (now, ok) in [
        (issued() + 2 * DAY, false),
        (issued() + CLOCK_TOLERANCE_SECS + 1, false),
        (issued() + CLOCK_TOLERANCE_SECS, true),
        (issued(), true),
    ] {
        let (v, next) = evaluate(Some(&f), &input(&keys, now), ClockLoad::Corrupt);
        if ok {
            assert!(matches!(v, LicenseVerdict::Valid(_)), "{now}: {v:?}");
            assert_eq!(
                next,
                Some(ClockRecord {
                    last_seen: now,
                    max_issued_at: issued()
                })
            );
        } else {
            assert!(matches!(v, LicenseVerdict::ClockAnomaly(_)), "{now}: {v:?}");
            assert_eq!(next, None);
        }
    }
}

#[test]
fn clock_store_missing_requires_refresh_for_old_file() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let edge = issued() + MISSING_RECORD_MAX_AGE_SECS;
    // 첫 활성화 직후(1일 이내)는 영향 없음, 기록을 쓴다.
    let (v, next) = evaluate(Some(&f), &input(&keys, edge), ClockLoad::Missing);
    assert!(matches!(v, LicenseVerdict::Valid(_)), "{v:?}");
    assert!(next.is_some());
    // 기록 없음 + 1일 초과 → 온라인 refresh 필요(expired), 기록은 쓰지 않는다.
    let (v, next) = evaluate(Some(&f), &input(&keys, edge + 1), ClockLoad::Missing);
    match v {
        LicenseVerdict::Expired(l) => assert_eq!(l.rights(), EffectiveRights::VIEW_EXPORT_ONLY),
        v => panic!("{v:?}"),
    }
    assert_eq!(next, None);
    // 읽기 실패: 판정은 기록 없음과 같고, 어느 경우에도 덮어쓰지 않는다.
    let (v, next) = evaluate(
        Some(&f),
        &input(&keys, issued() + 60),
        ClockLoad::Unreadable,
    );
    assert!(matches!(v, LicenseVerdict::Valid(_)), "{v:?}");
    assert_eq!(next, None);
    let (v, _) = evaluate(Some(&f), &input(&keys, edge + 1), ClockLoad::Unreadable);
    assert!(matches!(v, LicenseVerdict::Expired(_)), "{v:?}");

    // 저장소 흐름: 기록 삭제 후 시계를 되돌려도(옛 파일, 1일 초과) 열리지 않는다. 새 파일(refresh)이면 복구.
    let store = MemoryClockStore::default();
    assert!(matches!(
        verify_license(Some(&f), &input(&keys, issued() + 60), &store),
        LicenseVerdict::Valid(_)
    ));
    store.clear();
    for _ in 0..2 {
        assert!(matches!(
            verify_license(Some(&f), &input(&keys, issued() + 5 * DAY), &store),
            LicenseVerdict::Expired(_)
        ));
        assert_eq!(
            store.get(),
            None,
            "기록 없음 상태를 새 기록으로 덮지 않는다"
        );
    }
    let mut p = perpetual();
    p["issued_at"] = json!(codec::format_instant(issued() + 5 * DAY));
    assert!(matches!(
        verify_license(
            Some(&sign(&sk, &p)),
            &input(&keys, issued() + 5 * DAY),
            &store
        ),
        LicenseVerdict::Valid(_)
    ));
    assert!(store.get().is_some());
}

/// 쓰기 횟수를 세는 저장소.
#[derive(Default)]
struct CountingStore {
    inner: MemoryClockStore,
    saves: std::sync::atomic::AtomicUsize,
}

impl ClockStore for CountingStore {
    fn load(&self) -> ClockLoad {
        self.inner.load()
    }
    fn save(&self, record: ClockRecord) {
        self.saves.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.inner.save(record);
    }
}

#[test]
fn clock_record_writes_are_throttled() {
    let sk = key(1);
    let keys = ring(&[(KID, &sk)]);
    let f = sign(&sk, &perpetual());
    let store = CountingStore::default();
    let saves = || store.saves.load(std::sync::atomic::Ordering::SeqCst);
    let t0 = issued() + 60;
    let _ = verify_license(Some(&f), &input(&keys, t0), &store);
    assert_eq!(saves(), 1, "첫 기록은 쓴다");
    for _ in 0..100 {
        let _ = verify_license(Some(&f), &input(&keys, t0), &store);
    }
    let _ = verify_license(
        Some(&f),
        &input(&keys, t0 + CLOCK_SAVE_INTERVAL_SECS - 1),
        &store,
    );
    assert_eq!(saves(), 1, "반복 호출·간격 미만 변화는 쓰지 않는다");
    let _ = verify_license(
        Some(&f),
        &input(&keys, t0 + CLOCK_SAVE_INTERVAL_SECS),
        &store,
    );
    assert_eq!(saves(), 2);
    // max_issued_at 변화는 간격과 무관하게 쓴다.
    let mut p = perpetual();
    p["issued_at"] = json!(codec::format_instant(issued() + 120));
    let _ = verify_license(
        Some(&sign(&sk, &p)),
        &input(&keys, t0 + CLOCK_SAVE_INTERVAL_SECS),
        &store,
    );
    assert_eq!(saves(), 3);
    assert_eq!(store.inner.get().unwrap().max_issued_at, issued() + 120);
}

#[test]
fn production_slots_parse_and_exclude_test_public_keys() {
    // 운영 슬롯 상수 오류가 `unwrap_or(빈 고리)`로 조용히 전원 unknown_kid가 되지 않게 한다.
    // 운영 키 주입 전인 지금은 빈 슬롯을 허용한다(빈 고리 = 실패 닫힘, 의도된 상태).
    assert!(KeyRing::from_raw(PRODUCTION_LICENSE_KEYS).is_ok());
    assert!(KeyRing::from_raw(PRODUCTION_RULEPACK_KEYS).is_ok());
    // 거부 목록은 단위·통합 테스트 시드 키를 포함한다(교차 벡터 키는 tests/license.rs가 확인).
    // 10·11은 tests/rule_pack.rs(키 회전·모르는 kid)가 쓴다.
    for label in [1u8, 2, 9, 10, 11] {
        let pk = key(label).verifying_key().to_bytes();
        assert!(TEST_PUBLIC_KEYS.contains(&pk), "key({label})");
        assert!(has_denied_key(&[("prod-1", pk)], &TEST_PUBLIC_KEYS));
    }
    let other = key(3).verifying_key().to_bytes();
    assert!(!has_denied_key(&[("prod-1", other)], &TEST_PUBLIC_KEYS));
    assert!(!has_denied_key(PRODUCTION_LICENSE_KEYS, &TEST_PUBLIC_KEYS));
    assert!(!has_denied_key(PRODUCTION_RULEPACK_KEYS, &TEST_PUBLIC_KEYS));
}
