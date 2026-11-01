// 테스트 공용 매스 픽스처(정수 mm, Z-up). 축 정렬 상자: 바깥에서 볼 때 반시계.
import { canonicalMesh, type IntMesh } from "@arch-studio/geometry";

export function boxMesh(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): IntMesh {
  const v: [number, number, number][] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const t: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], // 바닥(-Z)
    [4, 5, 6], [4, 6, 7], // 지붕(+Z)
    [0, 1, 5], [0, 5, 4], // -Y
    [1, 2, 6], [1, 6, 5], // +X
    [2, 3, 7], [2, 7, 6], // +Y
    [3, 0, 4], [3, 4, 7], // -X
  ];
  return canonicalMesh(v, t);
}
