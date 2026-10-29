// 시트 만들기 큐·내보내기 실행(React 없음, 어댑터 주입 → Node 테스트 가능).
// - sheet 레인은 "최신만 유효"라 동시에 두 요청을 보내면 앞 요청이 버려진다 → 큐로 하나씩 보낸다(seq는 sheets/seq.ts 전역 증가).
// - 내보내기: 형식마다 export 레인 write → (PNG만) Rasterizer → FileGateway.save(경로는 받지 않는다, 파일마다 OS 저장 대화상자).
// 기하·도면은 워커가 만든다. 여기서는 바이트를 옮길 뿐이다.
import type { EngineHost } from "../shell/types.ts";
import {
  buildSheetEnvelope,
  buildWriteEnvelope,
  readBuildResponse,
  readWriteResponse,
  FORMAT_ORDER,
  type BuiltSheet,
  type OutputFile,
  type OutputFormat,
  type SheetInput,
} from "./model.ts";
import { nextSheetSeq } from "./seq.ts";

type EngineLike = Pick<EngineHost, "send" | "subscribe">;

const DEFAULT_TIMEOUT_MS = 120_000;

/** 요청을 보내고 응답이 해석될 때까지 기다린다. 시간 초과는 reject("TIMEOUT"). */
function exchange<T>(engine: EngineLike, send: () => void, read: (res: unknown) => T | null, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      fn();
    };
    const unsub = engine.subscribe((res) => {
      const out = read(res);
      if (out !== null) finish(() => resolve(out));
    });
    const timer = setTimeout(() => finish(() => reject(new Error("TIMEOUT"))), timeoutMs);
    try {
      send();
    } catch {
      finish(() => reject(new Error("ENGINE_UNAVAILABLE")));
    }
  });
}

export type BuildResult = { ok: true; built: BuiltSheet } | { ok: false; code: string };

export interface SheetBuilder {
  /** 같은 입력은 캐시에서 돌려준다(입력 JSON 동일 = 결과 동일, 엔진은 결정적). 큐에 쌓아 하나씩 보낸다. */
  build(input: SheetInput): Promise<BuildResult>;
  /** 캐시를 비운다(엔진을 다시 만들었을 때). */
  clear(): void;
}

export function createSheetBuilder(engine: EngineLike | null, opts: { timeoutMs?: number } = {}): SheetBuilder {
  const cache = new Map<string, BuildResult>();
  let tail: Promise<unknown> = Promise.resolve();
  let counter = 0;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const run = async (input: SheetInput): Promise<BuildResult> => {
    if (!engine) return { ok: false, code: "ENGINE_UNAVAILABLE" };
    const reqId = `sheet-build-${nextSheetSeq()}-${++counter}`;
    const seq = nextSheetSeq();
    try {
      const out = await exchange(
        engine,
        () => engine.send(buildSheetEnvelope(reqId, seq, input)),
        (res) => {
          const r = readBuildResponse(res, reqId);
          return r.kind === "ignore" ? null : r;
        },
        timeoutMs,
      );
      if (out.kind === "ok") return { ok: true, built: out.built };
      return { ok: false, code: out.kind === "error" ? out.code : "AR050" };
    } catch (e) {
      return { ok: false, code: e instanceof Error && e.message === "TIMEOUT" ? "TIMEOUT" : "ENGINE_UNAVAILABLE" };
    }
  };

  return {
    build(input) {
      const key = JSON.stringify(input);
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      const p = tail.then(async () => {
        const again = cache.get(key);
        if (again) return again;
        const r = await run(input);
        if (r.ok) cache.set(key, r); // 실패는 캐시하지 않는다(다시 시도 가능)
        return r;
      });
      tail = p.catch(() => undefined);
      return p;
    },
    clear() {
      cache.clear();
    },
  };
}

/* ---------- 내보내기 ---------- */

export interface ExportRasterizer {
  rasterize(svg: string, opts: { readonly widthPx: number }): Promise<Uint8Array>;
}

export interface ExportFiles {
  save(format: OutputFormat, data: Uint8Array): Promise<unknown>;
}

export interface ExportDeps {
  readonly engine: EngineLike | null;
  readonly files: ExportFiles;
  /** 없으면 PNG는 만들지 않는다(웹: 서버 경로 072 — 화면이 미리 막는다). */
  readonly rasterizer?: ExportRasterizer | undefined;
  readonly newReqId: () => string;
  readonly timeoutMs?: number;
}

export interface ExportRequest {
  readonly formats: readonly OutputFormat[];
  /** 내보낼 시트 모델 원본(워커가 돌려준 값 그대로). */
  readonly sheets: readonly unknown[];
  readonly layerMap: Readonly<Record<string, string>>;
  readonly projectName: string;
  readonly date: string;
}

export interface ExportFailure {
  readonly format: OutputFormat;
  readonly code: string;
}

export interface ExportOutcome {
  /** 저장한 파일 수. */
  readonly saved: number;
  /** 사용자가 저장 대화상자를 닫아 멈췄다. */
  readonly canceled: boolean;
  readonly failures: readonly ExportFailure[];
  readonly warnings: ReadonlyArray<{ code: string; detail: string }>;
}

export type ExportProgress = { format: OutputFormat; phase: "make" | "save"; saved: number };

function errorCode(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const o = e as { name?: unknown; code?: unknown; message?: unknown };
    if (o.name === "BridgeError" && typeof o.code === "string") return o.code;
    if (o.name === "Error" && (o.message === "TIMEOUT" || o.message === "ENGINE_UNAVAILABLE")) return o.message;
  }
  return "AR056";
}

/**
 * 형식 순서(DXF·PDF·SVG·PNG)대로 만들고 저장한다. 한 형식이 실패하면 다른 형식은 계속한다(AR056 "형식 바꿔 다시").
 * 저장 쓰기 실패(AR052·AR055)와 사용자 취소는 거기서 멈춘다(같은 원인이 반복되므로).
 */
export async function runExport(req: ExportRequest, deps: ExportDeps, onProgress?: (p: ExportProgress) => void): Promise<ExportOutcome> {
  const failures: ExportFailure[] = [];
  const warnings: Array<{ code: string; detail: string }> = [];
  let saved = 0;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ordered = FORMAT_ORDER.filter((f) => req.formats.includes(f));

  for (const format of ordered) {
    onProgress?.({ format, phase: "make", saved });
    let files: OutputFile[];
    try {
      const engine = deps.engine;
      if (!engine) throw new Error("ENGINE_UNAVAILABLE");
      const reqId = deps.newReqId();
      const out = await exchange(
        engine,
        () =>
          engine.send(
            buildWriteEnvelope({
              reqId,
              format,
              sheets: req.sheets,
              layerMap: format === "dxf" ? req.layerMap : {},
              bundle: format === "pdf",
              projectName: req.projectName,
              date: req.date,
            }),
          ),
        (res) => {
          const r = readWriteResponse(res, reqId);
          return r.kind === "ignore" ? null : r;
        },
        timeoutMs,
      );
      if (out.kind !== "ok") {
        failures.push({ format, code: out.code });
        continue;
      }
      for (const w of out.warnings) if (!warnings.some((x) => x.code === w.code && x.detail === w.detail)) warnings.push(w);
      files = out.files;
      if (format === "png") {
        if (!deps.rasterizer) {
          failures.push({ format, code: "NOT_SUPPORTED" });
          continue;
        }
        const dec = new TextDecoder("utf-8", { fatal: true });
        const pngs: OutputFile[] = [];
        for (const f of files) {
          if (f.widthPx === undefined) throw new Error("invalid");
          const bytes = await deps.rasterizer.rasterize(dec.decode(f.bytes), { widthPx: f.widthPx });
          pngs.push({ name: f.name, bytes });
        }
        files = pngs;
      }
    } catch (e) {
      failures.push({ format, code: errorCode(e) });
      continue;
    }

    for (const f of files) {
      onProgress?.({ format, phase: "save", saved });
      try {
        await deps.files.save(format, f.bytes);
        saved++;
      } catch (e) {
        const code = errorCode(e);
        if (code === "CANCELLED") return { saved, canceled: true, failures, warnings };
        failures.push({ format, code });
        return { saved, canceled: false, failures, warnings };
      }
    }
  }
  return { saved, canceled: false, failures, warnings };
}
