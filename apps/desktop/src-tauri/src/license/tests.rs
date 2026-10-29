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

fn eval(keys: &KeyRing, file: &str, now: i64, prev: Option<ClockRecord>) -> LicenseVerdict {
    evaluate(Some(file), &input(keys, now), prev).0
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
            evaluate(f, &input(&keys, 0), None).0,
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
            evaluate(Some(&f), &inp, None).0,
            LicenseVerdict::DeviceMismatch
        );
        assert_eq!(evaluate(Some(&f), &inp, None).1, None);
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
        Some(rec(now + CLOCK_TOLERANCE_SECS + 1)),
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
    let store = MemoryClockStore::default();
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
        evaluate(Some(&f), &inp, None)
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
        evaluate(Some(&t), &input(&keys, issued()), None)
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
            None,
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
