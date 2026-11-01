// arch.render 핸들러(AR-06-056 1단계). payload(start_ai_run이 만든 값): { run_id, variant, quality, preset, inputs: { depth_path, edge_path }, max_px }.
// 순서: payload 검사 → 입력 내려받기·재검사(PNG·10MB·max_px) → 제공자 → 출력 검사(PNG 고정) → org-files 저장 → finish_ai_run 결과.
// 실패 분류: 제공자 호출 전(입력 내려받기)만 재시도 가능. 제공자 호출 뒤 실패는 재시도하지 않는다(유료 호출 재실행 방지, 실패·환불).
// 진행 단계는 잡 조회(apps/web/src/server/jobs/service.ts)가 읽는 JSON { stage } 형식(submit·generate·persist).
import type { HandlerContext, JobHandler } from "../../core/runner.ts";
import { JobError } from "../../core/errors.ts";
import { readPngSize } from "./png.ts";
import type { RenderProvider } from "./provider.ts";
import type { RenderStorage } from "./storage.ts";

export interface RenderHandlerDeps {
  provider: RenderProvider;
  storage: RenderStorage;
  randomUUID(): string;
}

/** render_input 상한(웹 업로드 정책과 같은 10MB). */
export const RENDER_INPUT_MAX_BYTES = 10 * 1024 * 1024;

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PART}$`);

interface RenderPayload {
  runId: string;
  preset: Record<string, unknown>;
  depthPath: string;
  edgePath: string;
  maxPx: number;
}

function fatal(code: string, message: string): JobError {
  return new JobError(message, { retryable: false, code });
}

function parsePayload(orgId: string, payload: Record<string, unknown>): RenderPayload {
  if (!UUID_RE.test(orgId)) throw fatal("bad_payload", "org id invalid");
  const runId = payload["run_id"];
  if (typeof runId !== "string" || !UUID_RE.test(runId)) throw fatal("bad_payload", "run_id invalid");
  // 고품질·업스케일은 결정 전까지 처리하지 않는다(웹이 22023으로 막지만 DB 직접 enqueue 대비).
  if (payload["variant"] !== "render_std" || payload["quality"] !== "standard") throw fatal("unsupported_quality", "only standard quality");
  const inputs = payload["inputs"];
  const inputPath = new RegExp(`^${orgId}/arch/render_input/${UUID_PART}\\.png$`);
  const depthPath = inputs !== null && typeof inputs === "object" ? (inputs as Record<string, unknown>)["depth_path"] : undefined;
  const edgePath = inputs !== null && typeof inputs === "object" ? (inputs as Record<string, unknown>)["edge_path"] : undefined;
  if (typeof depthPath !== "string" || !inputPath.test(depthPath) || typeof edgePath !== "string" || !inputPath.test(edgePath)) {
    throw fatal("bad_payload", "render input path invalid");
  }
  const maxPx = payload["max_px"];
  if (typeof maxPx !== "number" || !Number.isSafeInteger(maxPx) || maxPx < 1) throw fatal("bad_payload", "max_px invalid");
  const preset = payload["preset"];
  return {
    runId,
    preset: preset !== null && typeof preset === "object" && !Array.isArray(preset) ? (preset as Record<string, unknown>) : {},
    depthPath,
    edgePath,
    maxPx,
  };
}

async function stage(ctx: HandlerContext, progress: number, name: "submit" | "generate" | "persist"): Promise<void> {
  await ctx.heartbeat(progress, JSON.stringify({ stage: name }));
}

async function loadInput(deps: RenderHandlerDeps, path: string, maxPx: number): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.storage.download("arch-user", path);
  } catch (err) {
    throw new JobError("render input download failed", { retryable: true, code: "storage", cause: err });
  }
  if (bytes.byteLength > RENDER_INPUT_MAX_BYTES) throw fatal("AR031", "render input too large");
  const size = readPngSize(bytes);
  if (!size) throw fatal("bad_input", "render input is not png");
  if (size.width > maxPx || size.height > maxPx) throw fatal("AR031", "render input exceeds max_px");
  return bytes;
}

export function createRenderHandler(deps: RenderHandlerDeps): JobHandler {
  return async (ctx) => {
    const { job, signal } = ctx;
    const p = parsePayload(job.org_id, job.payload ?? {});

    await stage(ctx, 10, "submit");
    const depth = await loadInput(deps, p.depthPath, p.maxPx);
    const edge = await loadInput(deps, p.edgePath, p.maxPx);
    if (signal.aborted) throw signal.reason;

    await stage(ctx, 30, "generate");
    let out: { png: Uint8Array; seed: number | null };
    try {
      out = await deps.provider.render({ depth, edge, preset: p.preset, maxPx: p.maxPx, signal });
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      throw new JobError("render provider failed", { retryable: false, code: "AI_UNAVAILABLE", cause: err });
    }
    if (signal.aborted) throw signal.reason;
    const size = readPngSize(out.png);
    if (!size || size.width > p.maxPx || size.height > p.maxPx) throw fatal("AR032", "render output is not an allowed png");

    await stage(ctx, 80, "persist");
    const outputPath = `${job.org_id}/arch/render/${deps.randomUUID()}.png`;
    if (!new RegExp(`^${job.org_id}/arch/render/${UUID_PART}\\.png$`).test(outputPath)) throw fatal("bad_output_path", "output path invalid");
    try {
      await deps.storage.uploadPng("org-files", outputPath, out.png);
    } catch (err) {
      throw new JobError("render output upload failed", { retryable: false, code: "storage", cause: err });
    }
    return {
      runResult: {
        output_path: outputPath,
        width: size.width,
        height: size.height,
        bytes: out.png.byteLength,
        provider: deps.provider.name.slice(0, 40),
        model: deps.provider.model.slice(0, 120),
        seed: out.seed,
        ai_label: true,
      },
      jobResult: { run_id: p.runId, output_path: outputPath },
    };
  };
}
