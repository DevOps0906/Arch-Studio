// 스파이크(버리는 코드): 예시 대지 엔벨로프 입력. packages/rules의 테스트 고정 입력(가짜 팩, 법규 수치 아님)을 읽기만 한다.
// 스파이크가 packages를 상대 경로로 읽는 것은 측정용이다(반대 방향 — 패키지가 spikes를 import — 은 금지).
import { loadRulePack } from "../../../../packages/rules/src/pack.ts";
import { fixtureModel } from "../../../../packages/rules/src/test-fixtures.ts";
import { buildEnvelope } from "../../../../packages/rules/src/envelope/envelope.ts";
import { envelopeFixturePackRaw, TEST_CAP_MM } from "../../../../packages/rules/src/envelope/test-fixtures.ts";
import type { SolidKernel } from "../../../../packages/geometry/src/solid/kernel.ts";
import { lcg, SITE } from "./scene.ts";

/** 요철 200각형 대지(중심 50m,30m, 반지름 52m ±8%). 고정 시드. rules 벤치(blob)와 같은 방식. */
export function blobSite(): [number, number][] {
  const rnd = lcg(20261029);
  const pts: [number, number][] = [];
  const n = 200;
  const q = n / 4;
  for (let quad = 0; quad < 4; quad++) {
    for (let i = 0; i < q; i++) {
      const t = i / q;
      const c = (1 - t * t) / (1 + t * t);
      const s = (2 * t) / (1 + t * t);
      const r = 52000 * (0.92 + 0.16 * rnd());
      const [x, y] = ([[c, s], [-s, c], [-c, -s], [s, -c]] as const)[quad]!;
      pts.push([Math.round(50000 + r * x), Math.round(30000 + r * y * 0.62)]);
    }
  }
  return pts;
}

export function exampleEnvelope(kernel: SolidKernel, northDeg = 0, site: "rect" | "blob" = "rect") {
  const pack = loadRulePack(envelopeFixturePackRaw());
  const m = fixtureModel({ application_date: "2000-07-01" }); // 가짜 신 기준(계단 2 + 비율 1)
  m.site.boundary = { outer: site === "rect" ? SITE.map(([x, y]) => [x, y] as [number, number]) : blobSite() };
  m.site.north_angle_deg = northDeg;
  m.site.roads = site === "rect" ? [{ edge_index: 0, width_mm: 6000 }] : [{ edge_index: 0, width_mm: 6000 }, { edge_index: 1, width_mm: 6000 }];
  return buildEnvelope(m, pack, kernel, { cap_height_mm: TEST_CAP_MM });
}
