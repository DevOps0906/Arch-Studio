// 폴백 표시 메시(AR-06-036): 엔진 워커 메시가 오기 전·워커가 없을 때 같은 모양(바닥 다각형 × 높이)을 TS로 만든다. 표시 전용, 판정·면적에 쓰지 않는다.
// three ShapeUtils(earcut, 결정적)를 쓰므로 뷰포트 청크에서만 import한다.
import { ShapeUtils, Vector2 } from "three";
import { massHeight, type Mass } from "../state/commands.ts";
import type { MeshData } from "./geometry.ts";

/** 폴백 표시 메시(바닥 다각형 × 전체 높이). 삼각분할은 three ShapeUtils(earcut, 결정적). 층이 없거나 삼각분할이 실패하면 null. */
export function prismMesh(mass: Mass): MeshData | null {
  const h = massHeight(mass);
  if (mass.floors.length === 0 || h <= 0) return null;
  return slabMesh(mass, mass.base_level_mm, mass.base_level_mm + h);
}

/** 바닥 다각형 × [z0, z1] 판(층별 표시·분해도, AR-06-085). 삼각형 수 = display/settings.ts slabTriangles. 실패하면 null. */
export function slabMesh(mass: Mass, z0: number, z1: number): MeshData | null {
  if (z1 <= z0) return null;
  const outer = mass.footprint.outer;
  const holes = mass.footprint.holes ?? [];
  const contour = outer.map(([x, y]) => new Vector2(x, y));
  const holeV = holes.map((r) => r.map(([x, y]) => new Vector2(x, y)));
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const r of holeV) if (!ShapeUtils.isClockWise(r)) r.reverse();
  const faces = ShapeUtils.triangulateShape(contour, holeV);
  if (faces.length === 0) return null;
  const flat = [...contour, ...holeV.flat()];
  const nv = flat.length;
  const positions = new Float32Array(nv * 2 * 3);
  flat.forEach((p, i) => {
    positions.set([p.x, p.y, z0], i * 3);
    positions.set([p.x, p.y, z1], (nv + i) * 3);
  });
  const idx: number[] = [];
  for (const face of faces) {
    const [a, b, c] = face as [number, number, number];
    idx.push(nv + a, nv + b, nv + c); // 윗면(반시계 = 위로 향함)
    idx.push(c, b, a); // 아랫면
  }
  // 옆면: 고리마다 변 하나에 사각형 2개. 외곽 반시계·구멍 시계라 바깥을 향한다.
  let start = 0;
  for (const ring of [contour, ...holeV]) {
    const len = ring.length;
    for (let i = 0; i < len; i++) {
      const a = start + i;
      const b = start + ((i + 1) % len);
      idx.push(a, b, nv + b, a, nv + b, nv + a);
    }
    start += len;
  }
  return { positions, index: Uint32Array.from(idx) };
}
