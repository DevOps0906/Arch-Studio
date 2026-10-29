// sheet/validate — 파이프라인 1단계(02_ARCHITECTURE.md 2.3절). 형식(zod)·위상·판정 상태를 검사해
// 실패면 AR050과 원인 목록, 저장된 시트의 엔진 버전이 다르면 AR059 안내를 돌려준다(예외 아님).
import {
  designModelV1Schema,
  draftingProfileSchema,
  judgmentResultSchema,
  sheetSpecSchema,
  type Polygon,
} from "@arch-studio/domain";
import { roundHalfAway, validatePolygon } from "@arch-studio/geometry";
import type { DraftingInput, LicenseFlags } from "./types.ts";

export interface ValidateOptions {
  /** 이미 저장된 시트의 engine_version. 입력 engine_version과 다르면 AR059 안내. */
  saved_engine_version?: string;
}

export type ValidateResult =
  | { ok: true; input: DraftingInput; notices: Array<{ code: "AR059"; detail: string }> }
  | { ok: false; code: "AR050"; issues: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function zodIssues(prefix: string, error: { issues: Array<{ path: Array<string | number>; message: string }> }): string[] {
  return error.issues.map((i) => `${prefix}${i.path.length ? "." + i.path.join(".") : ""}: ${i.message}`);
}

function polygonIssue(where: string, p: Polygon, issues: string[]): void {
  const err = validatePolygon(p);
  if (err !== null) issues.push(`${where}: ${err}`);
}

export function validateDraftingInput(raw: unknown, options: ValidateOptions = {}): ValidateResult {
  const issues: string[] = [];
  if (raw === null || typeof raw !== "object") return { ok: false, code: "AR050", issues: ["입력이 객체가 아닙니다"] };
  const r = raw as Record<string, unknown>;

  const model = designModelV1Schema.safeParse(r.model);
  const judgment = judgmentResultSchema.safeParse(r.judgment);
  const sheet = sheetSpecSchema.safeParse(r.sheet);
  const profile = draftingProfileSchema.safeParse(r.profile);
  if (!model.success) issues.push(...zodIssues("model", model.error));
  if (!judgment.success) issues.push(...zodIssues("judgment", judgment.error));
  if (!sheet.success) issues.push(...zodIssues("sheet", sheet.error));
  if (!profile.success) issues.push(...zodIssues("profile", profile.error));
  else if (!(roundHalfAway(profile.data.default_text_height_mm * 100) > 0)) {
    issues.push("profile.default_text_height_mm: 0.01mm 반올림이 0입니다(문자 높이 0 불가)");
  }

  const lic = r.license as Record<string, unknown> | null | undefined;
  if (lic === null || typeof lic !== "object" || typeof lic.drafting_watermark !== "boolean") {
    issues.push("license.drafting_watermark: boolean이 필요합니다");
  } else if (
    lic.fallback_revisions !== undefined &&
    !(typeof lic.fallback_revisions === "number" && Number.isSafeInteger(lic.fallback_revisions) && lic.fallback_revisions >= 0)
  ) {
    issues.push("license.fallback_revisions: 0 이상 정수여야 합니다");
  }
  if (typeof r.engine_version !== "string" || r.engine_version === "") issues.push("engine_version: 문자열이 필요합니다");
  if (typeof r.project_name !== "string") issues.push("project_name: 문자열이 필요합니다");
  if (typeof r.date !== "string" || !DATE.test(r.date)) issues.push("date: YYYY-MM-DD 문자열이 필요합니다");

  if (model.success) {
    const m = model.data;
    polygonIssue("model.site.boundary", m.site.boundary, issues);
    m.masses.forEach((mass) => polygonIssue(`model.masses[${mass.id}].footprint`, mass.footprint, issues));
    if (!m.masses.some((mass) => mass.floors.length > 0)) issues.push("model.masses: 층이 없습니다");
    for (const layout of m.floor_layouts) {
      for (const room of layout.rooms) polygonIssue(`model.floor_layouts[${layout.floor_id}].rooms[${room.id}]`, room.polygon, issues);
    }
    if (sheet.success) {
      const s = sheet.data;
      if (s.kind === "floor_plan") {
        if (s.floor_id === undefined) issues.push("sheet.floor_id: 평면 개략도는 층이 필요합니다");
        else if (!m.floor_layouts.some((l) => l.floor_id === s.floor_id)) issues.push(`sheet.floor_id: 실 배치가 없는 층입니다(${s.floor_id})`);
      }
      if (s.floor_id !== undefined && !m.masses.some((mass) => mass.floors.some((f) => f.id === s.floor_id))) {
        issues.push(`sheet.floor_id: 모델에 없는 층입니다(${s.floor_id})`);
      }
    }
    if (judgment.success) {
      if (judgment.data.items.length === 0) issues.push("judgment: 판정이 끝나지 않았습니다");
      if (judgment.data.rule_pack_version !== m.rule_context.rule_pack_version) {
        issues.push("judgment.rule_pack_version: 모델의 규칙 팩과 다릅니다(판정 다시 실행 필요)");
      }
    }
  }

  if (issues.length > 0 || !model.success || !judgment.success || !sheet.success || !profile.success) {
    return { ok: false, code: "AR050", issues };
  }
  const license: LicenseFlags = { drafting_watermark: (lic as { drafting_watermark: boolean }).drafting_watermark };
  const fb = (lic as { fallback_revisions?: number }).fallback_revisions;
  if (fb !== undefined) license.fallback_revisions = fb;
  const input: DraftingInput = {
    model: model.data,
    judgment: judgment.data,
    sheet: sheet.data,
    profile: profile.data,
    license,
    engine_version: r.engine_version as string,
    project_name: r.project_name as string,
    date: r.date as string,
  };
  const notices: Array<{ code: "AR059"; detail: string }> = [];
  if (options.saved_engine_version !== undefined && options.saved_engine_version !== input.engine_version) {
    notices.push({
      code: "AR059",
      detail: `저장된 시트 엔진 ${options.saved_engine_version} → 현재 ${input.engine_version}. 현재 엔진으로 다시 생성합니다`,
    });
  }
  return { ok: true, input, notices };
}
