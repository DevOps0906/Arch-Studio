//! 라이선스 파일 검증(AR-06-041). 순수 로직: Tauri 런타임 없이 `cargo test`로 검증한다.
//!
//! 서명 규약(AR-06-040 `apps/web/src/server/licenses/signing.ts`와 같아야 한다, 04_API.md 2.4절):
//! - 파일 = `{ payload: base64url(정준 JSON 바이트), sig: base64url(Ed25519 서명), kid }`.
//! - 서명 입력 = [`LICENSE_CONTEXT`](`"arch-license-v1\n"`, 16바이트) ‖ 디코드한 payload **바이트 그대로**.
//!   바이트를 먼저 검증하고 그 뒤에 JSON을 해석한다(재정준화·재직렬화 없음). 바깥 `kid` = `payload.kid`.
//! - 규칙 팩 매니페스트는 다른 접두 [`RULEPACK_CONTEXT`]와 다른 키 고리를 쓴다([`rule_pack`]).
//!
//! 판정 규칙:
//! - 로컬 권한은 서명 파일만 믿는다. SQLite·`local_settings` 값은 입력으로 받지 않는다(02_ARCHITECTURE.md 2.2절).
//! - `device_hash`는 현재 기기에서 다시 계산한 값과 정확히 같아야 한다(다른 PC 파일 거부).
//! - 시계 되돌림: 단조 기록([`ClockStore`])의 `last_seen`이나 파일 `issued_at`보다 현재가 [`CLOCK_TOLERANCE_SECS`] 넘게 이르면
//!   [`LicenseVerdict::ClockAnomaly`](만료와 같은 처리: 열람·내보내기만). 기록 형식 오류도 시계 이상이다.
//!   기록이 없는데(삭제·초기화) 파일이 [`MISSING_RECORD_MAX_AGE_SECS`]보다 오래됐으면 `expired`(온라인 refresh 필요).
//! - 시계를 미래로 잘못 맞췄던 기록은 서버가 막 발급한 새 파일(`issued_at > max_issued_at`, 현재와 허용 오차 안)로만 복구된다.
//! - 업데이트 기간 밖 빌드(`build_eligible = false`)는 설치형 편집을 끈다(열람·내보내기 유지).
//! - 판정 결과([`VerifiedLicense`])는 이 모듈의 [`evaluate`]만 만들 수 있다(봉인 필드). 외부는 getter로만 읽는다.
//! - 결과의 실패 상태에는 파일 내용·서명·기기 해시·원인 문자열을 담지 않는다. `Debug`는 상태 이름만 출력한다.

pub mod codec;
pub mod rule_pack;

#[path = "../../keys/mod.rs"]
mod production_keys;

use std::sync::Mutex;

use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;

use codec::{b64url_decode, parse_date, parse_instant};

/// 라이선스 파일 서명 도메인 접두(040 `LICENSE_SIGNING_CONTEXT`).
pub const LICENSE_CONTEXT: &[u8] = b"arch-license-v1\n";
/// 규칙 팩 매니페스트 서명 도메인 접두([DECISION] AR-06-041, 042와 합의 항목).
pub const RULEPACK_CONTEXT: &[u8] = b"arch-rulepack-v1\n";

/// 명령 입력(파일 문자열) 상한. 파싱 전에 검사한다.
pub const MAX_FILE_BYTES: usize = 16 * 1024;
/// 디코드한 payload 상한.
pub const MAX_PAYLOAD_BYTES: usize = 12 * 1024;
/// 시계 비교 허용 오차(NTP 보정·서버와의 작은 차이).
pub const CLOCK_TOLERANCE_SECS: i64 = 600;
/// 영구(license 출처) 권리 재확인 주기: `issued_at` + 30일(D-H5 ②). `rights_expiry`가 없을 때의 보수적 기본값.
pub const PERPETUAL_RIGHTS_SECS: i64 = 30 * 86_400;
/// 플랜 출처 오프라인 기본 한도: `issued_at` + 7일(02_ARCHITECTURE.md 2.2절). `offline_valid_until`이 없을 때.
pub const PLAN_OFFLINE_SECS: i64 = 7 * 86_400;
/// 시계 기록이 없을 때 받아들이는 파일 나이 상한(`now − issued_at`). 넘으면 `expired`(온라인 refresh로 새 파일 필요).
/// 첫 활성화 직후(방금 받은 파일)는 영향 없다. 기록 삭제 → 시계 되돌림 우회의 비용을 높인다(D-H3 수용 범위 안에서).
pub const MISSING_RECORD_MAX_AGE_SECS: i64 = 86_400;
/// 시계 기록 쓰기 최소 간격. `last_seen`만 이보다 적게 움직였으면 키체인에 쓰지 않는다(반복 호출 쓰기 증폭 방지).
/// 대신 되돌림 감지 여유가 최대 이 값만큼 늘어난다(허용 오차 + 간격).
pub const CLOCK_SAVE_INTERVAL_SECS: i64 = 600;
/// 서버 `eligible_rule_packs`의 기준 시간대(Asia/Seoul, +09:00).
const SEOUL_OFFSET_SECS: i64 = 9 * 3600;

// ---- 키 고리 ----

/// `test`(대소문자 무시)가 들어간 kid가 있으면 true. 운영 키 슬롯 컴파일 가드용.
pub const fn has_test_kid(keys: &[(&str, [u8; 32])]) -> bool {
    let mut i = 0;
    while i < keys.len() {
        let b = keys[i].0.as_bytes();
        let mut j = 0;
        while j + 4 <= b.len() {
            if b[j].eq_ignore_ascii_case(&b't')
                && b[j + 1].eq_ignore_ascii_case(&b'e')
                && b[j + 2].eq_ignore_ascii_case(&b's')
                && b[j + 3].eq_ignore_ascii_case(&b't')
            {
                return true;
            }
            j += 1;
        }
        i += 1;
    }
    false
}

/// 64자 hex → 32바이트(컴파일 시점 상수용). 형식이 틀리면 컴파일 실패.
const fn hex32(s: &str) -> [u8; 32] {
    let b = s.as_bytes();
    assert!(b.len() == 64);
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (hex_nibble(b[i * 2]) << 4) | hex_nibble(b[i * 2 + 1]);
        i += 1;
    }
    out
}

const fn hex_nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("hex"),
    }
}

/// 테스트 공개키 거부 목록: 교차 벡터(`tests/fixtures/license/vectors.json`의 `keys`·`rulepack_keys`) 3개 +
/// 단위·통합 테스트 시드 키(`[1;32]`·`[2;32]`·`[9;32]`·`[10;32]`·`[11;32]`, `tests/rule_pack.rs`가 10·11을 쓴다) 5개.
/// 운영 슬롯에 들어가면 컴파일이 실패한다(kid 이름과 무관하게 바이트 비교). 테스트에 새 시드를 쓰면 여기에 함께 넣는다.
pub const TEST_PUBLIC_KEYS: [[u8; 32]; 8] = [
    hex32("838b58f7453e68683484f8e258e723db774b6546b008ba4c857c666847a560a8"),
    hex32("fcc3d2eb48301c279897f575ee0f8f6b99a019fc4ed3266a24f83edd93cf110c"),
    hex32("c670cd5cdfb2962bf1dd6dbbca8f96560c15968d62047c0f81344bd0e08bb398"),
    hex32("8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"),
    hex32("8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394"),
    hex32("fd1724385aa0c75b64fb78cd602fa1d991fdebf76b13c58ed702eac835e9f618"),
    hex32("43a72e714401762df66b68c26dfbdf2682aaec9f2474eca4613e424a0fbafd3c"),
    hex32("66be7e332c7a453332bd9d0a7f7db055f5c5ef1a06ada66d98b39fb6810c473a"),
];

/// 슬롯에 거부 목록 키가 하나라도 있으면 true(컴파일 가드용).
pub const fn has_denied_key(keys: &[(&str, [u8; 32])], denied: &[[u8; 32]]) -> bool {
    let mut i = 0;
    while i < keys.len() {
        let mut j = 0;
        while j < denied.len() {
            let mut k = 0;
            let mut same = true;
            while k < 32 {
                if keys[i].1[k] != denied[j][k] {
                    same = false;
                }
                k += 1;
            }
            if same {
                return true;
            }
            j += 1;
        }
        i += 1;
    }
    false
}

// 운영 빌드에 테스트 키가 들어가면 컴파일 실패(kid 이름·공개키 바이트 둘 다).
const _: () = assert!(!has_test_kid(production_keys::LICENSE_KEYS));
const _: () = assert!(!has_test_kid(production_keys::RULEPACK_KEYS));
const _: () = assert!(!has_denied_key(
    production_keys::LICENSE_KEYS,
    &TEST_PUBLIC_KEYS
));
const _: () = assert!(!has_denied_key(
    production_keys::RULEPACK_KEYS,
    &TEST_PUBLIC_KEYS
));

/// 운영 라이선스 키 슬롯(검사·고지용, 공개키).
pub const PRODUCTION_LICENSE_KEYS: &[(&str, [u8; 32])] = production_keys::LICENSE_KEYS;
/// 운영 규칙 팩 키 슬롯(검사·고지용, 공개키).
pub const PRODUCTION_RULEPACK_KEYS: &[(&str, [u8; 32])] = production_keys::RULEPACK_KEYS;

/// 키 고리 구성 오류(앱 시작 시 한 번, 상수 오류).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRingError {
    InvalidKid,
    DuplicateKid,
    InvalidKey,
}

/// kid → Ed25519 공개키. 용도(라이선스·규칙 팩)마다 따로 만든다.
#[derive(Clone)]
pub struct KeyRing {
    keys: Vec<(String, VerifyingKey)>,
}

fn valid_kid(kid: &str) -> bool {
    (1..=64).contains(&kid.len())
        && kid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

impl KeyRing {
    pub fn from_raw(entries: &[(&str, [u8; 32])]) -> Result<Self, KeyRingError> {
        let mut keys: Vec<(String, VerifyingKey)> = Vec::with_capacity(entries.len());
        for (kid, raw) in entries {
            if !valid_kid(kid) {
                return Err(KeyRingError::InvalidKid);
            }
            if keys.iter().any(|(k, _)| k == kid) {
                return Err(KeyRingError::DuplicateKid);
            }
            let key = VerifyingKey::from_bytes(raw).map_err(|_| KeyRingError::InvalidKey)?;
            // 작은 차수 점(약한 키)은 받지 않는다.
            if key.is_weak() {
                return Err(KeyRingError::InvalidKey);
            }
            keys.push((kid.to_string(), key));
        }
        Ok(Self { keys })
    }

    /// 운영 라이선스 키 고리. 상수가 잘못되면 빈 고리(모든 파일 `unknown_kid`, 실패 닫힘).
    /// 조용히 빈 고리가 되지 않도록 `production_slots_parse` 테스트가 `from_raw(...).is_ok()`를 단언한다.
    pub fn production_license() -> Self {
        Self::from_raw(PRODUCTION_LICENSE_KEYS).unwrap_or(Self { keys: Vec::new() })
    }

    /// 운영 규칙 팩 키 고리.
    pub fn production_rulepack() -> Self {
        Self::from_raw(PRODUCTION_RULEPACK_KEYS).unwrap_or(Self { keys: Vec::new() })
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn kids(&self) -> Vec<&str> {
        self.keys.iter().map(|(k, _)| k.as_str()).collect()
    }

    pub fn contains_public_key(&self, raw: &[u8; 32]) -> bool {
        self.keys.iter().any(|(_, k)| k.as_bytes() == raw)
    }

    fn get(&self, kid: &str) -> Option<&VerifyingKey> {
        self.keys.iter().find(|(k, _)| k == kid).map(|(_, v)| v)
    }
}

impl std::fmt::Debug for KeyRing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyRing")
            .field("kids", &self.kids())
            .finish()
    }
}

/// 봉투(접두 ‖ 바이트 서명) 검증 실패.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EnvelopeError {
    Malformed,
    UnknownKid,
    InvalidSignature,
}

/// base64url 본문·서명을 디코드하고 `context ‖ 본문 바이트`를 `verify_strict`로 검증한다. 성공하면 본문 바이트.
pub(crate) fn verify_envelope(
    ring: &KeyRing,
    context: &[u8],
    kid: &str,
    body_b64: &str,
    sig_b64: &str,
    max_body: usize,
) -> Result<Vec<u8>, EnvelopeError> {
    if body_b64.len() > max_body.div_ceil(3) * 4 || sig_b64.len() != 86 {
        return Err(EnvelopeError::Malformed);
    }
    let body = b64url_decode(body_b64).ok_or(EnvelopeError::Malformed)?;
    let sig = b64url_decode(sig_b64).ok_or(EnvelopeError::Malformed)?;
    let sig: [u8; 64] = sig.try_into().map_err(|_| EnvelopeError::Malformed)?;
    if body.len() > max_body || body.is_empty() {
        return Err(EnvelopeError::Malformed);
    }
    let key = ring.get(kid).ok_or(EnvelopeError::UnknownKid)?;
    let mut message = Vec::with_capacity(context.len() + body.len());
    message.extend_from_slice(context);
    message.extend_from_slice(&body);
    key.verify_strict(&message, &Signature::from_bytes(&sig))
        .map_err(|_| EnvelopeError::InvalidSignature)?;
    Ok(body)
}

// ---- payload ----

#[derive(Deserialize)]
struct RawFile {
    payload: String,
    sig: String,
    kid: String,
}

/// 파일 출처.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    License,
    Plan,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::License => "license",
            Source::Plan => "plan",
        }
    }
}

/// 표시용 기능 플래그(발급 시점 값). 클라우드 판정은 서버.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Features {
    pub drafting_watermark: bool,
    pub rule_pack_updates: bool,
    pub cloud_review: bool,
    pub ai_render: bool,
}

/// 사용자별 합성 권리(AR-06-074가 채운다). 없으면 기본값([`EffectiveRights`] 참고).
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rights {
    pub web_edit: Option<bool>,
    pub desktop_edit: Option<bool>,
    pub view_export: Option<bool>,
    pub ai_render: Option<bool>,
    pub ai_chat: Option<bool>,
    pub cloud_review: Option<bool>,
    pub devices_max: Option<u32>,
}

/// 권리별 종료 시각(RFC 3339). null·누락은 보수적 기본값([`LicensePayload::right_expiry`]).
#[derive(Deserialize, Clone, PartialEq, Eq, Default)]
pub struct RightsExpiry {
    pub web_edit: Option<String>,
    pub desktop_edit: Option<String>,
    pub ai_render: Option<String>,
    pub ai_chat: Option<String>,
    pub cloud_review: Option<String>,
}

/// `rights_expiry` 키(`view_export` 제외).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Right {
    WebEdit,
    DesktopEdit,
    AiRender,
    AiChat,
    CloudReview,
}

impl Right {
    pub const ALL: [Right; 5] = [
        Right::WebEdit,
        Right::DesktopEdit,
        Right::AiRender,
        Right::AiChat,
        Right::CloudReview,
    ];
}

/// 서명된 payload(04_API.md 2.4절 `LicensePayloadV1`). `Debug`는 가린다. 필드는 크레이트 밖에서 getter로만 읽는다.
#[derive(Deserialize, Clone, PartialEq, Eq)]
pub struct LicensePayload {
    pub(crate) v: u32,
    pub(crate) license_id: Option<String>,
    pub(crate) org_id: String,
    pub(crate) app_id: String,
    pub(crate) sku: String,
    pub(crate) source: Source,
    pub(crate) updates_until: Option<String>,
    pub(crate) activation_id: String,
    pub(crate) device_hash: String,
    pub(crate) issued_at: String,
    pub(crate) kid: String,
    pub(crate) offline_valid_until: Option<String>,
    pub(crate) features: Features,
    #[serde(default)]
    pub(crate) seat_id: Option<String>,
    #[serde(default)]
    pub(crate) rights: Option<Rights>,
    #[serde(default)]
    pub(crate) rights_expiry: Option<RightsExpiry>,
}

impl std::fmt::Debug for LicensePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LicensePayload(<redacted>)")
    }
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

impl LicensePayload {
    pub fn license_id(&self) -> Option<&str> {
        self.license_id.as_deref()
    }
    pub fn org_id(&self) -> &str {
        &self.org_id
    }
    pub fn sku(&self) -> &str {
        &self.sku
    }
    pub fn source(&self) -> Source {
        self.source
    }
    pub fn updates_until(&self) -> Option<&str> {
        self.updates_until.as_deref()
    }
    pub fn activation_id(&self) -> &str {
        &self.activation_id
    }
    pub fn issued_at(&self) -> &str {
        &self.issued_at
    }
    pub fn offline_valid_until(&self) -> Option<&str> {
        self.offline_valid_until.as_deref()
    }
    pub fn features(&self) -> Features {
        self.features
    }
    pub fn seat_id(&self) -> Option<&str> {
        self.seat_id.as_deref()
    }
    /// 파일에 적힌 권리(만료 반영 전). 실제 권리는 [`VerifiedLicense::rights`].
    pub fn granted_rights(&self) -> Option<Rights> {
        self.rights
    }
    pub fn rights_expiry(&self) -> Option<&RightsExpiry> {
        self.rights_expiry.as_ref()
    }

    /// `issued_at`(유닉스 초). [`validate`] 뒤에만 부른다.
    pub fn issued_at_secs(&self) -> i64 {
        parse_instant(&self.issued_at).unwrap_or(i64::MAX)
    }

    /// 형식 검사. 해석 불가 값이 하나라도 있으면 거부(실패 닫힘).
    fn validate(&self) -> bool {
        let instant_ok =
            |v: &Option<String>| v.as_deref().is_none_or(|s| parse_instant(s).is_some());
        let expiry_ok = self.rights_expiry.as_ref().is_none_or(|e| {
            [
                &e.web_edit,
                &e.desktop_edit,
                &e.ai_render,
                &e.ai_chat,
                &e.cloud_review,
            ]
            .into_iter()
            .all(instant_ok)
        });
        self.v == 1
            && self.app_id == "arch"
            && valid_kid(&self.kid)
            && is_hex64(&self.device_hash)
            && parse_instant(&self.issued_at).is_some()
            && instant_ok(&self.offline_valid_until)
            && self
                .updates_until
                .as_deref()
                .is_none_or(|d| parse_date(d).is_some())
            // 영구 출처는 업데이트 유효 기간이 있어야 한다(빌드·규칙 팩 자격 기준).
            && (self.source == Source::Plan || self.updates_until.is_some())
            && expiry_ok
    }

    /// 오프라인 편집 한도(유닉스 초). 영구 + `offline_valid_until` 없음 = 무기한(`None`).
    pub fn offline_limit(&self) -> Option<i64> {
        match (&self.offline_valid_until, self.source) {
            (Some(s), _) => parse_instant(s),
            (None, Source::Plan) => Some(self.issued_at_secs().saturating_add(PLAN_OFFLINE_SECS)),
            (None, Source::License) => None,
        }
    }

    /// 권리별 종료 시각. 값이 없으면 영구 = `issued_at` + 30일, 플랜 = 오프라인 한도(가장 보수적).
    pub fn right_expiry(&self, right: Right) -> i64 {
        let given = self.rights_expiry.as_ref().and_then(|e| match right {
            Right::WebEdit => e.web_edit.as_deref(),
            Right::DesktopEdit => e.desktop_edit.as_deref(),
            Right::AiRender => e.ai_render.as_deref(),
            Right::AiChat => e.ai_chat.as_deref(),
            Right::CloudReview => e.cloud_review.as_deref(),
        });
        if let Some(t) = given.and_then(parse_instant) {
            return t;
        }
        let issued = self.issued_at_secs();
        match self.source {
            Source::License => issued.saturating_add(PERPETUAL_RIGHTS_SECS),
            Source::Plan => self
                .offline_limit()
                .unwrap_or(issued.saturating_add(PLAN_OFFLINE_SECS)),
        }
    }

    /// 파일이 주는 권리(만료 전). `rights`가 없으면(074 이전 파일) 설치형 편집만 true, 클라우드·AI·웹은 false(서버 판정).
    fn granted(&self, right: Right) -> bool {
        let r = self.rights.unwrap_or_default();
        let given = match right {
            Right::WebEdit => r.web_edit,
            Right::DesktopEdit => r.desktop_edit,
            Right::AiRender => r.ai_render,
            Right::AiChat => r.ai_chat,
            Right::CloudReview => r.cloud_review,
        };
        given.unwrap_or(self.rights.is_none() && right == Right::DesktopEdit)
    }
}

/// 판정 시각 기준 실제 권리. `view_export`는 항상 true(만료 후에도 열람·내보내기 유지).
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
pub struct EffectiveRights {
    pub web_edit: bool,
    pub desktop_edit: bool,
    pub view_export: bool,
    pub ai_render: bool,
    pub ai_chat: bool,
    pub cloud_review: bool,
}

impl EffectiveRights {
    pub const VIEW_EXPORT_ONLY: Self = Self {
        web_edit: false,
        desktop_edit: false,
        view_export: true,
        ai_render: false,
        ai_chat: false,
        cloud_review: false,
    };

    fn get_mut(&mut self, right: Right) -> &mut bool {
        match right {
            Right::WebEdit => &mut self.web_edit,
            Right::DesktopEdit => &mut self.desktop_edit,
            Right::AiRender => &mut self.ai_render,
            Right::AiChat => &mut self.ai_chat,
            Right::CloudReview => &mut self.cloud_review,
        }
    }
}

/// 서명·기기 검증을 통과한 파일과 판정 결과. `Debug`는 가린다.
///
/// 봉인: 이 모듈의 [`evaluate`]만 만든다(비공개 `_seal`). 크레이트 밖에서는 서명 없이 "valid"를 만들 수 없다.
///
/// ```compile_fail
/// // 필드 직접 읽기 불가(getter만).
/// fn f(l: &arch_studio_desktop_lib::license::VerifiedLicense) -> bool { l.build_eligible }
/// ```
///
/// ```compile_fail
/// // 구조체 리터럴로 만들 수 없다.
/// use arch_studio_desktop_lib::license::{EffectiveRights, LicensePayload, VerifiedLicense};
/// fn f(payload: LicensePayload) -> VerifiedLicense {
///     VerifiedLicense { payload, rights: EffectiveRights::VIEW_EXPORT_ONLY, build_eligible: true, _seal: () }
/// }
/// ```
///
/// ```compile_fail
/// // payload 필드도 크레이트 밖에서 쓰거나 읽을 수 없다.
/// fn f(p: &mut arch_studio_desktop_lib::license::LicensePayload) { p.device_hash = String::new(); }
/// ```
#[derive(Clone, PartialEq, Eq)]
pub struct VerifiedLicense {
    pub(crate) payload: LicensePayload,
    pub(crate) rights: EffectiveRights,
    /// 내장 빌드 날짜 <= `updates_until`(영구). 플랜은 true. 빌드 날짜를 모르면 영구는 false(실패 닫힘).
    pub(crate) build_eligible: bool,
    _seal: (),
}

impl VerifiedLicense {
    pub fn payload(&self) -> &LicensePayload {
        &self.payload
    }

    /// 판정 시각 기준 실제 권리(만료·빌드 자격 반영).
    pub fn rights(&self) -> EffectiveRights {
        self.rights
    }

    /// 업데이트 기간 안의 빌드인가. false면 `rights().desktop_edit`도 false다.
    pub fn build_eligible(&self) -> bool {
        self.build_eligible
    }
}

impl std::fmt::Debug for VerifiedLicense {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VerifiedLicense(<redacted>)")
    }
}

/// 검증 결과.
#[derive(Clone, PartialEq, Eq)]
pub enum LicenseVerdict {
    /// 유효(권리별 만료는 `rights`에 반영).
    Valid(VerifiedLicense),
    /// 서명은 유효하지만 오프라인 한도·설치형 편집 권리 만료, 또는 더 새 파일을 본 뒤의 옛 파일. 열람·내보내기만.
    Expired(VerifiedLicense),
    /// 시계 되돌림 감지. 만료와 같은 처리.
    ClockAnomaly(VerifiedLicense),
    /// 파일 없음(미활성).
    Absent,
    /// 형식 오류·크기 초과·해석 불가·다른 앱·다른 버전.
    Malformed,
    /// 고리에 없는 kid.
    UnknownKid,
    /// 서명 불일치·바깥 kid와 payload kid 불일치.
    InvalidSignature,
    /// 다른 기기 파일(또는 기기 식별자를 읽지 못함).
    DeviceMismatch,
}

impl LicenseVerdict {
    /// 화면에 주는 상태 이름(04_API.md 2.4절 `LicenseStatus.state` + `expired`·`clock_anomaly`).
    pub fn state(&self) -> &'static str {
        match self {
            LicenseVerdict::Valid(_) => "valid",
            LicenseVerdict::Expired(_) => "expired",
            LicenseVerdict::ClockAnomaly(_) => "clock_anomaly",
            LicenseVerdict::Absent => "absent",
            LicenseVerdict::Malformed => "malformed",
            LicenseVerdict::UnknownKid => "unknown_kid",
            LicenseVerdict::InvalidSignature => "invalid_signature",
            LicenseVerdict::DeviceMismatch => "device_mismatch",
        }
    }

    /// 서명·기기 검증을 통과한 파일(유효·만료·시계 이상).
    pub fn license(&self) -> Option<&VerifiedLicense> {
        match self {
            LicenseVerdict::Valid(l)
            | LicenseVerdict::Expired(l)
            | LicenseVerdict::ClockAnomaly(l) => Some(l),
            _ => None,
        }
    }
}

impl std::fmt::Debug for LicenseVerdict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LicenseVerdict({})", self.state())
    }
}

// ---- 시계 기록 ----

/// 단조 증가 기록. `last_seen` = 관측한 가장 늦은 시스템 시각, `max_issued_at` = 통과한 파일 중 가장 늦은 `issued_at`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct ClockRecord {
    pub last_seen: i64,
    pub max_issued_at: i64,
}

impl ClockRecord {
    /// 직렬화(`v1:<last_seen>:<max_issued_at>`).
    pub fn encode(&self) -> String {
        format!("v1:{}:{}", self.last_seen, self.max_issued_at)
    }

    pub fn decode(s: &str) -> Option<Self> {
        let mut p = s.split(':');
        if p.next()? != "v1" {
            return None;
        }
        let last_seen = p.next()?.parse().ok()?;
        let max_issued_at = p.next()?.parse().ok()?;
        if p.next().is_some() {
            return None;
        }
        Some(Self {
            last_seen,
            max_issued_at,
        })
    }
}

/// 시계 기록 읽기 결과.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClockLoad {
    /// 항목 없음(첫 실행·삭제). 파일이 [`MISSING_RECORD_MAX_AGE_SECS`]보다 오래됐으면 `expired`.
    Missing,
    /// 저장소를 읽지 못함(키체인 잠김·접근 거부). 판정은 `Missing`과 같고, 덮어쓰지 않는다(더 높은 기록을 낮추지 않게).
    Unreadable,
    /// 항목은 있으나 형식 오류. 정상 경로에서는 생기지 않으므로 `clock_anomaly`(막 발급된 파일만 복구).
    Corrupt,
    Record(ClockRecord),
}

impl From<Option<ClockRecord>> for ClockLoad {
    fn from(v: Option<ClockRecord>) -> Self {
        v.map_or(ClockLoad::Missing, ClockLoad::Record)
    }
}

/// 시계 기록 저장소. 앱은 OS 키체인(`commands::license::KeychainClockStore`), 테스트는 [`MemoryClockStore`].
/// SQLite·`local_settings`에 두지 않는다. 쓰기 실패는 무시(다음 판정이 기록 없음·옛 기록으로 처리).
pub trait ClockStore: Send + Sync {
    fn load(&self) -> ClockLoad;
    fn save(&self, record: ClockRecord);
}

/// 메모리 시계 기록(테스트용).
#[derive(Default)]
pub struct MemoryClockStore(Mutex<Option<ClockRecord>>);

impl MemoryClockStore {
    pub fn with(record: ClockRecord) -> Self {
        Self(Mutex::new(Some(record)))
    }

    pub fn get(&self) -> Option<ClockRecord> {
        self.0.lock().ok().and_then(|g| *g)
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.0.lock() {
            *g = None;
        }
    }
}

impl ClockStore for MemoryClockStore {
    fn load(&self) -> ClockLoad {
        self.get().into()
    }

    fn save(&self, record: ClockRecord) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(record);
        }
    }
}

// ---- 판정 ----

/// 판정 입력. 시각·기기·기록은 모두 주입한다.
pub struct VerifyInput<'a> {
    pub keys: &'a KeyRing,
    /// 현재 기기에서 다시 계산한 `device_hash`. `None` = 기기 식별자를 읽지 못함(→ `DeviceMismatch`).
    pub device_hash: Option<&'a str>,
    /// 현재 시스템 시각(유닉스 초).
    pub now: i64,
    /// 내장 빌드 날짜(1970-01-01부터 일수). 모르면 `None`.
    pub build_date: Option<i64>,
}

/// 판정 + 기록 갱신. 기록은 `max`로만 움직인다(예외: 서버가 막 발급한 새 파일로 미래 시각 잠금 복구).
/// `last_seen`만 [`CLOCK_SAVE_INTERVAL_SECS`]보다 적게 움직였으면 쓰지 않는다.
pub fn verify_license(
    file: Option<&str>,
    input: &VerifyInput<'_>,
    store: &dyn ClockStore,
) -> LicenseVerdict {
    let previous = store.load();
    let (verdict, next) = evaluate(file, input, previous);
    if let Some(next) = next {
        if should_persist(previous, next) {
            store.save(next);
        }
    }
    verdict
}

/// 새 기록을 저장소에 쓸지. 기록이 없었거나 형식 오류였거나, `max_issued_at`이 바뀌었거나,
/// `last_seen`이 내려갔거나(미래 시각 잠금 복구), 간격 이상 올라갔을 때만.
fn should_persist(previous: ClockLoad, next: ClockRecord) -> bool {
    match previous {
        ClockLoad::Record(r) => {
            next.max_issued_at != r.max_issued_at
                || next.last_seen < r.last_seen
                || next.last_seen.saturating_sub(r.last_seen) >= CLOCK_SAVE_INTERVAL_SECS
        }
        _ => true,
    }
}

const NO_RECORD: ClockRecord = ClockRecord {
    last_seen: i64::MIN,
    max_issued_at: i64::MIN,
};

/// 순수 판정. 두 번째 값은 저장할 새 기록(없으면 그대로).
pub fn evaluate(
    file: Option<&str>,
    input: &VerifyInput<'_>,
    previous: ClockLoad,
) -> (LicenseVerdict, Option<ClockRecord>) {
    let payload = match authenticate(file, input.keys) {
        Ok(p) => p,
        Err(r) => return (r.verdict(), None),
    };
    match input.device_hash {
        Some(h) if h == payload.device_hash => {}
        _ => return (LicenseVerdict::DeviceMismatch, None),
    }

    let now = input.now;
    let issued = payload.issued_at_secs();
    let build_eligible = match payload.source {
        Source::Plan => true,
        Source::License => match (
            input.build_date,
            payload.updates_until.as_deref().and_then(parse_date),
        ) {
            (Some(b), Some(u)) => b <= u,
            _ => false,
        },
    };
    let restricted = |payload: LicensePayload| VerifiedLicense {
        payload,
        rights: EffectiveRights::VIEW_EXPORT_ONLY,
        build_eligible,
        _seal: (),
    };
    // 서버가 막 발급한 파일: 서명 검증 통과 + 발급 시각이 현재와 허용 오차 안.
    let fresh = now.abs_diff(issued) <= CLOCK_TOLERANCE_SECS.unsigned_abs();
    // (비교 기준 기록, 새 기록을 돌려줄지, 기록이 없는 상태인지)
    let (prev, persist, unrecorded) = match previous {
        // 미래 시각 잠금 복구: 본 적 없는 더 새 파일이 지금 막 발급됐으면 last_seen을 다시 잡는다.
        // 옛 파일 재제출(issued <= max_issued_at)이나 시계를 되돌린 상태(fresh 아님)로는 복구되지 않는다.
        ClockLoad::Record(r) if fresh && issued > r.max_issued_at => (
            ClockRecord {
                last_seen: now.max(issued),
                max_issued_at: r.max_issued_at,
            },
            true,
            false,
        ),
        ClockLoad::Record(r) => (r, true, false),
        ClockLoad::Corrupt if fresh => (NO_RECORD, true, false),
        ClockLoad::Corrupt => return (LicenseVerdict::ClockAnomaly(restricted(payload)), None),
        ClockLoad::Missing => (NO_RECORD, true, true),
        ClockLoad::Unreadable => (NO_RECORD, false, true),
    };
    let rolled_back = now.saturating_add(CLOCK_TOLERANCE_SECS) < prev.last_seen
        || now.saturating_add(CLOCK_TOLERANCE_SECS) < issued;
    if rolled_back {
        // 기록을 낮추지도, 미래 issued_at으로 올리지도 않는다.
        return (LicenseVerdict::ClockAnomaly(restricted(payload)), None);
    }
    if unrecorded && now.saturating_sub(issued) > MISSING_RECORD_MAX_AGE_SECS {
        // 기록 없음 + 오래된 파일: 기록 삭제 뒤 시계 되돌림과 구분할 수 없다 → 온라인 refresh 필요.
        // 기록을 새로 쓰지 않는다(쓰면 다음 실행부터 기록 삭제가 다시 통한다).
        return (LicenseVerdict::Expired(restricted(payload)), None);
    }

    let effective_now = now.max(prev.last_seen);
    let next = persist.then_some(ClockRecord {
        last_seen: effective_now,
        max_issued_at: prev.max_issued_at.max(issued),
    });
    if issued < prev.max_issued_at {
        // 더 새 파일을 본 뒤의 옛 파일(백업 복원·좌석 회수 전 파일 재사용).
        return (LicenseVerdict::Expired(restricted(payload)), next);
    }
    if payload.offline_limit().is_some_and(|t| effective_now >= t) {
        return (LicenseVerdict::Expired(restricted(payload)), next);
    }

    let mut rights = EffectiveRights {
        web_edit: false,
        desktop_edit: false,
        view_export: true,
        ai_render: false,
        ai_chat: false,
        cloud_review: false,
    };
    for right in Right::ALL {
        *rights.get_mut(right) =
            payload.granted(right) && effective_now < payload.right_expiry(right);
    }
    if payload.granted(Right::DesktopEdit) && !rights.desktop_edit {
        // 설치형 편집 권리가 기간(영구 30일 재확인 등)을 넘겼다.
        return (LicenseVerdict::Expired(restricted(payload)), next);
    }
    // 업데이트 기간 밖 빌드(또는 빌드 날짜 모름): 설치형 편집은 끄고 열람·내보내기는 유지한다.
    // 상태는 `valid`, 화면은 `build_eligible = false`로 "이 버전은 업데이트 기간 밖"을 안내한다.
    rights.desktop_edit &= build_eligible;
    (
        LicenseVerdict::Valid(VerifiedLicense {
            payload,
            rights,
            build_eligible,
            _seal: (),
        }),
        next,
    )
}

/// 서명 단계 실패(내용 없음).
#[derive(Clone, Copy)]
enum Rejected {
    Absent,
    Malformed,
    UnknownKid,
    InvalidSignature,
}

impl Rejected {
    fn verdict(self) -> LicenseVerdict {
        match self {
            Rejected::Absent => LicenseVerdict::Absent,
            Rejected::Malformed => LicenseVerdict::Malformed,
            Rejected::UnknownKid => LicenseVerdict::UnknownKid,
            Rejected::InvalidSignature => LicenseVerdict::InvalidSignature,
        }
    }
}

/// 서명 검증 → payload 해석·형식 검사. 기기·시각은 보지 않는다.
fn authenticate(file: Option<&str>, keys: &KeyRing) -> Result<LicensePayload, Rejected> {
    let Some(text) = file else {
        return Err(Rejected::Absent);
    };
    if text.len() > MAX_FILE_BYTES {
        return Err(Rejected::Malformed);
    }
    if text.trim().is_empty() {
        return Err(Rejected::Absent);
    }
    let raw: RawFile = serde_json::from_str(text).map_err(|_| Rejected::Malformed)?;
    if !valid_kid(&raw.kid) {
        return Err(Rejected::Malformed);
    }
    let bytes = verify_envelope(
        keys,
        LICENSE_CONTEXT,
        &raw.kid,
        &raw.payload,
        &raw.sig,
        MAX_PAYLOAD_BYTES,
    )
    .map_err(|e| match e {
        EnvelopeError::Malformed => Rejected::Malformed,
        EnvelopeError::UnknownKid => Rejected::UnknownKid,
        EnvelopeError::InvalidSignature => Rejected::InvalidSignature,
    })?;
    // 검증한 바이트 그대로 해석(재정준화 없음). 구조체 필드 중복 키는 serde가 거부한다.
    let payload: LicensePayload =
        serde_json::from_slice(&bytes).map_err(|_| Rejected::Malformed)?;
    if payload.kid != raw.kid {
        return Err(Rejected::InvalidSignature);
    }
    if !payload.validate() {
        return Err(Rejected::Malformed);
    }
    Ok(payload)
}

/// 서버 `eligible_rule_packs` 폴백 경계: `updates_until` 다음 날 00:00(Asia/Seoul)을 유닉스 초로.
pub fn updates_limit_secs(updates_until_days: i64) -> i64 {
    (updates_until_days + 1) * 86_400 - SEOUL_OFFSET_SECS
}

#[cfg(test)]
mod tests;
