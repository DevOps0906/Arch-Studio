// 평면 편집 연산(순수). 입력 FloorLayout을 바꾸지 않고 새 FloorLayout을 돌려준다(불변). 좌표는 모두 mm 정수.
// 기하·면적·겹침 검사는 @arch-studio/layout·geometry의 결정적 순수 함수만 쓴다. 이 파일은 "무엇을 어떻게 고치는가"만 정하고,
// 고친 결과가 맞는지(AR051)는 analysis.ts가 layout 검사로 알린다. LLM·난수·시계를 쓰지 않는다.
import type { Point, Polygon } from "@arch-studio/domain";
import { normalizePolygon, roundHalfAway, union, validatePolygon } from "@arch-studio/geometry";
import { moveEdge, polygonArea2, type FloorLayout, type Opening, type Room } from "@arch-studio/layout";

export const GRID_MM = 100;
export const GRID_SHIFT_MM = 1_000;
export const DEFAULT_DOOR_MM = 900;
export const DEFAULT_WINDOW_MM = 1_200;

export type Selection =
  | { readonly kind: "none" }
  | { readonly kind: "room"; readonly id: string; readonly edge: number | null }
  | { readonly kind: "opening"; readonly id: string };

export const NO_SELECTION: Selection = { kind: "none" };

export type OpResult = { readonly ok: true; readonly layout: FloorLayout; readonly select?: Selection; readonly notice?: string } | { readonly ok: false; readonly reason: string };

const fail = (reason: string): OpResult => ({ ok: false, reason });

/** 그리드 스냅(half-away). 끄면 정수 mm만 보장한다. */
export function snapMm(v: number, grid: number = GRID_MM): number {
  return grid <= 1 ? roundHalfAway(v) : roundHalfAway(v / grid) * grid;
}

export function snapPoint(p: Point, grid: number = GRID_MM): Point {
  return [snapMm(p[0], grid), snapMm(p[1], grid)];
}

export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!set.has(id)) return id;
  }
}

const roomOf = (l: FloorLayout, id: string): Room | undefined => l.rooms.find((r) => r.id === id);
const withRoom = (l: FloorLayout, room: Room): FloorLayout => ({ ...l, rooms: l.rooms.map((r) => (r.id === room.id ? room : r)) });

/** 변 길이(mm, 정수 반올림). 제곱합의 제곱근은 IEEE 정확 반올림이라 환경과 무관하다. */
export function edgeLength(poly: Polygon, edge: number): number {
  const a = poly.outer[edge] as Point;
  const b = poly.outer[(edge + 1) % poly.outer.length] as Point;
  return roundHalfAway(Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2));
}

export function rectPolygon(x: number, y: number, w: number, h: number): Polygon {
  return {
    outer: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/** 일직선 위 중간 꼭짓점 제거(합치기·분할 뒤 정리). 문·창 호스트 변은 호출자가 다시 찾는다. */
function simplify(points: readonly Point[]): Point[] {
  let pts = dedupe(points);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length] as Point;
      const b = pts[i] as Point;
      const c = pts[(i + 1) % pts.length] as Point;
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

function polygonProblem(p: Polygon): string | null {
  const code = validatePolygon(p);
  return code === null ? null : "실 모양이 올바르지 않습니다(자기 교차이거나 면적이 0입니다).";
}

// ---------- 실 ----------

export function drawRoom(layout: FloorLayout, points: readonly Point[], name: string, use: string): OpResult {
  const pts = dedupe(points);
  if (pts.length < 3) return fail("실은 꼭짓점이 3개 이상이어야 닫을 수 있습니다.");
  const polygon: Polygon = { outer: pts };
  const problem = polygonProblem(polygon);
  if (problem) return fail(problem);
  const id = uniqueId("r", layout.rooms.map((r) => r.id));
  const room: Room = { id, name: name.trim() === "" ? "새 실" : name.trim(), use: use.trim() === "" ? "미정" : use.trim(), polygon };
  return { ok: true, layout: { ...layout, rooms: [...layout.rooms, room] }, select: { kind: "room", id, edge: null } };
}

export function removeRoom(layout: FloorLayout, id: string): OpResult {
  if (!roomOf(layout, id)) return fail("없는 실입니다.");
  const gone = layout.openings.filter((o) => o.host.room_id === id).length;
  return {
    ok: true,
    layout: { ...layout, rooms: layout.rooms.filter((r) => r.id !== id), openings: layout.openings.filter((o) => o.host.room_id !== id) },
    select: NO_SELECTION,
    ...(gone > 0 ? { notice: `실과 함께 문·창 ${gone}개를 지웠습니다.` } : {}),
  };
}

export function renameRoom(layout: FloorLayout, id: string, name: string, use: string): OpResult {
  const r = roomOf(layout, id);
  if (!r) return fail("없는 실입니다.");
  const n = name.trim();
  const u = use.trim();
  if (n === "" || u === "") return fail("이름과 용도는 비울 수 없습니다.");
  if (n.length > 60 || u.length > 60) return fail("이름과 용도는 60자 이하로 적습니다.");
  if (n === r.name && u === r.use) return { ok: true, layout };
  return { ok: true, layout: withRoom(layout, { ...r, name: n, use: u }) };
}

// ---------- 경계 이동 ----------

const samePt = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/**
 * 변 이동. 축에 평행한 변은 수직 방향으로만 움직인다(직각 유지). 같은 두 끝점을 가진 이웃 실의 변(공유 벽)은 함께 옮긴다.
 * 이동 뒤 겹침·이탈은 막지 않는다 — 검사 줄이 AR051로 알리고 저장을 막는다(03장 3.7절).
 */
export function moveRoomEdge(layout: FloorLayout, room_id: string, edge_index: number, dx: number, dy: number): OpResult {
  const room = roomOf(layout, room_id);
  if (!room) return fail("없는 실입니다.");
  const n = room.polygon.outer.length;
  if (!Number.isInteger(edge_index) || edge_index < 0 || edge_index >= n) return fail("없는 변입니다.");
  const a = room.polygon.outer[edge_index] as Point;
  const b = room.polygon.outer[(edge_index + 1) % n] as Point;
  let mx = dx;
  let my = dy;
  if (a[0] === b[0]) my = 0;
  else if (a[1] === b[1]) mx = 0;
  if (mx === 0 && my === 0) return fail("이 변은 그 방향으로 움직이지 않습니다. 변에 수직인 화살표를 쓰세요.");
  const rooms = layout.rooms.map((r) => {
    if (r.id === room_id) return { ...r, polygon: moveEdge(r.polygon, edge_index, mx, my) };
    const m = r.polygon.outer.length;
    for (let i = 0; i < m; i++) {
      const p = r.polygon.outer[i] as Point;
      const q = r.polygon.outer[(i + 1) % m] as Point;
      if ((samePt(p, a) && samePt(q, b)) || (samePt(p, b) && samePt(q, a))) return { ...r, polygon: moveEdge(r.polygon, i, mx, my) };
    }
    return r;
  });
  return { ok: true, layout: { ...layout, rooms } };
}

// ---------- 문·창 ----------

type Span = { a: Point; b: Point; width: number };

/** 개구부의 절대 양 끝(호스트 변 위, 정수 반올림). */
function spanOf(poly: Polygon, o: Opening): Span | null {
  const n = poly.outer.length;
  if (o.host.edge_index < 0 || o.host.edge_index >= n) return null;
  const p = poly.outer[o.host.edge_index] as Point;
  const q = poly.outer[(o.host.edge_index + 1) % n] as Point;
  const len = Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
  if (len === 0) return null;
  const ux = (q[0] - p[0]) / len;
  const uy = (q[1] - p[1]) / len;
  return {
    a: [roundHalfAway(p[0] + ux * o.offset_mm), roundHalfAway(p[1] + uy * o.offset_mm)],
    b: [roundHalfAway(p[0] + ux * (o.offset_mm + o.width_mm)), roundHalfAway(p[1] + uy * (o.offset_mm + o.width_mm))],
    width: o.width_mm,
  };
}

/** 절대 구간을 새 다각형의 한 변 위로 옮긴다. 어느 변에도 들어가지 않으면 null. 직선 오차 1mm 허용(대각선 변). */
function locate(poly: Polygon, s: Span): { edge_index: number; offset_mm: number } | null {
  const n = poly.outer.length;
  for (let i = 0; i < n; i++) {
    const p = poly.outer[i] as Point;
    const q = poly.outer[(i + 1) % n] as Point;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len2 = ex * ex + ey * ey;
    const len = Math.sqrt(len2);
    const inside = (c: Point) => {
      const cross = ex * (c[1] - p[1]) - ey * (c[0] - p[0]);
      const dot = ex * (c[0] - p[0]) + ey * (c[1] - p[1]);
      return Math.abs(cross) <= len && dot >= -len && dot <= len2 + len;
    };
    if (inside(s.a) && inside(s.b)) {
      const da = (ex * (s.a[0] - p[0]) + ey * (s.a[1] - p[1])) / len;
      const db = (ex * (s.b[0] - p[0]) + ey * (s.b[1] - p[1])) / len;
      return { edge_index: i, offset_mm: Math.max(0, roundHalfAway(Math.min(da, db))) };
    }
  }
  return null;
}

/** 실 모양이 바뀐 뒤 그 실의 문·창을 새 변으로 옮긴다. 옮길 곳이 없으면 지우고 개수를 알린다. */
function remap(openings: readonly Opening[], oldRooms: ReadonlyMap<string, Polygon>, newRooms: ReadonlyMap<string, Polygon>, pick?: (o: Opening, span: Span) => string): { openings: Opening[]; dropped: number } {
  const out: Opening[] = [];
  let dropped = 0;
  for (const o of openings) {
    const old = oldRooms.get(o.host.room_id);
    if (!old) {
      out.push(o);
      continue;
    }
    const span = spanOf(old, o);
    const target = span ? (pick ? pick(o, span) : o.host.room_id) : o.host.room_id;
    const poly = newRooms.get(target);
    const at = span && poly ? locate(poly, span) : null;
    if (!at) dropped += 1;
    else out.push({ ...o, host: { room_id: target, edge_index: at.edge_index }, offset_mm: at.offset_mm });
  }
  return { openings: out, dropped };
}

// ---------- 분할 ----------

/** 반평면으로 자른다(Sutherland-Hodgman). keep(c): 좌표 c가 남는 쪽이면 true. 선 위 점은 양쪽에 남는다. */
function clip(pts: readonly Point[], axis: 0 | 1, at: number, side: 1 | -1): Point[] {
  const out: Point[] = [];
  const val = (p: Point) => (p[axis] - at) * side;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Point;
    const q = pts[(i + 1) % pts.length] as Point;
    const vp = val(p);
    const vq = val(q);
    if (vp >= 0) out.push(p);
    if ((vp > 0 && vq < 0) || (vp < 0 && vq > 0)) {
      const t = vp / (vp - vq);
      const [pa, qa] = axis === 0 ? [p[1], q[1]] : [p[0], q[0]];
      const along = roundHalfAway(pa + (qa - pa) * t);
      out.push(axis === 0 ? [at, along] : [along, at]);
    }
  }
  return out;
}

/** 방향 부호 바뀜 횟수(선 위 점은 건너뜀). 2가 아니면 한 번에 두 덩이로 나뉘는 모양이 아니다. */
function crossings(pts: readonly Point[], axis: 0 | 1, at: number): number {
  const signs = pts.map((p) => Math.sign(p[axis] - at)).filter((s) => s !== 0);
  let n = 0;
  for (let i = 0; i < signs.length; i++) if (signs[i] !== signs[(i + 1) % signs.length]) n += 1;
  return n;
}

/** 수직선(axis 0: x = at) 또는 수평선(axis 1: y = at)으로 실을 둘로 나눈다. 앞쪽(작은 좌표)이 원래 id를 가진다. */
export function splitRoom(layout: FloorLayout, room_id: string, axis: 0 | 1, at: number): OpResult {
  const room = roomOf(layout, room_id);
  if (!room) return fail("없는 실입니다.");
  if (!Number.isInteger(at)) return fail("분할 위치는 mm 정수여야 합니다.");
  const pts = room.polygon.outer;
  if (room.polygon.holes && room.polygon.holes.length > 0) return fail("구멍이 있는 실은 나눌 수 없습니다.");
  if (crossings(pts, axis, at) !== 2) return fail("분할선이 실을 정확히 둘로 나누지 못합니다. 위치를 바꾸세요.");
  const low = simplify(clip(pts, axis, at, -1));
  const high = simplify(clip(pts, axis, at, 1));
  const pl = { outer: low } satisfies Polygon;
  const ph = { outer: high } satisfies Polygon;
  if (low.length < 3 || high.length < 3 || polygonProblem(pl) || polygonProblem(ph)) return fail("분할선이 실을 정확히 둘로 나누지 못합니다. 위치를 바꾸세요.");
  if (polygonArea2(normalizePolygon(pl)) + polygonArea2(normalizePolygon(ph)) !== polygonArea2(normalizePolygon(room.polygon))) {
    return fail("분할 뒤 면적이 맞지 않아 취소했습니다. 위치를 바꾸세요.");
  }
  const newId = uniqueId("r", layout.rooms.map((r) => r.id));
  const a: Room = { ...room, polygon: pl };
  const b: Room = { id: newId, name: `${room.name} 2`, use: room.use, polygon: ph };
  const rooms = layout.rooms.flatMap((r) => (r.id === room_id ? [a, b] : [r]));
  const oldMap = new Map([[room_id, room.polygon]]);
  const newMap = new Map<string, Polygon>([
    [room_id, pl],
    [newId, ph],
  ]);
  // 문·창은 자기 구간이 들어가는 쪽 조각으로 따라간다. 분할선에 걸리면 지운다.
  const r = remap(layout.openings, oldMap, newMap, (o, span) => (locate(pl, span) ? room_id : newId));
  return {
    ok: true,
    layout: { ...layout, rooms, openings: r.openings },
    select: { kind: "room", id: room_id, edge: null },
    ...(r.dropped > 0 ? { notice: `분할선에 걸린 문·창 ${r.dropped}개를 지웠습니다.` } : {}),
  };
}

// ---------- 병합 ----------

/** 두 실을 한 실로 합친다. 변이 맞닿아 하나의 구멍 없는 다각형이 될 때만 된다. 앞 실의 id·이름·용도를 유지한다. */
export function mergeRooms(layout: FloorLayout, keep_id: string, other_id: string): OpResult {
  const a = roomOf(layout, keep_id);
  const b = roomOf(layout, other_id);
  if (!a || !b || keep_id === other_id) return fail("합칠 실 두 개를 고르세요.");
  let u: Polygon[];
  try {
    u = union([normalizePolygon(a.polygon), normalizePolygon(b.polygon)]);
  } catch {
    return fail("실 모양이 올바르지 않아 합칠 수 없습니다.");
  }
  const only = u[0];
  if (u.length !== 1 || !only || (only.holes && only.holes.length > 0)) return fail("두 실이 변으로 맞닿아 있지 않아 합칠 수 없습니다.");
  const merged: Polygon = { outer: simplify(only.outer) };
  if (merged.outer.length < 3 || polygonProblem(merged)) return fail("합친 모양이 올바르지 않습니다.");
  const rooms = layout.rooms.filter((r) => r.id !== other_id).map((r) => (r.id === keep_id ? { ...r, polygon: merged } : r));
  const oldMap = new Map([
    [keep_id, a.polygon],
    [other_id, b.polygon],
  ]);
  const newMap = new Map([[keep_id, merged]]);
  const r = remap(layout.openings, oldMap, newMap, (o) => (o.host.room_id === other_id ? keep_id : o.host.room_id));
  return {
    ok: true,
    layout: { ...layout, rooms, openings: r.openings },
    select: { kind: "room", id: keep_id, edge: null },
    ...(r.dropped > 0 ? { notice: `맞닿은 벽의 문·창 ${r.dropped}개를 지웠습니다.` } : {}),
  };
}

// ---------- 문·창 편집 ----------

export function addOpening(layout: FloorLayout, room_id: string, edge_index: number, kind: Opening["kind"], width_mm?: number, prefer_center_mm?: number): OpResult {
  const room = roomOf(layout, room_id);
  if (!room) return fail("먼저 실을 고르세요.");
  const n = room.polygon.outer.length;
  if (!Number.isInteger(edge_index) || edge_index < 0 || edge_index >= n) return fail("먼저 벽(변)을 고르세요. [ ] 키로 변을 바꿉니다.");
  const len = edgeLength(room.polygon, edge_index);
  const width = Math.min(width_mm ?? (kind === "door" ? DEFAULT_DOOR_MM : DEFAULT_WINDOW_MM), snapMm(len, GRID_MM));
  if (width < GRID_MM) return fail("이 벽은 너무 짧아 놓을 수 없습니다.");
  const taken = layout.openings.filter((o) => o.host.room_id === room_id && o.host.edge_index === edge_index);
  const free = (off: number) => taken.every((o) => off + width <= o.offset_mm || o.offset_mm + o.width_mm <= off);
  const center = Math.max(0, Math.min(len - width, snapMm(prefer_center_mm === undefined ? (len - width) / 2 : prefer_center_mm - width / 2)));
  let offset: number | null = null;
  const candidates = [center];
  for (let d = GRID_MM; d <= len; d += GRID_MM) candidates.push(center + d, center - d);
  for (const c of candidates) {
    if (c >= 0 && c + width <= len && free(c)) {
      offset = c;
      break;
    }
  }
  if (offset === null) return fail("이 벽에는 빈 자리가 없습니다. 다른 벽을 고르세요.");
  const id = uniqueId(kind === "door" ? "d" : "w", layout.openings.map((o) => o.id));
  const o: Opening = kind === "door" ? { id, kind, host: { room_id, edge_index }, offset_mm: offset, width_mm: width, swing: "left" } : { id, kind, host: { room_id, edge_index }, offset_mm: offset, width_mm: width };
  return { ok: true, layout: { ...layout, openings: [...layout.openings, o] }, select: { kind: "opening", id } };
}

/** 포인터로 벽 위를 눌러 놓기: 누른 지점(변 시작점부터 mm)이 개구부 가운데가 되게 한다. */
export function addOpeningAt(layout: FloorLayout, room_id: string, edge_index: number, offset_hint_mm: number, kind: Opening["kind"]): OpResult {
  return addOpening(layout, room_id, edge_index, kind, undefined, offset_hint_mm);
}

/** 포인터로 실을 눌러 나눌 때의 분할선: 상자가 가로로 길면 세로선(X), 아니면 가로선(Y), 위치는 누른 점. */
export function pointerSplit(layout: FloorLayout, room_id: string, p: Point): { axis: 0 | 1; at: number } {
  const room = roomOf(layout, room_id);
  if (!room) return { axis: 0, at: p[0] };
  const xs = room.polygon.outer.map((q) => q[0]);
  const ys = room.polygon.outer.map((q) => q[1]);
  const wide = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  return wide ? { axis: 0, at: p[0] } : { axis: 1, at: p[1] };
}

export interface OpeningPatch {
  readonly offset_mm?: number;
  readonly width_mm?: number;
  readonly swing?: "left" | "right";
}

export function updateOpening(layout: FloorLayout, id: string, patch: OpeningPatch): OpResult {
  const o = layout.openings.find((x) => x.id === id);
  if (!o) return fail("없는 문·창입니다.");
  const offset = patch.offset_mm ?? o.offset_mm;
  const width = patch.width_mm ?? o.width_mm;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(width) || width <= 0 || offset < 0) return fail("위치와 폭은 0보다 큰 mm 정수로 적습니다.");
  const next: Opening = { ...o, offset_mm: offset, width_mm: width, ...(o.kind === "door" ? { swing: patch.swing ?? o.swing ?? "left" } : {}) };
  return { ok: true, layout: { ...layout, openings: layout.openings.map((x) => (x.id === id ? next : x)) } };
}

/** 문·창을 벽을 따라 미끄러뜨린다. 변 범위 안으로 가둔다. */
export function slideOpening(layout: FloorLayout, id: string, delta_mm: number): OpResult {
  const o = layout.openings.find((x) => x.id === id);
  const room = o ? roomOf(layout, o.host.room_id) : undefined;
  if (!o || !room) return fail("없는 문·창입니다.");
  const len = edgeLength(room.polygon, o.host.edge_index);
  const offset = Math.max(0, Math.min(len - o.width_mm, o.offset_mm + delta_mm));
  if (offset === o.offset_mm) return fail("벽 끝입니다.");
  return updateOpening(layout, id, { offset_mm: offset });
}

export function removeOpening(layout: FloorLayout, id: string): OpResult {
  if (!layout.openings.some((o) => o.id === id)) return fail("없는 문·창입니다.");
  return { ok: true, layout: { ...layout, openings: layout.openings.filter((o) => o.id !== id) }, select: NO_SELECTION };
}
