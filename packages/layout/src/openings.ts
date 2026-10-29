// 문·창 위치 계산(AR-F-032 "문·창 심볼, 벽 위 위치·폭"). 계약(04_API.md 4.7.1): host = {room_id, edge_index}, offset_mm, width_mm.
// edge_index는 저장된 외곽 고리 순서 그대로의 변(outer[i] → outer[i+1])이고, offset은 그 변 시작점에서 변을 따라 잰 mm다.
// 변 범위를 벗어나거나(offset < 0, width ≤ 0, offset + width > 변 길이) 같은 벽에서 다른 개구부와 겹치면 AR051(kind opening).
// 길이 비교는 제곱 정수(bigint)로 해서 대각선 변도 정확하다. 위치 점만 half-away 반올림한다.
import type { Point } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import type { Pt } from "./predicates.ts";
import { lineOf, thicknessOf, type WallPiece } from "./walls.ts";
import type { FloorLayout, LayoutIssue, OpeningPlacement, Room, WallKind, WallSpec } from "./types.ts";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function signedArea2(ring: readonly Pt[]): bigint {
  let s = 0n;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    s += BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
  }
  return s;
}

function rotOf(d: Point): OpeningPlacement["rot_deg"] {
  const [x, y] = d;
  if (x === 1 && y === 0) return 0;
  if (x === 0 && y === 1) return 90;
  if (x === -1 && y === 0) return 180;
  if (x === 0 && y === -1) return 270;
  return null;
}

function openingIssue(room_ids: string[], opening_ids: string[], detail: string): LayoutIssue {
  return { code: "AR051", kind: "opening", room_ids: [...new Set(room_ids)].sort(cmp), opening_ids: [...opening_ids].sort(cmp), detail };
}

const isMm = (v: number) => Number.isSafeInteger(v);

/**
 * 문·창 배치. pieces = wallPieces(실, 외곽) — 개구부가 놓인 벽의 종류(외벽·내벽)와 두께를 정한다.
 * placements는 opening id 사전순, 문제가 있는 개구부는 placements에서 빠지고 issues에 들어간다.
 */
export function placeOpenings(
  layout: { rooms: readonly Room[]; openings: readonly FloorLayout["openings"][number][] },
  pieces: readonly WallPiece[],
  walls: WallSpec,
): { placements: OpeningPlacement[]; issues: LayoutIssue[] } {
  const rooms = new Map<string, Room>();
  for (const r of layout.rooms) if (!rooms.has(r.id)) rooms.set(r.id, r);
  const issues: LayoutIssue[] = [];
  const placements: OpeningPlacement[] = [];
  const seen = new Set<string>();
  const sorted = [...layout.openings].sort((a, b) => cmp(a.id, b.id));
  for (const op of sorted) {
    const rid = op.host.room_id;
    if (seen.has(op.id)) {
      issues.push(openingIssue([rid], [op.id], `문·창 id ${op.id}이(가) 중복됩니다`));
      continue;
    }
    seen.add(op.id);
    const room = rooms.get(rid);
    if (room === undefined) {
      issues.push(openingIssue([], [op.id], `문·창 ${op.id}의 호스트 실 ${rid}이(가) 없습니다`));
      continue;
    }
    const ring = room.polygon.outer;
    const n = ring.length;
    if (!(Number.isSafeInteger(op.host.edge_index) && op.host.edge_index >= 0 && op.host.edge_index < n)) {
      issues.push(openingIssue([rid], [op.id], `문·창 ${op.id}: 실 ${rid}에 ${op.host.edge_index}번 변이 없습니다`));
      continue;
    }
    const a = ring[op.host.edge_index] as Pt;
    const b = ring[(op.host.edge_index + 1) % n] as Pt;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
    const o = op.offset_mm;
    const w = op.width_mm;
    if (!isMm(o) || !isMm(w) || o < 0 || w <= 0 || BigInt(o + w) * BigInt(o + w) > len2 || len2 === 0n) {
      issues.push(openingIssue([rid], [op.id], `문·창 ${op.id}이(가) 실 ${rid}의 ${op.host.edge_index}번 변 범위를 벗어납니다`));
      continue;
    }
    const l = lineOf(a, b);
    if (l === null) continue; // len2 > 0이라 오지 않는다
    const { line } = l;
    const len = Math.sqrt(Number(len2));
    const ul = Math.sqrt(line.l2);
    const sgn = dx * line.ux + dy * line.uy > 0 ? 1 : -1; // 변 방향 = ±u
    const t0 = l.ta + sgn * o * ul;
    const t1 = l.ta + sgn * (o + w) * ul;
    const at = (s: number): Point => [roundHalfAway(a[0] + (s * dx) / len), roundHalfAway(a[1] + (s * dy) / len)];
    // 실 안쪽이 국소 +y가 되게: 고리가 반시계면 변 방향 그대로, 시계면 반대 방향.
    const ccw = signedArea2(ring) > 0n;
    const ux = ccw ? sgn * line.ux : -sgn * line.ux;
    const uy = ccw ? sgn * line.uy : -sgn * line.uy;
    const dir: Point = [ux + 0, uy + 0];
    const pa = at(o);
    const pb = at(o + w);
    const mid = (t0 + t1) / 2;
    const host = pieces.find((p) => p.line.key === line.key && p.lo <= mid && mid <= p.hi);
    const wall: WallKind = host?.kind ?? "interior";
    placements.push({
      opening_id: op.id,
      kind: op.kind,
      room_id: rid,
      width_mm: w,
      swing: op.swing ?? "left",
      wall,
      thickness_mm: thicknessOf(wall, walls),
      origin: ccw ? pa : pb,
      dir,
      rot_deg: rotOf(dir),
      a: pa,
      b: pb,
      line_key: line.key,
      t: [Math.min(t0, t1), Math.max(t0, t1)],
    });
  }
  // 같은 벽 직선에서 구간이 겹치는 개구부(길이 > 0 공유).
  const byLine = new Map<string, OpeningPlacement[]>();
  for (const p of placements) byLine.set(p.line_key, [...(byLine.get(p.line_key) ?? []), p]);
  const bad = new Set<string>();
  for (const key of [...byLine.keys()].sort(cmp)) {
    const list = (byLine.get(key) as OpeningPlacement[]).slice().sort((x, y) => x.t[0] - y.t[0] || cmp(x.opening_id, y.opening_id));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i] as OpeningPlacement;
        const q = list[j] as OpeningPlacement;
        if (q.t[0] >= p.t[1]) break;
        issues.push(openingIssue([p.room_id, q.room_id], [p.opening_id, q.opening_id], `문·창 ${p.opening_id}과(와) ${q.opening_id}이(가) 같은 벽에서 겹칩니다`));
        bad.add(p.opening_id);
        bad.add(q.opening_id);
      }
    }
  }
  return { placements: placements.filter((p) => !bad.has(p.opening_id)), issues };
}
