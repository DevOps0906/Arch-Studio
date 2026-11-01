// 측정 도구 D(03장 3.5절, AR-06-084, 순수·결정적): 두 점 거리·수평·높이차(mm 정수)와 꼭짓점·변·바닥 스냅.
// 결과는 화면 표시 전용이다. DesignModel에 저장하지 않고 실행 취소 대상도 아니다.
// 점은 모델 축 mm 정수 [x, y, z](Z 위). 스냅 후보는 DesignModel 데이터(대지 경계·매스 바닥 × 층 경계·꼭짓점 세로선)에서 만든다.
import { snapMm, type Model } from "../state/commands.ts";
import { floorLevels } from "../viewport/geometry.ts";
import { keepsPoint, type SectionPlane } from "./section.ts";

export type Point3 = readonly [number, number, number];
export type SnapKind = "vertex" | "edge" | "grid";

export interface Measurement {
  /** 화면 목록 번호(결정적, 1부터 증가). */
  readonly id: number;
  readonly a: Point3;
  readonly b: Point3;
}

export interface MeasureResult {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** 평면 거리(mm 정수). */
  readonly horizontal: number;
  /** 높이차 절댓값(mm 정수). */
  readonly vertical: number;
  /** 3차원 거리(mm 정수). */
  readonly distance: number;
}

/** 정수 제곱합의 제곱근을 mm 정수로(IEEE sqrt는 정확히 반올림되므로 같은 입력 → 같은 값). */
const rootMm = (sq: number) => snapMm(Math.sqrt(sq), 1);

export function measureDistance(a: Point3, b: Point3): MeasureResult {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return { dx, dy, dz, horizontal: rootMm(dx * dx + dy * dy), vertical: Math.abs(dz), distance: rootMm(dx * dx + dy * dy + dz * dz) };
}

export interface SnapTargets {
  readonly vertices: readonly Point3[];
  readonly edges: readonly (readonly [Point3, Point3])[];
}

/**
 * 스냅 후보: 대지 경계(z 0) 꼭짓점·변, 매스 바닥 링(외곽·구멍) × 층 경계 높이의 꼭짓점·변, 꼭짓점 세로선.
 * 단면이 있으면 잘라 낸 쪽 꼭짓점은 빼고, 변은 남는 쪽만(평면과 만나는 점은 mm 정수 반올림) 남긴다.
 */
export function snapTargets(model: Model, plane: SectionPlane | null = null): SnapTargets {
  const vertices: Point3[] = [];
  const edges: [Point3, Point3][] = [];
  const ring = (r: readonly (readonly [number, number])[], z: number) => {
    r.forEach(([x, y], i) => {
      const n = r[(i + 1) % r.length] as readonly [number, number];
      vertices.push([x, y, z]);
      edges.push([
        [x, y, z],
        [n[0], n[1], z],
      ]);
    });
  };
  ring(model.site.boundary.outer, 0);
  for (const m of model.masses) {
    const levels = floorLevels(m);
    const bottom = levels[0] as number;
    const top = levels[levels.length - 1] as number;
    for (const r of [m.footprint.outer, ...(m.footprint.holes ?? [])]) {
      for (const z of levels) ring(r, z);
      if (top > bottom) for (const [x, y] of r) edges.push([[x, y, bottom], [x, y, top]]);
    }
  }
  if (!plane) return { vertices, edges };
  const kept = (q: Point3) => keepsPoint(plane, q[0], q[1]);
  const side = (q: Point3) => plane.nx * q[0] + plane.ny * q[1] + plane.c;
  const clipped: [Point3, Point3][] = [];
  for (const [a, b] of edges) {
    const ka = kept(a);
    const kb = kept(b);
    if (ka && kb) clipped.push([a, b]);
    else if (ka || kb) {
      const t = side(a) / (side(a) - side(b));
      const m: Point3 = [snapMm(a[0] + (b[0] - a[0]) * t, 1), snapMm(a[1] + (b[1] - a[1]) * t, 1), snapMm(a[2] + (b[2] - a[2]) * t, 1)];
      clipped.push(ka ? [a, m] : [m, b]);
    }
  }
  return { vertices: vertices.filter(kept), edges: clipped };
}

const dist2 = (a: Point3, b: Point3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * 측정 점 스냅. 우선순위: 허용 거리 안의 가장 가까운 꼭짓점 → 가장 가까운 변(변 위 위치는 시작 꼭짓점에서 grid mm 단위) →
 * 바닥 근처(z < 허용)면 x·y grid mm 격자·z 0, 면 위 점은 격자 없이 mm 정수 반올림만. 결과는 mm 정수.
 */
export function snapMeasurePoint(raw: Point3, targets: SnapTargets, toleranceMm: number, grid = 100): { readonly point: Point3; readonly kind: SnapKind } {
  const tol2 = toleranceMm * toleranceMm;
  let best: Point3 | null = null;
  let bestD = tol2;
  for (const v of targets.vertices) {
    const d = dist2(raw, v);
    if (d <= bestD) {
      best = v;
      bestD = d;
    }
  }
  if (best) return { point: best, kind: "vertex" };
  let edge: Point3 | null = null;
  bestD = tol2;
  for (const [a, b] of targets.edges) {
    const ab: Point3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    if (len2 === 0) continue;
    const t = Math.min(1, Math.max(0, ((raw[0] - a[0]) * ab[0] + (raw[1] - a[1]) * ab[1] + (raw[2] - a[2]) * ab[2]) / len2));
    const d = dist2(raw, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
    if (d > bestD) continue;
    bestD = d;
    const len = Math.sqrt(len2);
    const s = Math.min(len, snapMm(t * len, grid)) / len;
    edge = [snapMm(a[0] + ab[0] * s, 1), snapMm(a[1] + ab[1] * s, 1), snapMm(a[2] + ab[2] * s, 1)];
  }
  if (edge) return { point: edge, kind: "edge" };
  if (raw[2] < toleranceMm) return { point: [snapMm(raw[0], grid), snapMm(raw[1], grid), 0], kind: "grid" };
  return { point: [snapMm(raw[0], 1), snapMm(raw[1], 1), snapMm(raw[2], 1)], kind: "grid" };
}

/** 화면 거리 문구(mm 정수, 천 단위 쉼표). */
export function formatMm(v: number): string {
  return `${v.toLocaleString("ko-KR")}mm`;
}

/** 측정 한 줄 요약(라이브 영역·목록 공용). */
export function measureText(r: MeasureResult): string {
  return `거리 ${formatMm(r.distance)} · 수평 ${formatMm(r.horizontal)} · 높이차 ${formatMm(r.vertical)}`;
}

/** 측정 선분(mm xyz × 2점 목록, 표시용). hover가 있으면 시작점에서 hover까지 미리보기 선을 덧붙인다. */
export function measureSegments(measures: readonly Measurement[], start: Point3 | null, hover: Point3 | null): Float32Array {
  const pairs: (readonly [Point3, Point3])[] = measures.map((m) => [m.a, m.b]);
  if (start && hover) pairs.push([start, hover]);
  const out = new Float32Array(pairs.length * 6);
  pairs.forEach(([a, b], i) => out.set([...a, ...b], i * 6));
  return out;
}
