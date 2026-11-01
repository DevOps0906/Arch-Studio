// 렌더 입력 PNG 인코딩(AR-06-056, 순수·결정적). 뷰포트 캡처(viewport/capture.ts의 RGBA)를 8비트 회색조 PNG로 만든다.
// - 새 의존성 없이 플랫폼 CompressionStream("deflate" = zlib 형식, PNG IDAT 규격)만 쓴다. 같은 입력 → 같은 바이트.
// - 상한: 긴 변 render_max_px(표준 1024), 파일 10MB(uploads render_input 정책·서버 AR031과 같은 값). 넘으면 보내지 않는다.
// - 보내는 것은 깊이·윤곽 이미지 2장뿐이다(원본 모델·도면 데이터 0, 03장 2.5절).

/** 표준 품질 긴 변(px). 03장 3.9절 "표준 1024px". */
export const RENDER_STD_MAX_PX = 1024;
/** 업로드 상한(바이트). apps/web uploads 정책 render_input 10MB와 같다. */
export const RENDER_INPUT_MAX_BYTES = 10 * 1024 * 1024;

export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface RenderInputPngs {
  readonly width: number;
  readonly height: number;
  /** 깊이 PNG(회색조, 가까움 = 밝음). */
  readonly depth: Uint8Array;
  /** 윤곽 PNG(흰 바탕 검정 선). 서버 필드명 edge_path. */
  readonly edge: Uint8Array;
}

export class RenderCaptureError extends Error {
  readonly reason: "size" | "too_large";
  constructor(reason: "size" | "too_large") {
    super(`render capture ${reason}`);
    this.name = "RenderCaptureError";
    this.reason = reason;
  }
}

/** 화면 크기 → 캡처 크기: 비율 유지, 긴 변 = maxPx(정수, 짧은 변 최소 1). */
export function renderCaptureSize(viewWidth: number, viewHeight: number, maxPx = RENDER_STD_MAX_PX): { width: number; height: number } {
  if (!(viewWidth > 0) || !(viewHeight > 0) || !Number.isSafeInteger(maxPx) || maxPx < 1) throw new RenderCaptureError("size");
  if (viewWidth >= viewHeight) return { width: maxPx, height: Math.max(1, Math.round((maxPx * viewHeight) / viewWidth)) };
  return { width: Math.max(1, Math.round((maxPx * viewWidth) / viewHeight)), height: maxPx };
}

/** RGBA(회색조) → 1채널(R 값). */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const n = width * height;
  if (rgba.length !== n * 4) throw new RenderCaptureError("size");
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4] as number;
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const body = new Response(data as unknown as BodyInit).body;
  if (!body) throw new RenderCaptureError("size");
  return new Uint8Array(await new Response(body.pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
}

/** 8비트 회색조 PNG. 줄마다 Up 필터(2). */
export async function encodePngGray(gray: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || gray.length !== width * height) {
    throw new RenderCaptureError("size");
  }
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width + 1);
    raw[o] = 2;
    for (let x = 0; x < width; x++) {
      const cur = gray[y * width + x] as number;
      const up = y > 0 ? (gray[(y - 1) * width + x] as number) : 0;
      raw[o + 1 + x] = (cur - up) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 0; // 회색조
  const parts = [Uint8Array.from(PNG_SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", await zlibDeflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 캡처 결과(RGBA 2장) → 렌더 입력 PNG 2장. 크기·바이트 상한을 넘으면 RenderCaptureError. */
export async function encodeRenderInputs(
  capture: { readonly width: number; readonly height: number; readonly depth: ArrayLike<number>; readonly outline: ArrayLike<number> },
  maxPx = RENDER_STD_MAX_PX,
): Promise<RenderInputPngs> {
  const { width, height } = capture;
  if (width > maxPx || height > maxPx) throw new RenderCaptureError("size");
  const depth = await encodePngGray(rgbaToGray(capture.depth, width, height), width, height);
  const edge = await encodePngGray(rgbaToGray(capture.outline, width, height), width, height);
  if (depth.length > RENDER_INPUT_MAX_BYTES || edge.length > RENDER_INPUT_MAX_BYTES) throw new RenderCaptureError("too_large");
  return { width, height, depth, edge };
}
