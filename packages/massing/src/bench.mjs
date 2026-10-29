// 매스 제안 벤치(AR-F-033: 대지 꼭짓점 200개 이하 p95 3초). 테스트 밖에서 수동 실행: pnpm --filter @arch-studio/massing bench
// .mjs인 이유: massing tsconfig는 Node 타입이 없어 .ts 스크립트가 typecheck를 깨뜨린다(엔진 코드 아님).
// 결과는 tasks/logs/AR-06-028.md에 기기 사양과 함께 적는다. 팩은 가짜, 입력은 고정 시드 LCG + 유리 매개화 원(rules bench:envelope와 같은 대지).
// eslint-disable-next-line no-restricted-imports -- 벤치 스크립트는 OS 정보만 읽는다(엔진 코드 아님)
import { cpus } from "node:os";
import { loadSolidKernel, roundHalfAway } from "@arch-studio/geometry";
import { suggestMasses } from "./suggest.ts";
import { emptySiteModel, fixturePack } from "./test-fixtures.ts";

let seed = 20261029;
function rand() {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
}

/** 반지름 R(±10%) 요철 n각형 대지. */
function blob(n, R) {
  const pts = [];
  const q = n / 4;
  for (let quad = 0; quad < 4; quad++) {
    for (let i = 0; i < q; i++) {
      const t = i / q;
      const c = (1 - t * t) / (1 + t * t);
      const s = (2 * t) / (1 + t * t);
      const r = R * (0.9 + 0.2 * rand());
      const [x, y] = [[c, s], [-s, c], [-c, -s], [s, -c]][quad];
      pts.push([roundHalfAway(r * x), roundHalfAway(r * y)]);
    }
  }
  return pts;
}

const kernel = await loadSolidKernel();
const pack = fixturePack();
const runs = 30;
for (const [label, verts, R, target] of [
  ["직사각형 4꼭짓점", 4, 0, 300],
  ["요철 200꼭짓점 R=30m, 목표 600㎡", 200, 30000, 600],
  ["요철 200꼭짓점 R=30m, 목표 없음", 200, 30000, null],
]) {
  const times = [];
  let found = 0;
  for (let i = 0; i < runs + 1; i++) {
    const m = emptySiteModel();
    m.site.boundary = verts === 4 ? { outer: [[0, 0], [20000, 0], [20000, 15000], [0, 15000]] } : { outer: blob(verts, R) };
    m.site.north_angle_deg = 17 + i; // 반복마다 정북 각도를 바꿔 캐시 효과를 없앤다
    m.site.roads = [{ edge_index: 0, width_mm: 6000 }];
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    const t0 = performance.now();
    const out = suggestMasses(m, pack, kernel, { target_gfa_m2: target, floors: null, floor_height_mm: 3000, use: "가짜용도A" });
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    const dt = performance.now() - t0;
    if (i > 0) times.push(dt); // 첫 회는 예열
    found += out.candidates.length;
  }
  times.sort((a, b) => a - b);
  const pick = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(1);
  console.log(`${label}: median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${runs}, 후보 평균 ${(found / (runs + 1)).toFixed(1)}개)`);
}
console.log(`기기: ${cpus()[0]?.model ?? "?"} × ${cpus().length}, Node ${process.version}`);
