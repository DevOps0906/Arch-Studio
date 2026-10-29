//! AR-06-042 P12: 운영 공개키 빌드 시 주입 파서(keys/parse.rs, build.rs와 같은 코드).
#[path = "../keys/parse.rs"]
mod key_parse;

use key_parse::{check_disjoint, parse_key_list, render_const};

const A: &str = "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";
const B: &str = "8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394";

#[test]
fn parses_kid_hex_list() {
    assert!(parse_key_list("").unwrap().is_empty());
    assert!(parse_key_list(" , ").unwrap().is_empty());
    let keys = parse_key_list(&format!("lic-2026a:{A}, lic-2026b:{}", B.to_uppercase())).unwrap();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0].0, "lic-2026a");
    assert_eq!(keys[0].1[0], 0x8a);
    assert_eq!(keys[1].1[31], 0x94);
}

#[test]
fn rejects_malformed_entries() {
    for bad in [
        A.to_string(),                       // kid 없음
        format!(":{A}"),                     // 빈 kid
        format!("k/1:{A}"),                  // kid 문자
        format!("{}:{A}", "k".repeat(65)),   // kid 길이
        format!("k:{}", &A[..62]),           // 짧은 키
        format!("k:{}zz", &A[..62]),         // hex 아님
        format!("k:{A},k:{B}"),              // 중복 kid
        "-----BEGIN PUBLIC KEY-----".into(), // PEM 아님
    ] {
        assert!(parse_key_list(&bad).is_err(), "{bad}");
    }
}

#[test]
fn rejects_same_key_in_both_rings() {
    let a = parse_key_list(&format!("lic:{A}")).unwrap();
    let b = parse_key_list(&format!("pack:{A}")).unwrap();
    assert!(check_disjoint(&a, &b).is_err());
    let c = parse_key_list(&format!("pack:{B}")).unwrap();
    assert!(check_disjoint(&a, &c).is_ok());
}

#[test]
fn renders_rust_const() {
    let keys = parse_key_list(&format!("lic:{A}")).unwrap();
    let src = render_const("LICENSE_KEYS", &keys);
    assert!(src.starts_with("pub const LICENSE_KEYS: &[(&str, [u8; 32])] = &[(\"lic\", [138, 136,"));
    assert_eq!(
        render_const("X", &[]),
        "pub const X: &[(&str, [u8; 32])] = &[];\n"
    );
}
