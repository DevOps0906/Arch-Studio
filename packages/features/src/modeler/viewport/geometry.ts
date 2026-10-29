// 뷰포트 표시용 기하(순수, 결정적). 좌표 원본은 DesignModel mm 정수(Z 위)이고, three 장면은 루트 그룹에서 m·Y 위로 바꾼다
// (rotation.x = −π/2, scale 0.001 → 모델 +X = 월드 +X, 모델 +Y = 월드 −Z, 모델 +Z = 월드 +Y).
// - 윤곽선은 EdgesGeometry를 쓰지 않고 DesignModel 데이터(바닥 변 × 층 경계 + 꼭짓점 세로선)로 만든다([DECISION] 1절).
// - three를 import하지 않는다(모델러 첫 청크에 three가 들어가지 않게). three가 필요한 폴백 메시는 prism.ts.
// 여기 값은 화면 표시 전용이다. 판정·면적·도면은 엔진(정수 기하)이 따로 계산한다.
import type { Point } from "@arch-studio/domain";
import { sortedFloors, type Mass, type Model } from "../state/commands.ts";

export interface MeshData {
  /** mm 좌표 xyz(모델 축, Z 위). */
  readonly positions: Float32Array;
  readonly index: Uint32Array;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 모델(mm, Z 위) → 월드(m, Y 위). */
export function modelToWorld(x: number, y: number, z = 0): [number, number, number] {
  return [x / 1000, z / 1000, -y / 1000];
}

/** 월드 지면 점(m) → 모델 mm(반올림 전 실수). */
export function worldToModel(wx: number, wz: number): [number, number] {
  return [wx * 1000, -wz * 1000];
}

/** 매스 기하 키: 바닥·바닥 높이·층고 순서가 같으면 같은 메시(워커 메시 캐시 키). 위치가 바뀌면 키도 바뀐다. */
export function meshKey(mass: Mass): string {
  const f = sortedFloors(mass).map((x) => x.height_mm);
  return JSON.stringify([mass.footprint.outer, mass.footprint.holes ?? [], mass.base_level_mm, f]);
}

function ringBounds(points: readonly Point[], b: Bounds | null): Bounds | null {
  let out = b;
  for (const [x, y] of points) {
    out = out ? { minX: Math.min(out.minX, x), minY: Math.min(out.minY, y), maxX: Math.max(out.maxX, x), maxY: Math.max(out.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return out;
}

/** 대지와 매스 바닥 전체를 감싸는 상자(mm). 비었으면 20m 상자. */
export function sceneBounds(model: Model): Bounds {
  let b = ringBounds(model.site.boundary.outer, null);
  for (const m of model.masses) b = ringBounds(m.footprint.outer, b);
  return b ?? { minX: 0, minY: 0, maxX: 20_000, maxY: 20_000 };
}

export function massBounds(mass: Mass, dx = 0, dy = 0): Bounds {
  const b = ringBounds(mass.footprint.outer, null) as Bounds;
  return { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy };
}

/** 층 경계 높이(mm, 아래부터): base, base+h1, …, base+Σh. */
export function floorLevels(mass: Mass): number[] {
  const out = [mass.base_level_mm];
  let z = mass.base_level_mm;
  for (const f of sortedFloors(mass)) {
    z += f.height_mm;
    out.push(z);
  }
  return out;
}

/** 매스 윤곽선(선분 목록, mm xyz × 2점): 층 경계마다 바닥 변(외곽·구멍) + 꼭짓점 세로선. 층이 없으면 빈 버퍼. */
export function massOutline(mass: Mass): Float32Array {
  if (mass.floors.length === 0) return new Float32Array(0);
  const levels = floorLevels(mass);
  const rings = [mass.footprint.outer, ...(mass.footprint.holes ?? [])];
  const bottom = levels[0] as number;
  const top = levels[levels.length - 1] as number;
  let n = 0;
  for (const r of rings) n += r.length * levels.length + r.length;
  const out = new Float32Array(n * 6);
  let o = 0;
  const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    out[o++] = ax;
    out[o++] = ay;
    out[o++] = az;
    out[o++] = bx;
    out[o++] = by;
    out[o++] = bz;
  };
  for (const r of rings) {
    for (const z of levels) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i] as Point;
        const b = r[(i + 1) % r.length] as Point;
        seg(a[0], a[1], z, b[0], b[1], z);
      }
    }
    for (const [x, y] of r) seg(x, y, bottom, x, y, top);
  }
  return out;
}

/** 대지 경계 닫힌 선(mm xyz, z = 0). */
export function siteLoop(model: Model): Float32Array {
  const r = model.site.boundary.outer;
  const out = new Float32Array(r.length * 3);
  r.forEach(([x, y], i) => out.set([x, y, 0], i * 3));
  return out;
}

/** 그리는 중인 바닥 선(mm xyz, z = 0). hover가 있으면 마지막 점에서 이어 그린다. */
export function draftLine(points: readonly Point[], hover: Point | null): Float32Array {
  const all = hover ? [...points, hover] : points;
  const out = new Float32Array(all.length * 3);
  all.forEach(([x, y], i) => out.set([x, y, 0], i * 3));
  return out;
}

export interface CameraPose {
  /** 월드 좌표(m). */
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  /** 궤도 회전 허용(평면 보기는 회전 잠금). */
  readonly rotate: boolean;
}

/**
 * 카메라 자세(월드 m). 투시 = 남동쪽 위, 평면 = 바로 위, 정북 단면 = 정북 방향과 직각인 동쪽에서 수평으로(일조사선 경사가 보이게).
 * northDeg: 모델 +Y축에서 정북까지 시계 방향 각도(DesignModel site.north_angle_deg). 표시 전용이라 Math.sin·cos를 쓴다.
 */
export function cameraPose(mode: "perspective" | "plan" | "section", b: Bounds, topMm: number, northDeg: number, aspect = 1): CameraPose {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  // 세로로 긴 뷰포트(폭/높이 < 1)는 가로 시야가 좁아 그만큼 멀리서 본다.
  const fit = 1 / Math.max(0.4, Math.min(1, aspect));
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, topMm, 10_000) * fit;
  const t = modelToWorld(cx, cy, Math.min(topMm, span) / 3);
  const d = (span * 1.6) / 1000;
  if (mode === "plan") {
    // 바로 위(아주 작은 남쪽 오프셋: 궤도 제어의 극점 특이점 회피)
    return { position: [t[0], d * 1.1, t[2] + d * 0.001], target: [t[0], 0, t[2]], rotate: false };
  }
  if (mode === "section") {
    const r = (northDeg * Math.PI) / 180;
    // 정북 단위 벡터(모델) = (sin r, cos r). 동쪽 = 정북을 시계 방향 90° = (cos r, −sin r)
    const ex = Math.cos(r);
    const ey = -Math.sin(r);
    const p = modelToWorld(cx + ex * span * 1.6, cy + ey * span * 1.6, Math.min(topMm, span) / 3);
    return { position: p, target: t, rotate: true };
  }
  const p = modelToWorld(cx + span * 0.9, cy - span * 1.2, span * 0.9);
  return { position: p, target: t, rotate: true };
}

/** 화면 거리 허용 안에서 첫 점 근처를 찍으면 다각형을 닫는다(mm 거리). */
export function closesDraft(points: readonly Point[], p: Point, toleranceMm: number): boolean {
  const first = points[0];
  if (!first || points.length < 3) return false;
  const dx = first[0] - p[0];
  const dy = first[1] - p[1];
  return dx * dx + dy * dy <= toleranceMm * toleranceMm;
}
