//! 규칙 팩 매니페스트 서명·자격 검사(AR-06-041). 설치·불러오기 배선은 AR-06-042 `commands/rule_pack.rs`.
//!
//! - 서명 매니페스트 = `{ manifest: base64url(JSON 바이트), sig: base64url(Ed25519), kid }`.
//!   서명 입력 = [`RULEPACK_CONTEXT`](`"arch-rulepack-v1\n"`) ‖ manifest 바이트 그대로(라이선스와 다른 도메인·다른 키 고리).
//! - manifest JSON(v1): `{ v: 1, app_id: "arch", version: "YYYY.MM.n", published_at: RFC 3339, basis_date: "YYYY-MM-DD",
//!   sha256: hex64(팩 본문), bytes: 팩 바이트 수, kid }`. 필드 정의는 042와 합의 항목(tasks/logs/AR-06-041.md).
//! - 엔진에는 [`AdmittedRulePack`]만 넘긴다. 이 타입은 [`admit_rule_pack`]만 만들 수 있다(필드 비공개):
//!   라이선스 `valid` + 매니페스트 서명 + 본문 해시·크기 일치 + 자격(영구: `published_at < updates_until 다음 날 00:00 KST`,
//!   플랜: `features.rule_pack_updates`)을 모두 통과해야 한다.

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::codec::{parse_date, parse_instant};
use super::{
    updates_limit_secs, verify_envelope, EnvelopeError, KeyRing, LicenseVerdict, Source,
    RULEPACK_CONTEXT,
};

/// 서명 매니페스트 문자열 상한.
pub const MAX_SIGNED_MANIFEST_BYTES: usize = 8 * 1024;
/// 디코드한 manifest 상한.
pub const MAX_MANIFEST_BYTES: usize = 4 * 1024;
/// 팩 본문 상한(AR-06-042 P6: 2026.10.0 팩은 약 7 KB. 넉넉히 8 MiB, 파싱·해시 전에 검사).
pub const MAX_PACK_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
struct RawSignedManifest {
    manifest: String,
    sig: String,
    kid: String,
}

/// 서명된 매니페스트.
#[derive(Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct RulePackManifest {
    pub v: u32,
    pub app_id: String,
    pub version: String,
    pub published_at: String,
    pub basis_date: String,
    pub sha256: String,
    pub bytes: u64,
    pub kid: String,
}

/// `YYYY.MM.n` 형식(설치 폴더 이름으로도 쓰므로 숫자·점 외 문자는 받지 않는다, AR-06-042 P7).
pub fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3
        && parts[0].len() == 4
        && parts[1].len() == 2
        && (1..=3).contains(&parts[2].len())
        && parts.iter().all(|p| p.bytes().all(|b| b.is_ascii_digit()))
}

impl RulePackManifest {
    fn validate(&self) -> bool {
        self.v == 1
            && self.app_id == "arch"
            && valid_version(&self.version)
            && parse_instant(&self.published_at).is_some()
            && parse_date(&self.basis_date).is_some()
            && self.sha256.len() == 64
            && self
                .sha256
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            && self.bytes > 0
            && self.bytes <= MAX_PACK_BYTES as u64
    }
}

/// `YYYY.MM.n` 버전 비교. 형식은 [`valid_version`]으로 먼저 확인한다(형식 밖 조각은 0으로 읽는다).
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| -> [u32; 3] {
        let mut out = [0u32; 3];
        for (i, p) in v.split('.').take(3).enumerate() {
            out[i] = p.parse().unwrap_or(0);
        }
        out
    };
    parse(a).cmp(&parse(b))
}

/// 거부 이유(내용·서명 없음).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RulePackRejection {
    /// 라이선스가 `valid`가 아니거나 팩이 자격 밖.
    NotEntitled,
    /// 서명 매니페스트·본문이 상한을 넘음(파싱 전 검사).
    TooLarge,
    Malformed,
    UnknownKid,
    InvalidSignature,
    /// 본문 해시·크기가 매니페스트와 다름.
    ContentMismatch,
}

/// 엔진에 넘길 수 있는 팩. [`admit_rule_pack`]만 만든다.
pub struct AdmittedRulePack {
    manifest: RulePackManifest,
    pack: Vec<u8>,
}

impl AdmittedRulePack {
    pub fn manifest(&self) -> &RulePackManifest {
        &self.manifest
    }

    pub fn bytes(&self) -> &[u8] {
        &self.pack
    }
}

impl std::fmt::Debug for AdmittedRulePack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AdmittedRulePack")
            .field("version", &self.manifest.version)
            .finish_non_exhaustive()
    }
}

/// 라이선스 상태와 팩 게시 시각으로 자격을 판정한다(순수).
/// - `valid`가 아니면(만료·시계 이상·변조·미활성) false.
/// - 영구(license 출처): `published_at < (updates_until + 1일) 00:00 KST`(서버 `arch.eligible_rule_packs` 폴백 경계와 같음).
/// - 플랜 출처: `features.rule_pack_updates`(체험·구독 유효 중).
pub fn pack_entitled(license: &LicenseVerdict, published_at: i64) -> bool {
    let LicenseVerdict::Valid(l) = license else {
        return false;
    };
    match l.payload.source {
        Source::License => l
            .payload
            .updates_until
            .as_deref()
            .and_then(parse_date)
            .is_some_and(|d| published_at < updates_limit_secs(d)),
        Source::Plan => l.payload.features.rule_pack_updates,
    }
}

impl RulePackRejection {
    /// 화면·로그용 상태 이름.
    pub fn as_str(self) -> &'static str {
        match self {
            RulePackRejection::NotEntitled => "not_entitled",
            RulePackRejection::TooLarge => "too_large",
            RulePackRejection::Malformed => "malformed",
            RulePackRejection::UnknownKid => "unknown_kid",
            RulePackRejection::InvalidSignature => "invalid_signature",
            RulePackRejection::ContentMismatch => "content_mismatch",
        }
    }
}

/// 매니페스트 서명 → 형식 → 본문 해시·크기만 검사한다(자격은 보지 않는다). 설치된 팩의 최고 버전 계산(롤백 방어)과
/// [`admit_rule_pack`]이 쓴다. 성공하면 서명된 manifest.
pub fn verify_rule_pack(
    keys: &KeyRing,
    signed_manifest: &str,
    pack: &[u8],
) -> Result<RulePackManifest, RulePackRejection> {
    if signed_manifest.len() > MAX_SIGNED_MANIFEST_BYTES || pack.len() > MAX_PACK_BYTES {
        return Err(RulePackRejection::TooLarge);
    }
    let raw: RawSignedManifest =
        serde_json::from_str(signed_manifest).map_err(|_| RulePackRejection::Malformed)?;
    let bytes = verify_envelope(
        keys,
        RULEPACK_CONTEXT,
        &raw.kid,
        &raw.manifest,
        &raw.sig,
        MAX_MANIFEST_BYTES,
    )
    .map_err(|e| match e {
        EnvelopeError::Malformed => RulePackRejection::Malformed,
        EnvelopeError::UnknownKid => RulePackRejection::UnknownKid,
        EnvelopeError::InvalidSignature => RulePackRejection::InvalidSignature,
    })?;
    let manifest: RulePackManifest =
        serde_json::from_slice(&bytes).map_err(|_| RulePackRejection::Malformed)?;
    if manifest.kid != raw.kid {
        return Err(RulePackRejection::InvalidSignature);
    }
    if !manifest.validate() {
        return Err(RulePackRejection::Malformed);
    }
    let digest = Sha256::digest(pack);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if manifest.bytes != pack.len() as u64 || hex != manifest.sha256 {
        return Err(RulePackRejection::ContentMismatch);
    }
    Ok(manifest)
}

/// 라이선스 `valid` → 매니페스트 서명 → 본문 해시·크기 → 자격 순으로 검사하고, 모두 통과하면 엔진 전달용 팩을 만든다.
pub fn admit_rule_pack(
    license: &LicenseVerdict,
    keys: &KeyRing,
    signed_manifest: &str,
    pack: Vec<u8>,
) -> Result<AdmittedRulePack, RulePackRejection> {
    if !matches!(license, LicenseVerdict::Valid(_)) {
        return Err(RulePackRejection::NotEntitled);
    }
    let manifest = verify_rule_pack(keys, signed_manifest, &pack)?;
    let published_at = parse_instant(&manifest.published_at).ok_or(RulePackRejection::Malformed)?;
    if !pack_entitled(license, published_at) {
        return Err(RulePackRejection::NotEntitled);
    }
    Ok(AdmittedRulePack { manifest, pack })
}
