//! 기기 해시(AR-06-041). `device_hash` = SHA-256(앱 솔트 ‖ 정규화한 OS 기기 식별자) 소문자 hex64.
//!
//! - 원문 기기 식별자([`RawDeviceId`])는 이 모듈 밖으로 나가지 않는다: `Display`·`Serialize` 없음, `Debug`는 가림,
//!   오류에도 담지 않는다. 화면·서버·로그에는 해시만 간다.
//! - 앱 솔트([`DEVICE_HASH_SALT`])로 다른 앱(같은 기기 ID를 쓰는 제품)과 해시가 연결되지 않게 한다.
//! - OS 접근은 [`DeviceIdSource`] trait 뒤에 둔다(테스트는 [`StaticDeviceId`]).
//!   Windows `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`, macOS `IOPlatformUUID`, Linux `/etc/machine-id`.

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

/// `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` 출력 → GUID.
pub fn parse_reg_machine_guid(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        if parts.next()? != "MachineGuid" || parts.next()? != "REG_SZ" {
            return None;
        }
        let v = parts.next()?;
        (parts.next().is_none() && is_guid(v)).then(|| v.to_string())
    })
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

#[cfg(target_os = "windows")]
fn os_raw_id() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let reg = std::path::Path::new(&root).join("System32").join("reg.exe");
    let out = std::process::Command::new(reg)
        .args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
            "/v",
            "MachineGuid",
            "/reg:64",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_reg_machine_guid(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(target_os = "macos")]
fn os_raw_id() -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
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
        let reg = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    1b2c3d4e-0000-4111-8222-333344445555\r\n\r\n";
        assert_eq!(
            parse_reg_machine_guid(reg).as_deref(),
            Some("1b2c3d4e-0000-4111-8222-333344445555")
        );
        assert_eq!(
            parse_reg_machine_guid("MachineGuid REG_SZ not-a-guid"),
            None
        );
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
