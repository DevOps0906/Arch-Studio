// 실 겹침·층 외곽 이탈 검사(AR051, PRD AR-F-032 "저장 전에 오류"). 정수 연산만.
// 판정 정의: 내부(넓이 > 0)가 겹치면 위반, 경계(변·꼭짓점) 접촉은 허용. 층 외곽 = 그 층 매스 외곽의 합집합(geometry.union).
// 빠른 경로(상자·교차·표본점)로 대부분 결론을 내고, 애매한 경우(경계만 닿음)만 합집합 면적을 비교한다.
// 합집합 면적 비교가 정확한 이유: 변끼리 가로지르지 않으면(가로지르면 이미 겹침/이탈로 결론) 합집합의 꼭짓점은
// 입력 꼭짓점뿐이라 스냅 반올림이 일어나지 않는다 → area2(A∪B) = area2(A) + area2(B) ⇔ 내부가 겹치지 않음.
import type { DesignModelV1, Polygon } from "@arch-studio/domain";
import { GeometryError, normalizePolygon, union } from "@arch-studio/geometry";
import {
  anyEdgeHit,
  boxInteriorsOverlap,
  boxOf,
  pointInPolygon2,
  pointInPolygons2,
  ringsOf,
  samplePoints2,
  type Box,
  type Pt,
} from "./predicates.ts";
import { LayoutError, type FloorLayout, type LayoutIssue, type Room } from "./types.ts";

/** 검사용으로 준비한 실(정규화 다각형·고리·상자·2배 면적). */
export interface PreparedRoom {
  id: string;
  poly: Polygon;
  rings: Pt[][];
  box: Box;
  area2: bigint;
}

/** 준비된 층 외곽. */
export interface PreparedOutline {
  polys: Polygon[];
  rings: Pt[][];
  box: Box;
  area2: bigint;
}

function ringArea2(ring: readonly Pt[]): bigint {
  let s = 0n;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    s += BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
  }
  return s < 0n ? -s : s;
}

/** 정규화된 다각형의 2배 면적(외곽 − 구멍, 정확). */
export function polygonArea2(p: Polygon): bigint {
  let s = ringArea2(p.outer);
  for (const h of p.holes ?? []) s -= ringArea2(h);
  return s;
}

const sumArea2 = (polys: readonly Polygon[]) => polys.reduce((s, p) => s + polygonArea2(p), 0n);

/** 실 다각형 검사·정규화. 실패면 GeometryError 코드. */
export function prepareRoom(room: Room): PreparedRoom | { id: string; error: string } {
  try {
    const poly = normalizePolygon(room.polygon);
    return { id: room.id, poly, rings: ringsOf(poly), box: boxOf([poly]), area2: polygonArea2(poly) };
  } catch (e) {
    if (e instanceof GeometryError) return { id: room.id, error: e.code };
    throw e;
  }
}

export function prepareOutline(polys: readonly Polygon[]): PreparedOutline {
  const ps = polys.map((p) => normalizePolygon(p));
  return { polys: ps, rings: ps.flatMap(ringsOf), box: boxOf(ps), area2: sumArea2(ps) };
}

/**
 * 층 외곽(벽 중심선) = floor_id 층과 같은 level을 가진 모든 매스 외곽의 합집합. 정렬된 Polygon[].
 * floor_id가 모델에 없으면 LayoutError(UNKNOWN_FLOOR).
 */
export function floorOutline(model: Pick<DesignModelV1, "masses">, floor_id: string): Polygon[] {
  let level: number | undefined;
  for (const m of model.masses) for (const f of m.floors) if (f.id === floor_id) level = f.level;
  if (level === undefined) throw new LayoutError("UNKNOWN_FLOOR", `모델에 없는 층입니다(${floor_id})`);
  const feet = model.masses.filter((m) => m.floors.some((f) => f.level === level)).map((m) => m.footprint);
  return union(feet);
}

/** 두 실의 내부가 겹치는가(경계 접촉은 false). */
export function roomsOverlap(a: PreparedRoom, b: PreparedRoom): boolean {
  if (!boxInteriorsOverlap(a.box, b.box)) return false;
  if (anyEdgeHit(a.rings, b.rings, false)) return true;
  for (const p of samplePoints2(a.poly)) if (pointInPolygon2(p, b.poly) === 1) return true;
  for (const p of samplePoints2(b.poly)) if (pointInPolygon2(p, a.poly) === 1) return true;
  return sumArea2(union([a.poly, b.poly])) < a.area2 + b.area2;
}

/** 실이 층 외곽 밖으로 나가는가(외곽 경계 위에 놓인 변은 허용). */
export function roomOutside(r: PreparedRoom, o: PreparedOutline): boolean {
  if (o.polys.length === 0) return true;
  if (r.box[0] < o.box[0] || r.box[1] < o.box[1] || r.box[2] > o.box[2] || r.box[3] > o.box[3]) return true;
  let allInside = true;
  for (const p of samplePoints2(r.poly)) {
    const s = pointInPolygons2(p, o.polys);
    if (s === -1) return true;
    if (s === 0) allInside = false;
  }
  if (anyEdgeHit(r.rings, o.rings, false)) return true;
  // 빠른 수락: 표본점이 모두 외곽 안, 실 변이 외곽 경계와 닿지 않고, 외곽 꼭짓점(구멍 포함)이 실 안에 없음.
  if (allInside && !anyEdgeHit(r.rings, o.rings, true)) {
    let holeInside = false;
    for (const ring of o.rings) {
      for (const [x, y] of ring) if (pointInPolygon2([x * 2, y * 2], r.poly) === 1) holeInside = true;
    }
    if (!holeInside) return false;
  }
  return sumArea2(union([...o.polys, r.poly])) > o.area2;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const KIND_ORDER = { invalid: 0, outside: 1, overlap: 2, opening: 3 } as const;

/** 위반 목록의 고정 순서: 종류 → 실 id → 문·창 id. */
export function sortIssues(issues: LayoutIssue[]): LayoutIssue[] {
  const key = (i: LayoutIssue) => `${i.room_ids.join("\u0000")}\u0001${(i.opening_ids ?? []).join("\u0000")}`;
  return issues.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || cmp(key(a), key(b)) || cmp(a.detail, b.detail));
}

export function overlapIssue(a: string, b: string): LayoutIssue {
  const ids = [a, b].sort(cmp);
  return { code: "AR051", kind: "overlap", room_ids: ids, detail: `실 ${ids[0]}과(와) ${ids[1]}이(가) 겹칩니다` };
}

export function outsideIssue(id: string): LayoutIssue {
  return { code: "AR051", kind: "outside", room_ids: [id], detail: `실 ${id}이(가) 층 외곽 밖에 있습니다` };
}

export interface RoomCheck {
  prepared: PreparedRoom[];
  issues: LayoutIssue[];
}

/** 실 다각형 검사 + 모든 쌍 겹침 + 외곽 이탈. 결과 issues는 정렬되어 있다. */
export function checkRooms(rooms: FloorLayout["rooms"], outline: PreparedOutline): RoomCheck {
  const issues: LayoutIssue[] = [];
  const prepared: PreparedRoom[] = [];
  const seen = new Set<string>();
  for (const room of rooms) {
    if (seen.has(room.id)) {
      issues.push({ code: "AR051", kind: "invalid", room_ids: [room.id], detail: `실 id ${room.id}이(가) 중복됩니다` });
      continue;
    }
    seen.add(room.id);
    const p = prepareRoom(room);
    if ("error" in p) {
      issues.push({ code: "AR051", kind: "invalid", room_ids: [room.id], detail: `실 ${room.id} 다각형 오류(${p.error})` });
      continue;
    }
    prepared.push(p);
  }
  // x 최소값 순으로 훑어 상자 x 구간이 겹치는 쌍만 본다(결정적 순서).
  const order = prepared.map((_, i) => i).sort((i, j) => (prepared[i] as PreparedRoom).box[0] - (prepared[j] as PreparedRoom).box[0] || i - j);
  for (let oi = 0; oi < order.length; oi++) {
    const a = prepared[order[oi] as number] as PreparedRoom;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const b = prepared[order[oj] as number] as PreparedRoom;
      if (b.box[0] >= a.box[2]) break;
      if (roomsOverlap(a, b)) issues.push(overlapIssue(a.id, b.id));
    }
  }
  for (const r of prepared) if (roomOutside(r, outline)) issues.push(outsideIssue(r.id));
  return { prepared, issues: sortIssues(issues) };
}
