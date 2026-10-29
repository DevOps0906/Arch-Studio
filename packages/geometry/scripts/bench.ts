// 200꼭짓점 합집합·오프셋 벤치(AR-06-014, 개발서 12.8절). 테스트 밖에서 수동 실행: pnpm --filter @arch-studio/geometry bench
// 결과는 tasks/logs/AR-06-014.md에 기기 사양과 함께 기록한다. 입력은 고정 시드 LCG + 유리 매개화 원(초월함수 없음).
// eslint-disable-next-line no-restricted-imports -- 벤치 스크립트는 OS 정보만 읽는다(엔진 코드 아님)
import { cpus } from "node:os";
import type { Point, Polygon } from "@arch-studio/domain";
import { offset, roundHalfAway, union } from "../src/index.ts";

let seed = 20261029;
function rand(): number {
  seed = (seed * 48271) % 2147483647; // Park–Miller: 곱이 2^53 미만이라 정확
  return seed / 2147483647;
}

/** 반지름 R±20% 요철의 별 모양 n각형(중심 cx, cy). 원 위 점은 t∈[-1,1]의 유리 매개화 4분면 복사. */
function blob(n: number, cx: number, cy: number, R: number): Polygon {
  const pts: Point[] = [];
  const q = n / 4;
  for (let quad = 0; quad < 4; quad++) {
    for (let i = 0; i < q; i++) {
      const t = i / q; // 0..1 → 0..90°(유리 매개화)
      const c = (1 - t * t) / (1 + t * t);
      const s = (2 * t) / (1 + t * t);
      const r = R * (0.8 + 0.4 * rand());
      const [x, y] = [
        [c, s],
        [-s, c],
        [-c, -s],
        [s, -c],
      ][quad] as [number, number];
      pts.push([roundHalfAway(cx + r * x), roundHalfAway(cy + r * y)]);
    }
  }
  return { outer: pts };
}

function measure(label: string, runs: number, fn: () => unknown): void {
  fn(); // 예열
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    const t0 = performance.now();
    fn();
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pick = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] as number).toFixed(1);
  console.log(`${label.padEnd(36)} median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  (n=${runs})`);
}

const A = blob(200, 0, 0, 50_000);
const B = blob(200, 30_000, 10_000, 50_000);
const runs = 50;
console.log(`node ${process.version}, ${cpus()[0]?.model ?? "?"} × ${cpus().length}`);
console.log(`입력: A ${A.outer.length}점, B ${B.outer.length}점, 반지름 50m ±20%`);
const u = union([A, B]);
console.log(`합집합 결과: ${u.length}개, 꼭짓점 ${u.reduce((s, p) => s + p.outer.length, 0)}`);
measure("union(A, B) 200+200점", runs, () => union([A, B]));
measure("offset(A, +500, miter)", runs, () => offset(A, 500));
measure("offset(A, +500, square)", runs, () => offset(A, 500, { join: "square" }));
measure("offset(A, -500, miter)", runs, () => offset(A, -500));
measure("offset(A, -3000, miter)", runs, () => offset(A, -3000));
