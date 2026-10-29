//! 라이선스 명령(AR-06-041). 화면은 `license_verify`·`device_hash_get` 2개만 부른다.
//!
//! - `license_verify(file)`: 라이선스 파일 문자열(최대 [`MAX_FILE_BYTES`]) → 상태. 경로·URL·시각·키를 받지 않는다.
//!   실패 상태는 상태 이름만(`malformed`·`unknown_kid`·`invalid_signature`·`device_mismatch`·`absent`).
//! - `device_hash_get()`: 활성화 요청용 `device_hash`(hex64). 원문 기기 식별자는 돌려주지 않는다.
//! - 시계 기록은 OS 키체인 항목 [`CLOCK_ACCOUNT`](화면 허용 키 `secrets::ALLOWED_KEYS` 밖)에 둔다. SQLite·설정 파일에 두지 않는다.
//! - 이 모듈은 로그를 남기지 않는다.

use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::State;

use super::secrets::{KeyringBackend, SecretBackend, SERVICE};
use super::AppError;
use crate::device::{current_device_hash, DeviceIdSource, OsDeviceId};
use crate::license::codec::{format_instant, parse_date};
use crate::license::{
    verify_license, ClockLoad, ClockRecord, ClockStore, EffectiveRights, Features, KeyRing,
    LicenseVerdict, Right, VerifyInput,
};

/// 키체인 계정 이름(시계 기록). 화면 `secret_*` 명령으로는 읽거나 쓸 수 없다.
pub const CLOCK_ACCOUNT: &str = "license.clock.v1";

/// 오류 코드(화면 흐름용 내부 코드).
pub mod code {
    /// 기기 식별자를 읽지 못함.
    pub const DEVICE_UNAVAILABLE: &str = "DEVICE_UNAVAILABLE";
}

/// 키체인 시계 기록. 읽기 실패 = `Unreadable`(덮어쓰지 않음), 항목 없음 = `Missing`, 형식 오류 = `Corrupt`(시계 이상).
pub struct KeychainClockStore {
    backend: Arc<dyn SecretBackend>,
}

impl KeychainClockStore {
    pub fn new(backend: Arc<dyn SecretBackend>) -> Self {
        Self { backend }
    }
}

impl ClockStore for KeychainClockStore {
    fn load(&self) -> ClockLoad {
        match self.backend.get(CLOCK_ACCOUNT) {
            Err(_) => ClockLoad::Unreadable,
            Ok(None) => ClockLoad::Missing,
            Ok(Some(bytes)) => std::str::from_utf8(&bytes)
                .ok()
                .and_then(ClockRecord::decode)
                .map_or(ClockLoad::Corrupt, ClockLoad::Record),
        }
    }

    fn save(&self, record: ClockRecord) {
        let _ = self.backend.set(CLOCK_ACCOUNT, record.encode().as_bytes());
    }
}

/// 현재 시각(유닉스 초). 테스트는 고정 시계를 쓴다.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    })
}

/// 릴리스 빌드가 넣는 빌드 날짜(`ARCH_BUILD_DATE=YYYY-MM-DD`, 컴파일 시점). 없으면 영구의 `build_eligible`은 false
/// (설치형 편집 불가). 개발·테스트(디버그) 빌드는 없어도 되고, 릴리스 빌드는 아래 단언으로 컴파일이 실패한다.
pub fn embedded_build_date() -> Option<i64> {
    option_env!("ARCH_BUILD_DATE").and_then(parse_date)
}

/// `YYYY-MM-DD` 모양인지(컴파일 시점 검사용. 달력 유효성은 [`parse_date`]가 실행 시 본다).
pub const fn is_build_date_shape(v: Option<&str>) -> bool {
    let Some(s) = v else {
        return false;
    };
    let b = s.as_bytes();
    if b.len() != 10 {
        return false;
    }
    let mut i = 0;
    while i < 10 {
        let ok = match i {
            4 | 7 => b[i] == b'-',
            _ => b[i].is_ascii_digit(),
        };
        if !ok {
            return false;
        }
        i += 1;
    }
    true
}

// 릴리스 빌드(debug_assertions 꺼짐)는 ARCH_BUILD_DATE가 없으면 컴파일 실패: 영구 사용자 전원이 편집 불가가 되는 배포를 막는다.
#[cfg(not(debug_assertions))]
const _: () = assert!(
    is_build_date_shape(option_env!("ARCH_BUILD_DATE")),
    "릴리스 빌드에는 ARCH_BUILD_DATE=YYYY-MM-DD 환경 변수가 필요하다(AR-06-041 D9)"
);

/// 검증 서비스. 키 고리·기기·시계·기록을 주입받는다.
pub struct LicenseService {
    keys: KeyRing,
    device: Arc<dyn DeviceIdSource>,
    store: Arc<dyn ClockStore>,
    clock: Clock,
    build_date: Option<i64>,
    // 기록 읽기→판정→쓰기를 한 번에 하나씩.
    lock: Mutex<()>,
    // 기기 해시는 프로세스 수명 동안 한 번만 계산한다(반복 호출로 OS 조회·프로세스 실행이 늘지 않게). 실패는 캐시하지 않는다.
    device_cache: OnceLock<String>,
}

impl LicenseService {
    pub fn new(
        keys: KeyRing,
        device: Arc<dyn DeviceIdSource>,
        store: Arc<dyn ClockStore>,
        clock: Clock,
        build_date: Option<i64>,
    ) -> Self {
        Self {
            keys,
            device,
            store,
            clock,
            build_date,
            lock: Mutex::new(()),
            device_cache: OnceLock::new(),
        }
    }

    /// 운영: 내장 공개키, OS 기기 식별자, OS 키체인 시계 기록, 시스템 시각.
    pub fn production() -> Self {
        Self::new(
            KeyRing::production_license(),
            Arc::new(OsDeviceId),
            Arc::new(KeychainClockStore::new(Arc::new(KeyringBackend::new(
                SERVICE,
            )))),
            system_clock(),
            embedded_build_date(),
        )
    }

    fn cached_device_hash(&self) -> Option<String> {
        if let Some(h) = self.device_cache.get() {
            return Some(h.clone());
        }
        let h = current_device_hash(self.device.as_ref())?;
        Some(self.device_cache.get_or_init(|| h).clone())
    }

    pub fn verify(&self, file: Option<&str>) -> LicenseVerdict {
        let device_hash = self.cached_device_hash();
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let input = VerifyInput {
            keys: &self.keys,
            device_hash: device_hash.as_deref(),
            now: (self.clock)(),
            build_date: self.build_date,
        };
        verify_license(file, &input, self.store.as_ref())
    }

    pub fn device_hash(&self) -> Result<String, AppError> {
        self.cached_device_hash()
            .ok_or_else(|| AppError::new(code::DEVICE_UNAVAILABLE, "device"))
    }
}

/// 관리 상태.
#[derive(Clone)]
pub struct LicenseState(pub Arc<LicenseService>);

/// 권리별 종료 시각(표시용, RFC 3339).
#[derive(Serialize, Clone, PartialEq, Eq)]
pub struct RightsExpiryView {
    pub web_edit: String,
    pub desktop_edit: String,
    pub ai_render: String,
    pub ai_chat: String,
    pub cloud_review: String,
}

/// 화면에 주는 라이선스 요약. `device_hash`·`kid`·서명·payload 원문은 넣지 않는다.
#[derive(Serialize, Clone, PartialEq, Eq)]
pub struct LicenseView {
    pub license_id: Option<String>,
    pub org_id: String,
    pub sku: String,
    pub source: &'static str,
    pub updates_until: Option<String>,
    pub activation_id: String,
    pub seat_id: Option<String>,
    pub issued_at: String,
    pub offline_valid_until: Option<String>,
    pub features: Features,
    pub rights: EffectiveRights,
    pub rights_expiry: RightsExpiryView,
    pub build_eligible: bool,
}

impl std::fmt::Debug for LicenseView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LicenseView(<redacted>)")
    }
}

/// `license_verify` 응답.
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct LicenseStatus {
    pub state: &'static str,
    pub license: Option<LicenseView>,
}

impl From<&LicenseVerdict> for LicenseStatus {
    fn from(v: &LicenseVerdict) -> Self {
        let license = v.license().map(|l| {
            let p = l.payload();
            let exp = |r: Right| format_instant(p.right_expiry(r));
            LicenseView {
                license_id: p.license_id().map(str::to_string),
                org_id: p.org_id().to_string(),
                sku: p.sku().to_string(),
                source: p.source().as_str(),
                updates_until: p.updates_until().map(str::to_string),
                activation_id: p.activation_id().to_string(),
                seat_id: p.seat_id().map(str::to_string),
                issued_at: p.issued_at().to_string(),
                offline_valid_until: p.offline_valid_until().map(str::to_string),
                features: p.features(),
                rights: l.rights(),
                rights_expiry: RightsExpiryView {
                    web_edit: exp(Right::WebEdit),
                    desktop_edit: exp(Right::DesktopEdit),
                    ai_render: exp(Right::AiRender),
                    ai_chat: exp(Right::AiChat),
                    cloud_review: exp(Right::CloudReview),
                },
                build_eligible: l.build_eligible(),
            }
        });
        Self {
            state: v.state(),
            license,
        }
    }
}

/// 라이선스 파일 검증. `file`이 없거나 비면 `absent`. 크기 상한은 [`MAX_FILE_BYTES`].
#[tauri::command(async)]
pub fn license_verify(state: State<'_, LicenseState>, file: Option<String>) -> LicenseStatus {
    LicenseStatus::from(&state.0.verify(file.as_deref()))
}

/// 현재 기기의 `device_hash`(활성화·refresh 요청용).
#[tauri::command(async)]
pub fn device_hash_get(state: State<'_, LicenseState>) -> Result<String, AppError> {
    state.0.device_hash()
}
