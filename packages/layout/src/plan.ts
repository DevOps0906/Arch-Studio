// 평면 개략도(drafting floor_plan)가 쓰는 한 층의 도형 묶음: 외곽, 실 면적 행, AR051, 벽 띠, 문·창 배치.
import type { DesignModelV1, Polygon } from "@arch-studio/domain";
import type { PreparedRoom } from "./check.ts";
import { placeOpenings } from "./openings.ts";
import { createLayoutState, type LayoutOptions, type LayoutState } from "./state.ts";
import { wallBands, wallPieces, wallSegments } from "./walls.ts";
import type { LayoutIssue, OpeningPlacement, RoomAreaRow, WallSegment } from "./types.ts";

export interface FloorPlanGeometry {
  floor_id: string;
  /** 층 외곽(벽 중심선, 정규화). */
  outline: Polygon[];
  /** 실(입력 순서), 정규화 다각형. 위반이 있으면 비어 있을 수 있다. */
  rooms: Array<{ id: string; name: string; use: string; polygon: Polygon; row: RoomAreaRow }>;
  issues: LayoutIssue[];
  /** 아래 세 칸은 issues가 비었을 때만 채운다(위반 모델은 그리지 않는다). */
  walls: WallSegment[];
  wall_bands: Polygon[];
  openings: OpeningPlacement[];
  state: LayoutState;
}

export function floorPlanGeometry(model: Pick<DesignModelV1, "masses" | "floor_layouts" | "program">, floor_id: string, options: LayoutOptions = {}): FloorPlanGeometry {
  const state = createLayoutState(model, floor_id, options);
  const rooms = state.rooms.flatMap((r, i) => {
    const p = state.prepared.get(r.id) as PreparedRoom | undefined;
    return p === undefined ? [] : [{ id: r.id, name: r.name, use: r.use, polygon: p.poly, row: state.rows[i] as RoomAreaRow }];
  });
  const base = { floor_id, outline: state.outline.polys, rooms, issues: [...state.issues], state };
  if (state.issues.length > 0) return { ...base, walls: [], wall_bands: [], openings: [] };
  const polys = rooms.map((r) => r.polygon);
  const pieces = wallPieces(polys, state.outline.polys);
  const { placements } = placeOpenings({ rooms: state.rooms, openings: state.openings }, pieces, state.walls);
  return {
    ...base,
    walls: wallSegments(polys, state.outline.polys, state.walls),
    wall_bands: wallBands(polys, state.outline.polys, placements, state.walls),
    openings: placements,
  };
}
