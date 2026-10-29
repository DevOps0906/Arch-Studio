//! 022 PNG 골든 일치(AR-06-080): `packages/drafting/golden/png-*/input.svg`를 Rust resvg로 렌더해
//! resvg-js 2.6.2가 만든 `expected.png`와 비교한다. 골든은 읽기 전용(테스트 전용 저장소 상대 경로).
//! - x86_64: PNG 바이트 동일(Linux에서 확인, 선행 검증 `tasks/logs/AR-06-080.md`).
//! - 그 밖 아키텍처: 디코드 화소 허용 오차(채널 차 3 초과 화소 0.1% 미만, 022 기준 그대로).
use std::path::PathBuf;

use arch_studio_desktop_lib::commands::raster::{rasterize, RasterOptions};
use arch_studio_desktop_lib::commands::sha256_hex;
use resvg::tiny_skia::Pixmap;

const CASES: &[&str] = &[
    "png-site-a3-basic",
    "png-korean-long-names",
    "png-hatch-ansi31",
];

fn golden_dir(case: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/drafting/golden")
        .join(case)
}

/// (채널 차 3 초과 화소 수, 전체 화소 수).
fn pixel_diff(a: &Pixmap, b: &Pixmap) -> (usize, usize) {
    assert_eq!((a.width(), a.height()), (b.width(), b.height()), "크기");
    let over = a
        .data()
        .chunks_exact(4)
        .zip(b.data().chunks_exact(4))
        .filter(|(x, y)| x.iter().zip(y.iter()).any(|(p, q)| p.abs_diff(*q) > 3))
        .count();
    (over, a.data().len() / 4)
}

#[test]
fn golden_png_cases_match_resvg_js() {
    for case in CASES {
        let dir = golden_dir(case);
        let svg = std::fs::read_to_string(dir.join("input.svg")).expect("input.svg");
        let expected = std::fs::read(dir.join("expected.png")).expect("expected.png");
        let meta: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("meta.json")).unwrap()).unwrap();
        assert_eq!(meta["renderer"]["resvg"], "0.34.0", "{case}: 렌더러 버전");
        assert_eq!(
            meta["png_sha256"],
            sha256_hex(&expected),
            "{case}: 골든 파일"
        );
        let width = meta["width_px"].as_u64().unwrap() as u32;

        let png = rasterize(
            &svg,
            RasterOptions {
                width_px: Some(width),
                dpi: None,
            },
        )
        .unwrap_or_else(|e| panic!("{case}: {e}"));
        // 결정성: 같은 입력 2회 바이트 동일.
        let again = rasterize(
            &svg,
            RasterOptions {
                width_px: Some(width),
                dpi: None,
            },
        )
        .unwrap();
        assert_eq!(png, again, "{case}: 결정성");

        let got = Pixmap::decode_png(&png).unwrap();
        let exp = Pixmap::decode_png(&expected).unwrap();
        assert_eq!(
            (got.width(), got.height()),
            (width, meta["height_px"].as_u64().unwrap() as u32),
            "{case}: 크기"
        );
        let (over, total) = pixel_diff(&got, &exp);
        assert!(
            over * 1000 < total,
            "{case}: 채널 차 3 초과 화소 {over}/{total} (0.1% 이상)"
        );
        if cfg!(target_arch = "x86_64") {
            assert_eq!(
                sha256_hex(&png),
                meta["png_sha256"].as_str().unwrap(),
                "{case}: x86_64에서는 resvg-js 골든과 PNG 바이트가 같아야 한다"
            );
        }
    }
}

/// 허용 오차 판정 자체가 차이를 잡는지(다른 폭으로 렌더하면 크기·화소가 달라 실패해야 한다).
#[test]
fn pixel_tolerance_detects_real_differences() {
    let dir = golden_dir("png-hatch-ansi31");
    let svg = std::fs::read_to_string(dir.join("input.svg")).unwrap();
    let exp = Pixmap::decode_png(&std::fs::read(dir.join("expected.png")).unwrap()).unwrap();
    // 흰 화면과 비교하면 허용 오차를 넘는다.
    let mut blank = Pixmap::new(exp.width(), exp.height()).unwrap();
    blank.fill(resvg::tiny_skia::Color::WHITE);
    let (over, total) = pixel_diff(&blank, &exp);
    assert!(
        over * 1000 >= total,
        "흰 화면이 통과하면 안 된다: {over}/{total}"
    );
    // 글자를 다른 글꼴 이름으로 지정해도(시스템 글꼴 대체 없음) 같은 그림.
    let renamed = svg.replace("Noto Sans KR", "Malgun Gothic");
    assert_ne!(renamed, svg);
    let a = rasterize(
        &svg,
        RasterOptions {
            width_px: Some(exp.width()),
            dpi: None,
        },
    )
    .unwrap();
    let b = rasterize(
        &renamed,
        RasterOptions {
            width_px: Some(exp.width()),
            dpi: None,
        },
    )
    .unwrap();
    assert_eq!(a, b);
}
