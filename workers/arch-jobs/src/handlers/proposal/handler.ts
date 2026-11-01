// arch.proposal_pdf 핸들러(AR-06-032 1단계). payload(start_ai_run이 만든 값, 04_API.md 4.4절):
// { run_id, variant, kind, content_path, content_sha256, render_ids, drawing_sheets, template_version, narrative }.
// 순서: payload 검사 → 내용 파일 내려받기·해시 확인 → 시트 내려받기·해시·SVG 재검사 → (proposal만) 서술 → HTML 조립 → PDF 렌더(120초) → exports 저장 → finish_ai_run.
// 진행 단계는 잡 조회가 읽는 JSON { stage }(narrative·assemble·render, 04_API.md 4장).
// 실패 분류: 입력 내려받기·서술·결과 업로드의 일시 오류(네트워크·타임아웃·429)는 재시도 1회(02_ARCHITECTURE.md 4장).
// PDF 렌더러의 예외·120초 타임아웃은 재시도하지 않는다(04_API.md 외부 연동 표 공용 WeasyPrint 행 "렌더 예외 재시도 불가 → 환불, 타임아웃 120초").
// 형식·검사 실패도 재시도 없음. 최종 실패는 러너가 fail_job → fail_ai_run으로 전액 환불한다.
import type { HandlerContext, JobHandler } from "../../core/runner.ts";
import { JobError } from "../../core/errors.ts";
import { parseContentFile, PROPOSAL_TEMPLATE_VERSION, sha256Hex, type ContentFile, type DocKind } from "./content.ts";
import { assembleProposalHtml } from "./html.ts";
import { checkNarrative, narrativeSummaryOf, type NarrativeClient, type NarrativeOutput } from "./narrative.ts";
import type { PdfRenderer } from "./pdf-renderer.ts";
import type { ProposalStorage } from "./storage.ts";
import { checkSheetSvgBytes } from "./svg.ts";

export interface ProposalHandlerDeps {
  narrative: NarrativeClient;
  renderer: PdfRenderer;
  storage: ProposalStorage;
  randomUUID(): string;
  /** 설정상 서술이 국외로 가도 되는가(src/config.ts isNarrativeCrossBorder = 웹과 같은 해석). */
  narrativeCrossBorder: boolean;
  /** PDF 렌더 단계 상한(기본 120초, 04_API.md 4장). 테스트만 바꾼다. */
  renderTimeoutMs?: number;
}

export const PDF_RENDER_TIMEOUT_MS = 120_000;
/** 내용 파일 상한(웹 본문 512KB + 정규화 여유). */
export const CONTENT_MAX_BYTES = 1024 * 1024;
export const PDF_MAX_BYTES = 50 * 1024 * 1024;

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PART}$`);
const SHA_RE = /^[0-9a-f]{64}$/;
const DOC_KINDS = new Set<DocKind>(["proposal", "overview", "area_table", "cost"]);

interface ProposalPayload {
  runId: string;
  kind: DocKind;
  contentPath: string;
  contentSha256: string;
  sheets: string[];
  narrative: boolean;
}

function fatal(code: string, message: string): JobError {
  return new JobError(message, { retryable: false, code });
}

function parsePayload(orgId: string, payload: Record<string, unknown>): ProposalPayload {
  if (!UUID_RE.test(orgId)) throw fatal("bad_payload", "org id invalid");
  const runId = payload["run_id"];
  if (typeof runId !== "string" || !UUID_RE.test(runId)) throw fatal("bad_payload", "run_id invalid");
  const kind = payload["kind"];
  if (typeof kind !== "string" || !DOC_KINDS.has(kind as DocKind)) throw fatal("bad_payload", "kind invalid");
  const variant = payload["variant"];
  const narrative = payload["narrative"];
  // DB 규칙: variant proposal ⇔ kind proposal ⇔ narrative true.
  if (variant !== (kind === "proposal" ? "proposal" : "doc_template") || narrative !== (kind === "proposal")) throw fatal("bad_payload", "variant mismatch");
  if (payload["template_version"] !== PROPOSAL_TEMPLATE_VERSION) throw fatal("unsupported_template", "template version not supported");
  const contentPath = payload["content_path"];
  if (typeof contentPath !== "string" || !new RegExp(`^${orgId}/arch/proposal_content/${UUID_PART}\\.json$`).test(contentPath)) {
    throw fatal("bad_payload", "content path invalid");
  }
  const contentSha256 = payload["content_sha256"];
  if (typeof contentSha256 !== "string" || !SHA_RE.test(contentSha256)) throw fatal("bad_payload", "content sha invalid");
  // 렌더 이미지 삽입은 1단계 범위 밖(웹이 22023으로 막지만 DB 직접 enqueue 대비).
  const renderIds = payload["render_ids"];
  if (!Array.isArray(renderIds) || renderIds.length > 0) throw fatal("unsupported_render_ids", "render images not supported yet");
  const sheets = payload["drawing_sheets"];
  const sheetPath = new RegExp(`^${orgId}/arch/proposal_sheet/${UUID_PART}\\.svg$`);
  if (!Array.isArray(sheets) || sheets.length > 6 || !sheets.every((s): s is string => typeof s === "string" && sheetPath.test(s))) {
    throw fatal("bad_payload", "drawing sheet path invalid");
  }
  return { runId, kind: kind as DocKind, contentPath, contentSha256, sheets, narrative: narrative === true };
}

async function stage(ctx: HandlerContext, progress: number, name: "narrative" | "assemble" | "render"): Promise<void> {
  await ctx.heartbeat(progress, JSON.stringify({ stage: name }));
}

async function download(deps: ProposalHandlerDeps, path: string, what: string): Promise<Uint8Array> {
  try {
    return await deps.storage.download("arch-user", path);
  } catch (err) {
    throw new JobError(`${what} download failed`, { retryable: true, code: "storage", cause: err });
  }
}

/** 오류를 재시도 분류 그대로 넘기되(JobError), 모르는 오류는 재시도 1회 대상으로 본다(네트워크·타임아웃·429). */
function passThrough(err: unknown, code: string, message: string): JobError {
  if (err instanceof JobError) return err;
  return new JobError(message, { retryable: true, code, cause: err });
}

async function renderWithTimeout(deps: ProposalHandlerDeps, html: string, outer: AbortSignal): Promise<{ pdf: Uint8Array; pages: number }> {
  const ctrl = new AbortController();
  const ms = deps.renderTimeoutMs ?? PDF_RENDER_TIMEOUT_MS;
  const onOuter = () => ctrl.abort(outer.reason);
  outer.addEventListener("abort", onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new JobError("pdf render timed out", { retryable: false, code: "pdf_timeout" });
      ctrl.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([deps.renderer.render({ html, signal: ctrl.signal }), timeout]);
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", onOuter);
  }
}

export function createProposalHandler(deps: ProposalHandlerDeps): JobHandler {
  return async (ctx) => {
    const { job, signal } = ctx;
    const p = parsePayload(job.org_id, job.payload ?? {});

    // 입력: 내용 파일(해시 = payload) → 시트(해시 = 내용 파일, SVG 재검사).
    const contentBytes = await download(deps, p.contentPath, "proposal content");
    if (contentBytes.byteLength > CONTENT_MAX_BYTES) throw fatal("AR031", "proposal content too large");
    const file: ContentFile | null = parseContentFile(contentBytes, p.contentSha256);
    if (!file || file.kind !== p.kind || file.template_version !== PROPOSAL_TEMPLATE_VERSION || file.render_ids.length > 0) {
      throw fatal("bad_input", "proposal content invalid");
    }
    if (file.sheet_sha256.length !== p.sheets.length) throw fatal("bad_input", "sheet list mismatch");
    if (p.kind === "cost" && !file.content.cost) throw fatal("bad_input", "cost content missing");
    const sheets: string[] = [];
    for (const [i, path] of p.sheets.entries()) {
      const bytes = await download(deps, path, "proposal sheet");
      if (sha256Hex(bytes) !== file.sheet_sha256[i]) throw fatal("bad_input", "sheet changed after request");
      if (!checkSheetSvgBytes(bytes).ok) throw fatal("bad_input", "sheet svg rejected");
      sheets.push(new TextDecoder("utf-8").decode(bytes));
    }
    if (signal.aborted) throw signal.reason;

    // 서술(proposal만). 수치는 보내지 않고, 숫자가 섞인 문장은 쓰지 않는다.
    let narrative: NarrativeOutput | null = null;
    if (p.narrative) {
      await stage(ctx, 20, "narrative");
      // 실패 닫힘: 설정은 oss(웹이 국외 이전 동의를 확인하지 않음)인데 클라이언트가 국외로 보내면 부르지 않는다(재시도 없음 → 환불).
      if (deps.narrative.crossBorder && !deps.narrativeCrossBorder) throw fatal("narrative_route_mismatch", "narrative route mismatch");
      let out: NarrativeOutput;
      try {
        out = await deps.narrative.narrate({ jobId: job.id, summary: narrativeSummaryOf(file), signal });
      } catch (err) {
        if (signal.aborted) throw signal.reason;
        throw passThrough(err, "AI_UNAVAILABLE", "narrative failed");
      }
      narrative = checkNarrative(out);
      if (!narrative) throw fatal("AR032", "narrative rejected (numbers or shape)");
    }
    if (signal.aborted) throw signal.reason;

    await stage(ctx, 50, "assemble");
    const html = assembleProposalHtml({ file, sheets, narrative });

    await stage(ctx, 70, "render");
    let out: { pdf: Uint8Array; pages: number };
    try {
      out = await renderWithTimeout(deps, html, signal);
    } catch (err) {
      if (signal.aborted && !(err instanceof JobError)) throw signal.reason;
      // 렌더러가 재시도 가능으로 표시해도 재시도하지 않는다(정본: 렌더 예외 재시도 불가 → 환불).
      if (err instanceof JobError && !err.retryable) throw err;
      throw new JobError("pdf render failed", { retryable: false, code: err instanceof JobError ? err.code : "pdf_render", cause: err });
    }
    if (signal.aborted) throw signal.reason;
    const head = new TextDecoder("latin1").decode(out.pdf.subarray(0, 5));
    if (head !== "%PDF-" || out.pdf.byteLength > PDF_MAX_BYTES || !Number.isSafeInteger(out.pages) || out.pages < 1 || out.pages > 200) {
      throw fatal("AR032", "pdf output invalid");
    }

    const pdfPath = `${job.org_id}/arch/pdf/${deps.randomUUID()}.pdf`;
    if (!new RegExp(`^${job.org_id}/arch/pdf/${UUID_PART}\\.pdf$`).test(pdfPath)) throw fatal("bad_output_path", "output path invalid");
    try {
      await deps.storage.uploadPdf("exports", pdfPath, out.pdf);
    } catch (err) {
      throw new JobError("pdf upload failed", { retryable: true, code: "storage", cause: err });
    }
    const result = {
      pdf_path: pdfPath,
      pages: out.pages,
      bytes: out.pdf.byteLength,
      sheets_included: sheets.length,
      narrative: narrative ? { model: narrative.model, ai_label: true } : null,
      content_sha256: p.contentSha256,
    };
    return { runResult: result, jobResult: { run_id: p.runId, pdf_path: pdfPath } };
  };
}
