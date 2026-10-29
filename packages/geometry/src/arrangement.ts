// 정수 평면 배치(arrangement): 방향 있는 선분 묶음 → 감김수 > 0 영역(positive fill)의 다각형.
// 1) 반복 스냅 라운딩(Hobby 핫 픽셀): 교차점을 half-away로 반올림한 정수점(핫 픽셀)과 끝점을 지나는 선분을
//    그 점에 꺾어 통과시킨다. 교차·T자 접촉이 없어질 때까지 되풀이한다.
// 2) 같은 무방향 선분끼리 가중치 합산 → 각 조각 양옆의 감김수를 반직선 교차(정수 판정)로 구해 경계만 남긴다.
// 3) 경계를 "왼쪽이 안" 방향으로 이어 고리를 만들고(꼭짓점에서 시계 방향 첫 변), 반복 꼭짓점에서 고리를 나눈다.
// 4) 부호 면적으로 외곽·구멍을 가르고, 구멍은 그것을 포함하는 가장 작은 외곽에 붙인다.
// 사칙연산·비교만 쓴다(초월함수 없음). 결과는 입력 순서와 무관하게 정렬된다.
import type { Point, Polygon } from "@arch-studio/domain";
import { GeometryError } from "./errors.ts";
import { cmpPt, orient, pointInRing2, ptKey, ringArea2, samePt, type Pt } from "./predicates.ts";
import { roundRatioHalfAway } from "./round.ts";

/** 배치 입력 좌표 상한: 2배 좌표의 차가 2^26 미만이어야 판정이 정확하다. */
export const ARRANGEMENT_LIMIT = 16_000_000;
const MAX_SNAP_ROUNDS = 64;

export interface Seg {
  a: Pt;
  b: Pt;
  w: number;
}

function bbox(s: Seg): [number, number, number, number] {
  return [
    Math.min(s.a[0], s.b[0]),
    Math.min(s.a[1], s.b[1]),
    Math.max(s.a[0], s.b[0]),
    Math.max(s.a[1], s.b[1]),
  ];
}

/** x 구간으로 정렬해 bbox가 겹치는 쌍만 방문(결정적 순서). */
function forEachOverlappingPair(segs: readonly Seg[], visit: (i: number, j: number) => void): void {
  const boxes = segs.map(bbox);
  const order = segs.map((_, i) => i).sort((i, j) => (boxes[i] as number[])[0]! - (boxes[j] as number[])[0]! || i - j);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi] as number;
    const bi = boxes[i] as number[];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj] as number;
      const bj = boxes[j] as number[];
      if (bj[0]! > bi[2]!) break;
      if (bj[1]! > bi[3]! || bj[3]! < bi[1]!) continue;
      visit(i, j);
    }
  }
}

/** 내부끼리 교차하면 교차점을 half-away 반올림한 정수점, 아니면 null. */
function roundedCrossing(s: Seg, t: Seg): Pt | null {
  const d1 = Math.sign(orient(t.a, t.b, s.a));
  const d2 = Math.sign(orient(t.a, t.b, s.b));
  if (d1 * d2 >= 0) return null;
  const d3 = Math.sign(orient(s.a, s.b, t.a));
  const d4 = Math.sign(orient(s.a, s.b, t.b));
  if (d3 * d4 >= 0) return null;
  const rx = s.b[0] - s.a[0];
  const ry = s.b[1] - s.a[1];
  const qx = t.b[0] - t.a[0];
  const qy = t.b[1] - t.a[1];
  const den = BigInt(rx * qy - ry * qx);
  const num = BigInt((t.a[0] - s.a[0]) * qy - (t.a[1] - s.a[1]) * qx);
  return [
    roundRatioHalfAway(BigInt(s.a[0]) * den + BigInt(rx) * num, den),
    roundRatioHalfAway(BigInt(s.a[1]) * den + BigInt(ry) * num, den),
  ];
}

interface Bound {
  n: number; // t = n / d, d > 0
  d: number;
  closed: boolean;
}

/** a < b 이면 음수(분수 비교, 분자·분모 ≤ 2^26 이라 곱이 정확). */
function cmpBound(a: Bound, b: Bound): number {
  return a.n * b.d - b.n * a.d;
}

/**
 * 선분이 핫 픽셀 h(= roundHalfAway로 h가 되는 점들의 정사각형)와 만나는가. 정확 판정.
 * 축마다 픽셀 구간: h > 0 [h-½, h+½), h < 0 (h-½, h+½], h = 0 (-½, ½) — roundHalfAway와 같은 소속.
 * 2배 좌표에서 선분 P(t) = A + t·D, t ∈ [0, 1]이 두 축 구간을 동시에 만족하는 t가 있는지 유리수 구간 교집합으로 본다.
 */
export function hitsPixel(s: Seg, h: Pt): boolean {
  let lo: Bound = { n: 0, d: 1, closed: true };
  let hi: Bound = { n: 1, d: 1, closed: true };
  for (const k of [0, 1] as const) {
    const A = s.a[k] * 2;
    const D = s.b[k] * 2 - A;
    const c = h[k] * 2;
    const inclLow = h[k] > 0;
    const inclHigh = h[k] < 0;
    if (D === 0) {
      // 끝점(짝수)은 경계(홀수)와 같을 수 없다
      if (!(A > c - 1 && A < c + 1)) return false;
      continue;
    }
    const tLow: Bound = D > 0 ? { n: c - 1 - A, d: D, closed: inclLow } : { n: A - c - 1, d: -D, closed: inclHigh };
    const tHigh: Bound = D > 0 ? { n: c + 1 - A, d: D, closed: inclHigh } : { n: A - c + 1, d: -D, closed: inclLow };
    const cl = cmpBound(tLow, lo);
    if (cl > 0) lo = tLow;
    else if (cl === 0) lo = { ...lo, closed: lo.closed && tLow.closed };
    const ch = cmpBound(tHigh, hi);
    if (ch < 0) hi = tHigh;
    else if (ch === 0) hi = { ...hi, closed: hi.closed && tHigh.closed };
  }
  const c = cmpBound(lo, hi);
  return c < 0 || (c === 0 && lo.closed && hi.closed);
}

function lowerBoundX(hot: readonly Pt[], x: number): number {
  let lo = 0;
  let hi = hot.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((hot[mid] as Pt)[0] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 핫 픽셀을 지나는 선분을 그 중심점에서 나눈다. 나뉜 것이 있으면 split = true. */
function snapRound(segs: readonly Seg[], hot: readonly Pt[]): { out: Seg[]; split: boolean } {
  const out: Seg[] = [];
  let split = false;
  for (const s of segs) {
    const [minx, miny, maxx, maxy] = bbox(s);
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const via: { h: Pt; t: number }[] = [];
    // 정수 끝점이므로 정사각형이 bbox와 만나려면 중심이 bbox 안(경계 포함)에 있어야 한다.
    for (let i = lowerBoundX(hot, minx); i < hot.length; i++) {
      const h = hot[i] as Pt;
      if (h[0] > maxx) break;
      if (h[1] < miny || h[1] > maxy || samePt(h, s.a) || samePt(h, s.b)) continue;
      if (hitsPixel(s, h)) via.push({ h, t: (h[0] - s.a[0]) * dx + (h[1] - s.a[1]) * dy });
    }
    if (via.length === 0) {
      out.push(s);
      continue;
    }
    split = true;
    via.sort((p, q) => p.t - q.t || cmpPt(p.h, q.h));
    let prev = s.a;
    for (const { h } of via) {
      out.push({ a: prev, b: h, w: s.w });
      prev = h;
    }
    out.push({ a: prev, b: s.b, w: s.w });
  }
  return { out, split };
}

/** 조각 사이에 내부 교차 또는 T자(끝점이 다른 조각 내부 위)가 있는가. */
function hasDefects(segs: readonly Seg[]): boolean {
  let bad = false;
  forEachOverlappingPair(segs, (i, j) => {
    if (bad) return;
    const s = segs[i] as Seg;
    const t = segs[j] as Seg;
    if (roundedCrossing(s, t)) bad = true;
    else if (interiorHit(s, t.a) || interiorHit(s, t.b) || interiorHit(t, s.a) || interiorHit(t, s.b)) bad = true;
  });
  return bad;
}

function interiorHit(s: Seg, p: Pt): boolean {
  if (samePt(p, s.a) || samePt(p, s.b) || orient(s.a, s.b, p) !== 0) return false;
  return (p[0] - s.a[0]) * (p[0] - s.b[0]) + (p[1] - s.a[1]) * (p[1] - s.b[1]) < 0;
}

/**
 * Hobby 스냅 라운딩: 핫 픽셀 = 끝점 ∪ 교차점(half-away 반올림). 각 선분을 닫힌 핫 픽셀을 지나는 순서대로 꺾는다.
 * 한 번이면 조각끼리 교차하지 않는 것이 정리(Hobby 1999)지만, 남은 결함이 있으면 조각을 입력으로 되풀이한다.
 */
function node(input: readonly Seg[]): Seg[] {
  let segs = input.filter((s) => !samePt(s.a, s.b));
  for (let round = 0; round < MAX_SNAP_ROUNDS; round++) {
    const hotMap = new Map<string, Pt>();
    for (const s of segs) {
      hotMap.set(ptKey(s.a), s.a);
      hotMap.set(ptKey(s.b), s.b);
    }
    forEachOverlappingPair(segs, (i, j) => {
      const p = roundedCrossing(segs[i] as Seg, segs[j] as Seg);
      if (p) hotMap.set(ptKey(p), p);
    });
    const hot = [...hotMap.values()].sort(cmpPt);
    segs = snapRound(segs, hot).out.filter((s) => !samePt(s.a, s.b));
    if (!hasDefects(segs)) return segs;
  }
  throw new GeometryError("NUMERIC_FAILURE", `스냅 라운딩이 ${MAX_SNAP_ROUNDS}회 안에 수렴하지 않습니다`);
}

interface Group {
  p: Pt; // 사전순 작은 끝
  q: Pt;
  n: number; // p→q 방향 가중치 합
}

function groupFragments(frags: readonly Seg[]): Group[] {
  const map = new Map<string, Group>();
  for (const s of frags) {
    const forward = cmpPt(s.a, s.b) < 0;
    const p = forward ? s.a : s.b;
    const q = forward ? s.b : s.a;
    const k = `${ptKey(p)};${ptKey(q)}`;
    const g = map.get(k);
    if (g) g.n += forward ? s.w : -s.w;
    else map.set(k, { p, q, n: forward ? s.w : -s.w });
  }
  return [...map.values()].filter((g) => g.n !== 0).sort((g, h) => cmpPt(g.p, h.p) || cmpPt(g.q, h.q));
}

/**
 * 감김수 > 0 경계 조각을 "왼쪽이 안" 방향으로 돌려준다.
 * 조각 중점 M에서 수평(+x) 반직선(수평 조각은 수직 +y)으로 다른 조각과의 교차를 센다.
 */
function boundaryEdges(groups: readonly Group[]): [Pt, Pt][] {
  const edges: [Pt, Pt][] = [];
  const doubled = groups.map((g) => ({ a: [g.p[0] * 2, g.p[1] * 2] as Pt, b: [g.q[0] * 2, g.q[1] * 2] as Pt, n: g.n }));
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi] as Group;
    const M: Pt = [g.p[0] + g.q[0], g.p[1] + g.q[1]];
    const horizontal = g.p[1] === g.q[1];
    let w0 = 0;
    for (let hi = 0; hi < doubled.length; hi++) {
      if (hi === gi) continue;
      const { a, b, n } = doubled[hi] as { a: Pt; b: Pt; n: number };
      if (!horizontal) {
        if (a[1] > M[1] !== b[1] > M[1]) {
          const o = orient(a, b, M);
          if (b[1] > a[1]) {
            if (o > 0) w0 += n; // 위로 가는 변이 오른쪽에서 교차 → +1
          } else if (o < 0) w0 -= n;
        }
      } else if (a[0] > M[0] !== b[0] > M[0]) {
        const o = orient(a, b, M);
        if (b[0] > a[0]) {
          if (o < 0) w0 -= n; // +x로 가는 변이 위에서 교차 → -1
        } else if (o > 0) w0 += n;
      }
    }
    // w0 = 반직선 쪽(+x 또는 +y) 바로 옆의 감김수, wMinus = 반대쪽.
    const c = horizontal ? -g.n : g.q[1] > g.p[1] ? g.n : -g.n;
    const insideMinus = w0 + c > 0;
    if (insideMinus === w0 > 0) continue;
    if (!horizontal) {
      const up: [Pt, Pt] = g.q[1] > g.p[1] ? [g.p, g.q] : [g.q, g.p];
      edges.push(insideMinus ? up : [up[1], up[0]]); // 위로 가는 변의 왼쪽 = -x
    } else {
      edges.push(insideMinus ? [g.q, g.p] : [g.p, g.q]); // -x로 가는 변의 왼쪽 = -y
    }
  }
  return edges;
}

/** r 기준 반시계 각도 비교용: 0 = [0, π), 1 = [π, 2π). */
function half(r: Pt, d: Pt): number {
  const c = r[0] * d[1] - r[1] * d[0];
  return c > 0 || (c === 0 && r[0] * d[0] + r[1] * d[1] > 0) ? 0 : 1;
}

/** 경계 변을 고리로 잇는다. 도착 꼭짓점에서 되돌아가는 방향으로부터 시계 방향 첫 변을 고른다. */
function linkRings(edges: readonly [Pt, Pt][]): Pt[][] {
  const out = new Map<string, number[]>();
  edges.forEach(([a], i) => {
    const k = ptKey(a);
    const list = out.get(k);
    if (list) list.push(i);
    else out.set(k, [i]);
  });
  const used = new Array<boolean>(edges.length).fill(false);
  const order = edges.map((_, i) => i).sort((i, j) => {
    const ei = edges[i] as [Pt, Pt];
    const ej = edges[j] as [Pt, Pt];
    return cmpPt(ei[0], ej[0]) || cmpPt(ei[1], ej[1]);
  });
  const rings: Pt[][] = [];
  for (const start of order) {
    if (used[start]) continue;
    const ring: Pt[] = [];
    let cur = start;
    for (;;) {
      used[cur] = true;
      const [u, v] = edges[cur] as [Pt, Pt];
      ring.push(u);
      const back: Pt = [u[0] - v[0], u[1] - v[1]];
      let best = -1;
      let bestDir: Pt = [0, 0];
      for (const cand of out.get(ptKey(v)) ?? []) {
        const w = (edges[cand] as [Pt, Pt])[1];
        const d: Pt = [w[0] - v[0], w[1] - v[1]];
        // 반시계 각도가 가장 큰 것 = 시계 방향으로 가장 가까운 것
        if (best < 0) {
          best = cand;
          bestDir = d;
          continue;
        }
        const hd = half(back, d);
        const hb = half(back, bestDir);
        if (hd > hb || (hd === hb && bestDir[0] * d[1] - bestDir[1] * d[0] > 0)) {
          best = cand;
          bestDir = d;
        }
      }
      if (best === start) break;
      if (best < 0 || used[best]) throw new GeometryError("NUMERIC_FAILURE", "경계 고리가 닫히지 않습니다");
      cur = best;
    }
    rings.push(...splitAtRepeats(ring));
  }
  return rings;
}

/** 같은 꼭짓점을 두 번 지나는 고리를 단순 고리들로 나눈다. */
function splitAtRepeats(ring: readonly Pt[]): Pt[][] {
  const result: Pt[][] = [];
  const path: Pt[] = [];
  const index = new Map<string, number>();
  for (const p of ring) {
    const k = ptKey(p);
    const at = index.get(k);
    if (at !== undefined) {
      const loop = path.splice(at + 1);
      for (const q of loop) index.delete(ptKey(q));
      loop.unshift(path[at] as Pt);
      if (loop.length >= 3) result.push(loop);
    } else {
      index.set(k, path.length);
      path.push(p);
    }
  }
  if (path.length >= 3) result.push(path);
  return result;
}

/** 일직선 중간 꼭짓점 제거. 3점 미만이 되면 빈 배열. */
function dropCollinear(ring: readonly Pt[]): Pt[] {
  const pts = [...ring];
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length >= 3; ) {
      const n = pts.length;
      const prev = pts[(i + n - 1) % n] as Pt;
      const cur = pts[i] as Pt;
      const next = pts[(i + 1) % n] as Pt;
      if (orient(prev, cur, next) === 0) {
        pts.splice(i, 1);
        changed = true;
      } else i++;
    }
  }
  return pts.length >= 3 ? pts : [];
}

/** 사전순 최소 꼭짓점에서 시작하도록 회전. */
function canonical(ring: readonly Pt[]): Point[] {
  let k = 0;
  for (let i = 1; i < ring.length; i++) if (cmpPt(ring[i] as Pt, ring[k] as Pt) < 0) k = i;
  return [...ring.slice(k), ...ring.slice(0, k)].map((p) => [p[0] + 0, p[1] + 0] as Point);
}

/** 고리 사전순 비교(같은 시작점이면 다음 꼭짓점으로). */
function cmpRing(r: readonly Point[], s: readonly Point[]): number {
  for (let i = 0; i < r.length && i < s.length; i++) {
    const c = cmpPt(r[i] as Pt, s[i] as Pt);
    if (c !== 0) return c;
  }
  return r.length - s.length;
}

/** 방향 있는 선분 묶음 → 감김수 > 0 영역의 다각형(외곽 반시계·구멍 시계, 정렬됨). */
export function fillPositive(segs: readonly Seg[]): Polygon[] {
  for (const s of segs) {
    for (const v of [s.a[0], s.a[1], s.b[0], s.b[1]]) {
      if (!Number.isSafeInteger(v) || v > ARRANGEMENT_LIMIT || v < -ARRANGEMENT_LIMIT) {
        throw new GeometryError("OUT_OF_RANGE", `중간 좌표가 ±${ARRANGEMENT_LIMIT}mm 를 넘습니다 (${v})`);
      }
    }
  }
  const rings = linkRings(boundaryEdges(groupFragments(node(segs))));
  // 구멍 배정은 일직선 꼭짓점을 지우기 전(모든 변이 조각) — 조각 중점은 다른 조각·꼭짓점 위에 있지 않다.
  const outers: { ring: Pt[]; area2: bigint; holes: Pt[][] }[] = [];
  const holes: { ring: Pt[]; area2: bigint }[] = [];
  for (const ring of rings) {
    const area2 = ringArea2(ring);
    if (area2 > 0n) outers.push({ ring, area2, holes: [] });
    else if (area2 < 0n) holes.push({ ring, area2 });
  }
  for (const h of holes) {
    const a = h.ring[0] as Pt;
    const b = h.ring[1] as Pt;
    const M: Pt = [a[0] + b[0], a[1] + b[1]];
    let parent: (typeof outers)[number] | undefined;
    for (const o of outers) {
      if ((parent === undefined || o.area2 < parent.area2) && pointInRing2(M, o.ring) === 1) parent = o;
    }
    if (!parent) throw new GeometryError("NUMERIC_FAILURE", "구멍을 담는 외곽이 없습니다");
    parent.holes.push(h.ring);
  }
  const polygons: Polygon[] = [];
  for (const o of outers) {
    const outer = dropCollinear(o.ring);
    if (outer.length === 0) continue;
    const hs = o.holes
      .map(dropCollinear)
      .filter((r) => r.length > 0)
      .map(canonical)
      .sort(cmpRing);
    polygons.push({ outer: canonical(outer), holes: hs });
  }
  return polygons.sort((p, q) => cmpRing(p.outer, q.outer));
}
