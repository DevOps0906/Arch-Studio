// 대지 경계 후보 추출: (1) mm 정수 환산 (2) 닫힌 폴리라인·원·끝점이 이어진 선/호 루프 추출 (3) 순위.
// 선분 연결은 "모든 끝점의 차수가 2인 단순 고리"만 루프로 인정한다(갈라지는 점이 있으면 모호하므로 후보로 만들지 않는다).
// 순위: 레이어 힌트(site < neutral < non_site) → 면적 큰 순 → 최소 꼭짓점 (x, y) 사전순 → 입력 순서. 모두 결정적이다.
import type { Point, Polygon } from "@arch-studio/domain";
import { GeometryError, area, normalizePolygon, roundHalfAway, COORD_LIMIT } from "@arch-studio/geometry";
import { DxfFail } from "./errors.ts";
import type { FlatResult } from "./flatten.ts";
import { hintClass, layerHint } from "./layers.ts";
import { MAX_CANDIDATE_VERTICES, MAX_VALIDATION_WORK, MIN_CANDIDATE_AREA_MM2 } from "./limits.ts";
import { UNIT_TO_MM, type DxfImportStats, type DxfUnit, type LayerHint, type SiteCandidate } from "./types.ts";

interface IntChains {
  xi: Int32Array;
  yi: Int32Array;
}

/** 도면 단위 좌표 → mm 정수(half-away). 범위 밖·비유한은 오류(부분 결과 없음). */
export function toMmInts(flat: FlatResult, unit: DxfUnit): IntChains {
  const f = UNIT_TO_MM[unit];
  const n = flat.vertices;
  const xi = new Int32Array(n);
  const yi = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const vx = (flat.xs[i] as number) * f;
    const vy = (flat.ys[i] as number) * f;
    if (!(Math.abs(vx) <= COORD_LIMIT + 0.5) || !(Math.abs(vy) <= COORD_LIMIT + 0.5)) {
      throw new DxfFail("DXF_COORD_OUT_OF_RANGE", `좌표가 ±${COORD_LIMIT}mm(10km) 범위를 넘습니다. 단위를 확인해 주세요`, { limit: COORD_LIMIT });
    }
    xi[i] = roundHalfAway(vx);
    yi[i] = roundHalfAway(vy);
  }
  return { xi, yi };
}

interface RawLoop {
  /** x, y 교대 */
  pts: number[];
  layers: Map<number, number>;
  source: SiteCandidate["source"];
  a2: bigint; // |부호 면적 × 2|
  minX: number;
  minY: number;
}

type Counters = Pick<DxfImportStats, "closed_chains" | "open_chains" | "loops_below_min_area" | "loops_rejected" | "loops_unchecked" | "duplicates_removed">;

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** 신발끈 2배 면적(정확, 첫 점 기준 평행이동으로 수 크기를 줄임). */
function area2(pts: number[]): bigint {
  const n = pts.length / 2;
  const x0 = pts[0] as number;
  const y0 = pts[1] as number;
  let s = 0n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = BigInt((pts[i * 2] as number) - x0);
    const ay = BigInt((pts[i * 2 + 1] as number) - y0);
    const bx = BigInt((pts[j * 2] as number) - x0);
    const by = BigInt((pts[j * 2 + 1] as number) - y0);
    s += ax * by - bx * ay;
  }
  return s;
}

export interface LoopResult {
  candidates: SiteCandidate[];
  counters: Counters;
}

export function extractCandidates(
  flat: FlatResult,
  ints: IntChains,
  maxCandidates: number,
  tolerance: 0 | 1,
): LoopResult {
  const { xi, yi } = ints;
  const counters: Counters = {
    closed_chains: 0,
    open_chains: 0,
    loops_below_min_area: 0,
    loops_rejected: 0,
    loops_unchecked: 0,
    duplicates_removed: 0,
  };
  const loops: RawLoop[] = [];

  const finishLoop = (pts: number[], layers: Map<number, number>, source: SiteCandidate["source"]): void => {
    // 이웃 중복 제거(처음-마지막 포함)
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] as number;
      const y = pts[i + 1] as number;
      if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) continue;
      out.push(x, y);
    }
    while (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
    if (out.length < 6) return; // 서로 다른 점 3개 미만: 퇴화
    if (out.length / 2 > MAX_CANDIDATE_VERTICES) {
      counters.loops_rejected++;
      return;
    }
    const a2 = absBig(area2(out));
    if (a2 < BigInt(2 * MIN_CANDIDATE_AREA_MM2)) {
      counters.loops_below_min_area++;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    for (let i = 0; i < out.length; i += 2) {
      const x = out[i] as number;
      const y = out[i + 1] as number;
      if (x < minX || (x === minX && y < minY)) {
        minX = x;
        minY = y;
      }
    }
    loops.push({ pts: out, layers, source, a2, minX, minY });
  };

  // ---- 1. 체인 → 닫힌 루프 / 열린 간선 ----
  const nChains = flat.start.length;
  const edgePts: number[][] = []; // 간선별 점 열(x,y 교대)
  const edgeChain: number[] = [];
  for (let c = 0; c < nChains; c++) {
    const s = flat.start[c] as number;
    const e = s + (flat.len[c] as number);
    const pts: number[] = [];
    for (let i = s; i < e; i++) {
      const x = xi[i] as number;
      const y = yi[i] as number;
      if (pts.length >= 2 && pts[pts.length - 2] === x && pts[pts.length - 1] === y) continue;
      pts.push(x, y);
    }
    const selfClosed = pts.length >= 8 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
    if (flat.closed[c] || selfClosed) {
      counters.closed_chains++;
      finishLoop(pts, new Map([[flat.layer[c] as number, 1]]), flat.circle[c] ? "circle" : "closed_polyline");
    } else if (pts.length >= 4) {
      counters.open_chains++;
      edgePts.push(pts);
      edgeChain.push(c);
    }
  }

  // ---- 2. 열린 체인 끝점 이음 → 단순 고리 ----
  const nEdges = edgePts.length;
  if (nEdges > 0) {
    const OFF = COORD_LIMIT + 2;
    const W = 2 * COORD_LIMIT + 5;
    const nodeOf = new Map<number, number>();
    const key = (x: number, y: number): number => (x + OFF) * W + (y + OFF);
    let nodes = 0;
    const getNode = (x: number, y: number): number => {
      const k = key(x, y);
      const hit = nodeOf.get(k);
      if (hit !== undefined) return hit;
      if (tolerance === 1) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const h = nodeOf.get(key(x + dx, y + dy));
            if (h !== undefined) {
              nodeOf.set(k, h);
              return h;
            }
          }
        }
      }
      nodeOf.set(k, nodes);
      return nodes++;
    };
    const na = new Int32Array(nEdges);
    const nb = new Int32Array(nEdges);
    for (let i = 0; i < nEdges; i++) {
      const p = edgePts[i] as number[];
      na[i] = getNode(p[0] as number, p[1] as number);
      nb[i] = getNode(p[p.length - 2] as number, p[p.length - 1] as number);
    }
    const deg = new Int32Array(nodes);
    const e1 = new Int32Array(nodes).fill(-1);
    const e2 = new Int32Array(nodes).fill(-1);
    const attach = (node: number, edge: number): void => {
      deg[node] = (deg[node] as number) + 1;
      if (e1[node] === -1) e1[node] = edge;
      else if (e2[node] === -1) e2[node] = edge;
    };
    for (let i = 0; i < nEdges; i++) {
      if (na[i] === nb[i]) {
        deg[na[i] as number] = (deg[na[i] as number] as number) + 2; // 스스로 닫힌 간선: 다른 간선과 이어지지 않게 차수만 올림
        continue;
      }
      attach(na[i] as number, i);
      attach(nb[i] as number, i);
    }
    const used = new Uint8Array(nEdges);
    for (let i = 0; i < nEdges; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const startNode = na[i] as number;
      if (na[i] === nb[i]) {
        // 허용 오차로 닫힌 단일 체인
        const lay = new Map([[flat.layer[edgeChain[i] as number] as number, 1]]);
        finishLoop(edgePts[i] as number[], lay, "connected_lines");
        continue;
      }
      const ring: number[] = [...(edgePts[i] as number[])];
      const lay = new Map<number, number>([[flat.layer[edgeChain[i] as number] as number, 1]]);
      let cur = i;
      let at = nb[i] as number;
      let ok = false;
      for (let steps = 0; steps <= nEdges; steps++) {
        if (at === startNode) {
          ok = deg[startNode] === 2; // 시작점에서 갈라지면 모호하다
          break;
        }
        if (deg[at] !== 2) break;
        const nxt = (e1[at] === cur ? e2[at] : e1[at]) as number;
        if (nxt < 0 || used[nxt]) break;
        used[nxt] = 1;
        const p = edgePts[nxt] as number[];
        const forward = na[nxt] === at;
        if (forward) for (let k = 2; k < p.length; k++) ring.push(p[k] as number);
        else for (let k = p.length - 4; k >= 0; k -= 2) ring.push(p[k] as number, p[k + 1] as number);
        const ln = flat.layer[edgeChain[nxt] as number] as number;
        lay.set(ln, (lay.get(ln) ?? 0) + 1);
        at = forward ? (nb[nxt] as number) : (na[nxt] as number);
        cur = nxt;
      }
      if (ok) finishLoop(ring, lay, "connected_lines");
    }
  }

  // ---- 3. 순위 ----
  const names = flat.layerNames;
  const primary = (l: RawLoop): string => {
    let best = -1;
    let bestN = -1;
    for (const [id, cnt] of [...l.layers.entries()].sort((a, b) => a[0] - b[0])) {
      if (cnt > bestN || (cnt === bestN && (names[id] as string) < (names[best] as string))) {
        best = id;
        bestN = cnt;
      }
    }
    return names[best] as string;
  };
  const meta = loops.map((l, idx) => {
    const layer = primary(l);
    return { l, idx, layer, hint: layerHint(layer) };
  });
  meta.sort(
    (p, q) =>
      hintClass(p.hint) - hintClass(q.hint) ||
      (p.l.a2 === q.l.a2 ? 0 : p.l.a2 > q.l.a2 ? -1 : 1) ||
      p.l.minX - q.l.minX ||
      p.l.minY - q.l.minY ||
      p.idx - q.idx,
  );

  // ---- 4. 검증·중복 제거·후보 생성 ----
  const candidates: SiteCandidate[] = [];
  const seen = new Set<string>();
  let work = 0;
  for (let mi = 0; mi < meta.length && candidates.length < maxCandidates; mi++) {
    const m = meta[mi] as (typeof meta)[number];
    const nv = m.l.pts.length / 2;
    work += nv * nv;
    if (work > MAX_VALIDATION_WORK) {
      counters.loops_unchecked += meta.length - mi;
      break;
    }
    const outer: Point[] = [];
    for (let i = 0; i < m.l.pts.length; i += 2) outer.push([m.l.pts[i] as number, m.l.pts[i + 1] as number]);
    let poly: Polygon;
    try {
      poly = normalizePolygon({ outer, holes: [] });
    } catch (e) {
      if (e instanceof GeometryError) {
        counters.loops_rejected++;
        continue;
      }
      throw e;
    }
    const ring = canonicalRing(poly.outer);
    const k = ring.map((p) => `${p[0]},${p[1]}`).join(";");
    if (seen.has(k)) {
      counters.duplicates_removed++;
      continue;
    }
    seen.add(k);
    const polygon: Polygon = { outer: ring, holes: [] };
    let per = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Point;
      const b = ring[(i + 1) % ring.length] as Point;
      per += Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    }
    candidates.push({
      rank: candidates.length + 1,
      polygon,
      area_mm2: area(polygon),
      perimeter_mm: roundHalfAway(per),
      vertex_count: ring.length,
      layer: m.layer,
      layers: [...m.l.layers.keys()].map((id) => names[id] as string).sort(),
      layer_hint: m.hint as LayerHint,
      source: m.l.source,
    });
  }
  return { candidates, counters };
}

/** 방향은 유지하고 (x, y) 사전순 최소 꼭짓점에서 시작하도록 회전한다. */
function canonicalRing(ring: Point[]): Point[] {
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i] as Point;
    const q = ring[best] as Point;
    if (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) best = i;
  }
  return [...ring.slice(best), ...ring.slice(0, best)].map((p) => [p[0] + 0, p[1] + 0] as Point);
}
