// 운영 공개키 빌드 시 주입(AR-06-042 P12). build.rs와 테스트(tests/key_inject.rs)가 `#[path]`로 함께 쓴다.
// 형식: `kid:hex64[,kid:hex64…]`(공백 허용, 빈 문자열 = 빈 고리). kid는 `[A-Za-z0-9._-]{1,64}`, 공개키는 Ed25519 32바이트 소문자·대문자 hex.
// 이 파일은 의존성 없이 표준 라이브러리만 쓴다(build 스크립트에서도 컴파일되도록).

/// 공개키 목록 문자열 → (kid, 32바이트). 형식 오류·중복 kid는 오류(빌드 실패).
pub fn parse_key_list(input: &str) -> Result<Vec<(String, [u8; 32])>, String> {
    let mut out: Vec<(String, [u8; 32])> = Vec::new();
    for (i, entry) in input.split(',').enumerate() {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let (kid, hex) = entry
            .split_once(':')
            .ok_or_else(|| format!("항목 {i}: `kid:hex64` 형식이 아니다"))?;
        let kid = kid.trim();
        let hex = hex.trim();
        let kid_ok = (1..=64).contains(&kid.len())
            && kid
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        if !kid_ok {
            return Err(format!("항목 {i}: kid 형식 오류"));
        }
        if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("항목 {i}: 공개키는 hex 64자여야 한다"));
        }
        let mut key = [0u8; 32];
        for (j, byte) in key.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[j * 2..j * 2 + 2], 16)
                .map_err(|_| format!("항목 {i}: hex 오류"))?;
        }
        if out.iter().any(|(k, _)| k == kid) {
            return Err(format!("항목 {i}: 중복 kid"));
        }
        out.push((kid.to_string(), key));
    }
    Ok(out)
}

/// 라이선스·규칙 팩 고리에 같은 공개키가 있으면 오류(용도 분리, 041 A1).
pub fn check_disjoint(a: &[(String, [u8; 32])], b: &[(String, [u8; 32])]) -> Result<(), String> {
    if a.iter().any(|(_, x)| b.iter().any(|(_, y)| x == y)) {
        return Err("라이선스·규칙 팩 공개키가 같다(용도별로 다른 키를 써야 한다)".to_string());
    }
    Ok(())
}

/// 생성 소스 한 줄: `pub const NAME: &[(&str, [u8; 32])] = &[("kid", [..]), ...];`
pub fn render_const(name: &str, keys: &[(String, [u8; 32])]) -> String {
    let mut s = format!("pub const {name}: &[(&str, [u8; 32])] = &[");
    for (kid, key) in keys {
        let bytes: Vec<String> = key.iter().map(|b| format!("{b}")).collect();
        s.push_str(&format!("({kid:?}, [{}]), ", bytes.join(", ")));
    }
    s.push_str("];\n");
    s
}
