// 설치형 Rasterizer: Rust `rasterize_svg`(JSON `{svg, options}` → 원시 PNG 바이트). 입력 상한·옵션은 IPC 전에 TS가 먼저 거부하고,
// Rust가 다시 강제한다. Rust는 동시 1건(BUSY)이라 여기서 호출을 차례로 줄 세운다(대기 상한을 넘으면 BUSY).
import { errorFrom, BridgeError, type RasterErrorCode } from "../adapters/errors.ts";
import {
  assertPngResult,
  assertRasterizeOptions,
  assertRasterSvg,
  type RasterizeOptions,
  type Rasterizer,
} from "../adapters/rasterizer.ts";
import { RASTERIZE_SVG_COMMAND, type InvokeFn } from "./invoke.ts";

/** Rust `RasterOptions`(camelCase, deny_unknown_fields). */
type RasterOptionsWire = { widthPx: number } | { dpi: number };

const RASTER_CODES: readonly RasterErrorCode[] = ["AR055", "AR056", "INVALID_INPUT", "BUSY"];

/** 대기(실행 중 포함) 상한. 화면은 보통 한 장씩 부르므로 넉넉하다. 넘치면 SVG를 붙잡고 쌓이지 않게 BUSY. */
export const RASTER_QUEUE_LIMIT = 8;

function bytesOf(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw) && raw.every((b) => typeof b === "number" && b >= 0 && b <= 255)) return Uint8Array.from(raw);
  return null;
}

export class TauriRasterizer implements Rasterizer {
  readonly #invoke: InvokeFn;
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;

  constructor(invoke: InvokeFn) {
    this.#invoke = invoke;
  }

  async rasterize(svg: string, opts: RasterizeOptions): Promise<Uint8Array> {
    assertRasterizeOptions(opts);
    assertRasterSvg(svg);
    if (this.#pending >= RASTER_QUEUE_LIMIT) throw new BridgeError("BUSY");
    // 옵션은 검사한 키만 새 객체로 보낸다(호출자 객체의 다른 속성·프로토타입이 IPC로 가지 않게).
    const options: RasterOptionsWire = opts.widthPx !== undefined ? { widthPx: opts.widthPx } : { dpi: opts.dpi as number };
    this.#pending++;
    const run = this.#tail.then(() => this.#call(svg, options));
    this.#tail = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.#pending--;
    }
  }

  async #call(svg: string, options: RasterOptionsWire): Promise<Uint8Array> {
    let raw: unknown;
    try {
      raw = await this.#invoke(RASTERIZE_SVG_COMMAND, { svg, options });
    } catch (err) {
      throw errorFrom(err, RASTER_CODES, "AR056");
    }
    const bytes = bytesOf(raw);
    if (!bytes) throw new BridgeError("AR056");
    assertPngResult(bytes);
    return bytes;
  }
}
