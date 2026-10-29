// 판정 p95 벤치(AR-06-015, AR-F-004 "매스 변경 후 p95 200ms"). 테스트 밖 수동 실행: pnpm --filter @arch-studio/rules bench
// 결과는 tasks/logs/AR-06-015.md에 기기 사양과 함께 기록한다. 입력: 200꼭짓점 대지 + 매스 6개(각 4층, 일부 겹침), 반복마다 매스 1개 이동.
import { cpus } from "node:os";
import { readFileSync } from "node:fs";
import type { DesignModelV1, Point } from "@arch-studio/domain";
import { judge, loadRulePack } from "../../packages/rules/src/index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "../../packages/rules/src/test-fixtures.ts";

/** 반지름 R 원 위 200점(유리 매개화, 초월함수 없음), 정수 반올림. */
function circle(n: number, R: number): Point[] {
  const pts: Point[] = [];
  const q = n / 4;
  for (let quad = 0; quad < 4; quad++) {
    for (let i = 0; i < q; i++) {
      const t = i / q;
      const c = (1 - t * t) / (1 + t * t);
      const s = (2 * t) / (1 + t * t);
      const [x, y] = ([[c, s], [-s, c], [-c, -s], [s, -c]][quad]) as [number, number];
      pts.push([Math.round(R * x), Math.round(R * y)]);
    }
  }
  return pts;
}

function model(shift: number): DesignModelV1 {
  const m = fixtureModel();
  m.site.boundary = { outer: circle(200, 40_000) };
  m.site.roads = [0, 1, 2, 3, 4].map((edge_index) => ({ edge_index, width_mm: 6000 }));
  m.masses = Array.from({ length: 6 }, (_, k) => {
    const x = -15_000 + (k % 3) * 9_000 + (k === 0 ? shift : 0);
    const y = -10_000 + Math.floor(k / 3) * 9_000;
    return {
      id: `m${k}`,
      footprint: { outer: [[x, y], [x + 10_000, y], [x + 10_000, y + 10_000], [x, y + 10_000]] as Point[] },
      base_level_mm: 0,
      floors: [1, 2, 3, 4].map((level) => ({ id: `m${k}f${level}`, level, height_mm: 3000, use: "가짜용도A" })),
      roof: { type: "flat" as const },
    };
  });
  return m;
}

function measure(label: string, runs: number, fn: (i: number) => unknown): void {
  fn(0);
  const times: number[] = [];
  for (let i = 1; i <= runs; i++) {
    const t0 = performance.now();
    fn(i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pick = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] as number).toFixed(2);
  console.log(`${label.padEnd(40)} median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${runs})`);
}

const fixture = loadRulePack(structuredClone(FIXTURE_PACK_RAW));
const shipped = loadRulePack(JSON.parse(readFileSync(new URL("../../packages/rules/packs/2026.10.0/pack.json", import.meta.url), "utf8")));
console.log(`node ${process.version}, ${cpus()[0]?.model ?? "?"} × ${cpus().length}`);
console.log("입력: 대지 200꼭짓점(반지름 40m), 매스 6개×4층(겹침 있음), 도로 변 5개, 반복마다 매스 m0을 1mm씩 이동");
measure("judge(확정 경로, 테스트 팩)", 200, (i) => judge(model(i), fixture));
measure("judge(배포 팩 2026.10.0, 전 항목 미확인)", 200, (i) => judge(model(i), shipped));
