// PNG 골든 하네스(AR-06-022). 입력은 DXF 골든 케이스(golden/_harness/cases.ts)를 읽기 전용으로 재사용한다. 3건 이내(용량 최소: 가로 px 작게).
// 배치: golden/png-<이름>/{input.svg, expected.png, meta.json}.
//  - input.svg = writeSvg 결과(번들 글꼴 이름, 번들 폭 표). 후속 Rust(resvg 크레이트, AR-06-080)가 같은 입력으로 같은 그림을 내는지 비교하는 기준.
//  - expected.png = resvg-js 2.6.2(resvg 0.34.0)의 출력 바이트. meta.json에 렌더 옵션 전체·바이트 sha256·픽셀(RGBA) sha256.
// 비교 규칙(png.test.ts): 같은 환경 → 바이트 동일, 다른 플랫폼 → 디코드한 픽셀 허용오차(바이트 동일은 약속하지 않는다, README.md).
// eslint-disable-next-line no-restricted-imports -- 골든 해시(엔진 밖 스크립트)
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 골든 파일 읽기(엔진 밖 스크립트)
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 시험용 PNG 디코더
import { inflateSync } from "node:zlib";
import { CASES, type GoldenCase } from "../_harness/cases.ts";
import { PNG_DEFAULT_DPI, PNG_RENDER_OPTIONS, PNG_WRITER_VERSION, buildPngSvg, writePng } from "../../src/writers/png/index.ts";
import { loadBundledMetrics } from "../../src/writers/pdf/node.ts";
import type { SheetModel } from "../../src/index.ts";

export const GOLDEN = new URL("../", import.meta.url);

/** 골든 3건: [DXF 케이스 id, 가로 px, 이유]. */
export const PNG_CASES: ReadonlyArray<{ source: string; width_px: number; note: string }> = [
  { source: "writer-site-a3-basic", width_px: 840, note: "배치도 A3 기본: 선·해치·치수·한글 표제란(기본 흐름)" },
  { source: "writer-korean-long-names", width_px: 840, note: "한글 긴 이름·MTEXT 줄바꿈: 한글이 두부(□)가 아님을 확인" },
  { source: "writer-hatch-ansi31", width_px: 600, note: "ANSI31·SOLID 해치(채움·불투명도·가는 선 안티앨리어싱)" },
];

export const pngCaseId = (source: string) => `png-${source.replace(/^writer-/, "")}`;
export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface PngGoldenMeta {
  case_id: string;
  source_case: string;
  note: string;
  writer_version: string;
  /** npm @resvg/resvg-js 버전과 그 안의 Rust 크레이트(README.md "재현"). */
  renderer: { npm: string; resvg: string; resvg_fork: string; tiny_skia: string; fontdb: string; rustybuzz: string; ttf_parser: string };
  options: { width_px: number; dpi: number; fit_to: "width"; font_file: string; font_family: string } & typeof PNG_RENDER_OPTIONS;
  width_px: number;
  height_px: number;
  png_sha256: string;
  /** 디코드한 RGBA 픽셀 바이트의 sha256(바이트 골든이 어긋날 때의 1차 확인). */
  pixels_sha256: string;
}

export const RENDERER = {
  npm: "@resvg/resvg-js@2.6.2",
  resvg: "0.34.0",
  resvg_fork: "github.com/zimond/resvg rev 3495d870 (resvg-js 2.6.2 Cargo.toml [patch.crates-io])",
  tiny_skia: "0.10.0",
  fontdb: "0.14.1",
  rustybuzz: "0.7.0",
  ttf_parser: "0.18.1",
} as const;

export function sheetOf(id: string): SheetModel {
  return (CASES.find((c) => c.id === id) as GoldenCase).build().sheet;
}

export function renderCase(source: string, width_px: number) {
  const sheet = sheetOf(source);
  const r = writePng(sheet, { width_px });
  return { sheet, svg: buildPngSvg(sheet, loadBundledMetrics()), r };
}

/** 최소 PNG 디코더(시험용): 8비트 RGB/RGBA 비인터레이스만. 필터 0~4. 결과는 RGBA(알파 255 보충). */
export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const b = Buffer.from(png);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG 시그니처가 아닙니다");
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("latin1", off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("8비트 비인터레이스만 지원");
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (channels === 0) throw new Error(`색 종류 ${data[9]} 미지원`);
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] as number;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] as number) : 0;
      const v = src[x] as number;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      out[y * stride + x] = (v + p) & 255;
    }
  }
  if (channels === 4) return { width, height, rgba: new Uint8Array(out) };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = out[i * 3] as number;
    rgba[i * 4 + 1] = out[i * 3 + 1] as number;
    rgba[i * 4 + 2] = out[i * 3 + 2] as number;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

export function goldenFiles(c: { source: string; width_px: number; note: string }): { svg: string; png: Uint8Array; meta: PngGoldenMeta } {
  const { svg, r } = renderCase(c.source, c.width_px);
  const dec = decodePng(r.bytes);
  const meta: PngGoldenMeta = {
    case_id: pngCaseId(c.source),
    source_case: c.source,
    note: c.note,
    writer_version: PNG_WRITER_VERSION,
    renderer: RENDERER,
    options: { width_px: r.width_px, dpi: PNG_DEFAULT_DPI, fit_to: "width", font_file: "fonts/NotoSansKR-Regular.subset.ttf", font_family: "'Noto Sans KR', sans-serif", ...PNG_RENDER_OPTIONS },
    width_px: r.width_px,
    height_px: r.height_px,
    png_sha256: sha256(r.bytes),
    pixels_sha256: sha256(dec.rgba),
  };
  return { svg, png: r.bytes, meta };
}

export const readGolden = (id: string, name: string) => new Uint8Array(readFileSync(new URL(`${id}/${name}`, GOLDEN)));
