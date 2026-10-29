// 도면 미리보기(03장 3.7절·6.2절): 엔진 워커 sheet 레인(build_sheet, kind "floor_plan")에 편집 중인 모델을 보내
// 내보내는 SVG와 같은 결과(drafting floor_plan 뷰)를 받는다. features는 @arch-studio/drafting을 import하지 않는다(settings/drafting/preview.ts와 같은 규칙).
// 표제란 고정 고지는 엔진이 넣는다. 사무소 프로필은 시트 화면에서 정하므로 여기서는 빈 기본값(미리보기 전용)이다.
import type { DesignModelV1, DraftingProfile, JudgmentResult, SheetSpec } from "@arch-studio/domain";

export const PLAN_PROFILE: DraftingProfile = Object.freeze({
  office_name: "",
  layer_map: {},
  default_paper: "A3",
  default_text_height_mm: 2.5,
  font_family: "Noto Sans KR",
}) as DraftingProfile;

/**
 * 판정 엔진을 쓸 수 없을 때(규칙 팩 없음 등)의 미리보기 전용 판정: 평면 뷰는 판정 값을 그리지 않지만 시트 입력 검사(validate)는
 * 판정 항목이 있어야 하므로 "산정 없음(NA)" 한 줄만 넣는다. 법규 결과처럼 보이지 않게 근거(basis)는 비운다. 시트 화면(AR-06-030)은 실제 판정을 쓴다.
 */
export function placeholderJudgment(model: DesignModelV1): JudgmentResult {
  return {
    engine_version: "preview",
    rule_pack_version: model.rule_context.rule_pack_version,
    application_date: model.rule_context.application_date,
    items: [{ key: "coverage", verdict: "NA", unit: "pct", basis: [] }],
    pending_changes: 0,
  };
}

export interface PlanDraftingInput {
  model: DesignModelV1;
  judgment: JudgmentResult;
  sheet: SheetSpec;
  profile: DraftingProfile;
  license: { drafting_watermark: boolean };
  engine_version: string;
  project_name: string;
  date: string;
}

/** 결정적: 같은 모델·판정·층·날짜 → 같은 입력(→ 같은 SVG 바이트). date = YYYY-MM-DD(엔진은 시각을 읽지 않는다). */
export function planSheetInput(model: DesignModelV1, judgment: JudgmentResult, floor_id: string, project_name: string, date: string): PlanDraftingInput {
  return {
    model,
    judgment,
    sheet: { id: "plan-preview", kind: "floor_plan", paper: "A3", orientation: "landscape", scale: "auto", floor_id, annotation_overrides: [], include_in_proposal: false },
    profile: PLAN_PROFILE,
    license: { drafting_watermark: false },
    engine_version: judgment.engine_version,
    project_name,
    date,
  };
}

export interface BuildSheetRequest {
  op: "build_sheet";
  req_id: string;
  lane: "sheet";
  seq: number;
  input: PlanDraftingInput;
}

export const buildSheetRequest = (reqId: string, seq: number, input: PlanDraftingInput): BuildSheetRequest => ({ op: "build_sheet", req_id: reqId, lane: "sheet", seq, input });

export type PreviewOutcome = { kind: "ok"; svg: string } | { kind: "error"; code: string } | { kind: "superseded" } | { kind: "ignore" };

/** 엔진 응답 해석. 내 req_id가 아니면 ignore. SVG는 문자열로만 받고 <img src=blob:>로만 그린다(스크립트 실행 경로 없음). */
export function readPreviewResponse(res: unknown, reqId: string): PreviewOutcome {
  if (res === null || typeof res !== "object") return { kind: "ignore" };
  const r = res as Record<string, unknown>;
  if (r.req_id !== reqId) return { kind: "ignore" };
  if (r.status === "superseded" || r.status === "canceled") return { kind: "superseded" };
  if (r.status === "progress") return { kind: "ignore" };
  if (r.ok === true) {
    const svg = (r.result as { svg_preview?: unknown } | null)?.svg_preview;
    return typeof svg === "string" && svg.startsWith("<svg") ? { kind: "ok", svg } : { kind: "error", code: "INVALID_RESPONSE" };
  }
  if (r.ok === false) return { kind: "error", code: typeof r.code === "string" ? r.code : "AR050" };
  return { kind: "ignore" };
}

export function previewErrorText(code: string): string {
  if (code === "AR051") return "실 배치 오류가 있어 도면을 만들 수 없습니다. 아래 오류를 먼저 고치세요.";
  if (code === "ENGINE_UNAVAILABLE") return "도면 엔진을 쓸 수 없습니다. 앱을 다시 열어 보세요.";
  return "도면 미리보기를 만들지 못했습니다. 잠시 뒤 다시 시도하세요.";
}

/** 오늘 날짜(로컬) YYYY-MM-DD — 화면이 엔진에 넘기는 표제란 작성일. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
