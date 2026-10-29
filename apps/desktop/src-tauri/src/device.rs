//! 기기 해시(AR-06-041). `device_hash` = SHA-256(앱 솔트 ‖ 정규화한 OS 기기 식별자) 소문자 hex64.
//!
//! - 원문 기기 식별자([`RawDeviceId`])는 이 모듈 밖으로 나가지 않는다: `Display`·`Serialize` 없음, `Debug`는 가림,
//!   오류에도 담지 않는다. 화면·서버·로그에는 해시만 간다.
//! - 앱 솔트([`DEVICE_HASH_SALT`])로 다른 앱(같은 기기 ID를 쓰는 제품)과 해시가 연결되지 않게 한다.
//! - OS 접근은 [`DeviceIdSource`] trait 뒤에 둔다(테스트는 [`StaticDeviceId`]).
//!   Windows `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`(레지스트리 API 직접 호출, 프로세스 실행 없음),
//!   macOS `IOPlatformUUID`(`/usr/sbin/ioreg` 절대 경로·빈 환경), Linux `/etc/machine-id`.

use sha2::{Digest, Sha256};

/// 앱별 솔트(버전 포함). 바꾸면 모든 활성화가 다른 기기로 보인다.
pub const DEVICE_HASH_SALT: &[u8] = b"com.archstudio.desktop/device-hash/v1\0";

/// 식별자 최대 길이(정규화 후).
const MAX_ID_LEN: usize = 128;

/// 원문 기기 식별자(정규화: 앞뒤 공백 제거, 소문자). 비었거나 제어 문자·과다 길이면 만들지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub struct RawDeviceId(String);

impl RawDeviceId {
    pub fn new(raw: &str) -> Option<Self> {
        let s = raw.trim().to_ascii_lowercase();
        if s.is_empty()
            || s.len() > MAX_ID_LEN
            || s.chars().any(char::is_control)
            // 전부 0인 식별자(가상 머신 기본값 등)는 기기를 구분하지 못한다.
            || s.chars().all(|c| matches!(c, '0' | '-'))
        {
            return None;
        }
        Some(Self(s))
    }
}

impl std::fmt::Debug for RawDeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RawDeviceId(<redacted>)")
    }
}

/// 기기 식별자 출처.
pub trait DeviceIdSource: Send + Sync {
    /// 읽지 못하면 `None`(원인은 담지 않는다).
    fn raw_id(&self) -> Option<RawDeviceId>;
}

/// `salt ‖ id` SHA-256 소문자 hex64.
pub fn device_hash(salt: &[u8], id: &RawDeviceId) -> String {
    let mut h = Sha256::new();
    h.update(salt);
    h.update(id.0.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// 앱 솔트로 현재 기기 해시. 식별자를 못 읽으면 `None`.
pub fn current_device_hash(source: &dyn DeviceIdSource) -> Option<String> {
    source.raw_id().map(|id| device_hash(DEVICE_HASH_SALT, &id))
}

/// 고정 식별자(테스트·진단용). 운영 `run()`은 [`OsDeviceId`]만 등록한다.
pub struct StaticDeviceId(pub Option<String>);

impl DeviceIdSource for StaticDeviceId {
    fn raw_id(&self) -> Option<RawDeviceId> {
        self.0.as_deref().and_then(RawDeviceId::new)
    }
}

/// `/etc/machine-id` 내용 → 식별자(32 hex).
pub fn parse_machine_id(content: &str) -> Option<String> {
    let s = content.trim();
    (s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())).then(|| s.to_string())
}

/// 레지스트리 `MachineGuid`(REG_SZ) 값 버퍼(UTF-16, `RegGetValueW`가 채운 만큼) → GUID.
/// 첫 NUL에서 끊고(REG_SZ 종단), 짝 없는 서로게이트·GUID 형식이 아니면 `None`. OS 호출과 분리해 Linux에서도 테스트한다.
pub fn parse_registry_guid(wide: &[u16]) -> Option<String> {
    let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    let v = String::from_utf16(&wide[..end]).ok()?;
    is_guid(&v).then_some(v)
}

/// `ioreg -rd1 -c IOPlatformExpertDevice` 출력 → `IOPlatformUUID`.
pub fn parse_ioreg_uuid(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("\"IOPlatformUUID\"")?;
        let v = rest
            .trim()
            .strip_prefix('=')?
            .trim()
            .strip_prefix('"')?
            .strip_suffix('"')?;
        is_guid(v).then(|| v.to_string())
    })
}

/// macOS 기기 ID 도구(절대 경로만, `PATH` 검색 없음).
pub const IOREG_PATH: &str = "/usr/sbin/ioreg";

fn is_guid(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// OS 기기 식별자.
pub struct OsDeviceId;

impl DeviceIdSource for OsDeviceId {
    fn raw_id(&self) -> Option<RawDeviceId> {
        os_raw_id().and_then(|s| RawDeviceId::new(&s))
    }
}

#[cfg(target_os = "linux")]
fn os_raw_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|p| {
            std::fs::read_to_string(p)
                .ok()
                .as_deref()
                .and_then(parse_machine_id)
        })
}

/// `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`를 `RegGetValueW`로 직접 읽는다(64비트 뷰).
/// 프로세스를 띄우지 않으므로 `SystemRoot`·`PATH` 등 사용자가 바꿀 수 있는 환경 변수에 의존하지 않는다
/// (보안 리뷰: `set SystemRoot=...`로 가짜 `reg.exe`를 실행시켜 다른 PC의 GUID를 흉내 내는 우회 차단).
#[cfg(target_os = "windows")]
fn os_raw_id() -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY,
    };
    let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography\0"
        .encode_utf16()
        .collect();
    let value: Vec<u16> = "MachineGuid\0".encode_utf16().collect();
    // GUID 36자 + NUL이면 충분하다. 더 길면 ERROR_MORE_DATA로 실패(읽지 못함 = 실패 닫힘).
    let mut buf = [0u16; 64];
    let mut cb = std::mem::size_of_val(&buf) as u32;
    // SAFETY: 이름 두 개는 NUL로 끝나는 UTF-16, `buf`는 `cb` 바이트 쓰기 가능, 형식 출력은 받지 않는다(null).
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut cb,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let units = (cb as usize / 2).min(buf.len());
    parse_registry_guid(&buf[..units])
}

/// 절대 경로 `/usr/sbin/ioreg`(SIP 보호 시스템 바이너리)를 빈 환경으로 실행한다. `PATH`·`DYLD_*` 등 환경 변수에 의존하지 않는다.
#[cfg(target_os = "macos")]
fn os_raw_id() -> Option<String> {
    let out = std::process::Command::new(IOREG_PATH)
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .env_clear()
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_ioreg_uuid(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn os_raw_id() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &str = "ARCH_TEST_ONLY-0123456789ABCDEF0123456789abcdef";

    #[test]
    fn hash_is_salted_normalized_and_stable() {
        let id = RawDeviceId::new(RAW).unwrap();
        let h = device_hash(DEVICE_HASH_SALT, &id);
        assert_eq!(h.len(), 64);
        assert!(h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert_eq!(
            h,
            device_hash(
                DEVICE_HASH_SALT,
                &RawDeviceId::new(&format!("  {}\n", RAW.to_lowercase())).unwrap()
            )
        );
        assert_ne!(h, device_hash(b"other-app\0", &id));
        let unsalted: String = Sha256::digest(RAW.to_lowercase().as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_ne!(h, unsalted);
        assert!(!h.contains("0123456789abcdef"));
    }

    #[test]
    fn rejects_unusable_ids() {
        for bad in ["", "   ", "a\u{0}b", "00000000-0000-0000-0000-000000000000"] {
            assert!(RawDeviceId::new(bad).is_none(), "{bad:?}");
        }
        assert!(RawDeviceId::new(&"a".repeat(MAX_ID_LEN + 1)).is_none());
        assert_eq!(current_device_hash(&StaticDeviceId(None)), None);
    }

    #[test]
    fn debug_never_prints_raw_id() {
        let id = RawDeviceId::new(RAW).unwrap();
        let printed = format!("{id:?}");
        assert!(
            !printed.to_lowercase().contains("0123456789abcdef"),
            "{printed}"
        );
    }

    #[test]
    fn os_output_parsers() {
        assert_eq!(
            parse_machine_id("0123456789abcdef0123456789abcdef\n").as_deref(),
            Some("0123456789abcdef0123456789abcdef")
        );
        assert_eq!(parse_machine_id("short"), None);
        let wide = |v: &str| v.encode_utf16().collect::<Vec<u16>>();
        // RegGetValueW는 REG_SZ 끝 NUL까지 채운다. NUL 뒤 남은 버퍼는 무시한다.
        let mut buf = wide("1b2c3d4e-0000-4111-8222-333344445555\0");
        assert_eq!(
            parse_registry_guid(&buf).as_deref(),
            Some("1b2c3d4e-0000-4111-8222-333344445555")
        );
        buf.extend(wide("garbage"));
        assert_eq!(
            parse_registry_guid(&buf).as_deref(),
            Some("1b2c3d4e-0000-4111-8222-333344445555")
        );
        // NUL 없이 꽉 찬 값(종단 누락)도 같은 형식 검사.
        assert_eq!(
            parse_registry_guid(&wide("1B2C3D4E-0000-4111-8222-333344445555")).as_deref(),
            Some("1B2C3D4E-0000-4111-8222-333344445555")
        );
        for bad in [
            "",
            "not-a-guid",
            "1b2c3d4e-0000-4111-8222-33334444555",
            "1b2c3d4e-0000-4111-8222-3333444455556",
            " 1b2c3d4e-0000-4111-8222-33334444555",
            "1b2c3d4e_0000-4111-8222-333344445555",
            "MachineGuid    REG_SZ    1b2c3d4e-0000-4111-8222-333344445555",
        ] {
            assert_eq!(parse_registry_guid(&wide(bad)), None, "{bad:?}");
        }
        // 짝 없는 서로게이트(잘못된 UTF-16) → 읽지 못함.
        let mut lone = wide("1b2c3d4e-0000-4111-8222-33334444555");
        lone.push(0xD800);
        assert_eq!(parse_registry_guid(&lone), None);
        assert_eq!(parse_registry_guid(&[0, 0x31, 0x32]), None);
        assert!(IOREG_PATH.starts_with('/'));
        let ioreg = "+-o J314sAP  <class IOPlatformExpertDevice>\n    {\n      \"IOPlatformSerialNumber\" = \"XYZ\"\n      \"IOPlatformUUID\" = \"A1B2C3D4-1111-2222-3333-444455556666\"\n    }\n";
        assert_eq!(
            parse_ioreg_uuid(ioreg).as_deref(),
            Some("A1B2C3D4-1111-2222-3333-444455556666")
        );
        assert_eq!(parse_ioreg_uuid("\"IOPlatformUUID\" = \"x\""), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn os_source_on_linux_yields_hash_or_none() {
        // CI 컨테이너에는 machine-id가 없을 수 있다. 있으면 해시 형식만 확인한다.
        if let Some(h) = current_device_hash(&OsDeviceId) {
            assert_eq!(h.len(), 64);
        }
    }
}
