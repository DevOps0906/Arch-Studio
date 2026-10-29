// 표제란 미리보기(03장 3.14절 "[표제란 미리보기 A3]"): 도면 엔진 워커 `sheet` 레인(build_sheet)에 고정 견본 대지 + 편집 중인
// 프로필을 보내 실제 엔진 SVG(svg_preview = writeSvg(buildSheet(...)), 내보내는 SVG와 같은 바이트)를 받는다.
// features는 @arch-studio/drafting을 import할 수 없어(package.json 범위 밖) 직접 호출 대신 useEngine 경로를 쓴다.
// 고정 고지·체험판 워터마크는 엔진 표제란(buildTitleBlock)이 넣는다 — 화면이 그리거나 지울 수 없다.
// 견본은 packages/drafting/golden/site_plan-basic 입력과 같은 대지·매스·판정(preview.test.ts가 엔진 출력과 바이트 비교).
import type { DesignModelV1, DraftingProfile, JudgmentResult, SheetSpec } from "@arch-studio/domain";

const BASIS = [{ law: "건축법", article: "제55조", effective_from: "2026-01-01", ordinance: false }];

export const PREVIEW_MODEL: DesignModelV1 = {
  schema_version: 1,
  units: "mm",
  meta: { created_by_engine_version: "0.0.0" },
  site: {
    parcel: { pnu: "1100000000000000000" },
    boundary: {
      outer: [
        [0, 0],
        [30000, 0],
        [30000, 20000],
        [0, 20000],
      ],
    },
    roads: [{ edge_index: 0, width_mm: 6000 }],
    zoning: { use_district: "제2종일반주거지역", districts: [] },
    north_angle_deg: 0,
  },
  rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-11-01", municipality_code: "11000", ordinance_applied: true },
  masses: [
    {
      id: "m000",
      footprint: {
        outer: [
          [5000, 8000],
          [20000, 8000],
          [20000, 16000],
          [5000, 16000],
        ],
      },
      base_level_mm: 0,
      floors: [{ id: "m000-f1", level: 1, height_mm: 3000, use: "단독주택" }],
      roof: { type: "flat" },
    },
  ],
  floor_layouts: [{ floor_id: "m000-f1", rooms: [], openings: [] }],
  program: { targets: [], checklist_answers: {}, user_locked_rows: [] },
} as unknown as DesignModelV1;

export const PREVIEW_JUDGMENT: JudgmentResult = {
  rule_pack_version: "2026.10.0",
  engine_version: "0.0.0",
  application_date: "2026-11-01",
  pending_changes: 0,
  items: [
    { key: "coverage", verdict: "PASS", value: 48.5, limit: 60, unit: "pct", basis: BASIS },
    { key: "far", verdict: "PASS", value: 142.37, limit: 200, unit: "pct", basis: BASIS },
    { key: "setback", verdict: "PASS", value: 3000, limit: 1000, unit: "mm", basis: BASIS },
    { key: "parking", verdict: "PASS", value: 6, unit: "count", basis: BASIS },
  ],
} as unknown as JudgmentResult;

export const PREVIEW_PROJECT_NAME = "표제란 미리보기";
export const PREVIEW_ENGINE_VERSION = "preview";

/** 04_API 2.3절 DraftingInput 구조(정본 타입은 packages/drafting, 여기서는 domain 타입으로 같은 모양만). */
export interface PreviewDraftingInput {
  model: DesignModelV1;
  judgment: JudgmentResult;
  sheet: SheetSpec;
  profile: DraftingProfile;
  license: { drafting_watermark: boolean };
  engine_version: string;
  project_name: string;
  date: string;
}

/** 결정적: 같은 프로필·워터마크·날짜 → 같은 입력(→ 같은 SVG 바이트). date는 YYYY-MM-DD(엔진은 시각을 읽지 않는다). */
export function previewInput(profile: DraftingProfile, watermark: boolean, date: string): PreviewDraftingInput {
  return {
    model: PREVIEW_MODEL,
    judgment: PREVIEW_JUDGMENT,
    sheet: {
      id: "preview",
      kind: "site_plan",
      paper: profile.default_paper,
      orientation: "landscape",
      scale: "auto",
      annotation_overrides: [],
      include_in_proposal: false,
    },
    profile,
    license: { drafting_watermark: watermark },
    engine_version: PREVIEW_ENGINE_VERSION,
    project_name: PREVIEW_PROJECT_NAME,
    date,
  };
}

export interface BuildSheetRequest {
  op: "build_sheet";
  req_id: string;
  lane: "sheet";
  seq: number;
  input: PreviewDraftingInput;
}

export function buildSheetRequest(reqId: string, seq: number, input: PreviewDraftingInput): BuildSheetRequest {
  return { op: "build_sheet", req_id: reqId, lane: "sheet", seq, input };
}

export type PreviewOutcome =
  | { kind: "ok"; svg: string }
  | { kind: "error"; code: string }
  | { kind: "superseded" }
  | { kind: "ignore" };

/** 엔진 응답 해석(apps/desktop/src/workers/protocol.ts EngineResponse). 내 req_id가 아니면 ignore. */
export function readPreviewResponse(res: unknown, reqId: string): PreviewOutcome {
  if (res === null || typeof res !== "object") return { kind: "ignore" };
  const r = res as Record<string, unknown>;
  if (r.req_id !== reqId) return { kind: "ignore" };
  if (r.status === "superseded" || r.status === "canceled") return { kind: "superseded" };
  if (r.status === "progress") return { kind: "ignore" };
  if (r.ok === true) {
    const svg = (r.result as { svg_preview?: unknown } | null)?.svg_preview;
    return typeof svg === "string" && svg.startsWith("<svg") ? { kind: "ok", svg } : { kind: "error", code: "invalid_response" };
  }
  if (r.ok === false) return { kind: "error", code: typeof r.code === "string" ? r.code : "AR050" };
  return { kind: "ignore" };
}

/** 오늘 날짜(로컬) YYYY-MM-DD — 화면이 엔진에 넘기는 표제란 작성일. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
