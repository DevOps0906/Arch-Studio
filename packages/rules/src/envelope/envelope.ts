// 법규 엔벨로프(AR-F-002, AR-06-016): DesignModel + 규칙 팩 → 건축 가능 볼륨(정수 mm 메시) + 제약별 적용 상태.
// 결정적 순수 함수. 3D 연산은 받은 SolidKernel(Manifold WASM)로 한다 — 초기화는 호출자(loadSolidKernel).
// 절대 규칙: 법규 수치는 팩 params에서만 읽는다. 확정 수치가 없는 제약은 적용하지 않고 "미확인" 상태 + 경고를 낸다.
// 산정 가정(법령 원문 대조 전, 팀장 확인 필요):
//  - 이격: 변마다 안쪽 띠(변 양끝을 거리만큼 늘인 직사각형)를 대지에서 뺀다. 오목 꼭짓점 둘레는 원 대신 정사각 캡이라 보수적.
//  - 정북 일조사선: 높이 z인 부분에서 정북 방향으로 잰 거리(수직 거리 아님)가 기준 이상. 기준선 = 바깥 법선이 정북 쪽인 대지 변
//    (도로 변은 팩 road_edges가 정함). 지표면 = z 0(대지 고저차 미반영). 구간 경계 높이는 아래 구간 기준(상한 포함).
//  - 높이 상한: 확정 높이 규칙이 없으면 호출자의 표시 상한(cap_height_mm)으로 자르고 경고(법규 수치 아님).
//  - 건폐율: 공간 형태가 아니라 바닥 면적 한도(내림)로만 낸다.
import { designModelV1Schema, type DesignModelV1, type Point, type Polygon } from "@arch-studio/domain";
import {
  COORD_LIMIT,
  area2,
  meshVolume,
  normalizePolygon,
  roundHalfAway,
  roundRatioHalfAway,
  type IntMesh,
  type Point3,
  type RegionNode,
  type SolidKernel,
  type SolidNode,
  volumeToString,
} from "@arch-studio/geometry";
import { canonicalJson } from "../canonical.ts";
import { RulesError } from "../errors.ts";
import { selectRules, type Rule, type RulePack } from "../pack.ts";
import { northVector } from "./north.ts";
import { sunlightParamsSchema, type SunlightBand, type SunlightParams } from "./params.ts";

/** 엔벨로프 엔진 버전. 산출 로직이 바뀌면 올리고 골든을 갱신한다. */
export const ENVELOPE_ENGINE_VERSION = "envelope-0.1.0";

export type EnvelopeConstraintKey = "coverage" | "height" | "sunlight" | "setback";

export type EnvelopeStatus =
  | "applied" // 확정 규칙 + 지원 지역
  | "reference" // 확정 수치를 적용했지만 지원 지역 밖이거나 조례 미확인(참고)
  | "unverified" // 미확인 규칙만 있음 — 적용 안 함
  | "district_not_in_pack" // 확정 규칙에 이 용도지역 수치가 없음 — 적용 안 함
  | "invalid_params" // 확정 규칙 수치가 엔벨로프 형식이 아님 — 적용 안 함
  | "missing" // 팩에 규칙이 없음 — 적용 안 함
  | "not_applicable"; // 그 종류의 대지 변이 없음

export type EnvelopeReason =
  | "UNVERIFIED_RULE"
  | "DISTRICT_NOT_IN_PACK"
  | "INVALID_PARAMS"
  | "RULE_MISSING"
  | "UNSUPPORTED_REGION"
  | "ORDINANCE_UNVERIFIED"
  | "NO_EDGES";

export const ENVELOPE_REASON_MESSAGES: Record<EnvelopeReason, string> = {
  UNVERIFIED_RULE: "미확인: 규칙 팩의 근거·수치가 확인 전이라 이 제약을 적용하지 않았습니다.",
  DISTRICT_NOT_IN_PACK: "확인 필요: 이 용도지역의 기준이 규칙 팩에 없어 이 제약을 적용하지 않았습니다.",
  INVALID_PARAMS: "확인 필요: 규칙 팩 수치 형식이 엔벨로프 형식과 달라 이 제약을 적용하지 않았습니다.",
  RULE_MISSING: "확인 필요: 규칙 팩에 이 제약이 없어 적용하지 않았습니다.",
  UNSUPPORTED_REGION: "미지원 지역: 참고 볼륨입니다. 직접 확인하세요.",
  ORDINANCE_UNVERIFIED: "조례 미확인: 국가 기준 참고 볼륨입니다. 조례 기준을 직접 확인하세요.",
  NO_EDGES: "해당 종류의 대지 변이 없습니다.",
};

export interface EnvelopeConstraint {
  key: EnvelopeConstraintKey;
  edge_class?: "road" | "adjacent";
  status: EnvelopeStatus;
  /** 볼륨·한도에 반영했는지. */
  applied: boolean;
  rule_ids: string[];
  basis: { law: string; article: string; effective_from: string; ordinance: boolean }[];
  reasons: EnvelopeReason[];
  /** 적용한 팩 수치(이 용도지역 것만). 적용 안 했으면 없음. */
  applied_params?: { max_pct: number } | { max_mm: number } | { min_mm: number } | { bands: SunlightBand[]; road_edges: SunlightParams["road_edges"] };
}

export type EnvelopeWarningCode =
  | "CONSTRAINT_NOT_APPLIED"
  | "HEIGHT_DISPLAY_CAP"
  | "MUNICIPALITY_NOT_IN_PACK"
  | "ORDINANCE_UNVERIFIED_MUNICIPALITY"
  | "SCHEDULED_RULES"
  | "PACK_VERSION_MISMATCH"
  | "FOOTPRINT_EXCEEDS_COVERAGE"
  | "EMPTY_ENVELOPE";

export interface EnvelopeWarning {
  code: EnvelopeWarningCode;
  message: string;
  rule_ids?: string[];
}

export interface EnvelopeOptions {
  /** 확정 높이 규칙이 없을 때 볼륨을 자를 표시 상한(mm 정수). 법규 수치가 아니라 화면 표시용. */
  cap_height_mm: number;
}

export interface EnvelopeOutput {
  engine_version: string;
  rule_pack_version: string;
  application_date: string;
  constraints: EnvelopeConstraint[];
  /** 이격 한계를 반영한 지면 영역(정수 mm). */
  footprint: Polygon[];
  footprint_area_mm2: number;
  /** 건폐율 바닥 면적 한도(mm², 내림). 건폐율 미적용이면 null. */
  max_building_area_mm2: number | null;
  /** 볼륨 상한 높이와 그 출처. */
  top_mm: number;
  top_source: "height_rule" | "display_cap";
  solid: IntMesh;
  /** 부피(mm³). safe int를 넘을 수 있어 bigint — JSON은 serializeEnvelope(10진 문자열). */
  volume_mm3: bigint;
  warnings: EnvelopeWarning[];
}

type Basis = EnvelopeConstraint["basis"][number];
const basisOf = (r: Rule): Basis[] =>
  r.basis.map((b) => ({ law: b.law, article: b.article, effective_from: b.effective_from, ordinance: b.ordinance }));

interface Edge {
  a: Point;
  b: Point;
  road: boolean;
}

/** 정규화한 대지(외곽 반시계·구멍 시계, 안쪽이 왼쪽)의 변. 도로 여부는 원래 외곽 변 번호(roads.edge_index)로 정한다. */
function siteEdges(model: DesignModelV1, site: Polygon): Edge[] {
  const outer = model.site.boundary.outer;
  const n = outer.length;
  const key = (p: Point, q: Point) => {
    const [s, t] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p];
    return `${s[0]},${s[1]};${t[0]},${t[1]}`;
  };
  const roadKeys = new Set<string>();
  for (const r of model.site.roads) {
    if (r.edge_index >= n) throw new RulesError("INVALID_INPUT", `도로 변 번호가 대지 외곽 변 수(${n})를 넘습니다: ${r.edge_index}`);
    roadKeys.add(key(outer[r.edge_index] as Point, outer[(r.edge_index + 1) % n] as Point));
  }
  const edges: Edge[] = [];
  for (const ring of [site.outer, ...(site.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Point;
      const b = ring[(i + 1) % ring.length] as Point;
      edges.push({ a, b, road: roadKeys.has(key(a, b)) });
    }
  }
  return edges;
}

const P = (x: number, y: number): Point => [roundHalfAway(x), roundHalfAway(y)];

/** 변 a→b(안쪽이 왼쪽)에서 거리 d 안의 띠: 변 양끝을 d만큼 늘이고 양쪽으로 d만큼 두께를 준 직사각형(바깥쪽은 대지 밖이라 무해). */
function strip(e: Edge, d: number): Polygon {
  const tx = e.b[0] - e.a[0];
  const ty = e.b[1] - e.a[1];
  const len = Math.sqrt(tx * tx + ty * ty);
  const ux = (tx / len) * d;
  const uy = (ty / len) * d;
  const nx = -uy; // 왼쪽(안쪽) 법선 × d
  const ny = ux;
  return {
    outer: [
      P(e.a[0] - ux - nx, e.a[1] - uy - ny),
      P(e.b[0] + ux - nx, e.b[1] + uy - ny),
      P(e.b[0] + ux + nx, e.b[1] + uy + ny),
      P(e.a[0] - ux + nx, e.a[1] - uy + ny),
    ],
  };
}

/** 정북 쪽 변 a→b를 남쪽(−N)으로 v만큼 쓸어 낸 평행사변형. */
function sweep(e: Edge, v: Point): Polygon {
  return { outer: [e.a, e.b, [e.b[0] - v[0], e.b[1] - v[1]], [e.a[0] - v[0], e.a[1] - v[1]]] };
}

/** 높이 z에서 비율 기준 거리 벡터 round(z·num/den·N). */
function ratioVector(z: number, ratio: { num: number; den: number }, north: [number, number]): Point {
  const d = (z * ratio.num) / ratio.den;
  return P(d * north[0], d * north[1]);
}

function shiftPoint(p: Point, dx: number, dy: number): Point {
  return [p[0] + dx, p[1] + dy];
}

function shiftPolygon(p: Polygon, dx: number, dy: number): Polygon {
  return { outer: p.outer.map((q) => shiftPoint(q, dx, dy)), holes: (p.holes ?? []).map((h) => h.map((q) => shiftPoint(q, dx, dy))) };
}

/** 엔벨로프 결과 → 정규 JSON(bigint 부피는 10진 문자열). 골든·저장용. */
export function serializeEnvelope(out: EnvelopeOutput): string {
  return canonicalJson({ ...out, volume_mm3: volumeToString(out.volume_mm3) });
}

/** 쓸기 벡터가 변과 평행하지 않은지(반올림 뒤 넓이 0인 평행사변형 방지). */
function crosses(e: Edge, v: Point): boolean {
  return (e.b[0] - e.a[0]) * v[1] - (e.b[1] - e.a[1]) * v[0] !== 0;
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function polygonsNode(polygons: readonly Polygon[]): RegionNode {
  return { op: "polygons", polygons };
}

interface Resolved {
  constraint: EnvelopeConstraint;
  rule?: Rule;
}

/**
 * 법규 엔벨로프를 만든다. model은 DesignModel v1(unknown 허용, 검사함), pack은 loadRulePack 결과, kernel은 loadSolidKernel 결과.
 * 같은 입력 → 같은 출력(바이트). 입력 오류는 RulesError(INVALID_INPUT), 지오메트리 거부는 GeometryError.
 */
export function buildEnvelope(modelInput: unknown, pack: RulePack, kernel: SolidKernel, options: EnvelopeOptions): EnvelopeOutput {
  const parsed = designModelV1Schema.safeParse(modelInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RulesError("INVALID_INPUT", `DesignModel 검사 실패 — ${first ? `${first.path.join(".")}: ${first.message}` : ""}`);
  }
  const cap = options?.cap_height_mm;
  if (!Number.isSafeInteger(cap) || cap <= 0 || cap > COORD_LIMIT) {
    throw new RulesError("INVALID_INPUT", `표시 상한 cap_height_mm는 1..${COORD_LIMIT} 정수여야 합니다: ${cap}`);
  }
  const model = parsed.data;
  const ctx = model.rule_context;
  const district = model.site.zoning.use_district;
  const warnings: EnvelopeWarning[] = [];

  if (ctx.rule_pack_version !== pack.version) {
    warnings.push({
      code: "PACK_VERSION_MISMATCH",
      message: `프로젝트 규칙 팩 버전(${ctx.rule_pack_version})과 다른 팩(${pack.version})으로 만들었습니다.`,
    });
  }
  const { active, scheduled } = selectRules(pack, ctx.application_date, ctx.municipality_code);
  const muni = pack.municipalities.find((x) => x.code === ctx.municipality_code);
  if (!muni) {
    warnings.push({
      code: "MUNICIPALITY_NOT_IN_PACK",
      message: `조례 미확인 지자체(${ctx.municipality_code}): 규칙 팩 지원 지역이 아니어서 참고 볼륨입니다. 직접 확인하세요.`,
    });
  } else if (muni.ordinance === "unverified") {
    warnings.push({
      code: "ORDINANCE_UNVERIFIED_MUNICIPALITY",
      message: `조례 미확인(${muni.name}): 조례 의존 제약은 국가 기준 참고값입니다.`,
    });
  }
  if (scheduled.length > 0) {
    warnings.push({
      code: "SCHEDULED_RULES",
      message: `신청 예정일(${ctx.application_date}) 뒤에 시행되는 예정 규칙 ${scheduled.length}건이 있습니다(엔벨로프에 반영하지 않음).`,
      rule_ids: scheduled.map((r) => r.id),
    });
  }

  const site = normalizePolygon(model.site.boundary);
  // 보조 도형(이격 띠·일조 쓸기·쐐기)이 대지 밖으로 나가므로 대지 경계 상자 중심을 원점으로 옮긴 국소 좌표에서 계산한다.
  // 대지 끝이 ±10km 좌표 한계에 붙어 있어도 중간 좌표가 한계 안에 머문다. 결과는 정수 이동으로 되돌린다(정렬 순서 불변).
  const xs = site.outer.map((p) => p[0]);
  const ys = site.outer.map((p) => p[1]);
  const c: Point = [Math.floor((Math.min(...xs) + Math.max(...xs)) / 2), Math.floor((Math.min(...ys) + Math.max(...ys)) / 2)];
  const localSite = shiftPolygon(site, -c[0], -c[1]);
  const edges = siteEdges(model, site).map((e) => ({ ...e, a: shiftPoint(e.a, -c[0], -c[1]), b: shiftPoint(e.b, -c[0], -c[1]) }));

  /** 슬롯 하나의 적용 상태. paramsOf가 null이면 이 용도지역 수치 없음, undefined면 형식 오류. */
  function resolve<T>(
    key: EnvelopeConstraintKey,
    edgeClass: "road" | "adjacent" | undefined,
    paramsOf: (r: Rule) => T | null | undefined,
  ): Resolved & { params?: T } {
    const inSlot = active.filter((r) => r.key === key && (edgeClass === undefined || (r.key === "setback" && r.edge_class === edgeClass)));
    const base = { key, ...(edgeClass ? { edge_class: edgeClass } : {}) };
    const confirmed = inSlot.find((r) => r.status === "confirmed");
    if (edgeClass && !edges.some((e) => e.road === (edgeClass === "road"))) {
      return {
        constraint: { ...base, status: "not_applicable", applied: false, rule_ids: inSlot.map((r) => r.id), basis: inSlot.flatMap(basisOf), reasons: ["NO_EDGES"] },
      };
    }
    if (!confirmed) {
      const status: EnvelopeStatus = inSlot.length > 0 ? "unverified" : "missing";
      return {
        constraint: {
          ...base,
          status,
          applied: false,
          rule_ids: inSlot.map((r) => r.id),
          basis: inSlot.flatMap(basisOf),
          reasons: [status === "unverified" ? "UNVERIFIED_RULE" : "RULE_MISSING"],
        },
      };
    }
    const common = { ...base, rule_ids: [confirmed.id], basis: basisOf(confirmed) };
    const params = paramsOf(confirmed);
    if (params === null || params === undefined) {
      const status: EnvelopeStatus = params === null ? "district_not_in_pack" : "invalid_params";
      return {
        constraint: { ...common, status, applied: false, reasons: [status === "district_not_in_pack" ? "DISTRICT_NOT_IN_PACK" : "INVALID_PARAMS"] },
        rule: confirmed,
      };
    }
    const reasons: EnvelopeReason[] = [];
    if (!muni) reasons.push("UNSUPPORTED_REGION");
    else if (confirmed.ordinance_dependent && muni.ordinance === "unverified") reasons.push("ORDINANCE_UNVERIFIED");
    return {
      constraint: { ...common, status: reasons.length > 0 ? "reference" : "applied", applied: true, reasons },
      rule: confirmed,
      params,
    };
  }

  const coverage = resolve("coverage", undefined, (r) => {
    if (r.key !== "coverage" || !r.params) return undefined;
    return r.params.max_pct_by_district[district] ?? null;
  });
  const height = resolve("height", undefined, (r) => {
    if (r.key !== "height" || !r.params) return undefined;
    return r.params.max_mm_by_district[district] ?? null;
  });
  const sunlight = resolve("sunlight", undefined, (r) => {
    if (r.key !== "sunlight") return undefined;
    const p = sunlightParamsSchema.safeParse(r.params);
    if (!p.success) return undefined;
    const bands = p.data.bands_by_district[district];
    return bands ? { bands, road_edges: p.data.road_edges } : null;
  });
  const setbackRoad = resolve("setback", "road", (r) => (r.key === "setback" && r.params ? r.params.min_mm : undefined));
  const setbackAdj = resolve("setback", "adjacent", (r) => (r.key === "setback" && r.params ? r.params.min_mm : undefined));

  if (coverage.params !== undefined) coverage.constraint.applied_params = { max_pct: coverage.params };
  if (height.params !== undefined) height.constraint.applied_params = { max_mm: height.params };
  if (sunlight.params !== undefined) sunlight.constraint.applied_params = sunlight.params;
  if (setbackRoad.params !== undefined) setbackRoad.constraint.applied_params = { min_mm: setbackRoad.params };
  if (setbackAdj.params !== undefined) setbackAdj.constraint.applied_params = { min_mm: setbackAdj.params };

  const constraints = [coverage, height, sunlight, setbackRoad, setbackAdj].map((x) => x.constraint);
  for (const c of constraints) {
    if (c.applied || c.status === "not_applicable") continue;
    const label = c.key === "setback" ? `이격(${c.edge_class === "road" ? "도로" : "인접"})` : TITLES[c.key];
    warnings.push({
      code: "CONSTRAINT_NOT_APPLIED",
      message: `${label} 제약 미확인: 이 제약을 적용하지 않은 엔벨로프입니다. ${ENVELOPE_REASON_MESSAGES[c.reasons[0] as EnvelopeReason]}`,
      rule_ids: c.rule_ids,
    });
  }

  // 1) 이격 한계 → 지면 영역
  const strips: Polygon[] = [];
  for (const e of edges) {
    const d = e.road ? setbackRoad.params : setbackAdj.params;
    if (d !== undefined) strips.push(strip(e, d));
  }
  const footprintLocal = kernel.region({ op: "subtract", base: polygonsNode([localSite]), minus: strips.length > 0 ? [polygonsNode(strips)] : [] });
  const footprint = footprintLocal.map((p) => shiftPolygon(p, c[0], c[1]));
  const footprintArea2 = footprintLocal.reduce((s, p) => s + BigInt(area2(p)), 0n);

  // 2) 건폐율 바닥 면적 한도(내림)
  let maxBuildingArea: number | null = null;
  if (coverage.params !== undefined) {
    const siteArea2 = BigInt(area2(site));
    const h100 = BigInt(Math.round(coverage.params * 100));
    maxBuildingArea = Number((siteArea2 * h100) / 20_000n);
    if (footprintArea2 > 2n * BigInt(maxBuildingArea)) {
      warnings.push({
        code: "FOOTPRINT_EXCEEDS_COVERAGE",
        message: "엔벨로프 바닥이 건폐율 한도보다 넓습니다. 매스 바닥 면적은 건폐율 한도 안이어야 합니다.",
        rule_ids: coverage.constraint.rule_ids,
      });
    }
  }

  // 3) 높이 상한
  const top = height.params ?? cap;
  if (height.params === undefined) {
    warnings.push({
      code: "HEIGHT_DISPLAY_CAP",
      message: `높이 제한 미적용: 볼륨을 표시 상한 ${cap}mm에서 잘랐습니다(법규 수치 아님).`,
    });
  }

  // 4) 볼륨: 일조사선 구간별 프리즘 − 비율 쐐기
  let solidLocal: IntMesh = { vertices: [], triangles: [] };
  if (footprintLocal.length > 0) {
    const node = sunlight.params
      ? sunlightSolid(footprintLocal, edges, sunlight.params, model.site.north_angle_deg, top)
      : extrude(footprintLocal, 0, top);
    solidLocal = kernel.solid(node);
  }
  const solid: IntMesh = {
    vertices: solidLocal.vertices.map(([x, y, z]) => [x + c[0], y + c[1], z]),
    triangles: solidLocal.triangles,
  };
  if (solid.triangles.length === 0) {
    warnings.push({ code: "EMPTY_ENVELOPE", message: "적용한 제약 안에 건축 가능 볼륨이 없습니다." });
  }

  return {
    engine_version: ENVELOPE_ENGINE_VERSION,
    rule_pack_version: pack.version,
    application_date: ctx.application_date,
    constraints,
    footprint,
    footprint_area_mm2: roundRatioHalfAway(footprintArea2, 2n),
    max_building_area_mm2: maxBuildingArea,
    top_mm: top,
    top_source: height.params !== undefined ? "height_rule" : "display_cap",
    solid,
    volume_mm3: meshVolume(solidLocal),
    warnings,
  };
}

const TITLES: Record<Exclude<EnvelopeConstraintKey, "setback">, string> = {
  coverage: "건폐율",
  height: "높이",
  sunlight: "정북 일조사선",
};

function extrude(region: readonly Polygon[], z0: number, z1: number): SolidNode {
  return { op: "extrude", region: polygonsNode(region), z0, z1 };
}

/** 일조사선 구간마다: (지면 영역 − 최소 거리 쓸기) 프리즘 − 비율 쐐기(변마다 볼록 껍질). */
function sunlightSolid(
  footprint: readonly Polygon[],
  edges: readonly Edge[],
  params: { bands: SunlightBand[]; road_edges: SunlightParams["road_edges"] },
  northAngleDeg: number,
  top: number,
): SolidNode {
  const north = northVector(northAngleDeg);
  // 바깥 법선(안쪽이 왼쪽이므로 (ty, −tx))이 정북 쪽인 변만 기준선
  const lines = edges.filter((e) => {
    if (e.road && params.road_edges === "exempt") return false;
    const tx = e.b[0] - e.a[0];
    const ty = e.b[1] - e.a[1];
    return ty * north[0] - tx * north[1] > 0;
  });
  const parts: SolidNode[] = [];
  let zl = 0;
  for (const band of params.bands) {
    if (zl >= top) break;
    const zu = band.up_to_mm === null ? top : Math.min(band.up_to_mm, top);
    let region: RegionNode = polygonsNode(footprint);
    if (band.min_distance_mm !== undefined && lines.length > 0) {
      const d = band.min_distance_mm;
      const v = P(d * north[0], d * north[1]);
      const sweeps = lines.filter((e) => crosses(e, v)).map((e) => sweep(e, v));
      if (sweeps.length > 0) region = { op: "subtract", base: region, minus: [polygonsNode(sweeps)] };
    }
    const prism: SolidNode = { op: "extrude", region, z0: zl, z1: zu };
    const ratio = band.distance_ratio;
    if (ratio && lines.length > 0) {
      // 쐐기를 프리즘 위아래로 넘겨 같은 높이 면을 피한다(z ≥ 0 유지 — 음수 z는 쓸기 방향이 뒤집힌다).
      // 넘기는 높이는 z·num/den이 정수가 되는 값으로 골라 쐐기 꼭짓점 반올림 오차를 없앤다(정북이 축 방향일 때 정확).
      const step = ratio.den / gcd(ratio.num, ratio.den);
      const z0 = zl > 0 ? Math.floor((zl - 1) / step) * step : 0;
      const z1 = (Math.floor(zu / step) + 1) * step;
      const v0 = ratioVector(z0, ratio, north);
      const v1 = ratioVector(z1, ratio, north);
      const wedges: SolidNode[] = lines.filter((e) => crosses(e, v1)).map((e) => {
        const pts: Point3[] = [];
        for (const [z, v] of [
          [z0, v0],
          [z1, v1],
        ] as const) {
          pts.push([e.a[0], e.a[1], z], [e.b[0], e.b[1], z], [e.a[0] - v[0], e.a[1] - v[1], z], [e.b[0] - v[0], e.b[1] - v[1], z]);
        }
        return { op: "hull", points: pts };
      });
      parts.push({ op: "subtract", base: prism, minus: [{ op: "union", children: wedges }] });
    } else {
      parts.push(prism);
    }
    zl = zu;
  }
  return { op: "union", children: parts };
}
