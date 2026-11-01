// 렌더 입력 PNG 인코딩 테스트(AR-06-056): 서명·IHDR·왕복 복원·결정성·크기·바이트 상한.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import {
  PNG_SIGNATURE,
  RENDER_INPUT_MAX_BYTES,
  RENDER_STD_MAX_PX,
  RenderCaptureError,
  crc32,
  encodePngGray,
  encodeRenderInputs,
  renderCaptureSize,
  rgbaToGray,
} from "./png.ts";

function grayRgba(w: number, h: number, f: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f(x, y) & 0xff;
    out.set([v, v, v, 255], (y * w + x) * 4);
  }
  return out;
}

/** 테스트용 디코더(회색조 8비트, 필터 0·2만). */
function decode(png: Uint8Array): { width: number; height: number; gray: Uint8Array } {
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(v.getUint32(8), 13);
  assert.equal(String.fromCharCode(...png.subarray(12, 16)), "IHDR");
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  assert.equal(png[24], 8);
  assert.equal(png[25], 0);
  let at = 8;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (at < png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    assert.equal(v.getUint32(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)), `${type} CRC`);
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    if (type === "IEND") ended = true;
    at += 12 + len;
  }
  assert.ok(ended);
  const raw = inflateSync(Buffer.concat(idat));
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const b = raw[y * (width + 1) + 1 + x] as number;
      const up = y > 0 ? (gray[(y - 1) * width + x] as number) : 0;
      gray[y * width + x] = f === 2 ? (b + up) & 0xff : b;
    }
  }
  return { width, height, gray };
}

test("crc32: 알려진 값", () => {
  assert.equal(crc32(new TextEncoder().encode("IEND")), 0xae426082);
});

test("encodePngGray: PNG 서명·IHDR·CRC, 픽셀 왕복, 같은 입력 → 같은 바이트", async () => {
  const w = 7;
  const h = 5;
  const gray = rgbaToGray(grayRgba(w, h, (x, y) => x * 31 + y * 17), w, h);
  const png = await encodePngGray(gray, w, h);
  const d = decode(png);
  assert.equal(d.width, w);
  assert.equal(d.height, h);
  assert.deepEqual([...d.gray], [...gray]);
  assert.deepEqual([...(await encodePngGray(gray, w, h))], [...png]);
});

test("renderCaptureSize: 비율 유지, 긴 변 = 상한", () => {
  assert.deepEqual(renderCaptureSize(800, 600), { width: 1024, height: 768 });
  assert.deepEqual(renderCaptureSize(375, 500), { width: 768, height: 1024 });
  assert.deepEqual(renderCaptureSize(4000, 1), { width: 1024, height: 1 });
  assert.throws(() => renderCaptureSize(0, 10), RenderCaptureError);
});

test("encodeRenderInputs: 깊이·윤곽 PNG 2장, 긴 변 ≤ 1024, 각 10MB 이하(최악 잡음 입력)", async () => {
  const { width, height } = renderCaptureSize(1600, 1200);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  const out = await encodeRenderInputs({ width, height, depth: grayRgba(width, height, () => noise()), outline: grayRgba(width, height, (x) => (x % 9 ? 255 : 0)) });
  for (const png of [out.depth, out.edge]) {
    const d = decode(png);
    assert.ok(d.width <= RENDER_STD_MAX_PX && d.height <= RENDER_STD_MAX_PX);
    assert.equal(d.width, width);
    assert.equal(d.height, height);
    assert.ok(png.length <= RENDER_INPUT_MAX_BYTES, `${png.length}바이트`);
  }
});

test("encodeRenderInputs: 상한보다 큰 캡처·크기 불일치는 거부", async () => {
  await assert.rejects(encodeRenderInputs({ width: 1025, height: 10, depth: new Uint8ClampedArray(1025 * 40), outline: new Uint8ClampedArray(1025 * 40) }), RenderCaptureError);
  await assert.rejects(encodeRenderInputs({ width: 2, height: 2, depth: new Uint8ClampedArray(4), outline: new Uint8ClampedArray(16) }), RenderCaptureError);
});
