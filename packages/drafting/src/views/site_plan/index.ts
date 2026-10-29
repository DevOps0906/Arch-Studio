// site_plan 뷰 생성기(AR-06-023, 02_ARCHITECTURE.md 2.3절 "뷰 생성기" site_plan 행).
// 그리는 것: 대지 경계·지번, 도로와 폭, 건축선·이격선, 매스 최외곽(층 외곽 합집합 투영), 최단 이격 치수,
// 간이 주차구획, 건폐율·용적률 요약표, FAIL 항목 "검토 필요" 표시.
// 법규 값(이격·대수·건폐율·용적률)은 JudgmentResult 값을 그대로 쓴다 — 다시 계산하지 않는다. 기하(합집합·오프셋·거리)는 geometry,
// 좌표는 모두 결정적 순수 함수. validateDraftingInput을 통과한 입력을 가정한다.
import type { Point, Polygon } from "@arch-studio/domain";
import { distance, offset, roundHalfAway, union } from "@arch-studio/geometry";
import { dimension, label, paperToModel } from "../../annotate/index.ts";
import { frameRect, usableRect, RESERVED_RIGHT } from "../../sheet/paper.ts";
import type { ViewModel } from "../../sheet/build.ts";
import { textHeightUm } from "../../titleblock/index.ts";
import type { Annotation, DraftingInput, Mm, PaperUm, Prim, SheetChecks, Vec } from "../../sheet/types.ts";
import { at, edgeFrame, nearestEdge } from "./geom.ts";
import { planParking } from "./parking.ts";

export const SITE_PLAN_VIEW_ID = "site";

/**
 * JudgmentResult에 아직 없는 근거를 구조적 타입으로 받는다(rules 패키지를 import하지 않는다).
 * 둘 다 생략 가능: 이격 점 쌍이 없으면 geometry 최단거리로 "위치만" 찾고(표시 값은 항상 판정 값),
 * 장애인 대수가 없으면 0대로 본다.
 */
export interface SitePlanExtras {
  /** rules가 이격 판정에 쓴 최단거리 점 쌍 [매스 위의 점, 대지 경계 위의 점]. */
  setback_pair?: [Vec<Mm>, Vec<Mm>];
  /** 판정 주차 대수 중 장애인 전용 대수. */
  parking_accessible?: number;
}

const ITEM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  coverage: "건폐율",
  far: "용적률",
  height: "높이",
  sunlight: "일조",
  setback: "이격거리",
  parking: "주차대수",
  seismic: "내진",
  zero_energy: "제로에너지",
  supervision: "감리",
});
/** 요약표에 항상 싣는 항목(있을 때). 그 밖의 항목은 FAIL일 때만 싣는다. */
const TABLE_KEYS = ["coverage", "far", "height", "setback", "parking"] as const;

type Item = DraftingInput["judgment"]["items"][number];

/** 소수 둘째 자리까지(끝 0 유지) 고정 표기. */
function fmt2(v: number): string {
  const n = roundHalfAway(v * 100);
  const a = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

function fmtValue(it: Item, v: number | undefined): string {
  if (v === undefined) return "-";
  switch (it.unit) {
    case "pct":
      return `${fmt2(v)}%`;
    case "mm":
      return String(roundHalfAway(v));
    case "m2":
      return fmt2(v);
    case "count":
      return String(roundHalfAway(v));
    default:
      return "-";
  }
}

const numeric = (it: Item) => it.unit !== "bool";

function ring(p: Polygon): Vec<Mm>[] {
  return p.outer.map(([x, y]) => [x, y] as Vec<Mm>);
}

interface Row {
  item: Item;
  /** 행 윗변 y(용지 0.01mm). */
  top: PaperUm;
}

interface TableLayout {
  x0: PaperUm;
  x1: PaperUm;
  top: PaperUm;
  step: PaperUm;
  headerH: PaperUm;
  rowH: PaperUm;
  rows: Row[];
  h: PaperUm;
}

function layoutTable(input: DraftingInput): TableLayout {
  const h = textHeightUm(input.profile.default_text_height_mm);
  const step = roundHalfAway(h * 1.5);
  const u = usableRect(input.sheet.paper, input.sheet.orientation, "site_plan");
  const f = frameRect(input.sheet.paper, input.sheet.orientation);
  const items = input.judgment.items;
  const picked: Item[] = [];
  for (const k of TABLE_KEYS) {
    const it = items.find((i) => i.key === k);
    if (it !== undefined) picked.push(it);
  }
  for (const it of items) if (it.verdict === "FAIL" && !picked.includes(it)) picked.push(it);
  const top = f.y1 - 300;
  const headerH = 2 * step;
  const rowH = 3 * step;
  const rows = picked.map((item, i) => ({ item, top: top - headerH - i * rowH }));
  return { x0: u.x1, x1: u.x1 + RESERVED_RIGHT.site_plan, top, step, headerH, rowH, rows, h };
}

function tablePrims(t: TableLayout): Prim<PaperUm>[] {
  const L = "A-ANNO-TEXT" as const;
  const colName = t.x0 + 200;
  const colVal = t.x0 + 5_000;
  const colLim = t.x0 + 7_600;
  const bottom = t.top - t.headerH - t.rows.length * t.rowH;
  const out: Prim<PaperUm>[] = [
    { layer: L, key: "tbl:frame", t: "pline", closed: true, pts: [[t.x0, t.top], [t.x1, t.top], [t.x1, bottom], [t.x0, bottom]] },
    { layer: L, key: "tbl:hdr", t: "line", a: [t.x0, t.top - t.headerH], b: [t.x1, t.top - t.headerH] },
    { layer: L, key: "tbl:title", t: "text", at: [colName, t.top - t.step], h: t.h, s: "건폐율·용적률 요약", align: "l" },
    { layer: L, key: "tbl:h:name", t: "text", at: [colName, t.top - 2 * t.step], h: t.h, s: "항목", align: "l" },
    { layer: L, key: "tbl:h:value", t: "text", at: [colVal, t.top - 2 * t.step], h: t.h, s: "값", align: "r" },
    { layer: L, key: "tbl:h:limit", t: "text", at: [colLim, t.top - 2 * t.step], h: t.h, s: "한도", align: "r" },
  ];
  t.rows.forEach(({ item, top }, i) => {
    const k = String(i).padStart(2, "0");
    const y1 = top - t.step;
    if (i > 0) out.push({ layer: L, key: `tbl:row:${k}`, t: "line", a: [t.x0, top], b: [t.x1, top] });
    out.push({ layer: L, key: `tbl:name:${k}`, t: "text", at: [colName, y1], h: t.h, s: ITEM_NAMES[item.key] ?? item.key, align: "l" });
    const cells: Array<[string, number | undefined, PaperUm]> = [
      ["value", item.value, colVal],
      ["limit", item.limit, colLim],
    ];
    for (const [name, v, x] of cells) {
      const p: Prim<PaperUm> = { layer: L, key: `tbl:${name}:${k}`, t: "text", at: [x, y1], h: t.h, s: numeric(item) ? fmtValue(item, v) : "-", align: "r" };
      if (numeric(item) && v !== undefined) p.source_ref = `judgment.${item.key}.${name}`;
      out.push(p);
    }
  });
  return out;
}

/** FAIL 항목의 "검토 필요" 기호(삼각형)와 라벨. 용지 좌표 주석. */
function failMarks(t: TableLayout): Annotation[] {
  const out: Annotation[] = [];
  for (const { item, top } of t.rows) {
    if (item.verdict !== "FAIL") continue;
    const x = t.x0 + 200;
    const y = top - 2 * t.step;
    const s = t.h;
    out.push({
      anno_id: `warn:review:${item.key}`,
      kind: "warning",
      prims: [
        { layer: "A-ANNO-TEXT", key: "mark", t: "pline", closed: true, pts: [[x, y], [x + s, y], [x + roundHalfAway(s / 2), y + s]] },
        { layer: "A-ANNO-TEXT", key: "text", t: "text", at: [x + s + roundHalfAway(s / 2), y], h: t.h, s: "검토 필요", align: "l" },
      ],
      overridable: ["offset", "hide"],
    });
  }
  return out;
}

/** 폐곡선 외곽·구멍을 닫힌 pline으로. */
function pushPolygon(prims: Prim<Mm>[], layer: "A-SITE-BNDY" | "A-SITE-SETB" | "A-MASS", key: string, p: Polygon): void {
  prims.push({ layer, key, t: "pline", closed: true, pts: ring(p) });
  (p.holes ?? []).forEach((hole, j) => {
    prims.push({ layer, key: `${key}:hole:${String(j).padStart(2, "0")}`, t: "pline", closed: true, pts: hole.map(([x, y]) => [x, y] as Vec<Mm>) });
  });
}

function minDistancePair(site: Polygon, footprints: Array<{ id: string; fp: Polygon }>): { pair: [Vec<Mm>, Vec<Mm>]; mass_id: string } | null {
  const xs = site.outer.map((p) => p[0]);
  const ys = site.outer.map((p) => p[1]);
  const pad = 10_000;
  const [x0, x1] = [Math.min(...xs) - pad, Math.max(...xs) + pad];
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  // 대지 바깥을 채운 고리 모양 다각형: 매스는 구멍(대지) 안에 있어 "겹침"이 아니므로 대지 경계까지의 거리가 나온다.
  const annulus: Polygon = {
    outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    holes: [site.outer.map(([x, y]) => [x, y] as Point)],
  };
  let best: { num: bigint; den: bigint; pair: [Vec<Mm>, Vec<Mm>]; id: string } | null = null;
  for (const { id, fp } of footprints) {
    const d = distance(fp, annulus);
    const { num, den } = d.d2_exact;
    if (best === null || num * best.den < best.num * den) {
      best = { num, den, pair: [[d.pair[0][0], d.pair[0][1]], [d.pair[1][0], d.pair[1][1]]], id };
    }
  }
  return best === null ? null : { pair: best.pair, mass_id: best.id };
}

export function buildSitePlanView(input: DraftingInput, extras: SitePlanExtras = {}): ViewModel {
  const { model, judgment } = input;
  const site = model.site;
  const siteRing = site.boundary.outer;
  const item = (k: Item["key"]) => judgment.items.find((i) => i.key === k);
  const prims: Prim<Mm>[] = [];

  // 1) 대지 경계
  pushPolygon(prims, "A-SITE-BNDY", "site", site.boundary);

  // 2) 이격선(판정 한도만큼 안쪽 오프셋) · 건축선
  const setbackItem = item("setback");
  const limit = setbackItem?.limit === undefined ? 0 : roundHalfAway(setbackItem.limit);
  if (limit > 0) {
    offset(site.boundary, -limit).forEach((p, i) => pushPolygon(prims, "A-SITE-SETB", `setb:${String(i).padStart(2, "0")}`, p));
  }
  const bl = site.zoning.building_line;
  if (bl !== undefined && bl.length >= 2) {
    prims.push({ layer: "A-SITE-SETB", key: "setb:bldline", t: "pline", closed: false, pts: bl.map(([x, y]) => [x, y] as Vec<Mm>) });
  }

  // 3) 도로: 도로 변을 바깥쪽으로 폭만큼 민 띠
  const roadEdges: number[] = [];
  const roadLabels: Array<{ edge: number; idx: number; at: Vec<Mm>; width: Mm }> = [];
  site.roads.forEach((road, idx) => {
    const f = edgeFrame(siteRing, road.edge_index);
    if (f === null || road.width_mm <= 0) return;
    roadEdges.push(road.edge_index);
    const w = road.width_mm;
    prims.push({
      layer: "A-SITE-ROAD",
      key: `road:${String(road.edge_index).padStart(3, "0")}`,
      t: "pline",
      closed: true,
      pts: [at(f, 0, 0), at(f, f.len, 0), at(f, f.len, -w), at(f, 0, -w)],
    });
    roadLabels.push({ edge: road.edge_index, idx, at: at(f, f.len / 2, -w / 2), width: w });
  });

  // 4) 매스 최외곽 = 층이 있는 매스 외곽의 합집합
  const built = model.masses.filter((m) => m.floors.length > 0);
  const massUnion = built.length > 0 ? union(built.map((m) => m.footprint)) : [];
  massUnion.forEach((p, i) => pushPolygon(prims, "A-MASS", `mass:${String(i).padStart(3, "0")}`, p));

  // 5) 주차구획(대수는 판정 값)
  const parkItem = item("parking");
  const parkTotal = parkItem?.value === undefined ? 0 : Math.max(0, roundHalfAway(parkItem.value));
  const plan = planParking({
    site_ring: siteRing,
    road_edges: roadEdges,
    obstacles: massUnion,
    total: parkTotal,
    accessible: extras.parking_accessible ?? 0,
  });
  const text_h = textHeightUm(input.profile.default_text_height_mm);
  for (const b of plan.bays) {
    const key = `park:${String(b.edge).padStart(3, "0")}:${String(b.seq).padStart(3, "0")}`;
    prims.push({ layer: "A-PARK", key, t: "pline", closed: true, pts: b.pts });
    if (b.kind === "accessible") prims.push({ layer: "A-PARK", key: `${key}:mark`, t: "text", at: b.center, h: text_h, s: "장애인", align: "c" });
  }

  // 6) 최단 이격
  const setbackValue = setbackItem?.value === undefined ? undefined : roundHalfAway(setbackItem.value);
  const footprints = built.map((m) => ({ id: m.id, fp: m.footprint }));
  let pair: [Vec<Mm>, Vec<Mm>] | null = null;
  let pairMass = built[0]?.id ?? "none";
  if (setbackValue !== undefined && footprints.length > 0) {
    if (extras.setback_pair !== undefined) pair = extras.setback_pair;
    else {
      const found = minDistancePair(site.boundary, footprints);
      if (found !== null) {
        pair = found.pair;
        pairMass = found.mass_id;
      }
    }
  }

  const table = layoutTable(input);
  const checks: SheetChecks = { area_table_m2: {} };
  for (const it of judgment.items) if (it.unit === "m2" && it.value !== undefined) checks.area_table_m2[it.key] = it.value;
  if (parkItem?.value !== undefined) checks.parking_count = parkTotal;
  if (setbackValue !== undefined) checks.min_setback_mm = setbackValue;

  const failed = (k: Item["key"]) => item(k)?.verdict === "FAIL";

  return {
    views: [{ view_id: SITE_PLAN_VIEW_ID, prims }],
    paper_prims: tablePrims(table),
    checks,
    annotate: (ctx) => {
      const out: Annotation[] = [...failMarks(table)];
      const view_id = SITE_PLAN_VIEW_ID;
      const lineStep = paperToModel(roundHalfAway(ctx.text_h * 1.5), ctx.scale);

      for (const r of roadLabels) {
        out.push(
          label(
            {
              anno_id: `label:road:edge${r.edge}`,
              kind: "label",
              view_id,
              at: r.at,
              lines: [{ kind: "value", s: `도로 폭 ${r.width}`, source_ref: `model.site.roads[${r.idx}].width_mm` }],
              layer: "A-SITE-ROAD",
            },
            ctx,
          ),
        );
      }

      const parcel = site.parcel.address_label ?? site.parcel.pnu;
      if (parcel !== undefined && parcel !== "") {
        const xs = siteRing.map((p) => p[0]);
        const ys = siteRing.map((p) => p[1]);
        out.push(
          label(
            {
              anno_id: "label:parcel",
              kind: "label",
              view_id,
              at: [roundHalfAway((Math.min(...xs) + Math.max(...xs)) / 2), Math.min(...ys) + lineStep],
              lines: [{ s: parcel }],
              layer: "A-SITE-BNDY",
            },
            ctx,
          ),
        );
      }

      if (pair !== null && setbackValue !== undefined && (pair[0][0] !== pair[1][0] || pair[0][1] !== pair[1][1])) {
        const edge = nearestEdge(siteRing, pair[1]);
        out.push(
          dimension(
            {
              anno_id: `dim:setback:edge${edge}:mass-${pairMass}`,
              view_id,
              a: pair[0],
              b: pair[1],
              offset: 0,
              value_mm: setbackValue,
              source_ref: "judgment.setback.value",
            },
            ctx,
          ),
        );
        if (failed("setback")) {
          out.push(
            label(
              {
                anno_id: "warn:review:setback:view",
                kind: "warning",
                view_id,
                at: [roundHalfAway((pair[0][0] + pair[1][0]) / 2), roundHalfAway((pair[0][1] + pair[1][1]) / 2) + lineStep],
                lines: [{ s: "검토 필요" }],
              },
              ctx,
            ),
          );
        }
      }

      if (parkTotal > 0 && plan.anchor !== null) {
        if (plan.shortfall > 0) {
          out.push(
            label(
              {
                anno_id: "warn:parking:shortage",
                kind: "warning",
                view_id,
                at: plan.anchor,
                lines: [
                  { s: "배치 공간 부족" },
                  { kind: "value", s: `필요 ${parkTotal}대`, source_ref: "judgment.parking.value" },
                  { kind: "value", s: `배치 ${plan.placed}대`, source_ref: "site_plan.parking.placed" },
                ],
              },
              ctx,
            ),
          );
        }
        if (failed("parking")) {
          out.push(
            label(
              {
                anno_id: "warn:review:parking:view",
                kind: "warning",
                view_id,
                at: [plan.anchor[0], plan.anchor[1] + 4 * lineStep],
                lines: [{ s: "검토 필요" }],
              },
              ctx,
            ),
          );
        }
      }
      return out;
    },
  };
}
