// 대지 화면 순수 로직(03장 3.4절). DesignModel.site ↔ 편집 초안, 정규화·면적·둘레, 조회 응답 → 후보, mm 입력 파싱.
// 기하(방향 정리·자기교차·면적)는 @arch-studio/geometry 결정적 함수만, m → mm 정수는 @arch-studio/domain mToMm(half-away)만 쓴다.
// React·DOM·shell-bridge를 쓰지 않는다(node --test 대상).
import { MM_COORD_LIMIT, designModelV1Schema, formatAreaM2, mToMm, type DesignModelV1, type Point, type Polygon } from "@arch-studio/domain";
import { GeometryError, area, normalizePolygon, roundHalfAway, type GeometryErrorCode } from "@arch-studio/geometry";

/** 국토의 계획 및 이용에 관한 법률 시행령 제30조 용도지역(21개, 세분 기준). 목록에 없는 값은 "기타"로 직접 입력. */
export const USE_DISTRICTS = [
  "제1종전용주거지역",
  "제2종전용주거지역",
  "제1종일반주거지역",
  "제2종일반주거지역",
  "제3종일반주거지역",
  "준주거지역",
  "중심상업지역",
  "일반상업지역",
  "근린상업지역",
  "유통상업지역",
  "전용공업지역",
  "일반공업지역",
  "준공업지역",
  "보전녹지지역",
  "생산녹지지역",
  "자연녹지지역",
  "보전관리지역",
  "생산관리지역",
  "계획관리지역",
  "농림지역",
  "자연환경보전지역",
] as const;

/** 대지 꼭짓점이 이보다 많으면 엔벨로프 계산이 느릴 수 있다는 경고(03장 2.2절 3단계). */
export const VERTEX_WARN = 200;
/** 도로 폭 상한(mm, 100m). */
export const ROAD_WIDTH_MAX_MM = 100_000;
/** 그리기 격자(mm). 캔버스 클릭은 이 격자에 맞춘다. */
export const DRAW_GRID_MM = 100;

/** 편집 초안. 좌표는 mm 정수, 꼭짓점 순서 그대로(정규화는 저장·면적 계산 때). */
export interface SiteDraft {
  outer: Point[];
  /** 변 번호(outer[i] → outer[i+1]) → 도로 폭 mm. */
  roads: Record<number, number>;
  north_angle_deg: number;
  use_district: string;
  districts: string[];
  parcel: { pnu?: string; address_label?: string };
  application_date: string;
  ordinance_applied: boolean;
  rule_pack_version: string;
}

export type ParsedModel = { ok: true; model: DesignModelV1 } | { ok: false };

/** ProjectRecord.designModel(JSON 원문) → 검증된 모델. 깨졌으면 ok:false(값은 돌려주지 않는다). */
export function parseDesignModel(json: string): ParsedModel {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  const r = designModelV1Schema.safeParse(raw);
  return r.success ? { ok: true, model: r.data } : { ok: false };
}

export function draftFromModel(model: DesignModelV1): SiteDraft {
  const roads: Record<number, number> = {};
  for (const r of model.site.roads) roads[r.edge_index] = r.width_mm;
  return {
    outer: model.site.boundary.outer.map((p) => [p[0], p[1]] as Point),
    roads,
    north_angle_deg: model.site.north_angle_deg,
    use_district: model.site.zoning.use_district,
    districts: [...model.site.zoning.districts],
    parcel: { ...model.site.parcel },
    application_date: model.rule_context.application_date,
    ordinance_applied: model.rule_context.ordinance_applied,
    rule_pack_version: model.rule_context.rule_pack_version,
  };
}

/** 대지가 "있다" = 경계가 geometry 검사를 통과한다(빈 상태 판정, 5.4절). */
export function hasSite(model: DesignModelV1): boolean {
  return outlineIssue(model.site.boundary.outer) === null;
}

const GEOMETRY_TEXT: Readonly<Record<GeometryErrorCode, string>> = {
  INVALID_COORDINATE: "좌표는 mm 정수여야 합니다.",
  OUT_OF_RANGE: "좌표가 원점에서 10km를 넘습니다.",
  TOO_FEW_POINTS: "꼭짓점이 3개 이상이어야 합니다.",
  DUPLICATE_POINT: "같은 자리에 꼭짓점이 겹쳐 있습니다.",
  ZERO_AREA: "면적이 0인 경계입니다.",
  SELF_INTERSECTION: "경계선이 서로 교차합니다. 꼭짓점 순서를 확인하세요.",
  HOLE_OUTSIDE: "구멍이 경계 밖에 있습니다.",
  INVALID_ARGUMENT: "경계 형식이 올바르지 않습니다.",
  NUMERIC_FAILURE: "경계를 계산하지 못했습니다.",
};

/** 경계 검사(geometry normalizePolygon). 통과하면 null, 아니면 한국어 이유. */
export function outlineIssue(outer: readonly Point[]): string | null {
  if (outer.length < 3) return GEOMETRY_TEXT.TOO_FEW_POINTS;
  try {
    normalizePolygon({ outer: outer as Point[] });
    return null;
  } catch (e) {
    return e instanceof GeometryError ? GEOMETRY_TEXT[e.code] : GEOMETRY_TEXT.INVALID_ARGUMENT;
  }
}

/**
 * 경계 정규화(외곽 반시계). 방향을 뒤집으면 꼭짓점이 [p0, p(n-1), …, p1]이 되므로 변 번호 대응표를 같이 돌려준다:
 * 원래 변 i(p_i → p_{i+1})는 뒤집은 뒤 변 n-1-i.
 */
export function normalizeOutline(outer: readonly Point[]): { outer: Point[]; edgeOf: (i: number) => number } {
  const n = normalizePolygon({ outer: outer as Point[] }).outer;
  const reversed = n.length > 2 && outer.length === n.length && (n[1]?.[0] !== outer[1]?.[0] || n[1]?.[1] !== outer[1]?.[1]);
  const len = outer.length;
  return { outer: n, edgeOf: reversed ? (i) => len - 1 - i : (i) => i };
}

export interface SiteMetrics {
  area_mm2: number;
  area_m2_text: string;
  perimeter_mm: number;
  vertex_count: number;
}

/** 면적(geometry area, mm² 정수)·둘레(변 길이 합, half-away 정수)·꼭짓점 수. 경계가 무효면 null. */
export function siteMetrics(outer: readonly Point[]): SiteMetrics | null {
  if (outlineIssue(outer) !== null) return null;
  const a = area({ outer: outer as Point[] });
  let per = 0;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i] as Point;
    const q = outer[(i + 1) % outer.length] as Point;
    per += Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
  }
  return { area_mm2: a, area_m2_text: formatAreaM2(a), perimeter_mm: roundHalfAway(per), vertex_count: outer.length };
}

/** mm 정수를 "12,345" 형식으로(로캘 비의존). */
export function formatMm(mm: number): string {
  const s = String(Math.abs(mm)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return mm < 0 ? `-${s}` : s;
}

/** mm 길이를 m 표시("12.35"): 0.01m 반올림. */
export function formatM(mm: number): string {
  const cm = roundHalfAway(mm / 10);
  const abs = Math.abs(cm);
  return `${cm < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * 사용자 mm 입력 → 정수 mm. 천 단위 쉼표·공백 허용, 소수는 half-away 반올림(geometry roundHalfAway).
 * 숫자가 아니거나 |값| > 10km면 null. `allowNegative=false`면 음수도 null.
 */
export function parseMmInput(text: string, allowNegative = true): number | null {
  const s = text.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = roundHalfAway(Number(s));
  if (!Number.isSafeInteger(v) || Math.abs(v) > MM_COORD_LIMIT) return null;
  if (!allowNegative && v < 0) return null;
  return v;
}

/** 정북 각도 입력(도) → [0, 360) 소수 첫째 자리. 숫자가 아니면 null. */
export function parseAngleInput(text: string): number | null {
  const s = text.replace(/\s/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || Math.abs(v) > 3600) return null;
  const tenth = roundHalfAway(v * 10);
  const norm = ((tenth % 3600) + 3600) % 3600;
  return norm / 10;
}

/** 꼭짓점 삭제 시 도로 변 번호 재배치: 삭제한 점 i에 닿는 두 변(i-1, i)은 하나가 되므로 i-1을 남기고 i를 지운다. */
export function roadsAfterRemove(roads: Record<number, number>, removed: number, oldCount: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, w] of Object.entries(roads)) {
    const i = Number(k);
    if (i === removed) continue;
    const j = i > removed ? i - 1 : i;
    if (j >= 0 && j < oldCount - 1) out[j] = w;
  }
  return out;
}

export type ApplyResult = { ok: true; model: DesignModelV1; siteLabel: string | null } | { ok: false; issues: string[] };

/**
 * 초안을 DesignModel에 반영(site·rule_context의 일부만 바꾼다). 경계는 정규화(반시계)하고 도로 변 번호를 따라 옮긴다.
 * 결과는 packages/domain zod 스키마로 다시 검사한다(저장 전 마지막 관문).
 */
export function applyDraft(model: DesignModelV1, draft: SiteDraft): ApplyResult {
  const issues: string[] = [];
  const outlineProblem = outlineIssue(draft.outer);
  if (outlineProblem) issues.push(`대지 경계: ${outlineProblem}`);
  if (draft.use_district.trim() === "") issues.push("용도지역을 고르세요.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.application_date)) issues.push("허가 신청 예정일을 YYYY-MM-DD로 넣으세요.");
  if (!Number.isFinite(draft.north_angle_deg)) issues.push("정북 각도를 넣으세요.");
  for (const [k, w] of Object.entries(draft.roads)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= draft.outer.length) issues.push(`도로 변 ${i + 1}이 경계에 없습니다.`);
    else if (!Number.isSafeInteger(w) || w <= 0 || w > ROAD_WIDTH_MAX_MM) issues.push(`변 ${i + 1}의 도로 폭은 1~100,000mm입니다.`);
  }
  if (issues.length > 0) return { ok: false, issues };
  const { outer, edgeOf } = normalizeOutline(draft.outer);
  const roads = Object.entries(draft.roads)
    .map(([k, w]) => ({ edge_index: edgeOf(Number(k)), width_mm: w }))
    .sort((a, b) => a.edge_index - b.edge_index);
  const parcel: { pnu?: string; address_label?: string } = {};
  if (draft.parcel.pnu) parcel.pnu = draft.parcel.pnu;
  if (draft.parcel.address_label) parcel.address_label = draft.parcel.address_label;
  const boundary: Polygon = { outer };
  const next: DesignModelV1 = {
    ...model,
    site: {
      ...model.site,
      boundary,
      north_angle_deg: draft.north_angle_deg,
      roads,
      zoning: { ...model.site.zoning, use_district: draft.use_district.trim(), districts: draft.districts.map((d) => d.trim()).filter(Boolean) },
      parcel,
    },
    rule_context: { ...model.rule_context, application_date: draft.application_date, ordinance_applied: draft.ordinance_applied },
  };
  const checked = designModelV1Schema.safeParse(next);
  if (!checked.success) return { ok: false, issues: ["저장할 수 없는 값이 있습니다. 경계 좌표와 도로 폭을 확인하세요."] };
  return { ok: true, model: checked.data, siteLabel: parcel.address_label ?? null };
}

/** 두 초안이 같은가(저장할 변경이 있는지). */
export function sameDraft(a: SiteDraft, b: SiteDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── 대지 조회 응답 → 후보 ──

/** 화면에 보이는 후보(조회·DXF 공통). 사용자가 "이 경계 쓰기"를 눌러야 초안에 들어간다. */
export interface SiteCandidateView {
  origin: "lookup" | "dxf";
  outer: Point[];
  area_mm2: number;
  perimeter_mm: number;
  label: string;
  use_district?: string | null;
  districts?: string[];
  parcel?: { pnu?: string; address_label?: string };
  /** 원점 이동량(mm, 조회 좌표계의 원점). 표시·추적용. */
  origin_mm?: [number, number];
  notes: string[];
}

export interface LookupData {
  parcel: { pnu: string; address_label: string | null };
  crs: string;
  boundary_m: [number, number][];
  zoning: { use_district: string | null; districts: string[] };
  remaining_today: number | null;
  notice: string;
  notes: string[];
}

const LOOKUP_TEXT_MAX = 200;
const PNU_RE = /^\d{19}$/;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

/** 서버 응답 data 검증(형식이 틀리면 null → 화면은 AR021과 같게 직접 그리기 안내). */
export function parseLookupData(raw: unknown): LookupData | null {
  if (raw === null || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const parcel = d["parcel"] as Record<string, unknown> | undefined;
  const pnu = str(parcel?.["pnu"], 19);
  if (!pnu || !PNU_RE.test(pnu)) return null;
  const label = parcel?.["address_label"] === null ? null : str(parcel?.["address_label"], LOOKUP_TEXT_MAX);
  if (d["crs"] !== "EPSG:5186") return null;
  const ring = d["boundary_m"];
  if (!Array.isArray(ring) || ring.length < 3 || ring.length > 2000) return null;
  const pts: [number, number][] = [];
  for (const p of ring) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    pts.push([p[0], p[1]]);
  }
  const zoning = d["zoning"] as Record<string, unknown> | undefined;
  const use = zoning?.["use_district"] === null ? null : str(zoning?.["use_district"], 60);
  const districtsRaw = Array.isArray(zoning?.["districts"]) ? (zoning?.["districts"] as unknown[]) : [];
  const districts = districtsRaw.map((x) => str(x, 60)).filter((x): x is string => x !== null).slice(0, 10);
  const remaining = Number.isSafeInteger(d["remaining_today"]) ? (d["remaining_today"] as number) : null;
  const source = d["source"] as Record<string, unknown> | undefined;
  const notice = str(source?.["notice"], 300) ?? "공공 데이터 값은 입력 후보이며 판정 기준이 아닙니다.";
  const notes = Array.isArray(d["notes"]) ? (d["notes"] as unknown[]).filter((n): n is string => n === "multipart" || n === "holes_dropped") : [];
  return { parcel: { pnu, address_label: label }, crs: "EPSG:5186", boundary_m: pts, zoning: { use_district: use, districts }, remaining_today: remaining, notice, notes };
}

const NOTE_TEXT: Readonly<Record<string, string>> = {
  multipart: "필지가 여러 조각이라 가장 큰 조각만 가져왔습니다.",
  holes_dropped: "필지 안쪽 구멍은 가져오지 않았습니다.",
};

/**
 * 조회 좌표(EPSG:5186, m) → 로컬 mm 정수 후보. 각 좌표를 mToMm(half-away)으로 바꾼 뒤 원점(최소 x·y를 m 단위로 내림)을 뺀다.
 * 정규화(geometry)를 통과하지 못하면 null(자기교차 등 — 후보로 쓰지 않는다).
 */
export function candidateFromLookup(data: LookupData): SiteCandidateView | null {
  let mm: [number, number][];
  try {
    mm = data.boundary_m.map(([x, y]) => [mToMm(x), mToMm(y)]);
  } catch {
    return null;
  }
  const ox = Math.floor(Math.min(...mm.map((p) => p[0])) / 1000) * 1000;
  const oy = Math.floor(Math.min(...mm.map((p) => p[1])) / 1000) * 1000;
  const local: Point[] = mm.map(([x, y]) => [x - ox, y - oy]);
  if (local.some(([x, y]) => Math.abs(x) > MM_COORD_LIMIT || Math.abs(y) > MM_COORD_LIMIT)) return null;
  if (outlineIssue(local) !== null) return null;
  const outer = normalizePolygon({ outer: local }).outer;
  const m = siteMetrics(outer);
  if (!m) return null;
  const parcel: { pnu?: string; address_label?: string } = { pnu: data.parcel.pnu };
  if (data.parcel.address_label) parcel.address_label = data.parcel.address_label;
  return {
    origin: "lookup",
    outer,
    area_mm2: m.area_mm2,
    perimeter_mm: m.perimeter_mm,
    label: data.parcel.address_label ?? "조회한 필지",
    use_district: data.zoning.use_district,
    districts: data.zoning.districts,
    parcel,
    origin_mm: [ox, oy],
    notes: data.notes.map((n) => NOTE_TEXT[n] ?? "").filter(Boolean),
  };
}

/** 후보를 초안에 반영. 경계가 바뀌면 도로 변 지정은 비운다(변 번호가 달라짐). 용도지역은 후보에 있을 때만 바꾼다. */
export function draftWithCandidate(draft: SiteDraft, c: SiteCandidateView): SiteDraft {
  const next: SiteDraft = { ...draft, outer: c.outer.map((p) => [p[0], p[1]] as Point), roads: {} };
  if (c.use_district) next.use_district = c.use_district;
  if (c.districts && c.districts.length > 0) next.districts = [...c.districts];
  if (c.parcel) next.parcel = { ...c.parcel };
  return next;
}

/** 꼭짓점 수 경고(03장 2.2 3단계). */
export function vertexWarning(count: number): string | null {
  return count > VERTEX_WARN ? `대지 꼭짓점이 ${formatMm(count)}개라 계산이 느릴 수 있습니다.` : null;
}
