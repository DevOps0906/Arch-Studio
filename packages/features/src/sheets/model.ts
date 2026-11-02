// 도면 시트 화면 모델(03장 3.8절, 5.3절 AR050~AR059). 순수 함수만: 시트 목록·설정, 입력 누락, 권리→화면 상태, 엔진 요청·응답 해석.
// 기하·도면·판정 값은 만들지 않는다(워커의 결정적 순수 함수가 만든다). 이 파일은 요청 봉투를 짜고 응답을 해석할 뿐이다.
import { designModelV1Schema, migrateLegacySheetSpec, normalizeSheetSpec, sheetSpecSchema, type DesignModelV1, type DraftingProfile, type JudgmentResult, type SheetSpec } from "@arch-studio/domain";
import type { EntitlementDecision, EntitlementStatus } from "@arch-studio/shell-bridge";
import { DENY_TEXT } from "../shell/nav.ts";

/* ---------- 시트 종류·설정 값 ---------- */

export type SheetKind = SheetSpec["kind"];
export type Paper = SheetSpec["paper"];
export type ScaleChoice = SheetSpec["scale"];

/** 화면에서 만들 수 있는 종류(입면 elevation은 Phase 2). */
export const UI_KINDS: readonly SheetKind[] = ["site_plan", "area_plan", "sunlight_section", "floor_plan"];

export const KIND_LABEL: Readonly<Record<SheetKind, string>> = {
  site_plan: "배치도",
  area_plan: "면적 산정도",
  sunlight_section: "일조사선 단면",
  floor_plan: "평면 개략도",
  elevation: "입면 개략도",
};

export const PAPERS: readonly Paper[] = ["A3", "A2", "A1"];
export const PAPER_LABEL: Readonly<Record<Paper, string>> = { A3: "A3", A2: "A2", A1: "A1" };
export const ORIENTATION_LABEL = { landscape: "가로", portrait: "세로" } as const;
export const SCALE_CHOICES: readonly ScaleChoice[] = ["auto", 100, 200, 300, 500, 600];

export function scaleLabel(s: ScaleChoice): string {
  return s === "auto" ? "자동" : `1/${s}`;
}

/** AR058: 용지를 한 단계 키우자는 제안(A3 → A2 → A1). 더 키울 수 없으면 null. */
export function nextPaper(p: Paper): Paper | null {
  const i = PAPERS.indexOf(p);
  return i >= 0 && i < PAPERS.length - 1 ? (PAPERS[i + 1] as Paper) : null;
}

/* ---------- 모델 읽기·입력 누락(AR050) ---------- */

export type ModelParse = { ok: true; model: DesignModelV1 } | { ok: false };

/** 프로젝트 레코드의 JSON 원문 → 설계 모델(zod). 손상·미지원 형식은 ok:false. */
export function parseModel(raw: string): ModelParse {
  try {
    const r = designModelV1Schema.safeParse(JSON.parse(raw));
    return r.success ? { ok: true, model: r.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface MissingInput {
  readonly id: "site" | "mass" | "floor" | "layout";
  readonly label: string;
  /** 이동할 프로젝트 탭 세그먼트. */
  readonly to: "site" | "model" | "plans";
}

/** 층 하나가 실 배치(rooms)를 가진 층 목록. 평면 개략도의 층 선택지. */
export function layoutFloors(model: DesignModelV1): Array<{ id: string; label: string }> {
  const levels = new Map<string, number>();
  for (const m of model.masses) for (const f of m.floors) levels.set(f.id, f.level);
  return model.floor_layouts
    .filter((l) => l.rooms.length > 0 && levels.has(l.floor_id))
    .map((l) => ({ id: l.floor_id, level: levels.get(l.floor_id) as number }))
    .sort((a, b) => a.level - b.level)
    .map((f) => ({ id: f.id, label: f.level > 0 ? `${f.level}F` : `B${Math.abs(f.level)}F` }));
}

/** 종류별 빠진 입력(AR050 "대지 경계 / 매스 / 층 정보"). 비어 있으면 만들 수 있다. */
export function missingInputs(model: DesignModelV1, kind: SheetKind): MissingInput[] {
  const out: MissingInput[] = [];
  if (kind === "elevation") return out;
  if (model.site.boundary.outer.length < 3) out.push({ id: "site", label: "대지 경계", to: "site" });
  if (model.masses.length === 0) out.push({ id: "mass", label: "매스", to: "model" });
  else if (!model.masses.some((m) => m.floors.length > 0)) out.push({ id: "floor", label: "층 정보", to: "model" });
  if (kind === "floor_plan" && layoutFloors(model).length === 0) out.push({ id: "layout", label: "층별 실 배치", to: "plans" });
  return out;
}

/** 지금 이 앱이 만들 수 있는 종류인가. 일조사선 단면은 엔벨로프 솔리드 입력이 워커에 연결되기 전이라 만들 수 없다. */
export function kindSupport(kind: SheetKind): { ok: true } | { ok: false; reason: string } {
  if (kind === "sunlight_section") return { ok: false, reason: "법규 엔벨로프 계산을 도면 엔진에 연결하는 작업이 끝나면 쓸 수 있습니다." };
  if (kind === "elevation") return { ok: false, reason: "입면 개략도는 다음 단계(Phase 2)에서 제공합니다." };
  return { ok: true };
}

/* ---------- 시트 목록(로컬 저장) ---------- */

export const MAX_SHEETS = 20;
const STORE_MAX_RAW = 262_144;

export interface StoredSheets {
  /** 이 목록을 마지막으로 확인한 엔진 버전. 지금 엔진과 다르면 AR059. 아직 모르면 null. */
  readonly engine_version: string | null;
  readonly specs: readonly SheetSpec[];
}

export const EMPTY_STORED: StoredSheets = Object.freeze({ engine_version: null, specs: [] });

export function storeKey(projectId: string): string {
  return `arch.sheets.v2.${projectId}`;
}

/** v1(annotation_overrides) 저장 키. 읽기만 한다 — 덮어쓰기·삭제 없음(AR-06-086 결정 4). */
export function legacyStoreKey(projectId: string): string {
  return `arch.sheets.v1.${projectId}`;
}

/** 저장 문자열 → 목록. 깨진 JSON·추가 키·스키마 위반·20장 초과·중복 id는 통째로 버린다(신뢰하지 않는다). */
export function parseStored(raw: string | null): StoredSheets {
  if (!raw || raw.length > STORE_MAX_RAW) return EMPTY_STORED;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_STORED;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return EMPTY_STORED;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "engine_version,specs" || !Array.isArray(o.specs) || o.specs.length > MAX_SHEETS) return EMPTY_STORED;
  if (o.engine_version !== null && (typeof o.engine_version !== "string" || o.engine_version === "" || o.engine_version.length > 64)) return EMPTY_STORED;
  const specs: SheetSpec[] = [];
  const ids = new Set<string>();
  for (const s of o.specs) {
    const r = sheetSpecSchema.safeParse(s);
    if (!r.success || ids.has(r.data.id) || r.data.id.length > 64) return EMPTY_STORED;
    ids.add(r.data.id);
    specs.push(r.data);
  }
  return { engine_version: o.engine_version as string | null, specs };
}

/**
 * v1 저장 문자열 → 목록(v2 모양으로 이행). 겉 구조(키·20장 초과·engine_version)가 깨지면 통째로 버리지만,
 * 시트 하나가 깨졌거나 id가 겹치면 그 시트만 건너뛰고 나머지는 유지한다(깨진 원본은 v1 키에 그대로 남는다).
 */
export function parseStoredLegacy(raw: string | null): StoredSheets {
  if (!raw || raw.length > STORE_MAX_RAW) return EMPTY_STORED;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_STORED;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return EMPTY_STORED;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "engine_version,specs" || !Array.isArray(o.specs) || o.specs.length > MAX_SHEETS) return EMPTY_STORED;
  if (o.engine_version !== null && (typeof o.engine_version !== "string" || o.engine_version === "" || o.engine_version.length > 64)) return EMPTY_STORED;
  const specs: SheetSpec[] = [];
  const ids = new Set<string>();
  for (const s of o.specs) {
    const r = migrateLegacySheetSpec(s);
    if (r === null || ids.has(r.id) || r.id.length > 64) continue;
    ids.add(r.id);
    specs.push(r);
  }
  return { engine_version: o.engine_version as string | null, specs };
}

/** 프로젝트의 시트 목록 읽기: v2가 있으면 그것만, 없으면 v1을 이행해 읽는다. 저장소 오류는 빈 목록. 화면·대시보드가 같은 함수를 쓴다. */
export function readStoredSheets(storage: { getItem(key: string): string | null } | null | undefined, projectId: string): StoredSheets {
  try {
    if (!storage) return EMPTY_STORED;
    const v2 = storage.getItem(storeKey(projectId));
    if (v2 !== null) return parseStored(v2);
    return parseStoredLegacy(storage.getItem(legacyStoreKey(projectId)));
  } catch {
    return EMPTY_STORED;
  }
}

export function serializeStored(s: StoredSheets): string {
  return JSON.stringify({ engine_version: s.engine_version, specs: s.specs.map(normalizeSheetSpec) });
}

/** 새 시트 설정. id는 종류 + 가장 작은 빈 번호(난수·시각 없음). */
export function newSpec(kind: SheetKind, existing: readonly SheetSpec[], model: DesignModelV1, defaultPaper: Paper): SheetSpec {
  let n = 1;
  const ids = new Set(existing.map((s) => s.id));
  while (ids.has(`${kind}-${n}`)) n++;
  const spec: SheetSpec = {
    id: `${kind}-${n}`,
    kind,
    paper: defaultPaper,
    orientation: "landscape",
    scale: "auto",
    include_in_proposal: true,
  };
  if (kind === "floor_plan") {
    const f = layoutFloors(model)[0];
    if (f) spec.floor_id = f.id;
  }
  return spec;
}

/** 시트 표시 이름: 종류 + (같은 종류가 여럿이면 번호) + (평면이면 층). */
export function sheetName(spec: SheetSpec, all: readonly SheetSpec[], model: DesignModelV1 | null): string {
  const same = all.filter((s) => s.kind === spec.kind);
  const idx = same.findIndex((s) => s.id === spec.id);
  let name = KIND_LABEL[spec.kind];
  if (spec.kind === "floor_plan" && model && spec.floor_id) {
    const f = layoutFloors(model).find((x) => x.id === spec.floor_id);
    if (f) name = `${f.label} 평면`;
  }
  return same.length > 1 && idx >= 0 ? `${name} ${idx + 1}` : name;
}

/* ---------- 권리 → 화면 상태(PRD 4.3·9.4, 03장 3.8·5.1절) ---------- */

export interface SheetAccess {
  /** 시트 추가·삭제·설정 변경(편집 권리). */
  readonly edit: boolean;
  /** 편집 판정 중. */
  readonly editPending: boolean;
  /** 편집이 막힌 이유(권리 거부 상태 문구). 편집 가능하면 null. */
  readonly editReason: string | null;
  /** 내보내기(view_export): 모든 상태에서 허용돼야 한다. 판정 실패·거부는 막고 이유를 보인다(실패 닫힘). */
  readonly exportState: "allowed" | "pending" | "denied";
  readonly exportReason: string | null;
  /** 출력 표제란에 "체험판"을 넣는가. 판정할 수 없으면 넣는다(PRD: 키가 없을 때 true). 화면에서 끌 수 없다. */
  readonly watermark: boolean;
  /** 편집이 끝났지만(체험·구독 만료) 열람·내보내기만 되는 상태 → 마지막으로 만든 시트 다시 내보내기만. */
  readonly viewOnly: boolean;
}

const EXPIRED_EDIT_TEXT = "체험이 끝나 열람과 내보내기만 됩니다. 마지막으로 만든 시트는 다시 내보낼 수 있고, 표제란의 체험판 표시는 그대로 남습니다. 라이선스나 구독으로 편집을 이어 가세요.";

export function sheetAccess(
  edit: EntitlementDecision | undefined,
  exp: EntitlementDecision | undefined,
  status: EntitlementStatus | undefined,
  planCode: string | null,
): SheetAccess {
  const paid = status !== undefined && (status.state === "active" || status.state === "grace") && planCode !== "trial";
  const watermark = !paid;
  const editAllowed = edit?.allowed === true;
  const editReason = !edit
    ? null
    : edit.allowed
      ? null
      : edit.reason === "expired"
        ? EXPIRED_EDIT_TEXT
        : `${DENY_TEXT[edit.reason] ?? DENY_TEXT.unverified}. 열람과 내보내기는 그대로 됩니다.`;
  const exportState = !exp ? "pending" : exp.allowed ? "allowed" : "denied";
  const exportReason = exp && !exp.allowed ? `${DENY_TEXT[exp.reason] ?? DENY_TEXT.unverified}. 내보내기 권한을 확인하지 못했습니다.` : null;
  return { edit: editAllowed, editPending: edit === undefined, editReason, exportState, exportReason, watermark, viewOnly: edit !== undefined && !edit.allowed };
}

/* ---------- 문구(5.3절) ---------- */

export type OutputFormat = "dxf" | "pdf" | "svg" | "png";
export const FORMAT_ORDER: readonly OutputFormat[] = ["dxf", "pdf", "svg", "png"];
export const FORMAT_LABEL: Readonly<Record<OutputFormat, string>> = {
  dxf: "DXF(AutoCAD 2013 형식)",
  pdf: "PDF(시트 묶음 1파일)",
  svg: "SVG",
  png: "PNG(미리보기)",
};

const OTHERS = { dxf: "SVG·PDF", pdf: "DXF·SVG", svg: "DXF·PDF", png: "DXF·SVG" } as const;

/** 엔진·어댑터 오류 코드 → 화면 문구. 입력 값·경로는 넣지 않는다. */
export function outputErrorText(code: string, format?: OutputFormat): string {
  switch (code) {
    case "AR050":
      return "모델에 빠진 정보가 있어 시트를 만들 수 없습니다.";
    case "AR051":
      return "실이 다른 실과 겹치거나 층 외곽 밖에 있습니다. 평면 화면에서 고친 뒤 다시 만드세요.";
    case "AR052":
      return "파일을 저장하지 못했습니다. 디스크 공간과 폴더 쓰기 권한을 확인하세요.";
    case "AR055":
      return "파일이 너무 커서 만들 수 없습니다. 시트 수나 용지를 줄여 다시 시도하세요.";
    case "AR056":
      return format === "png"
        ? "PNG를 만들지 못했습니다. DXF·SVG는 따로 내보낼 수 있습니다."
        : format === "pdf"
          ? "PDF를 만들지 못했습니다. DXF·SVG는 따로 내보낼 수 있습니다."
          : `파일을 만들지 못했습니다. ${format ? OTHERS[format] : "다른 형식"}은 따로 내보낼 수 있습니다.`;
    case "BUSY":
      return "다른 PNG 변환이 끝나지 않았습니다. 잠시 뒤 다시 시도하세요.";
    case "NOT_SUPPORTED":
      return "이 환경에서는 PNG 변환을 쓸 수 없습니다.";
    case "CANCELLED":
      return "저장을 취소했습니다.";
    case "ENGINE_UNAVAILABLE":
      return "도면 엔진을 시작하지 못했습니다. 앱을 다시 열어 주세요.";
    case "TIMEOUT":
      return "도면 엔진이 시간 안에 응답하지 않았습니다. 다시 시도하세요.";
    default:
      return "도면을 만들지 못했습니다. 다시 시도하세요.";
  }
}

/** AR057(글꼴 대체·없는 글자) 안내 문구. detail의 글자 목록은 엔진이 만든 값이라 그대로 보이지 않고 고정 문구만 쓴다. */
export const AR057_TEXT = "선택한 글꼴에 없는 글자는 비어 보일 수 있습니다. CAD에서 한글이 깨지면 같은 이름의 글꼴을 설치하세요.";

/** AR058 문구. 용지를 키울 수 있으면 제안한다. */
export function ar058Text(paper: Paper): string {
  const next = nextPaper(paper);
  return next ? `${paper}에 1/600으로도 들어가지 않습니다. 더 큰 용지(${next})를 고르세요.` : `${paper}에 1/600으로도 들어가지 않습니다. 대지나 매스 범위를 확인하세요.`;
}

export const AR059_TEXT = "이전 엔진으로 만든 시트입니다. 다시 만들면 현재 엔진 기준으로 바뀝니다. 주석 위치는 유지합니다.";

/** 도면 엔진은 법규 판정이 끝나야 시트를 만든다(validateDraftingInput: 판정 항목 없음 = AR050). 판정이 없거나 실패했을 때의 안내. */
export const JUDGMENT_REQUIRED_TEXT = "법규 판정이 끝나야 시트를 만들 수 있습니다. 규칙 팩이 없거나 판정에 실패한 상태입니다. 모델·판정 화면에서 판정 결과를 확인하세요.";

/* ---------- 엔진 요청·응답 ---------- */

/** 04_API 2.3절 DraftingInput 모양(정본 타입은 packages/drafting, 여기서는 domain 타입으로 같은 모양만). */
export interface SheetInput {
  model: DesignModelV1;
  judgment: JudgmentResult;
  sheet: SheetSpec;
  profile: DraftingProfile;
  license: { drafting_watermark: boolean; fallback_revisions?: number };
  engine_version: string;
  project_name: string;
  date: string;
}

export function buildSheetEnvelope(reqId: string, seq: number, input: SheetInput) {
  return { op: "build_sheet" as const, req_id: reqId, lane: "sheet" as const, seq, input };
}

/** 워커가 돌려주는 시트 모델 중 화면이 읽는 칸(나머지는 불투명 — 내보내기 때 그대로 되돌려 보낸다). */
export interface SheetSummary {
  readonly sheet_id: string;
  readonly kind: SheetKind;
  readonly scale: number;
  readonly paper: { readonly size: Paper; readonly orientation: "landscape" | "portrait"; readonly w: number; readonly h: number };
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly detail: string }>;
  readonly title_block: {
    readonly office_name: string;
    readonly project_name: string;
    readonly sheet_title: string;
    readonly scale_label: string;
    readonly date: string;
    readonly rule_pack_version: string;
    readonly pending_changes?: number;
    readonly disclaimer: string;
    readonly watermark: boolean;
  };
}

export interface BuiltSheet {
  /** 화면용 요약. */
  readonly summary: SheetSummary;
  /** 워커가 돌려준 시트 모델 원본(내보내기 요청에 그대로 실린다). */
  readonly sheet: unknown;
  readonly svg: string;
  readonly engineVersion: string;
  /** 앵커를 잃어 출력에서 빠진 사람 주석 수(워커 unapplied_overrides 의 orphan_anchor). */
  readonly orphanCount: number;
}

export type BuildOutcome =
  | { kind: "ok"; built: BuiltSheet }
  | { kind: "error"; code: string }
  | { kind: "superseded" }
  | { kind: "ignore" };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export function asSummary(v: unknown): SheetSummary | null {
  if (!isRec(v) || !isStr(v.sheet_id) || !isStr(v.kind) || typeof v.scale !== "number" || !Array.isArray(v.warnings)) return null;
  const p = v.paper;
  const t = v.title_block;
  if (!isRec(p) || !isStr(p.size) || !isStr(p.orientation) || typeof p.w !== "number" || typeof p.h !== "number") return null;
  if (!isRec(t) || !isStr(t.office_name) || !isStr(t.project_name) || !isStr(t.sheet_title) || !isStr(t.scale_label) || !isStr(t.date) || !isStr(t.rule_pack_version) || !isStr(t.disclaimer) || typeof t.watermark !== "boolean") return null;
  if (!(v.warnings as unknown[]).every((w) => isRec(w) && isStr(w.code) && isStr(w.detail))) return null;
  return v as unknown as SheetSummary;
}

/** build_sheet 응답 해석. 내 req_id가 아니면 ignore. */
export function readBuildResponse(res: unknown, reqId: string): BuildOutcome {
  if (!isRec(res) || res.req_id !== reqId) return { kind: "ignore" };
  if (res.status === "superseded" || res.status === "canceled") return { kind: "superseded" };
  if (res.status === "progress") return { kind: "ignore" };
  if (res.ok === true) {
    const r = isRec(res.result) ? res.result : null;
    const summary = r ? asSummary(r.sheet) : null;
    const svg = r?.svg_preview;
    if (!r || !summary || !isStr(svg) || !svg.startsWith("<svg") || !isStr(res.engine_version)) return { kind: "error", code: "invalid_response" };
    const un = Array.isArray(r.unapplied_overrides) ? (r.unapplied_overrides as unknown[]) : [];
    const orphanCount = un.filter((u) => isRec(u) && u.reason === "orphan_anchor").length;
    return { kind: "ok", built: { summary, sheet: r.sheet, svg, engineVersion: res.engine_version, orphanCount } };
  }
  if (res.ok === false) return { kind: "error", code: isStr(res.code) ? res.code : "AR050" };
  return { kind: "ignore" };
}

export interface OutputFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly widthPx?: number;
}

export type WriteOutcome =
  | { kind: "ok"; files: OutputFile[]; warnings: Array<{ code: string; detail: string }> }
  | { kind: "error"; code: string }
  | { kind: "ignore" };

export function buildWriteEnvelope(args: {
  reqId: string;
  format: OutputFormat;
  sheets: readonly unknown[];
  layerMap: Readonly<Record<string, string>>;
  bundle: boolean;
  projectName: string;
  date: string;
}) {
  return {
    op: "write" as const,
    req_id: args.reqId,
    lane: "export" as const,
    format: args.format,
    sheets: args.sheets,
    layer_map: args.layerMap,
    bundle: args.bundle,
    project_name: args.projectName,
    date: args.date,
  };
}

/** write 응답 해석. 파일 이름에 경로 구분자가 있으면 형식 오류로 본다. */
export function readWriteResponse(res: unknown, reqId: string): WriteOutcome {
  if (!isRec(res) || res.req_id !== reqId) return { kind: "ignore" };
  if (res.status === "progress") return { kind: "ignore" };
  if (res.status === "superseded" || res.status === "canceled") return { kind: "error", code: "AR056" };
  if (res.ok === false) return { kind: "error", code: isStr(res.code) ? res.code : "AR056" };
  if (res.ok !== true || !isRec(res.result) || !Array.isArray(res.result.files)) return { kind: "error", code: "invalid_response" };
  const files: OutputFile[] = [];
  for (const f of res.result.files) {
    if (!isRec(f) || !isStr(f.name) || /[\\/]/.test(f.name) || !(f.bytes instanceof ArrayBuffer) || f.bytes.byteLength === 0) return { kind: "error", code: "invalid_response" };
    const widthPx = typeof f.width_px === "number" && Number.isSafeInteger(f.width_px) && f.width_px > 0 ? f.width_px : undefined;
    files.push({ name: f.name, bytes: new Uint8Array(f.bytes), ...(widthPx === undefined ? {} : { widthPx }) });
  }
  const warnings = Array.isArray(res.result.warnings) ? (res.result.warnings as unknown[]).filter((w): w is { code: string; detail: string } => isRec(w) && isStr(w.code) && isStr(w.detail)) : [];
  return { kind: "ok", files, warnings };
}

/** 선택한 형식·시트 수 → 만들 파일 수(PDF는 묶음 1파일). */
export function fileCount(formats: readonly OutputFormat[], sheetCount: number): number {
  return formats.reduce((n, f) => n + (f === "pdf" ? (sheetCount > 0 ? 1 : 0) : sheetCount), 0);
}

/** 오늘 날짜(로컬) YYYY-MM-DD — 표제란 작성일. 엔진은 시각을 읽지 않으므로 화면이 넘긴다. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
