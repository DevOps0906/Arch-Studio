// Rasterizer(AR-06-080): 도면 SVG 문자열 → PNG 바이트. 설치형은 Rust `rasterize_svg`(resvg 0.34.0, 번들 Noto Sans KR만),
// 웹은 서버·워커의 resvg-js 경로(072 소유)라 이 어댑터는 NOT_SUPPORTED. 입력은 SVG 문자열과 크기 옵션뿐(경로·URL 0).
// 실패는 BridgeError(RasterErrorCode): AR055 상한 초과(입력·화소·결과, Rust 쪽 요소 깊이 32·<text> 글자·tspan·대시 조각 예산), AR056 렌더 실패·시간 초과, INVALID_INPUT 옵션·SVG 형식·
// 허용 밖 요소, BUSY 진행 중. 오류에는 코드만 남긴다(SVG 원문·Rust detail 버림).
import { BridgeError } from "./errors.ts";

/** 크기 옵션: 폭(px, 정본) 또는 dpi(SVG 물리 크기 기준) 중 정확히 하나. 배경은 흰색 고정. */
export type RasterizeOptions = { readonly widthPx: number; readonly dpi?: never } | { readonly dpi: number; readonly widthPx?: never };

/** 상한(Rust `commands/raster.rs`와 같다). 입력 바이트는 UTF-8 기준. */
export const RASTER_LIMITS = Object.freeze({
  maxSvgBytes: 8 * 1024 * 1024,
  maxPixels: 100_000_000,
  maxPngBytes: 100 * 1024 * 1024,
  minDpi: 10,
  maxDpi: 1200,
});

export interface Rasterizer {
  /** SVG → PNG(RGBA 8비트, IHDR·IDAT·IEND). 같은 입력이면 같은 바이트. */
  rasterize(svg: string, opts: RasterizeOptions): Promise<Uint8Array>;
}

/** UTF-8 바이트 길이(복사 없이). 짝 없는 서로게이트는 U+FFFD(3바이트)로 센다(TextEncoder와 같다). */
function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** SVG 입력 검사: 문자열, 비어 있지 않음(INVALID_INPUT), UTF-8 8MiB 이하(AR055). */
export function assertRasterSvg(svg: unknown): asserts svg is string {
  if (typeof svg !== "string" || svg.length === 0) throw new BridgeError("INVALID_INPUT");
  // UTF-8 바이트 ≥ UTF-16 코드 단위 수이므로 먼저 길이로 거른다.
  if (svg.length > RASTER_LIMITS.maxSvgBytes || utf8ByteLength(svg) > RASTER_LIMITS.maxSvgBytes) throw new BridgeError("AR055");
}

/** 옵션 검사: 키는 widthPx·dpi 중 정확히 하나, widthPx = 1 이상 1억 이하 정수, dpi = 10~1200 유한수. */
export function assertRasterizeOptions(opts: unknown): asserts opts is RasterizeOptions {
  if (typeof opts !== "object" || opts === null || Array.isArray(opts)) throw new BridgeError("INVALID_INPUT");
  const keys = Object.keys(opts);
  if (keys.length !== 1) throw new BridgeError("INVALID_INPUT");
  const o = opts as Record<string, unknown>;
  if (keys[0] === "widthPx") {
    const w = o.widthPx;
    if (typeof w !== "number" || !Number.isSafeInteger(w) || w < 1) throw new BridgeError("INVALID_INPUT");
    if (w > RASTER_LIMITS.maxPixels) throw new BridgeError("AR055");
    return;
  }
  if (keys[0] === "dpi") {
    const d = o.dpi;
    if (typeof d !== "number" || !Number.isFinite(d) || d < RASTER_LIMITS.minDpi || d > RASTER_LIMITS.maxDpi) {
      throw new BridgeError("INVALID_INPUT");
    }
    return;
  }
  throw new BridgeError("INVALID_INPUT");
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 결과 검사: PNG 서명, 결과 상한 이하. 아니면 AR056(렌더러 응답이 틀림). */
export function assertPngResult(bytes: Uint8Array): void {
  if (bytes.byteLength > RASTER_LIMITS.maxPngBytes) throw new BridgeError("AR055");
  if (bytes.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new BridgeError("AR056");
}

/** 이 플랫폼에 없음(웹: 서버·워커 경로, 072). 입력을 보지 않고 NOT_SUPPORTED. */
export const UNSUPPORTED_RASTERIZER: Rasterizer = Object.freeze({
  rasterize: async (): Promise<Uint8Array> => {
    throw new BridgeError("NOT_SUPPORTED");
  },
});

/** 어댑터 묶음의 래스터화기(없으면 NOT_SUPPORTED 구현). `PlatformAdapters.rasterizer`는 선택 필드라 화면은 이 함수로 꺼낸다. */
export function rasterizerOf(adapters: { readonly rasterizer?: Rasterizer }): Rasterizer {
  return adapters.rasterizer ?? UNSUPPORTED_RASTERIZER;
}
