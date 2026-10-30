//! 설치형 PNG 래스터화(AR-06-080). 화면은 SVG 문자열과 크기 옵션만 보낸다(파일 경로·URL 입력 0).
//! 렌더러는 resvg 0.34.0(022 웹 경로 `@resvg/resvg-js@2.6.2` 내장 버전과 같은 버전)이고 렌더 옵션도 022와 같다
//! (`packages/drafting/src/writers/png/README.md`). 같은 SVG → 웹과 같은 PNG 바이트(골든 `golden/png-*`, `tests/raster.rs`).
//!
//! 방어(`tasks/logs/AR-06-080.md` 0단계):
//! - 입력 8 MiB·XML 노드 50만·출력 1억 화소·PNG 100 MiB 상한(넘으면 AR055), DTD 거부(엔티티 폭탄).
//! - 허용 요소만(이미지·use·style·filter·mask·pattern 없음), 레이어를 만드는 속성·href·url() 거부, 파싱 후 트리 재검사.
//! - 이미지 href 해석기는 둘 다 None(디스크·네트워크를 읽지 않는다). 글꼴은 바이너리에 포함한 번들 Noto Sans KR 하나뿐이고,
//!   fontdb를 `fs` 기능 없이 써서 시스템 글꼴을 읽는 함수 자체가 없다.
//! - 요소 깊이 32(재귀 렌더의 스택 넘침 방지)·비용 예산(<text>당 글자·전체 글자·tspan 수·대시 조각 수) 사전 검사(AR055).
//! - 작업 스레드(스택 64 MiB) + 제한 시간(AR056 `timeout`), 동시 1건(BUSY). 오류 detail은 고정 토큰만(SVG 원문·이름·위치 없음).
//!
//! 한계: resvg는 취소가 없어 **제한 시간이 지나도 작업 스레드는 끝까지 계산한다**(명령 응답만 먼저 돌아가고 슬롯은 계속 점유).
//! 그래서 비용이 초선형으로 커지는 입력은 위 예산으로 렌더 전에 거부한다. 근본 대책(별도 sidecar 프로세스에서 렌더하고
//! 시간 초과 시 프로세스를 끝내기)은 후속 작업이다(`tasks/logs/AR-06-080.md` 보안 리뷰 반영 절).

use std::collections::HashMap;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::Duration;

use resvg::tiny_skia::{Color, Pixmap, Transform};
use resvg::usvg::{
    self, fontdb, tiny_skia_path, ImageHrefResolver, NodeKind, TreeParsing, TreeTextToPath,
};
use serde::Deserialize;
use tauri::ipc::Response;

use super::{code, AppError};

/// 입력 SVG UTF-8 바이트 상한(8 MiB). 가장 큰 골든 SVG 12.9KB의 600배 여유.
pub const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
/// XML 노드 상한(roxmltree `nodes_limit`). 요소·텍스트·주석 합.
pub const MAX_XML_NODES: u32 = 500_000;
/// 출력 화소 상한(022 `writePng`와 같다). RGBA 400MB.
pub const MAX_PIXELS: u64 = 100_000_000;
/// 결과 PNG 상한(= `export_save_file` PNG 상한, 넘으면 어차피 저장할 수 없다).
pub const MAX_PNG_BYTES: usize = 100 * 1024 * 1024;
/// dpi 범위(022 `writePng`와 같다).
pub const MIN_DPI: f32 = 10.0;
pub const MAX_DPI: f32 = 1200.0;
/// 제한 시간. 상한 근처(1억 화소) 릴리스 빌드 실측 4.3초의 약 7배.
/// 시간이 지나면 명령은 AR056을 돌려주지만 작업 스레드는 멈추지 않는다(모듈 머리 '한계' 참고).
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(30);

/// 요소 중첩 깊이 상한(루트 `<svg>` = 1). usvg·resvg는 트리를 재귀로 돌아 깊은 중첩이면 스택이 넘쳐 앱 프로세스가 끝난다
/// (보안 리뷰: `<g>` 600겹·`<tspan>` 1000겹, 기본 2 MiB 스택). 도면(writeSvg)은 svg > g > text 3단이라 32는 10배 여유.
pub const MAX_ELEMENT_DEPTH: usize = 32;
/// 작업 스레드 스택(깊이 상한과 2중 방어). 32단은 기본 스택으로도 충분하다.
pub const RENDER_STACK_BYTES: usize = 64 << 20;
/// `<text>` 하나의 글자 수 상한. 글자 배치 비용이 글자 수에 초선형(릴리스 실측: 4000자 41ms, 8000자 0.11s, 16000자 0.33s).
pub const MAX_TEXT_CHARS: usize = 4_000;
/// 문서 전체 `<text>` 글자 수 상한(선형: 4000자 × 50개 = 20만 자 1.7s). 도면 글자는 수천 자 수준.
pub const MAX_TOTAL_TEXT_CHARS: usize = 200_000;
/// 문서 전체 `<tspan>` 수 상한. 비용이 제곱으로 커진다(릴리스 실측: 2000개 0.77s, 4000개 2.7s, 8000개 11s). 도면은 0개.
pub const MAX_TSPANS: usize = 2_000;
/// 대시 조각 수 예산(경로마다 `경로 길이 × (배열 길이/2) / 주기`의 문서 합, 길이는 제어점 다각형 길이 = 상한).
/// 릴리스 실측: 조각 90만 개 경로 1개 0.11s, 10개(900만) 0.99s → 500만은 약 0.5s. 골든 도면은 경로당 수백 개.
/// tiny-skia는 경로마다 100만에서 대시를 포기하지만 경로 수를 늘리면 합은 끝이 없어 문서 합으로 막는다.
pub const MAX_DASH_SEGMENTS: f64 = 5_000_000.0;

/// 번들 글꼴 family 이름(022 `BUNDLED_FONT_NAME`). SVG의 어떤 family·generic family도 이 글꼴로 그린다.
pub const FONT_FAMILY: &str = "Noto Sans KR";
/// 번들 글꼴(`packages/drafting/fonts`, OFL 1.1). 컴파일 시 포함 — 실행 중 파일 경로를 열지 않는다.
/// 정본이 src-tauri 밖이라 상대 경로로 참조한다(복사본을 두면 두 파일이 어긋날 수 있다). sha256은 테스트가 확인한다.
pub static BUNDLED_FONT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/drafting/fonts/NotoSansKR-Regular.subset.ttf"
));

const SVG_NS: &str = "http://www.w3.org/2000/svg";

/// 도면 SVG(`writeSvg`)가 쓰는 요소만. 이 밖(image·use·style·filter·mask·clipPath·pattern·foreignObject·
/// symbol·marker·switch·a·script·그라디언트·중첩 svg)은 거부한다.
const ALLOWED_ELEMENTS: &[&str] = &[
    "svg", "g", "defs", "title", "desc", "line", "polyline", "polygon", "path", "rect", "circle",
    "ellipse", "text", "tspan",
];

/// 외부 참조(href)·CSS(style)·레이어(전체 크기 Pixmap)를 만드는 속성. 이름공간과 무관하게 지역 이름으로 거부.
const DENIED_ATTRIBUTES: &[&str] = &[
    "href",
    "style",
    "opacity",
    "filter",
    "mask",
    "clip-path",
    "mix-blend-mode",
    "isolation",
];

/// 크기 옵션: `widthPx`(정본, 골든과 같은 값) 또는 `dpi`(SVG 물리 크기 기준) 중 정확히 하나. 배경은 흰색 고정.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterOptions {
    #[serde(default)]
    pub width_px: Option<u32>,
    #[serde(default)]
    pub dpi: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Target {
    Width(u32),
    Dpi(f32),
}

fn err(code: &'static str, detail: &'static str) -> AppError {
    AppError::new(code, detail)
}

fn target_of(opts: RasterOptions) -> Result<Target, AppError> {
    match (opts.width_px, opts.dpi) {
        (Some(w), None) if w >= 1 => Ok(Target::Width(w)),
        (None, Some(d)) if d.is_finite() && (MIN_DPI..=MAX_DPI).contains(&d) => Ok(Target::Dpi(d)),
        _ => Err(err(code::INVALID_INPUT, "options")),
    }
}

fn check_svg_len(len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(err(code::INVALID_INPUT, "empty"));
    }
    if len > MAX_SVG_BYTES {
        return Err(err(code::TOO_LARGE, "svg_bytes"));
    }
    Ok(())
}

/// 번들 글꼴 하나만 든 글꼴 DB(한 번 만들어 재사용). 기본·generic family 전부 번들 글꼴.
pub fn font_db() -> &'static fontdb::Database {
    static DB: OnceLock<fontdb::Database> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_font_source(fontdb::Source::Binary(Arc::new(BUNDLED_FONT)));
        db.set_serif_family(FONT_FAMILY);
        db.set_sans_serif_family(FONT_FAMILY);
        db.set_cursive_family(FONT_FAMILY);
        db.set_fantasy_family(FONT_FAMILY);
        db.set_monospace_family(FONT_FAMILY);
        db
    })
}

/// usvg 옵션(022 `PNG_RENDER_OPTIONS`와 같다). 이미지 href는 문자열(파일 경로)·data URL 모두 해석하지 않는다.
pub fn usvg_options() -> usvg::Options {
    usvg::Options {
        resources_dir: None,
        font_family: FONT_FAMILY.to_owned(),
        shape_rendering: usvg::ShapeRendering::GeometricPrecision,
        text_rendering: usvg::TextRendering::GeometricPrecision,
        image_rendering: usvg::ImageRendering::OptimizeQuality,
        image_href_resolver: ImageHrefResolver {
            resolve_data: Box::new(|_, _, _| None),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    }
}

/// 가장 가까운 `<text>` 조상(자기 자신 제외). 조상은 이미 깊이 검사를 통과했으므로 32개 이하.
fn text_ancestor<'a, 'i>(node: roxmltree::Node<'a, 'i>) -> Option<roxmltree::Node<'a, 'i>> {
    node.ancestors()
        .skip(1)
        .find(|n| n.is_element() && n.tag_name().name() == "text")
}

/// XML 단계 검사: SVG 루트, 허용 요소, 처리 명령 없음, 거부 속성·`url(` 값 없음,
/// 요소 깊이·글자 수·tspan 수 예산(AR055). 문서 순서(전위)로 돌므로 조상은 먼저 깊이 검사를 통과했다.
fn check_document(doc: &roxmltree::Document) -> Result<(), AppError> {
    let root = doc.root_element();
    if root.tag_name().name() != "svg" || root.tag_name().namespace() != Some(SVG_NS) {
        return Err(err(code::INVALID_INPUT, "root"));
    }
    let mut tspans = 0usize;
    let mut total_chars = 0usize;
    let mut text_chars: HashMap<roxmltree::NodeId, usize> = HashMap::new();
    for node in doc.root().descendants() {
        if node.is_pi() {
            return Err(err(code::INVALID_INPUT, "pi"));
        }
        if node.is_text() {
            // `<text>` 밖 글자(title·desc·요소 사이 공백)는 그리지 않는다.
            if let Some(t) = text_ancestor(node) {
                let n = node.text().map_or(0, |s| s.chars().count());
                let per = text_chars.entry(t.id()).or_insert(0);
                *per += n;
                total_chars += n;
                if *per > MAX_TEXT_CHARS || total_chars > MAX_TOTAL_TEXT_CHARS {
                    return Err(err(code::TOO_LARGE, "text_chars"));
                }
            }
            continue;
        }
        if !node.is_element() {
            continue;
        }
        // 자신 포함 요소 조상 수. 상한+1에서 멈춰 노드당 최대 33단계.
        let depth = node
            .ancestors()
            .filter(|n| n.is_element())
            .take(MAX_ELEMENT_DEPTH + 1)
            .count();
        if depth > MAX_ELEMENT_DEPTH {
            return Err(err(code::TOO_LARGE, "depth"));
        }
        let tag = node.tag_name();
        let allowed = tag.namespace() == Some(SVG_NS)
            && ALLOWED_ELEMENTS.contains(&tag.name())
            && (tag.name() != "svg" || node == root);
        if !allowed {
            return Err(err(code::INVALID_INPUT, "element"));
        }
        for attr in node.attributes() {
            if DENIED_ATTRIBUTES.contains(&attr.name())
                || attr.value().to_ascii_lowercase().contains("url(")
            {
                return Err(err(code::INVALID_INPUT, "attribute"));
            }
        }
        if tag.name() == "tspan" {
            tspans += 1;
            if tspans > MAX_TSPANS {
                return Err(err(code::TOO_LARGE, "tspans"));
            }
        }
    }
    Ok(())
}

/// 경로 길이 상한: 직선은 정확히, 곡선은 제어점 다각형 길이(곡선 길이 이상). f64 합이 넘치면 무한대 → 예산에서 거부.
fn path_length_bound(path: &tiny_skia_path::Path) -> f64 {
    use tiny_skia_path::{PathSegment, Point};
    let d = |a: Point, b: Point| {
        (f64::from(b.x) - f64::from(a.x)).hypot(f64::from(b.y) - f64::from(a.y))
    };
    let origin = Point::zero();
    let (mut cur, mut start, mut len) = (origin, origin, 0.0f64);
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(p) => {
                cur = p;
                start = p;
            }
            PathSegment::LineTo(p) => {
                len += d(cur, p);
                cur = p;
            }
            PathSegment::QuadTo(c, p) => {
                len += d(cur, c) + d(c, p);
                cur = p;
            }
            PathSegment::CubicTo(c1, c2, p) => {
                len += d(cur, c1) + d(c1, c2) + d(c2, p);
                cur = p;
            }
            PathSegment::Close => {
                len += d(cur, start);
                cur = start;
            }
        }
    }
    len
}

/// 경로 하나의 대시 조각 수(tiny-skia `dash_impl`과 같은 식: 길이 × (배열 길이/2) / 주기). 주기가 0 이하·비유한이거나
/// 음수 항이 있으면 tiny-skia가 대시를 만들지 않으므로 0. 대시 배열과 경로 좌표는 같은 지역 좌표계라 변환(확대)과 무관하다.
fn dash_segments(path: &usvg::Path) -> f64 {
    let Some(arr) = path.stroke.as_ref().and_then(|s| s.dasharray.as_ref()) else {
        return 0.0;
    };
    let period: f64 = arr.iter().map(|&v| f64::from(v)).sum();
    if !period.is_finite() || period <= 0.0 || arr.iter().any(|&v| v < 0.0) {
        return 0.0;
    }
    path_length_bound(&path.data) * (arr.len() / 2) as f64 / period
}

/// 트리 단계 재검사: 레이어(전체 크기 Pixmap)를 만드는 그룹·이미지 노드가 없어야 하고, 대시 조각 수 합이 예산 안이어야 한다.
/// 글자를 경로로 바꾼 뒤(`convert_text`) 부르므로 글자 외곽선의 대시도 센다.
fn check_tree(tree: &usvg::Tree) -> Result<(), AppError> {
    let mut dashes = 0.0f64;
    for node in tree.root.descendants() {
        match &*node.borrow() {
            NodeKind::Group(g) if g.should_isolate() => {
                return Err(err(code::INVALID_INPUT, "isolation"))
            }
            NodeKind::Image(_) => return Err(err(code::INVALID_INPUT, "image")),
            NodeKind::Path(p) => {
                dashes += dash_segments(p);
                // NaN도 거부(NaN은 비교 불가 → 통과로 새지 않게).
                if dashes.is_nan() || dashes > MAX_DASH_SEGMENTS {
                    return Err(err(code::TOO_LARGE, "dash"));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// 출력 크기와 변환. 022(resvg-js fitTo width)와 같게: 세로 = round(폭 × h / w)(f32), 축별 배율.
fn target_size(size: usvg::Size, target: Target) -> Result<(u32, u32, Transform), AppError> {
    let (sw, sh) = (size.width(), size.height());
    let width = match target {
        Target::Width(w) => w as f32,
        // usvg 크기는 96dpi 기준 px.
        Target::Dpi(d) => (sw / 96.0 * d).round(),
    };
    let height = (width * sh / sw).round();
    if !width.is_finite() || !height.is_finite() || width < 1.0 || height < 1.0 {
        return Err(err(code::INVALID_INPUT, "size"));
    }
    if width > MAX_PIXELS as f32 || height > MAX_PIXELS as f32 {
        return Err(err(code::TOO_LARGE, "pixels"));
    }
    let (w, h) = (width as u32, height as u32);
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(err(code::TOO_LARGE, "pixels"));
    }
    Ok((w, h, Transform::from_scale(w as f32 / sw, h as f32 / sh)))
}

/// 상한이 있는 출력 버퍼. 상한을 넘기는 쓰기는 즉시 오류(압축을 끝까지 하지 않고 멈춘다).
struct CappedVec {
    buf: Vec<u8>,
    cap: usize,
    over: bool,
}

impl CappedVec {
    fn new(cap: usize) -> Self {
        Self {
            buf: Vec::new(),
            cap,
            over: false,
        }
    }
}

impl Write for CappedVec {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if self.buf.len().saturating_add(data.len()) > self.cap {
            self.over = true;
            return Err(io::Error::other("png_bytes"));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// PNG 틀(서명 8 + IHDR 25 + IDAT 길이·이름·CRC 12 + IEND 12) 바이트.
const PNG_FRAMING_BYTES: usize = 8 + 25 + 12 + 12;

/// RGBA 8비트 PNG(IHDR·IDAT·IEND, 022 resvg-js `asPng`와 같은 png 0.17.5 기본 설정과 바이트 동일).
/// png 0.17.5 `write_image_data`는 이미지 전체를 메모리에서 압축한 뒤에야 출력에 쓰므로 결과 상한을 끝에서만 볼 수 있다.
/// 그래서 IDAT 압축만 같은 방식(행마다 필터 바이트 1 + Sub 필터, `deflate` 1.0.0 `fast()` zlib — png 0.17.5의 기본 `Compression::Fast`와 같다)으로 직접 하며
/// 상한 버퍼에 흘려 넘는 순간 멈춘다(AR055 `png_bytes`). 틀(서명·IHDR·IEND)은 png 크레이트가 쓴다.
/// 바이트 동일성은 골든 3건 비교(`tests/raster.rs`)가 지킨다.
/// 흰 배경을 먼저 채워 모든 화소 알파가 255 → 사전 곱셈 값 = 원래 값이라 그대로 인코딩한다.
fn encode_png(pixmap: &Pixmap) -> Result<Vec<u8>, AppError> {
    encode_png_capped(pixmap, MAX_PNG_BYTES)
}

fn encode_png_capped(pixmap: &Pixmap, max_bytes: usize) -> Result<Vec<u8>, AppError> {
    if pixmap
        .data()
        .as_chunks::<4>()
        .0
        .iter()
        .any(|p| p[3] != u8::MAX)
    {
        return Err(err(code::PNG_FAILED, "alpha"));
    }
    let fail = |over: bool| {
        if over {
            err(code::TOO_LARGE, "png_bytes")
        } else {
            err(code::PNG_FAILED, "encode")
        }
    };
    let mut idat = CappedVec::new(max_bytes.saturating_sub(PNG_FRAMING_BYTES));
    let row = pixmap.width() as usize * 4;
    let compressed = (|| -> io::Result<()> {
        let mut z =
            deflate::write::ZlibEncoder::new(&mut idat, deflate::CompressionOptions::fast());
        let mut cur = vec![0u8; row];
        for line in pixmap.data().chunks_exact(row) {
            // png 0.17.5 Sub 필터(bpp 4): 첫 화소는 그대로, 나머지는 line[i] - line[i-4].
            cur[..4].copy_from_slice(&line[..4]);
            for i in 4..row {
                cur[i] = line[i].wrapping_sub(line[i - 4]);
            }
            z.write_all(&[1])?;
            z.write_all(&cur)?;
        }
        z.finish()?;
        Ok(())
    })();
    if compressed.is_err() {
        return Err(fail(idat.over));
    }
    let mut out = CappedVec::new(max_bytes);
    let framed = (|| -> Result<(), png::EncodingError> {
        let mut encoder = png::Encoder::new(&mut out, pixmap.width(), pixmap.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_chunk(png::chunk::IDAT, &idat.buf)?;
        writer.finish()
    })();
    if framed.is_err() {
        return Err(fail(out.over));
    }
    check_png_len(out.buf.len())?;
    Ok(out.buf)
}

fn check_png_len(len: usize) -> Result<(), AppError> {
    if len > MAX_PNG_BYTES {
        return Err(err(code::TOO_LARGE, "png_bytes"));
    }
    Ok(())
}

/// 순수 래스터화(같은 스레드, 시간 제한 없음). 명령은 `rasterize_guarded`를 거친다.
pub fn rasterize(svg: &str, options: RasterOptions) -> Result<Vec<u8>, AppError> {
    let target = target_of(options)?;
    check_svg_len(svg.len())?;
    let xml = roxmltree::ParsingOptions {
        allow_dtd: false,
        nodes_limit: MAX_XML_NODES,
    };
    let doc = roxmltree::Document::parse_with_options(svg, xml).map_err(|e| match e {
        roxmltree::Error::NodesLimitReached => err(code::TOO_LARGE, "nodes"),
        roxmltree::Error::DtdDetected => err(code::INVALID_INPUT, "dtd"),
        _ => err(code::INVALID_INPUT, "parse"),
    })?;
    check_document(&doc)?;
    let mut tree = usvg::Tree::from_xmltree(&doc, &usvg_options()).map_err(|e| match e {
        usvg::Error::ElementsLimitReached => err(code::TOO_LARGE, "nodes"),
        usvg::Error::InvalidSize => err(code::INVALID_INPUT, "size"),
        _ => err(code::INVALID_INPUT, "parse"),
    })?;
    drop(doc);
    tree.convert_text(font_db());
    check_tree(&tree)?;
    let (w, h, transform) = target_size(tree.size, target)?;
    let mut pixmap = Pixmap::new(w, h).ok_or_else(|| err(code::PNG_FAILED, "alloc"))?;
    pixmap.fill(Color::WHITE);
    resvg::Tree::from_usvg(&tree).render(transform, &mut pixmap.as_mut());
    drop(tree);
    encode_png(&pixmap)
}

/// 동시 1건 관문. 슬롯은 작업 스레드가 실제로 끝날 때 풀린다(제한 시간으로 명령이 먼저 돌아가도).
pub struct RenderGate(AtomicBool);

impl RenderGate {
    pub const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    pub fn busy(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

impl Default for RenderGate {
    fn default() -> Self {
        Self::new()
    }
}

struct Slot(&'static RenderGate);

impl Drop for Slot {
    fn drop(&mut self) {
        (self.0).0.store(false, Ordering::Release);
    }
}

/// 앱 전체 관문.
pub static GATE: RenderGate = RenderGate::new();

/// 값싼 검사 → 관문 → 작업 스레드에서 `rasterize` → 제한 시간. 초과는 AR056 `timeout`, 진행 중이면 BUSY.
/// 작업 스레드의 패닉은 AR056 `panic`(앱은 계속 돈다). 작업 스레드 스택은 `RENDER_STACK_BYTES`.
/// 시간 초과는 응답만 끊는다: 작업 스레드는 끝까지 돌고 그동안 슬롯은 BUSY(비용 예산으로 그 시간을 묶는다).
pub fn rasterize_guarded(
    gate: &'static RenderGate,
    svg: String,
    options: RasterOptions,
    timeout: Duration,
) -> Result<Vec<u8>, AppError> {
    target_of(options)?;
    check_svg_len(svg.len())?;
    if gate
        .0
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(err(code::BUSY, "busy"));
    }
    let slot = Slot(gate);
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("arch-raster".into())
        .stack_size(RENDER_STACK_BYTES)
        .spawn(move || {
            let _slot = slot;
            let _ = tx.send(rasterize(&svg, options));
        })
        .map_err(|_| err(code::PNG_FAILED, "thread"))?;
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(err(code::PNG_FAILED, "timeout")),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(err(code::PNG_FAILED, "panic")),
    }
}

/// SVG 문자열 → PNG 원시 바이트(웹뷰에서는 ArrayBuffer). 디스크에 쓰지 않는다(저장은 `export_save_file`).
#[tauri::command]
pub async fn rasterize_svg(svg: String, options: RasterOptions) -> Result<Response, AppError> {
    let png = tauri::async_runtime::spawn_blocking(move || {
        rasterize_guarded(&GATE, svg, options, RENDER_TIMEOUT)
    })
    .await
    .map_err(|_| err(code::PNG_FAILED, "join"))??;
    Ok(Response::new(png))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sha256_hex;

    const LEAK: &str = "SECRET-SVG-CONTENT";

    fn svg(body: &str) -> String {
        format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 1000 500"><rect x="0" y="0" width="1000" height="500" fill="#ffffff"/>{body}</svg>"##
        )
    }

    fn w(px: u32) -> RasterOptions {
        RasterOptions {
            width_px: Some(px),
            dpi: None,
        }
    }

    /// 오류 detail은 고정 토큰(영문 소문자·밑줄)만이고 입력 조각이 없다.
    fn assert_clean(e: &AppError) {
        assert!(
            e.detail.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
            "detail: {}",
            e.detail
        );
        let s = format!("{e:?} {e} {}", serde_json::to_string(e).unwrap());
        for bad in [LEAK, "<", "/", "\\", "file", "http"] {
            assert!(!s.contains(bad), "누출 {bad}: {s}");
        }
    }

    fn rejects(svg: &str, opts: RasterOptions, code: &str) -> AppError {
        let e = rasterize(svg, opts).expect_err("거부 기대");
        assert_eq!(e.code, code, "{e:?}");
        assert_clean(&e);
        e
    }

    fn decode(png: &[u8]) -> Pixmap {
        Pixmap::decode_png(png).expect("PNG")
    }

    fn ink(p: &Pixmap) -> usize {
        p.data()
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|c| c[0] < 200 || c[1] < 200 || c[2] < 200)
            .count()
    }

    #[test]
    fn bundled_font_is_the_drafting_subset() {
        // packages/drafting/fonts/README.md 값.
        assert_eq!(BUNDLED_FONT.len(), 2_717_880);
        assert_eq!(
            sha256_hex(BUNDLED_FONT),
            "a959c81476af1cbdce3f31431c0516bc5a3e29fb85c0b15b7e34e80a8d87b2c7"
        );
        let db = font_db();
        assert_eq!(db.len(), 1, "번들 글꼴 하나만");
        let face = db.faces().next().unwrap();
        assert!(face.families.iter().any(|(f, _)| f == FONT_FAMILY));
        assert!(matches!(face.source, fontdb::Source::Binary(_)));
    }

    #[test]
    fn renders_png_with_white_background_and_requested_width() {
        let png = rasterize(
            &svg(r##"<line x1="0" y1="0" x2="1000" y2="500" stroke="#000" stroke-width="20"/>"##),
            w(200),
        )
        .unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let p = decode(&png);
        assert_eq!((p.width(), p.height()), (200, 100));
        assert!(p.data().as_chunks::<4>().0.iter().all(|c| c[3] == 255));
        assert_eq!(
            &p.data()[4 * 199..4 * 200],
            &[255, 255, 255, 255],
            "흰 배경"
        );
        assert!(ink(&p) > 100);
        // 같은 입력 2회 → 같은 바이트.
        let again = rasterize(
            &svg(r##"<line x1="0" y1="0" x2="1000" y2="500" stroke="#000" stroke-width="20"/>"##),
            w(200),
        )
        .unwrap();
        assert_eq!(png, again);
    }

    #[test]
    fn dpi_option_uses_svg_physical_size() {
        // 100mm @ 254dpi = 1000px.
        let p = decode(
            &rasterize(
                &svg(""),
                RasterOptions {
                    width_px: None,
                    dpi: Some(254.0),
                },
            )
            .unwrap(),
        );
        assert_eq!((p.width(), p.height()), (1000, 500));
    }

    #[test]
    fn options_must_be_exactly_one_in_range() {
        let s = svg("");
        for o in [
            RasterOptions::default(),
            RasterOptions {
                width_px: Some(10),
                dpi: Some(96.0),
            },
            w(0),
            RasterOptions {
                width_px: None,
                dpi: Some(9.99),
            },
            RasterOptions {
                width_px: None,
                dpi: Some(1200.01),
            },
            RasterOptions {
                width_px: None,
                dpi: Some(f32::NAN),
            },
            RasterOptions {
                width_px: None,
                dpi: Some(f32::INFINITY),
            },
        ] {
            assert_eq!(
                rejects(&s, o, code::INVALID_INPUT).detail,
                "options",
                "{o:?}"
            );
        }
        assert!(rasterize(
            &s,
            RasterOptions {
                width_px: None,
                dpi: Some(10.0)
            }
        )
        .is_ok());
        assert!(rasterize(
            &s,
            RasterOptions {
                width_px: None,
                dpi: Some(1200.0)
            }
        )
        .is_ok());
        let unknown = serde_json::from_str::<RasterOptions>(r#"{"widthPx":10,"path":"C:/x"}"#);
        assert!(unknown.is_err(), "알 수 없는 필드 거부");
        let parsed: RasterOptions = serde_json::from_str(r#"{"widthPx":10}"#).unwrap();
        assert_eq!(parsed, w(10));
    }

    #[test]
    fn svg_byte_limit_is_checked_before_parsing() {
        let filler = format!("<!--{}-->", "x".repeat(MAX_SVG_BYTES));
        let base = svg("");
        let pad = MAX_SVG_BYTES - base.len() - "<!---->".len();
        let exact = base.replace("</svg>", &format!("<!--{}--></svg>", "x".repeat(pad)));
        assert_eq!(exact.len(), MAX_SVG_BYTES);
        assert!(rasterize(&exact, w(10)).is_ok(), "상한 정확히는 통과");
        let over = format!("{exact} ");
        assert_eq!(rejects(&over, w(10), code::TOO_LARGE).detail, "svg_bytes");
        // 파싱 전 거부: 깨진 XML이어도 크기 오류가 먼저.
        assert_eq!(rejects(&filler, w(10), code::TOO_LARGE).detail, "svg_bytes");
        assert_eq!(rejects("", w(10), code::INVALID_INPUT).detail, "empty");
    }

    #[test]
    fn xml_node_limit() {
        let many = "<g/>".repeat(MAX_XML_NODES as usize);
        assert_eq!(rejects(&svg(&many), w(10), code::TOO_LARGE).detail, "nodes");
    }

    #[test]
    fn output_pixel_limit_before_allocation() {
        let s = svg("");
        // 2:1 → 14143 x 7072 = 1.0002억 > 상한.
        assert_eq!(rejects(&s, w(14_143), code::TOO_LARGE).detail, "pixels");
        assert_eq!(rejects(&s, w(u32::MAX), code::TOO_LARGE).detail, "pixels");
        // 극단 비율: 폭 1px 요청으로도 세로가 상한을 넘는다.
        let tall = r#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="200000000"/>"#;
        assert_eq!(rejects(tall, w(1), code::TOO_LARGE).detail, "pixels");
        let flat = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="1"/>"#;
        assert_eq!(rejects(flat, w(10), code::INVALID_INPUT).detail, "size");
        // 경계: 정확히 1억 화소의 크기 계산은 통과(할당·렌더는 하지 않음).
        let size = usvg::Size::from_wh(10_000.0, 10_000.0).unwrap();
        assert!(target_size(size, Target::Width(10_000)).is_ok());
        assert!(target_size(size, Target::Width(10_001)).is_err());
        assert!(check_png_len(MAX_PNG_BYTES).is_ok());
        assert_eq!(
            check_png_len(MAX_PNG_BYTES + 1).unwrap_err().code,
            code::TOO_LARGE
        );
    }

    #[test]
    fn external_references_and_unsupported_elements_rejected() {
        let cases = [
            r#"<image href="file:///etc/passwd" width="10" height="10"/>"#.to_string(),
            r#"<image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="C:/Users/me/a.png" width="10" height="10"/>"#.into(),
            r#"<image href="data:image/svg+xml;base64,PHN2Zy8+" width="10" height="10"/>"#.into(),
            r#"<use href="other.svg#x"/>"#.into(),
            r##"<g id="a"/><use href="#a"/>"##.into(),
            r#"<style>@import url("http://example.com/x.css");</style>"#.into(),
            r#"<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>"#.into(),
            r#"<filter id="f"><feGaussianBlur stdDeviation="99"/></filter>"#.into(),
            r#"<mask id="m"/>"#.into(),
            r#"<clipPath id="c"/>"#.into(),
            r#"<pattern id="p"/>"#.into(),
            r#"<linearGradient id="l"/>"#.into(),
            r#"<svg x="0"/>"#.into(),
            r#"<script>alert(1)</script>"#.into(),
            r#"<a href="http://x"><rect width="1" height="1"/></a>"#.into(),
            format!(r#"<x:{LEAK} xmlns:x="urn:x"/>"#),
        ];
        for c in &cases {
            let e = rejects(&svg(c), w(10), code::INVALID_INPUT);
            assert_eq!(e.detail, "element", "{c}");
        }
    }

    #[test]
    fn layer_and_reference_attributes_rejected() {
        for a in [
            r#"opacity="0.5""#,
            r#"filter="url(#f)""#,
            r#"mask="url(#m)""#,
            r#"clip-path="url(#c)""#,
            r#"mix-blend-mode="multiply""#,
            r#"isolation="isolate""#,
            r#"style="opacity:0.5""#,
            r#"href="x""#,
            r#"fill="url(#p)""#,
            r#"stroke="URL(http://x/y.svg#p)""#,
            r#"fill="&#117;rl(#p)""#,
        ] {
            let e = rejects(
                &svg(&format!("<g {a}><rect width=\"1\" height=\"1\"/></g>")),
                w(10),
                code::INVALID_INPUT,
            );
            assert_eq!(e.detail, "attribute", "{a}");
        }
        // 도면이 쓰는 속성은 통과.
        let ok = svg(
            r##"<g id="A-SITE" fill="none" stroke="#ff0000" stroke-width="35" stroke-dasharray="300 100" fill-opacity="0.2" fill-rule="evenodd" transform="translate(1 2)"><polygon points="0,0 10,0 10,10"/><text x="1" y="2" font-size="30" text-anchor="middle">가</text></g>"##,
        );
        assert!(rasterize(&ok, w(10)).is_ok());
    }

    #[test]
    fn tree_check_rejects_isolated_groups_and_images() {
        // XML 검사를 우회했다고 가정하고 트리 검사만 본다(2중 방어).
        let parse = |s: &str| usvg::Tree::from_str(s, &usvg_options()).unwrap();
        let iso = parse(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g opacity="0.5"><rect width="5" height="5"/></g></svg>"#,
        );
        assert_eq!(check_tree(&iso).unwrap_err().detail, "isolation");
        let plain = parse(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g><rect width="5" height="5"/></g></svg>"#,
        );
        assert!(check_tree(&plain).is_ok());
    }

    #[test]
    fn image_resolvers_never_read_disk_or_data_urls() {
        // 실제로 있는 파일(번들 글꼴 정본 대신 이 소스 파일)과 data URL PNG를 가리켜도 이미지 노드가 생기지 않는다.
        let here = concat!(env!("CARGO_MANIFEST_DIR"), "/icons/32x32.png");
        assert!(std::path::Path::new(here).exists());
        let s = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="{here}" width="10" height="10"/><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>"#
        );
        let tree = usvg::Tree::from_str(&s, &usvg_options()).unwrap();
        assert!(check_tree(&tree).is_ok(), "이미지 노드가 없어야 한다");
        // 기본 해석기라면 파일을 읽어 이미지 노드를 만든다(위 단언이 의미 있음을 보인다).
        let default = usvg::Tree::from_str(&s, &usvg::Options::default()).unwrap();
        assert_eq!(check_tree(&default).unwrap_err().detail, "image");
    }

    #[test]
    fn dtd_entities_and_processing_instructions_rejected() {
        let bomb = r#"<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&c;</text></svg>"#;
        assert_eq!(rejects(bomb, w(10), code::INVALID_INPUT).detail, "dtd");
        let ext = r#"<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&x;</text></svg>"#;
        assert_eq!(rejects(ext, w(10), code::INVALID_INPUT).detail, "dtd");
        let pi = r#"<?xml-stylesheet href="http://x/a.css"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>"#;
        assert_eq!(rejects(pi, w(10), code::INVALID_INPUT).detail, "pi");
    }

    #[test]
    fn malformed_and_non_svg_input_has_fixed_detail() {
        for s in [
            format!("<svg xmlns=\"http://www.w3.org/2000/svg\"><text>{LEAK}"),
            format!("<html>{LEAK}</html>"),
            format!("\u{1f}\u{8b}{LEAK}"),
            format!(r#"<svg width="10" height="10"><g id="{LEAK}"/></svg>"#),
            format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10" id="{LEAK}"/>"#
            ),
        ] {
            let e = rasterize(&s, w(10)).unwrap_err();
            assert_eq!(e.code, code::INVALID_INPUT, "{s}");
            assert_clean(&e);
        }
    }

    #[test]
    fn any_font_family_uses_bundled_font() {
        let text = |family: &str| {
            let s = svg(&format!(
                r##"<text x="50" y="300" font-size="200" font-family="{family}" fill="#000">가나다</text>"##
            ));
            decode(&rasterize(&s, w(300)).unwrap())
        };
        let base = text("'Noto Sans KR'");
        assert!(ink(&base) > 200, "한글이 그려짐");
        for f in [
            "'Malgun Gothic'",
            "serif",
            "monospace",
            "cursive",
            "fantasy",
            "NoSuchFont, sans-serif",
        ] {
            assert_eq!(text(f).data(), base.data(), "{f}");
        }
    }

    fn nested(open: &str, close: &str, inner: &str, depth: usize) -> String {
        format!("{}{inner}{}", open.repeat(depth), close.repeat(depth))
    }

    fn doc_check(s: &str) -> Result<(), AppError> {
        let xml = roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: MAX_XML_NODES,
        };
        check_document(&roxmltree::Document::parse_with_options(s, xml).unwrap())
    }

    /// 슬롯은 작업 스레드가 결과를 보낸 직후(스레드 끝) 풀리므로 응답 직후에는 잠깐 바쁠 수 있다.
    fn wait_idle(gate: &RenderGate) {
        let start = std::time::Instant::now();
        while gate.busy() {
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "슬롯이 풀리지 않음"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    static DEPTH_GATE: RenderGate = RenderGate::new();

    /// 보안 리뷰 🟠1 회귀: 깊은 중첩이 작업 스레드 스택을 넘쳐 프로세스를 끝내지 않고 AR055 `depth`로 거부된다.
    #[test]
    fn deep_nesting_rejected_before_recursive_render() {
        let rect = r#"<rect width="10" height="10"/>"#;
        let g = |d: usize| {
            svg(&nested(
                r#"<g transform="translate(0.1 0)">"#,
                "</g>",
                rect,
                d,
            ))
        };
        let tspan = |d: usize| {
            svg(&format!(
                r#"<text x="10" y="100" font-size="20">{}</text>"#,
                nested("<tspan>", "</tspan>", "가", d)
            ))
        };
        // 명령 경로(작업 스레드)로: g 1024겹·tspan 1024겹·g 10만 겹(파서는 반복형이라 깊이 검사까지 온다).
        for s in [g(1024), tspan(1024), g(100_000)] {
            let e = rasterize_guarded(&DEPTH_GATE, s, w(100), RENDER_TIMEOUT).unwrap_err();
            assert_eq!((e.code, e.detail.as_str()), (code::TOO_LARGE, "depth"));
            assert_clean(&e);
            wait_idle(&DEPTH_GATE);
        }
        // 경계: svg(1) + rect(1) + g 30겹 = 32는 통과·렌더, g 31겹 = 33은 거부.
        assert!(rasterize_guarded(&DEPTH_GATE, g(30), w(100), RENDER_TIMEOUT).is_ok());
        assert_eq!(rejects(&g(31), w(100), code::TOO_LARGE).detail, "depth");
        // svg > text(2) + tspan 30겹 = 32는 통과, 31겹은 거부.
        assert!(rasterize(&tspan(30), w(100)).is_ok());
        assert_eq!(rejects(&tspan(31), w(100), code::TOO_LARGE).detail, "depth");
    }

    /// 보안 리뷰 🟠2: 초선형 비용 입력은 렌더 전에 고정 토큰으로 거부한다.
    #[test]
    fn text_and_tspan_budgets() {
        let text = |n: usize| {
            format!(
                r#"<text x="0" y="100" font-size="10">{}</text>"#,
                "가".repeat(n)
            )
        };
        assert!(doc_check(&svg(&text(MAX_TEXT_CHARS))).is_ok());
        assert_eq!(
            rejects(&svg(&text(MAX_TEXT_CHARS + 1)), w(10), code::TOO_LARGE).detail,
            "text_chars"
        );
        // tspan 안 글자도 바깥 <text> 몫으로 센다.
        let split = format!(
            r#"<text x="0" y="100">{}<tspan>{}</tspan></text>"#,
            "가".repeat(MAX_TEXT_CHARS / 2),
            "나".repeat(MAX_TEXT_CHARS / 2 + 1)
        );
        assert_eq!(
            rejects(&svg(&split), w(10), code::TOO_LARGE).detail,
            "text_chars"
        );
        // <text> 밖 글자(title)는 세지 않는다.
        let title = format!("<title>{}</title>", "가".repeat(MAX_TEXT_CHARS * 2));
        assert!(doc_check(&svg(&title)).is_ok());
        // 문서 전체 글자 상한: 상한 안의 <text>를 여러 개.
        let n = MAX_TOTAL_TEXT_CHARS / MAX_TEXT_CHARS;
        assert!(doc_check(&svg(&text(MAX_TEXT_CHARS).repeat(n))).is_ok());
        assert_eq!(
            rejects(
                &svg(&text(MAX_TEXT_CHARS).repeat(n + 1)),
                w(10),
                code::TOO_LARGE
            )
            .detail,
            "text_chars"
        );
        let tspans = |n: usize| {
            svg(&format!(
                r#"<text x="0" y="100">{}</text>"#,
                "<tspan>가</tspan>".repeat(n)
            ))
        };
        assert!(doc_check(&tspans(MAX_TSPANS)).is_ok());
        assert_eq!(
            rejects(&tspans(MAX_TSPANS + 1), w(10), code::TOO_LARGE).detail,
            "tspans"
        );
    }

    #[test]
    fn dash_segment_budget() {
        let tree = |body: &str| {
            let s = svg(body);
            let doc = roxmltree::Document::parse(&s).unwrap();
            let mut t = usvg::Tree::from_xmltree(&doc, &usvg_options()).unwrap();
            t.convert_text(font_db());
            t
        };
        // 길이 1000, 주기 0.0004 → 경로당 250만 조각.
        let line = r##"<line x1="0" y1="0" x2="1000" y2="0" stroke="#000" stroke-dasharray="0.0002 0.0002"/>"##;
        assert!(check_tree(&tree(line)).is_ok());
        assert!(check_tree(&tree(&line.replace("0.0002", "0.00021").repeat(2))).is_ok());
        assert_eq!(
            check_tree(&tree(&line.repeat(3))).unwrap_err().detail,
            "dash"
        );
        // 곡선은 제어점 다각형 길이(상한)로 센다: 제어점 경유 길이 3000 → 750만.
        let curve = r##"<path d="M0 0 C0 1000 1000 1000 1000 0" stroke="#000" stroke-dasharray="0.0002 0.0002"/>"##;
        assert_eq!(check_tree(&tree(curve)).unwrap_err().detail, "dash");
        // 거대 좌표(주기는 평범해도 길이가 크다)도 거부.
        let huge =
            r##"<path d="M-1e30 0 L1e30 0 L-1e30 0" stroke="#000" stroke-dasharray="1 1"/>"##;
        assert_eq!(check_tree(&tree(huge)).unwrap_err().detail, "dash");
        // 글자 외곽선의 대시도 센다.
        let text = r##"<text x="0" y="400" font-size="400" stroke="#000" stroke-dasharray="0.00001 0.00001">가</text>"##;
        assert_eq!(check_tree(&tree(text)).unwrap_err().detail, "dash");
        // 리뷰 재현(경로마다 tiny-skia 상한 100만 아래 × 40개) — 명령 경로에서 렌더 전 거부.
        let rev = r##"<line x1="0" y1="0" x2="1000" y2="500" stroke="#000" stroke-width="1" stroke-dasharray="0.0012 0.0012"/>"##.repeat(40);
        let e = rejects(&svg(&rev), w(1000), code::TOO_LARGE);
        assert_eq!(e.detail, "dash");
        // 대시 없음·도면 대시(300 100)는 0에 가깝다.
        assert!(check_tree(&tree(
            r##"<line x1="0" y1="0" x2="1000" y2="0" stroke="#000" stroke-dasharray="300 100"/>"##
        ))
        .is_ok());
    }

    fn noise(w: u32, h: u32) -> Pixmap {
        let mut p = Pixmap::new(w, h).unwrap();
        let mut x = 0x9e37_79b9u32;
        for (i, b) in p.data_mut().iter_mut().enumerate() {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            *b = if i % 4 == 3 { 255 } else { x as u8 };
        }
        p
    }

    /// 직접 압축한 IDAT가 png 0.17.5 `write_image_data`와 바이트 동일(골든 3건 외 잡음 영상으로도).
    #[test]
    fn png_encoder_matches_png_crate_bytes() {
        for (w, h) in [(1, 1), (7, 3), (64, 64), (333, 41)] {
            let p = noise(w, h);
            let mut legacy = Vec::new();
            {
                let mut e = png::Encoder::new(&mut legacy, w, h);
                e.set_color(png::ColorType::Rgba);
                e.set_depth(png::BitDepth::Eight);
                e.write_header()
                    .unwrap()
                    .write_image_data(p.data())
                    .unwrap();
            }
            assert_eq!(encode_png(&p).unwrap(), legacy, "{w}x{h}");
        }
    }

    /// 보안 리뷰 🟡: 결과 상한을 넘으면 압축 중에 멈추고 AR055 `png_bytes`.
    #[test]
    fn png_byte_cap_stops_while_compressing() {
        let p = noise(256, 256);
        let full = encode_png(&p).unwrap();
        assert_eq!(encode_png_capped(&p, full.len()).unwrap(), full);
        let e = encode_png_capped(&p, full.len() - 1).unwrap_err();
        assert_eq!((e.code, e.detail.as_str()), (code::TOO_LARGE, "png_bytes"));
        // 상한 버퍼는 상한을 넘겨 자라지 않는다.
        let mut c = CappedVec::new(10);
        assert!(c.write_all(&[0; 8]).is_ok());
        assert!(c.write_all(&[0; 3]).is_err());
        assert!(c.over && c.buf.len() == 8);
        let e = encode_png_capped(&p, 100).unwrap_err();
        assert_eq!(e.detail, "png_bytes");
    }

    static TEST_GATE: RenderGate = RenderGate::new();

    #[test]
    fn guarded_timeout_busy_and_release() {
        let heavy = svg(&r##"<line x1="0" y1="0" x2="1000" y2="500" stroke="#000" stroke-width="3" stroke-dasharray="0.01 0.01"/>"##.repeat(30));
        let e =
            rasterize_guarded(&TEST_GATE, heavy, w(4000), Duration::from_millis(1)).unwrap_err();
        assert_eq!((e.code, e.detail.as_str()), (code::PNG_FAILED, "timeout"));
        // 시간 초과 뒤에도 작업이 끝날 때까지는 BUSY.
        assert!(TEST_GATE.busy());
        let b = rasterize_guarded(&TEST_GATE, svg(""), w(10), RENDER_TIMEOUT).unwrap_err();
        assert_eq!((b.code, b.detail.as_str()), (code::BUSY, "busy"));
        // 값싼 검사는 관문 전에 한다(바쁜 동안에도 같은 코드).
        let o = rasterize_guarded(
            &TEST_GATE,
            svg(""),
            RasterOptions::default(),
            RENDER_TIMEOUT,
        )
        .unwrap_err();
        assert_eq!(o.code, code::INVALID_INPUT);
        let start = std::time::Instant::now();
        while TEST_GATE.busy() {
            assert!(
                start.elapsed() < Duration::from_secs(120),
                "작업이 끝나지 않음"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        let png = rasterize_guarded(&TEST_GATE, svg(""), w(10), RENDER_TIMEOUT).unwrap();
        assert_eq!(&png[..4], b"\x89PNG");
        wait_idle(&TEST_GATE);
        // 실패(파싱 오류)도 슬롯을 푼다.
        assert!(rasterize_guarded(&TEST_GATE, "<x".into(), w(10), RENDER_TIMEOUT).is_err());
        wait_idle(&TEST_GATE);
    }
}
