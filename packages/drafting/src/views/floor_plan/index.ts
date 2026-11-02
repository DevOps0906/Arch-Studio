// floor_plan 뷰 생성기(AR-06-026, 02_ARCHITECTURE.md 2.3절 "뷰 생성기" floor_plan 행, PRD AR-F-032).
// 그리는 것: 벽 띠(외벽·내벽, 문·창 자리에서 끊김, A-WALL), 실 외곽(벽 중심선, A-AREA), 문·창 INSERT(A-DOOR·A-GLAZ, 블록은 ViewModel.blocks),
// 실명·면적 라벨(면적 값 TEXT는 source_ref "geometry.area.room:<id>").
// 데이터: DesignModel.floor_layouts의 그 층(sheet.floor_id). @arch-studio/layout 검사(AR051)를 통과한 배치만 그리고, 위반이 있으면 시트를 만들지 않는다.
// 실 면적은 layout(벽 중심선 다각형 정확 2배 면적 → ㎡ × 100 half-away)으로 area_plan과 같은 정의다.
import type { Polygon } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import { floorPlanGeometry, type FloorPlanGeometry, type LayoutIssue, type WallSpec } from "@arch-studio/layout";
import { label, paperToModel, type AnnotateContext } from "../../annotate/index.ts";
import type { ViewModel } from "../../sheet/build.ts";
import { DraftingError } from "../../sheet/errors.ts";
import type { Annotation, DraftingInput, Mm, Prim, Vec } from "../../sheet/types.ts";
import { formatH100 } from "../area_plan/areas.ts";
import { openingPrims } from "./blocks.ts";
import { FloorPlanError } from "./errors.ts";

export { FloorPlanError } from "./errors.ts";
export { blockName as floorPlanBlockName } from "./blocks.ts";

export const FLOOR_PLAN_VIEW_ID = "plan";

export interface FloorPlanOptions {
  /** 벽 두께(mm). 없으면 layout DEFAULT_WALLS(외벽 200·내벽 100, PRD 제안). DraftingProfile에 칸이 없다. */
  walls?: WallSpec;
}

export type FloorPlanResult = { ok: true; view: ViewModel; geometry: FloorPlanGeometry } | { ok: false; code: "AR051"; issues: LayoutIssue[] };

/** 다각형 안의 라벨 점: 상자 중심이 안이면 그것, 아니면 상자 중심 높이의 수평선에서 가장 넓은 안쪽 구간의 가운데. */
export function labelPoint(p: Polygon): Vec<Mm> {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of p.outer) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const y = (y0 + y1) / 2;
  const xs: number[] = [];
  for (const ring of [p.outer, ...(p.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Vec<number>;
      const b = ring[(i + 1) % ring.length] as Vec<number>;
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
  }
  xs.sort((m, n) => m - n);
  const cx = (x0 + x1) / 2;
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const lo = xs[i] as number;
    const hi = xs[i + 1] as number;
    if (lo <= cx && cx <= hi) return [roundHalfAway(cx), roundHalfAway(y)];
    if (best === null || hi - lo > best[1] - best[0]) best = [lo, hi];
  }
  const mid = best === null ? cx : (best[0] + best[1]) / 2;
  return [roundHalfAway(mid), roundHalfAway(y)];
}

const ringPts = (ring: readonly (readonly [number, number])[]): Vec<Mm>[] => ring.map(([x, y]) => [x, y]);

/** AR051 검사 후 뷰를 만든다(값으로 거부). */
export function tryBuildFloorPlanView(input: DraftingInput, options: FloorPlanOptions = {}): FloorPlanResult {
  const floor_id = input.sheet.floor_id;
  if (floor_id === undefined) throw new DraftingError("INVALID_ARGUMENT", "sheet.floor_id: 평면 개략도는 층이 필요합니다");
  if (!input.model.floor_layouts.some((l) => l.floor_id === floor_id)) {
    throw new DraftingError("INVALID_ARGUMENT", `sheet.floor_id: 실 배치가 없는 층입니다(${floor_id})`);
  }
  const g = floorPlanGeometry(input.model, floor_id, options.walls ? { walls: options.walls } : {});
  if (g.issues.length > 0) return { ok: false, code: "AR051", issues: g.issues };
  if (g.outline.length === 0) throw new DraftingError("INVALID_ARGUMENT", `${floor_id}: 층 외곽이 없습니다`);

  const prims: Prim<Mm>[] = [];
  g.wall_bands.forEach((band, i) => {
    const k = `wall:${String(i).padStart(3, "0")}`;
    const loops = [band.outer, ...(band.holes ?? [])].map(ringPts);
    loops.forEach((pts, j) => prims.push({ layer: "A-WALL", key: `${k}:${j === 0 ? "o" : `h${String(j).padStart(3, "0")}`}`, t: "pline", closed: true, pts }));
    prims.push({ layer: "A-WALL", key: `${k}:hatch`, t: "hatch", pattern: "ANSI31", loops });
  });
  for (const r of g.rooms) {
    [r.polygon.outer, ...(r.polygon.holes ?? [])].forEach((ring, j) =>
      prims.push({ layer: "A-AREA", key: `room:${r.id}:${j === 0 ? "o" : `h${String(j).padStart(3, "0")}`}`, t: "pline", closed: true, pts: ringPts(ring) }),
    );
  }
  const op = openingPrims(g.openings);
  prims.push(...op.prims);

  const area_table_m2: Record<string, number> = {};
  let total = 0;
  for (const r of g.rooms) {
    area_table_m2[`room:${r.id}`] = r.row.area_m2;
    total += r.row.area_h100;
  }
  area_table_m2["rooms_total"] = total / 100;

  const annotate = (ctx: AnnotateContext): Annotation[] =>
    g.rooms.map((r) => {
      const [x, y] = labelPoint(r.polygon);
      // 두 줄의 가운데가 실 안 점에 오게 반 줄 올린다.
      const half = paperToModel(roundHalfAway((ctx.text_h * 1.5) / 2), ctx.scale);
      return label(
        {
          anno_id: `label:room:${r.id}`,
          kind: "label",
          view_id: FLOOR_PLAN_VIEW_ID,
          at: [x, y + half],
          lines: [{ s: r.name }, { kind: "value", s: `${formatH100(r.row.area_h100)}㎡`, source_ref: `geometry.area.room:${r.id}` }],
        },
        ctx,
      );
    });

  return {
    ok: true,
    geometry: g,
    view: {
      views: [{ view_id: FLOOR_PLAN_VIEW_ID, prims }],
      blocks: op.blocks,
      checks: { area_table_m2 },
      anchors: g.rooms.map((r) => ({ ref: r.id, ring: ringPts(r.polygon.outer) })),
      annotate,
    },
  };
}

/** 평면 개략도 ViewModel. 실 겹침·외곽 이탈·문창 위치 위반(AR051)이 있으면 FloorPlanError로 시트 생성을 거부한다. */
export function buildFloorPlanView(input: DraftingInput, options: FloorPlanOptions = {}): ViewModel {
  const r = tryBuildFloorPlanView(input, options);
  if (!r.ok) throw new FloorPlanError(r.issues);
  return r.view;
}
