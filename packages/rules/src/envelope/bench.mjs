// 엔벨로프 벤치(AR-F-002: 대지 꼭짓점 200개 이하 p95 2초). 테스트 밖에서 수동 실행: pnpm --filter @arch-studio/rules bench:envelope
// .mjs인 이유: rules tsconfig는 Node 타입이 없어 src의 .ts 스크립트가 typecheck를 깨뜨린다(엔진 코드 아님).
// 결과는 tasks/logs/AR-06-016.md에 기기 사양과 함께 적는다. 팩은 가짜(test-fixtures), 입력은 고정 시드 LCG + 유리 매개화 원.
// eslint-disable-next-line no-restricted-imports -- 벤치 스크립트는 OS 정보만 읽는다(엔진 코드 아님)
import { cpus } from "node:os";
import { loadSolidKernel, roundHalfAway } from "@arch-studio/geometry";
import { loadRulePack } from "../pack.ts";
import { fixtureModel } from "../test-fixtures.ts";
import { buildEnvelope } from "./envelope.ts";
import { envelopeFixturePackRaw, TEST_CAP_MM } from "./test-fixtures.ts";

let seed = 20261029;
function rand() {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
}

/** 반지름 R(±10%) 요철 n각형 대지. */
/** @returns {[number, number][]} */
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
const pack = loadRulePack(envelopeFixturePackRaw());
const runs = 50;
for (const [label, date] of [
  ["구 기준(계단 1 + 비율 1)", "2000-06-30"],
  ["신 기준(계단 2 + 비율 1)", "2000-07-01"],
]) {
  const times = [];
  let volume = 0;
  let verts = 0;
  for (let i = 0; i < runs + 1; i++) {
    const m = fixtureModel({ application_date: date });
    m.site.boundary = { outer: blob(200, 30000) };
    m.site.north_angle_deg = 17 + i; // 반복마다 정북 각도를 바꿔 캐시 효과를 없앤다
    m.site.roads = [{ edge_index: 0, width_mm: 6000 }, { edge_index: 1, width_mm: 6000 }];
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    const t0 = performance.now();
    const out = buildEnvelope(m, pack, kernel, { cap_height_mm: TEST_CAP_MM });
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    const dt = performance.now() - t0;
    if (i > 0) times.push(dt); // 첫 회는 예열
    volume = out.volume_mm3;
    verts = out.solid.vertices.length;
  }
  times.sort((a, b) => a - b);
  const pick = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(1);
  console.log(`${label}: median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${runs}, 꼭짓점 200, 메시 꼭짓점 ${verts}, 부피 ${volume})`);
}
console.log(`기기: ${cpus()[0]?.model ?? "?"} × ${cpus().length}, Node ${process.version}`);
