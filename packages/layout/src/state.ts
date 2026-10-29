// 실 면적·목표 차이와 편집 상태(AR-F-032 "실 경계를 옮긴 뒤 p95 100ms 안에 면적과 목표 차이 갱신", 04_API.md validate_layout).
// 면적 = 실 다각형(벽 중심선) 2배 면적의 정확한 정수 → ㎡ × 100 half-away. 목표 = program.targets 중 이름이 같은 첫 행.
// 경계 이동(moveBoundary)은 바뀐 실만 다시 잰다: 면적 행, 그 실이 낀 겹침 쌍, 외곽 이탈, 문·창. 결과는 전체 재검사와 같다(속성 테스트).
import type { DesignModelV1, Point, Polygon } from "@arch-studio/domain";
import { roundHalfAway, roundRatioHalfAway } from "@arch-studio/geometry";
import {
  checkRooms,
  floorOutline,
  outsideIssue,
  overlapIssue,
  prepareOutline,
  prepareRoom,
  roomOutside,
  roomsOverlap,
  sortIssues,
  type PreparedOutline,
  type PreparedRoom,
} from "./check.ts";
import { placeOpenings } from "./openings.ts";
import type { Pt } from "./predicates.ts";
import { DEFAULT_WALLS, LayoutError, type BoundaryMove, type FloorLayout, type LayoutIssue, type ProgramTarget, type Room, type RoomAreaRow, type WallSpec } from "./types.ts";

function ringAbs2(ring: readonly Pt[]): bigint {
  let s = 0n;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    s += BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
  }
  return s < 0n ? -s : s;
}

/** 실 다각형의 2배 면적(|외곽| − Σ|구멍|, 방향 무관, 정확). 검사는 하지 않는다(위반은 issues가 알린다). */
export function roomArea2(p: Polygon): bigint {
  let s = ringAbs2(p.outer);
  for (const h of p.holes ?? []) s -= ringAbs2(h);
  return s;
}

/** 2배 면적(mm²) → ㎡ × 100(half-away). 0.01㎡ = 10^4mm². area_plan(h100OfArea2)과 같은 식. */
export function h100OfArea2(a2: bigint): number {
  return roundRatioHalfAway(a2, 20_000n);
}

/** 목표 ㎡(실수) → ㎡ × 100 정수(half-away). */
export function h100OfM2(m2: number): number {
  return roundHalfAway(m2 * 100);
}

/** 실 이름 → 목표 ㎡ × 100(같은 이름이 여럿이면 첫 행). */
export function targetIndex(targets: readonly ProgramTarget[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of targets) if (!m.has(t.name)) m.set(t.name, h100OfM2(t.target_area_m2));
  return m;
}

export function roomRow(room: Room, targets: ReadonlyMap<string, number>): RoomAreaRow {
  const area_h100 = h100OfArea2(roomArea2(room.polygon));
  const t = targets.get(room.name);
  const target_h100 = t === undefined ? null : t;
  const diff_h100 = target_h100 === null ? null : area_h100 - target_h100;
  return {
    room_id: room.id,
    area_h100,
    target_h100,
    diff_h100,
    area_m2: area_h100 / 100,
    target_diff_m2: diff_h100 === null ? null : diff_h100 / 100,
  };
}

/** 다각형 외곽의 edge_index번 변(꼭짓점 i, i+1)을 (dx, dy) 옮긴 새 다각형. 구멍은 그대로. */
export function moveEdge(p: Polygon, edge_index: number, dx: number, dy: number): Polygon {
  const n = p.outer.length;
  if (!Number.isSafeInteger(edge_index) || edge_index < 0 || edge_index >= n) {
    throw new LayoutError("INVALID_ARGUMENT", `변 번호가 범위 밖입니다(${edge_index})`);
  }
  if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) throw new LayoutError("INVALID_ARGUMENT", `이동량은 mm 정수여야 합니다(${dx}, ${dy})`);
  const j = (edge_index + 1) % n;
  const outer: Point[] = p.outer.map(([x, y], i) => (i === edge_index || i === j ? [x + dx, y + dy] : [x, y]));
  return p.holes === undefined ? { outer } : { outer, holes: p.holes.map((h) => h.map(([x, y]) => [x, y] as Point)) };
}

/** 편집 중인 한 층의 상태(불변 값 — moveBoundary는 새 상태를 돌려준다). */
export interface LayoutState {
  readonly floor_id: string;
  readonly outline: PreparedOutline;
  readonly walls: WallSpec;
  readonly targets: ReadonlyMap<string, number>;
  readonly rooms: readonly Room[];
  readonly openings: FloorLayout["openings"];
  /** 실 id → 준비된 실(다각형 검사 통과·id 유일한 것만). */
  readonly prepared: ReadonlyMap<string, PreparedRoom>;
  /** rooms 순서의 면적·목표 차이. */
  readonly rows: readonly RoomAreaRow[];
  readonly roomIssues: readonly LayoutIssue[];
  readonly openingIssues: readonly LayoutIssue[];
  /** 전체 AR051 목록(정렬). 비어 있어야 저장·시트 생성 가능. */
  readonly issues: readonly LayoutIssue[];
}

export interface LayoutOptions {
  walls?: WallSpec;
}

function layoutOf(model: Pick<DesignModelV1, "floor_layouts">, floor_id: string): FloorLayout {
  const l = model.floor_layouts.find((x) => x.floor_id === floor_id);
  if (l === undefined) throw new LayoutError("UNKNOWN_FLOOR", `실 배치가 없는 층입니다(${floor_id})`);
  return l;
}

function finish(s: Omit<LayoutState, "issues">): LayoutState {
  return { ...s, issues: sortIssues([...s.roomIssues, ...s.openingIssues]) };
}

/** 층 외곽(이미 구한 것)과 실 배치로 상태를 만든다(전체 검사). */
export function createLayoutStateFrom(
  floor_id: string,
  outline: readonly Polygon[],
  layout: Pick<FloorLayout, "rooms" | "openings">,
  targets: readonly ProgramTarget[],
  options: LayoutOptions = {},
): LayoutState {
  const o = prepareOutline(outline);
  const t = targetIndex(targets);
  const rc = checkRooms(layout.rooms, o);
  const prepared = new Map<string, PreparedRoom>();
  for (const p of rc.prepared) prepared.set(p.id, p);
  return finish({
    floor_id,
    outline: o,
    walls: options.walls ?? DEFAULT_WALLS,
    targets: t,
    rooms: layout.rooms,
    openings: layout.openings,
    prepared,
    rows: layout.rooms.map((r) => roomRow(r, t)),
    roomIssues: rc.issues,
    openingIssues: placeOpenings(layout, [], options.walls ?? DEFAULT_WALLS).issues,
  });
}

/** DesignModel의 한 층으로 상태를 만든다. 외곽 = 그 층 매스 외곽 합집합. */
export function createLayoutState(
  model: Pick<DesignModelV1, "masses" | "floor_layouts" | "program">,
  floor_id: string,
  options: LayoutOptions = {},
): LayoutState {
  return createLayoutStateFrom(floor_id, floorOutline(model, floor_id), layoutOf(model, floor_id), model.program.targets, options);
}

/**
 * 경계 이동(여러 개면 함께 — 공유 경계를 끌면 양쪽 실 변을 같이 넘긴다). 바뀐 실만 다시 재고 새 상태를 돌려준다.
 * 없는 실 id·범위 밖 변·정수 아닌 이동량은 LayoutError(호출자 버그).
 */
export function moveBoundary(state: LayoutState, moves: BoundaryMove | readonly BoundaryMove[]): LayoutState {
  const list = Array.isArray(moves) ? (moves as readonly BoundaryMove[]) : [moves as BoundaryMove];
  const index = new Map<string, number>();
  let duplicate = false;
  state.rooms.forEach((r, i) => {
    if (index.has(r.id)) duplicate = true;
    else index.set(r.id, i);
  });
  const rooms = state.rooms.slice();
  const changed = new Set<string>();
  for (const m of list) {
    const i = index.get(m.room_id);
    if (i === undefined) throw new LayoutError("UNKNOWN_ROOM", `없는 실입니다(${m.room_id})`);
    const r = rooms[i] as Room;
    rooms[i] = { ...r, polygon: moveEdge(r.polygon, m.edge_index, m.dx_mm, m.dy_mm) };
    changed.add(m.room_id);
  }
  const layout = { rooms, openings: state.openings };
  if (duplicate) {
    // id 중복 모델은 증분 갱신의 대응이 모호하다 → 전체 재검사(드문 경로).
    return { ...createLayoutStateFrom(state.floor_id, state.outline.polys, layout, [], { walls: state.walls }), targets: state.targets, rows: rooms.map((r) => roomRow(r, state.targets)) };
  }
  const prepared = new Map(state.prepared);
  const issues: LayoutIssue[] = state.roomIssues.filter((x) => !x.room_ids.some((id) => changed.has(id)));
  const fresh: PreparedRoom[] = [];
  for (const id of [...changed].sort()) {
    const p = prepareRoom(rooms[index.get(id) as number] as Room);
    if ("error" in p) {
      prepared.delete(id);
      issues.push({ code: "AR051", kind: "invalid", room_ids: [id], detail: `실 ${id} 다각형 오류(${p.error})` });
    } else {
      prepared.set(id, p);
      fresh.push(p);
    }
  }
  for (const p of fresh) {
    for (const q of prepared.values()) {
      if (q.id === p.id || (changed.has(q.id) && q.id < p.id)) continue; // 바뀐 실끼리는 한 번만
      if (roomsOverlap(p, q)) issues.push(overlapIssue(p.id, q.id));
    }
    if (roomOutside(p, state.outline)) issues.push(outsideIssue(p.id));
  }
  const rows = state.rows.slice();
  for (const id of changed) {
    const i = index.get(id) as number;
    rows[i] = roomRow(rooms[i] as Room, state.targets);
  }
  return finish({
    ...state,
    rooms,
    prepared,
    rows,
    roomIssues: sortIssues(issues),
    openingIssues: placeOpenings(layout, [], state.walls).issues,
  });
}

/** 04_API.md 4.7.5 validate_layout 결과 모양. */
export interface ValidateLayoutResult {
  rooms: Array<{ room_id: string; area_m2: number; target_diff_m2: number | null }>;
  errors: LayoutIssue[];
}

export function validateLayoutResult(state: LayoutState): ValidateLayoutResult {
  return {
    rooms: state.rows.map((r) => ({ room_id: r.room_id, area_m2: r.area_m2, target_diff_m2: r.target_diff_m2 })),
    errors: state.issues.map((i) => ({ ...i, room_ids: [...i.room_ids], ...(i.opening_ids ? { opening_ids: [...i.opening_ids] } : {}) })),
  };
}

/** 한 층 전체 검사(저장 전 AR051, 시트 생성 전 거부 판단). */
export function validateLayout(
  model: Pick<DesignModelV1, "masses" | "floor_layouts" | "program">,
  floor_id: string,
  options: LayoutOptions = {},
): ValidateLayoutResult {
  return validateLayoutResult(createLayoutState(model, floor_id, options));
}
