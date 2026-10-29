// 매스 자동 제안 3안(AR-F-033, D-26 결정적 격자 탐색). 결정적 순수 함수: 같은 입력 → 같은 후보(난수·시간·LLM 없음).
// 흐름: 법규 엔벨로프(rules.buildEnvelope) → 지면 영역의 격자 칸 행렬 → 직사각형 후보 열거 → 정확 검사로 다듬기(커널 영역 차집합)
//       → 후보마다 엔벨로프 안에 들어가는 최대 층 수(커널 솔리드 차집합) → 전략 3개로 고르기 → 판정(rules.judge)으로 최종 확인.
// 후보는 판정 엔진(judge)에서 FAIL인 항목이 없는 것만 돌려준다. 확정 수치가 없는 항목은 WARN("확인 필요")이라 PASS로 속이지 않는다.
// 좌표는 전부 이 엔진이 만든 정수 mm다(AI가 만들지 않는다).
import { designModelV1Schema, type DesignModelV1, type Polygon } from "@arch-studio/domain";
import type { SolidKernel, SolidNode } from "@arch-studio/geometry";
import { buildEnvelope, judge, northVector, type EnvelopeOutput, type JudgeOutput, type RulePack } from "@arch-studio/rules";
import { compareRect, enumerateRects, occupancyOf, rectArea, rectDepth, rectInside, rectKey, rectOuter, rectWidth, type Rect } from "./grid.ts";

export const MASSING_ENGINE_VERSION = "massing-0.1.0";

/** 제안 엔진 기본값(법규 수치 아님 — 탐색 파라미터). */
export const DEFAULTS = {
  /** 확정 높이 규칙이 없을 때 엔벨로프를 자르는 표시 상한. */
  capHeightMm: 60_000,
  floorHeightMm: 3000,
  /** 목표 연면적·층수가 모두 없을 때 쓰는 층 수. */
  floors: 3,
  /** 바닥 직사각형의 한 변 최소 길이(실용 최소). */
  minSideMm: 3000,
  /** 일조 여유안: 정북 쪽 변을 더 물리는 거리. */
  northMarginMm: 2000,
  /** 정형안: 긴 변 ÷ 짧은 변 상한, 치수 모듈. */
  regularAspect: 1.5,
  regularModuleMm: 1000,
  /** 격자 한 축의 칸 수 상한. */
  maxCells: 48,
  /** 후보 직사각형 수. */
  poolSize: 8,
  /** 솔리드 검사에서 "들어간다"로 보는 넘침 부피 허용(mm³) — 부동소수 조각. */
  volumeToleranceMm3: 1_000_000,
  maxFloorsSearched: 30,
} as const;

export type StrategyKey = "max_coverage" | "sunlight_margin" | "regular_plan";

export const STRATEGY_TITLE: Readonly<Record<StrategyKey, string>> = {
  max_coverage: "건폐 최대",
  sunlight_margin: "일조 여유",
  regular_plan: "정형 평면",
};

export interface SuggestTargets {
  /** 목표 연면적(㎡). 없으면 null. */
  target_gfa_m2: number | null;
  /** 목표 지상 층 수. 없으면 null. */
  floors: number | null;
  floor_height_mm: number;
  use: string;
}

export interface SuggestOptions {
  cap_height_mm?: number;
}

export type Mass = DesignModelV1["masses"][number];

export interface Candidate {
  id: StrategyKey;
  strategy: StrategyKey;
  title: string;
  /** "왜 이 안인가" 설명(결정적 문장). */
  reasons: string[];
  masses: Mass[];
  floors: number;
  width_mm: number;
  depth_mm: number;
  footprint_area_m2: number;
  /** 지상 연면적(㎡, 0.01 내림) — 제안 산정값. 법규 판정 수치(건폐·용적·높이)는 judge 결과만 쓴다. */
  gfa_m2: number;
  /** 이 바닥에서 엔벨로프가 허용하는 최대 층 수와 남는 층 수(일조 여유 설명용). */
  allowed_floors: number;
  spare_floors: number;
  /** 건폐·용적·높이·이격이 모두 PASS면 pass, 하나라도 WARN(확인 필요)이면 check. FAIL 후보는 없다. */
  status: "pass" | "check";
  judge: JudgeOutput;
}

export type SuggestNoticeCode = "TARGET_NOT_MET" | "ENVELOPE_EMPTY" | "NO_CANDIDATE" | "LAW_UNVERIFIED";

export interface SuggestNotice {
  code: SuggestNoticeCode;
  message: string;
}

export interface SuggestResult {
  engine_version: string;
  targets: SuggestTargets;
  candidates: Candidate[];
  /** 탐색한 바닥 중 엔벨로프·판정을 통과하는 최대 지상 연면적(㎡, 0.01 내림). */
  max_gfa_m2: number;
  target_met: boolean;
  notices: SuggestNotice[];
  envelope: {
    top_mm: number;
    top_source: EnvelopeOutput["top_source"];
    max_building_area_m2: number | null;
    constraints: { key: string; edge_class?: string; status: string; applied: boolean }[];
  };
  grid_step_mm: number;
}

export class MassingError extends Error {
  readonly code: "INVALID_TARGETS" | "INVALID_MODEL";
  constructor(code: MassingError["code"], message: string) {
    super(message);
    this.name = "MassingError";
    this.code = code;
  }
}

/** 면적표 목표(program.targets)에서 기본 목표를 만든다(대화상자 초기값). */
export function targetsFromProgram(model: DesignModelV1): SuggestTargets {
  const rows = model.program.targets.filter((t) => Number.isFinite(t.target_area_m2) && t.target_area_m2 > 0);
  const sum = rows.reduce((s, t) => s + t.target_area_m2, 0);
  const use = rows[0]?.use ?? model.masses[0]?.floors[0]?.use ?? "단독주택";
  return { target_gfa_m2: sum > 0 ? Math.round(sum * 100) / 100 : null, floors: null, floor_height_mm: DEFAULTS.floorHeightMm, use };
}

export function validateTargets(t: SuggestTargets): void {
  const bad = (m: string): never => {
    throw new MassingError("INVALID_TARGETS", m);
  };
  if (t.target_gfa_m2 !== null && !(Number.isFinite(t.target_gfa_m2) && t.target_gfa_m2 > 0 && t.target_gfa_m2 <= 1_000_000)) bad("목표 연면적은 0보다 크고 1,000,000㎡ 이하여야 합니다.");
  if (t.floors !== null && !(Number.isSafeInteger(t.floors) && t.floors >= 1 && t.floors <= 60)) bad("목표 층수는 1~60 사이 정수여야 합니다.");
  if (!(Number.isSafeInteger(t.floor_height_mm) && t.floor_height_mm >= 1500 && t.floor_height_mm <= 10_000)) bad("층고는 1,500~10,000mm 정수여야 합니다.");
  if (t.use.trim().length < 1 || t.use.length > 40) bad("용도는 1~40자로 넣으세요.");
}

const floorM2 = (mm2: number): number => Math.floor(mm2 / 10_000) / 100;

/** 닫힌 표시 메시의 부피(mm³, 절댓값). */
function meshVolume(positions: Float32Array, index: Uint32Array): number {
  let v = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = (index[i] as number) * 3;
    const b = (index[i + 1] as number) * 3;
    const c = (index[i + 2] as number) * 3;
    const ax = positions[a] as number;
    const ay = positions[a + 1] as number;
    const az = positions[a + 2] as number;
    const bx = positions[b] as number;
    const by = positions[b + 1] as number;
    const bz = positions[b + 2] as number;
    const cx = positions[c] as number;
    const cy = positions[c + 1] as number;
    const cz = positions[c + 2] as number;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

const polyOf = (r: Rect): Polygon => ({ outer: rectOuter(r) });

function buildMass(rect: Rect, floors: number, t: SuggestTargets): Mass {
  return {
    id: "m-1",
    footprint: polyOf(rect),
    base_level_mm: 0,
    floors: Array.from({ length: floors }, (_, i) => ({ id: `m-1-f${i + 1}`, level: i + 1, height_mm: t.floor_height_mm, use: t.use })),
    roof: { type: "flat" },
  };
}

interface Plan {
  rect: Rect;
  floors: number;
  allowed: number;
  gfa: number; // mm²
  meets: boolean;
}

interface Ctx {
  model: DesignModelV1;
  pack: RulePack;
  kernel: SolidKernel;
  env: EnvelopeOutput;
  envNode: SolidNode;
  region: readonly Polygon[];
  targets: SuggestTargets;
  topFloors: number;
  maxArea: number | null;
  north: readonly [number, number];
  fitCache: Map<string, boolean>;
}

/** 네 변을 큰 걸음부터 작은 걸음으로 밀어 영역 안에서 최대로 키운다(순서 고정). */
function refine(c: Ctx, start: Rect, step: number): Rect {
  let r = start;
  const steps: number[] = [];
  for (let s = Math.max(100, Math.floor(step / 2 / 100) * 100); ; s = Math.floor(s / 2 / 100) * 100) {
    steps.push(s);
    if (s <= 100) break;
  }
  for (const s of steps) {
    let grew = true;
    let guard = 0;
    while (grew && guard++ < 200) {
      grew = false;
      for (const side of ["x1", "y1", "x0", "y0"] as const) {
        const next: Rect = { ...r, [side]: r[side] + (side === "x1" || side === "y1" ? s : -s) };
        if (rectInside(next, c.region)) {
          r = next;
          grew = true;
        }
      }
    }
  }
  return r;
}

/** 건폐율 한도(건축면적 상한)를 넘으면 긴 변을 100mm 단위로 줄인다. */
function clipToCoverage(c: Ctx, r: Rect, minSide: number): Rect | null {
  const cap = c.maxArea;
  if (cap === null || rectArea(r) <= cap) return r;
  const wide = rectWidth(r) >= rectDepth(r);
  const other = wide ? rectDepth(r) : rectWidth(r);
  const len = Math.floor(cap / other / 100) * 100;
  if (len >= minSide) return wide ? { ...r, x1: r.x0 + len } : { ...r, y1: r.y0 + len };
  // 한 변만 줄여서는 안 되면 두 변을 같이 줄인다(정사각에 가깝게).
  const side = Math.floor(Math.sqrt(cap) / 100) * 100;
  if (side < minSide) return null;
  return { x0: r.x0, y0: r.y0, x1: r.x0 + Math.min(side, rectWidth(r)), y1: r.y0 + Math.min(side, rectDepth(r)) };
}

/** 바닥 직사각형 위로 n층 각기둥이 엔벨로프 안에 들어가는가(커널 솔리드 차집합이 사실상 비면 참). 결과는 캐시. */
function fitsPrism(c: Ctx, r: Rect, n: number): boolean {
  const key = `${rectKey(r)}|${n}`;
  const hit = c.fitCache.get(key);
  if (hit !== undefined) return hit;
  const prism: SolidNode = { op: "extrude", region: { op: "polygons", polygons: [polyOf(r)] }, z0: 0, z1: n * c.targets.floor_height_mm };
  const [m] = c.kernel.renderMeshes([{ op: "subtract", base: prism, minus: [c.envNode] }]);
  const ok = !m || m.index.length === 0 || meshVolume(m.positions, m.index) <= DEFAULTS.volumeToleranceMm3;
  c.fitCache.set(key, ok);
  return ok;
}

/** 이 바닥이 엔벨로프 안에 들어가는 최대 층 수(0 = 1층도 안 들어감). 이진 탐색. */
function allowedFloors(c: Ctx, r: Rect): number {
  let lo = 0;
  let hi = c.topFloors;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fitsPrism(c, r, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 정북 쪽을 향한 변(정북 성분이 0.2 넘는 축)을 d만큼 물린다. */
function pullFacing(r: Rect, north: readonly [number, number], d: number): Rect {
  let out = r;
  if (Math.abs(north[1]) > 0.2) out = north[1] > 0 ? { ...out, y1: out.y1 - d } : { ...out, y0: out.y0 + d };
  if (Math.abs(north[0]) > 0.2) out = north[0] > 0 ? { ...out, x1: out.x1 - d } : { ...out, x0: out.x0 + d };
  return out;
}

/** n층이 들어가도록 정북 쪽 변을 가장 적게(100mm 단위) 물린 바닥. 안 되면 null. */
function pulledToFit(c: Ctx, r: Rect, n: number): Rect | null {
  const axes = (Math.abs(c.north[1]) > 0.2 ? 1 : 0) + (Math.abs(c.north[0]) > 0.2 ? 1 : 0);
  if (axes === 0) return null;
  const slack = Math.min(Math.abs(c.north[1]) > 0.2 ? rectDepth(r) : Infinity, Math.abs(c.north[0]) > 0.2 ? rectWidth(r) : Infinity) - DEFAULTS.minSideMm;
  const kMax = Math.floor(slack / 100);
  if (kMax < 1 || !fitsPrism(c, pullFacing(r, c.north, kMax * 100), n)) return null;
  let lo = 1;
  let hi = kMax;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsPrism(c, pullFacing(r, c.north, mid * 100), n)) hi = mid;
    else lo = mid + 1;
  }
  return pullFacing(r, c.north, lo * 100);
}

function desiredFloors(t: SuggestTargets, area: number): number {
  if (t.floors !== null) return t.floors;
  if (t.target_gfa_m2 !== null) return Math.max(1, Math.ceil((t.target_gfa_m2 * 1_000_000) / area));
  return DEFAULTS.floors;
}

function metTarget(t: SuggestTargets, gfa: number, floors: number): boolean {
  return t.target_gfa_m2 !== null ? gfa >= t.target_gfa_m2 * 1_000_000 : t.floors !== null ? floors === t.floors : true;
}

/**
 * 바닥 하나의 계획: (가) 그대로 두고 들어가는 만큼만 층을 쌓는다, (나) 원하는 층수가 안 들어가면 정북 쪽 변을 물려 원하는 층에 가깝게 맞춘다.
 * 둘 중 목표를 만족하는 쪽, 같으면 연면적이 큰 쪽.
 */
function planFor(c: Ctx, rect: Rect, maximize: boolean): Plan | null {
  // 건폐율 한도로 자른 모양도 따로 본다(자른 모양은 부분집합이라 더 높이 들어갈 수 있다).
  const variants: Rect[] = [rect];
  const cut = clipToCoverage(c, rect, DEFAULTS.minSideMm);
  if (cut && rectKey(cut) !== rectKey(rect)) variants.push(cut);
  const plans: Plan[] = [];
  for (const v of variants) {
    const area0 = rectArea(v);
    const allowed = allowedFloors(c, v);
    const want = maximize ? allowed : desiredFloors(c.targets, Math.min(area0, c.maxArea ?? area0));
    const options: { rect: Rect; floors: number; allowed: number }[] = [];
    if (allowed >= 1) options.push({ rect: v, floors: Math.min(want, allowed), allowed });
    if (!maximize && want > allowed) {
      const top = Math.min(want, c.topFloors);
      for (let n = top; n > allowed && n >= top - 2; n--) {
        const pulled = pulledToFit(c, v, n);
        if (!pulled) continue;
        options.push({ rect: pulled, floors: n, allowed: n });
        break;
      }
    }
    for (const o of options) {
      const r = clipToCoverage(c, o.rect, DEFAULTS.minSideMm); // 부분집합이라 같은 층수가 그대로 들어간다
      if (!r) continue;
      const gfa = rectArea(r) * o.floors;
      plans.push({ rect: r, floors: o.floors, allowed: o.allowed, gfa, meets: metTarget(c.targets, gfa, o.floors) });
    }
  }
  if (plans.length === 0) return null;
  return plans.reduce((best, p) => ((Number(p.meets) - Number(best.meets) || p.gfa - best.gfa) > 0 ? p : best));
}

/** 판정 엔진으로 최종 확인: FAIL이 있으면 층을 줄이거나 바닥을 안쪽으로 물려 다시 본다. 못 고치면 null. */
function finalize(c: Ctx, plan: Plan): { plan: Plan; masses: Mass[]; out: JudgeOutput } | null {
  let rect = plan.rect;
  let floors = plan.floors;
  for (let guard = 0; guard < 80; guard++) {
    const masses = [buildMass(rect, floors, c.targets)];
    const out = judge({ ...c.model, masses }, c.pack);
    const failed = new Set(out.result.items.filter((i) => i.verdict === "FAIL").map((i) => i.key));
    if (failed.size === 0) {
      const area = rectArea(rect);
      return { plan: { ...plan, rect, floors, gfa: area * floors, allowed: Math.max(plan.allowed, floors) }, masses, out };
    }
    if ((failed.has("far") || failed.has("height")) && floors > 1) {
      floors -= 1;
      continue;
    }
    if (failed.has("coverage") || failed.has("setback") || failed.has("far") || failed.has("height")) {
      const next: Rect = { x0: rect.x0 + 100, y0: rect.y0 + 100, x1: rect.x1 - 100, y1: rect.y1 - 100 };
      if (rectWidth(next) < DEFAULTS.minSideMm || rectDepth(next) < DEFAULTS.minSideMm) return null;
      rect = next;
      continue;
    }
    return null; // 다른 항목의 FAIL은 이 엔진이 고칠 수 없다
  }
  return null;
}

/** 정북 쪽 변을 거리만큼 물린다(축 정렬 직사각형 기준으로 정북에 가까운 변). */
function pullNorth(r: Rect, north: readonly [number, number], d: number): Rect {
  if (Math.abs(north[1]) >= Math.abs(north[0])) return north[1] >= 0 ? { ...r, y1: r.y1 - d } : { ...r, y0: r.y0 + d };
  return north[0] >= 0 ? { ...r, x1: r.x1 - d } : { ...r, x0: r.x0 + d };
}

/** 정형안: 긴 변을 짧은 변의 aspect배 이내로 자르고 두 변을 모듈 배수로 내린다. */
function regularize(r: Rect): Rect | null {
  const m = DEFAULTS.regularModuleMm;
  let w = Math.floor(rectWidth(r) / m) * m;
  let d = Math.floor(rectDepth(r) / m) * m;
  // 짧은 변을 모듈에 맞춘 뒤 긴 변을 그 aspect배 이내(모듈 배수)로 자른다.
  if (w >= d) w = Math.min(w, Math.floor((d * DEFAULTS.regularAspect) / m) * m);
  else d = Math.min(d, Math.floor((w * DEFAULTS.regularAspect) / m) * m);
  if (w < DEFAULTS.minSideMm || d < DEFAULTS.minSideMm) return null;
  return { x0: r.x0, y0: r.y0, x1: r.x0 + w, y1: r.y0 + d };
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || d <= 0) return 0;
  return (w * d) / Math.min(rectArea(a), rectArea(b));
}

function gridStep(region: readonly Polygon[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of region) {
    for (const [x, y] of p.outer) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  return Math.max(100, Math.ceil(span / DEFAULTS.maxCells / 100) * 100);
}

const sortPlans = (plans: Plan[], score: (p: Plan) => number): Plan[] =>
  [...plans].sort((a, b) => Number(b.meets) - Number(a.meets) || score(b) - score(a) || b.gfa - a.gfa || compareRect(a.rect, b.rect));

export function suggestMasses(modelIn: DesignModelV1, pack: RulePack, kernel: SolidKernel, targets: SuggestTargets, options: SuggestOptions = {}): SuggestResult {
  validateTargets(targets);
  const parsed = designModelV1Schema.safeParse(modelIn);
  if (!parsed.success) throw new MassingError("INVALID_MODEL", "설계 모델 형식이 올바르지 않습니다.");
  const model = parsed.data;

  const env = buildEnvelope(model, pack, kernel, { cap_height_mm: options.cap_height_mm ?? DEFAULTS.capHeightMm });
  const envelopeInfo: SuggestResult["envelope"] = {
    top_mm: env.top_mm,
    top_source: env.top_source,
    max_building_area_m2: env.max_building_area_mm2 === null ? null : floorM2(env.max_building_area_mm2),
    constraints: env.constraints.map((c) => ({ key: c.key, ...(c.edge_class ? { edge_class: c.edge_class } : {}), status: c.status, applied: c.applied })),
  };
  const notices: SuggestNotice[] = [];
  if (!env.constraints.some((c) => c.applied)) {
    notices.push({ code: "LAW_UNVERIFIED", message: "규칙 팩에 확정된 법규 수치가 없어 법규 한도 없이 목표 기준으로만 탐색했습니다. 모든 판정이 '확인 필요'입니다." });
  }
  const empty = (code: SuggestNoticeCode, message: string): SuggestResult => ({
    engine_version: MASSING_ENGINE_VERSION,
    targets,
    candidates: [],
    max_gfa_m2: 0,
    target_met: false,
    notices: [...notices, { code, message }],
    envelope: envelopeInfo,
    grid_step_mm: 0,
  });
  const region = env.footprint;
  if (region.length === 0 || env.solid.triangles.length === 0) return empty("ENVELOPE_EMPTY", "엔벨로프 안에 지을 수 있는 공간이 없습니다. 대지·이격 조건을 확인하세요.");

  const step = gridStep(region);
  const ctx: Ctx = {
    model,
    pack,
    kernel,
    env,
    envNode: { op: "mesh", mesh: env.solid },
    region,
    targets,
    topFloors: Math.max(0, Math.min(DEFAULTS.maxFloorsSearched, Math.floor(env.top_mm / targets.floor_height_mm))),
    maxArea: env.max_building_area_mm2,
    north: northVector(model.site.north_angle_deg),
    fitCache: new Map(),
  };
  const occ = occupancyOf(region, step);
  if (!occ) return empty("NO_CANDIDATE", "탐색할 수 있는 바닥이 없습니다.");

  // 후보 직사각형: 면적 큰 순, 서로 80% 넘게 겹치면 건너뜀 → 정확 다듬기.
  const all = enumerateRects(occ)
    .filter((r) => rectWidth(r) >= DEFAULTS.minSideMm && rectDepth(r) >= DEFAULTS.minSideMm)
    .sort((a, b) => rectArea(b) - rectArea(a) || compareRect(a, b));
  const seeds: Rect[] = [];
  for (const r of all) {
    if (seeds.length >= DEFAULTS.poolSize) break;
    if (seeds.every((s) => overlapRatio(s, r) < 0.8)) seeds.push(r);
  }
  const pool: Rect[] = [];
  const seen = new Set<string>();
  for (const s of seeds) {
    const r = refine(ctx, s, step);
    if (!seen.has(rectKey(r))) {
      seen.add(rectKey(r));
      pool.push(r);
    }
  }
  if (pool.length === 0) return empty("NO_CANDIDATE", "탐색할 수 있는 바닥이 없습니다.");

  const north = ctx.north;
  const plansOf = (rects: Rect[], maximize = false): Plan[] => rects.map((r) => planFor(ctx, r, maximize)).filter((p): p is Plan => p !== null);

  const poolPlans = plansOf(pool);
  /** 계획의 바닥을 부분집합 모양으로 바꾼 계획(부분집합이라 엔벨로프 안에 그대로 들어간다). 층은 새 면적에 맞춰 다시 정한다. */
  const derive = (p: Plan, r: Rect | null): Plan | null => {
    if (!r || rectWidth(r) < DEFAULTS.minSideMm || rectDepth(r) < DEFAULTS.minSideMm) return null;
    const allowed = Math.max(p.allowed, allowedFloors(ctx, r));
    const floors = Math.min(desiredFloors(targets, rectArea(r)), allowed);
    if (floors < 1) return null;
    const gfa = rectArea(r) * floors;
    return { rect: r, floors, allowed, gfa, meets: metTarget(targets, gfa, floors) };
  };
  const aPlans = sortPlans(poolPlans, (p) => rectArea(p.rect));
  const bPlans = sortPlans(
    poolPlans.map((p) => derive(p, pullNorth(p.rect, north, DEFAULTS.northMarginMm))).filter((p): p is Plan => p !== null),
    (p) => Math.floor(((p.allowed - p.floors) * 1000) / Math.max(1, p.allowed)) * 1e9 + rectArea(p.rect) / 1e6,
  );
  const cPlans = sortPlans(
    poolPlans.map((p) => derive(p, regularize(p.rect))).filter((p): p is Plan => p !== null),
    (p) => rectArea(p.rect),
  );
  const maxPlans = sortPlans(plansOf(pool, true), (p) => p.gfa);

  // 탐색한 바닥 중 판정을 통과하는 최대 연면적.
  let maxGfa = 0;
  for (const p of maxPlans.slice(0, 4)) {
    const f = finalize(ctx, p);
    if (f) maxGfa = Math.max(maxGfa, f.plan.gfa);
  }

  const chosen: Candidate[] = [];
  const taken = new Set<string>();
  const strategies: { key: StrategyKey; plans: Plan[]; reason: (p: Plan) => string[] }[] = [
    {
      key: "max_coverage",
      plans: aPlans,
      reason: (p) => [`엔벨로프 안에 들어가는 가장 큰 직사각형 바닥입니다(바닥 ${floorM2(rectArea(p.rect))}㎡).`, ...(ctx.maxArea !== null ? ["건폐율 한도 안으로 다듬었습니다."] : [])],
    },
    {
      key: "sunlight_margin",
      plans: bPlans,
      reason: (p) => [
        `정북 쪽 변을 ${DEFAULTS.northMarginMm.toLocaleString("ko-KR")}mm 더 물렸습니다.`,
        `엔벨로프가 허용하는 ${p.allowed}층 중 ${p.floors}층만 써서 ${p.allowed - p.floors}층 여유가 있습니다.`,
      ],
    },
    {
      key: "regular_plan",
      plans: cPlans,
      reason: (p) => [`긴 변이 짧은 변의 ${DEFAULTS.regularAspect}배 이내이고 두 변이 ${DEFAULTS.regularModuleMm.toLocaleString("ko-KR")}mm 배수인 직사각형입니다(${rectWidth(p.rect).toLocaleString("ko-KR")}×${rectDepth(p.rect).toLocaleString("ko-KR")}mm).`],
    },
  ];
  for (const s of strategies) {
    let tries = 0;
    for (const p of s.plans) {
      if (tries++ >= 6) break;
      const f = finalize(ctx, p);
      if (!f) continue;
      const key = `${rectKey(f.plan.rect)}|${f.plan.floors}`;
      if (taken.has(key)) continue;
      taken.add(key);
      maxGfa = Math.max(maxGfa, f.plan.gfa);
      const geoKeys = new Set(["coverage", "far", "height", "setback"]);
      const allPass = f.out.result.items.filter((i) => geoKeys.has(i.key)).every((i) => i.verdict === "PASS");
      chosen.push({
        id: s.key,
        strategy: s.key,
        title: STRATEGY_TITLE[s.key],
        reasons: s.reason(f.plan),
        masses: f.masses,
        floors: f.plan.floors,
        width_mm: rectWidth(f.plan.rect),
        depth_mm: rectDepth(f.plan.rect),
        footprint_area_m2: floorM2(rectArea(f.plan.rect)),
        gfa_m2: floorM2(f.plan.gfa),
        allowed_floors: f.plan.allowed,
        spare_floors: Math.max(0, f.plan.allowed - f.plan.floors),
        status: allPass ? "pass" : "check",
        judge: f.out,
      });
      break;
    }
  }

  const t = targets;
  const targetMet = chosen.length > 0 && (t.target_gfa_m2 !== null ? chosen.some((c) => c.gfa_m2 >= t.target_gfa_m2!) : true);
  if (chosen.length === 0) {
    notices.push({ code: "NO_CANDIDATE", message: "판정을 통과하는 매스 후보를 찾지 못했습니다. 목표를 줄이거나 대지·규칙을 확인하세요." });
  } else if (!targetMet) {
    notices.push({ code: "TARGET_NOT_MET", message: `엔벨로프 안에서 최대 ${floorM2(maxGfa)}㎡입니다.` });
  }
  return {
    engine_version: MASSING_ENGINE_VERSION,
    targets,
    candidates: chosen,
    max_gfa_m2: floorM2(maxGfa),
    target_met: targetMet,
    notices,
    envelope: envelopeInfo,
    grid_step_mm: step,
  };
}
