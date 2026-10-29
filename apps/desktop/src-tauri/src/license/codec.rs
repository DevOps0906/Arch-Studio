//! 엄격한 base64url·RFC 3339 해석(의존성 없음). 하나의 값에 하나의 표현만 받는다.

/// base64url(RFC 4648 §5, 패딩 없음) 디코드. 패딩·`+`·`/`·공백, 남는 비트가 0이 아닌 끝 문자는 거부한다.
pub fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let bytes = s.as_bytes();
    if bytes.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &c in bytes {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    // 남는 비트(2 또는 4)는 0이어야 정준 표현이다.
    if acc != 0 {
        return None;
    }
    Some(out)
}

/// base64url 인코드(패딩 없음). 테스트·진단용.
pub fn b64url_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = match chunk.len() {
            3 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8 | chunk[2] as u32,
            2 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8,
            _ => (chunk[0] as u32) << 16,
        };
        let emit = chunk.len() + 1;
        for i in 0..emit {
            out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

fn digits(s: &[u8]) -> Option<i64> {
    if s.is_empty() || !s.iter().all(u8::is_ascii_digit) {
        return None;
    }
    Some(s.iter().fold(0i64, |a, &d| a * 10 + (d - b'0') as i64))
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    }
}

/// 1970-01-01부터의 일수(그레고리력, Howard Hinnant days_from_civil).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `YYYY-MM-DD` → 1970-01-01부터의 일수.
pub fn parse_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, m, d) = (digits(&b[0..4])?, digits(&b[5..7])?, digits(&b[8..10])?);
    if !(1..=12).contains(&m) || d < 1 || d > days_in_month(y, m) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// RFC 3339 시각 → 유닉스 초. `YYYY-MM-DDTHH:MM:SS[.f+](Z|±HH:MM)`만 받는다(대문자 `T`·`Z`).
/// 소수 초는 버린다(만료 시각이면 더 이르게 = 보수적).
pub fn parse_instant(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b.len() > 40 || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let days = parse_date(std::str::from_utf8(&b[0..10]).ok()?)?;
    let (h, mi, sec) = (
        digits(&b[11..13])?,
        digits(&b[14..16])?,
        digits(&b[17..19])?,
    );
    if h > 23 || mi > 59 || sec > 59 {
        return None;
    }
    let mut rest = &b[19..];
    if rest.first() == Some(&b'.') {
        let n = rest[1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if n == 0 || n > 9 {
            return None;
        }
        rest = &rest[1 + n..];
    }
    let offset = match rest {
        b"Z" => 0,
        [sign @ (b'+' | b'-'), oh1, oh2, b':', om1, om2] => {
            let oh = digits(&[*oh1, *oh2])?;
            let om = digits(&[*om1, *om2])?;
            if oh > 23 || om > 59 {
                return None;
            }
            let v = oh * 3600 + om * 60;
            if *sign == b'+' {
                v
            } else {
                -v
            }
        }
        _ => return None,
    };
    Some(days * 86_400 + h * 3600 + mi * 60 + sec - offset)
}

/// 유닉스 초 → `YYYY-MM-DDTHH:MM:SSZ`(테스트·표시용).
pub fn format_instant(t: i64) -> String {
    let days = t.div_euclid(86_400);
    let secs = t.rem_euclid(86_400);
    // civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64url_roundtrip_and_rejects_noncanonical() {
        for len in 0..40usize {
            let data: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            let enc = b64url_encode(&data);
            assert_eq!(b64url_decode(&enc).as_deref(), Some(&data[..]), "{len}");
        }
        assert_eq!(b64url_decode("Zg").unwrap(), b"f");
        assert_eq!(b64url_decode("Zh"), None); // 남는 비트 ≠ 0
        assert_eq!(b64url_decode("Zg=="), None);
        assert_eq!(b64url_decode("Z"), None);
        assert_eq!(b64url_decode("a+b/"), None);
        assert_eq!(b64url_decode("ab cd"), None);
        assert_eq!(b64url_decode("").unwrap(), b"");
    }

    #[test]
    fn instants() {
        assert_eq!(parse_instant("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_instant("2026-10-29T03:04:05Z"), Some(1_793_243_045));
        assert_eq!(
            parse_instant("2026-10-29T12:04:05+09:00"),
            parse_instant("2026-10-29T03:04:05Z")
        );
        assert_eq!(
            parse_instant("2026-10-29T03:04:05.999Z"),
            Some(1_793_243_045)
        );
        assert_eq!(parse_instant("2024-02-29T00:00:00Z"), Some(1_709_164_800));
        for bad in [
            "2026-10-29",
            "2026-10-29 03:04:05Z",
            "2026-10-29t03:04:05z",
            "2026-13-01T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2026-10-29T24:00:00Z",
            "2026-10-29T03:04:60Z",
            "2026-10-29T03:04:05",
            "2026-10-29T03:04:05.Z",
            "2026-10-29T03:04:05+0900",
            "+2026-10-29T03:04:05Z",
        ] {
            assert_eq!(parse_instant(bad), None, "{bad}");
        }
        assert_eq!(format_instant(1_793_243_045), "2026-10-29T03:04:05Z");
    }

    #[test]
    fn instant_roundtrip_seeded() {
        let mut x: u64 = 0x5eed_0041;
        for _ in 0..2000 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let t = (x % 8_000_000_000) as i64 - 1_000_000_000;
            assert_eq!(parse_instant(&format_instant(t)), Some(t), "{t}");
        }
    }

    #[test]
    fn dates() {
        assert_eq!(parse_date("1970-01-02"), Some(1));
        assert_eq!(parse_date("2027-10-28"), Some(21_119));
        assert_eq!(parse_date("2027-1-28"), None);
        assert_eq!(parse_date("2027-02-30"), None);
    }
}
