// 엔벨로프 단위 테스트(AR-06-016). 팩은 전부 가짜(test-fixtures) 또는 배포 팩(전 항목 미확인).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 배포 팩·소스 검사용 파일 읽기(테스트 전용)
import { readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { before, test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { loadSolidKernel, type SolidKernel } from "@arch-studio/geometry";
import { RulesError, buildEnvelope, loadRulePack, serializeEnvelope, sinCosDeg, type EnvelopeOutput, type RulePack } from "../index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "../test-fixtures.ts";
import { envelopeFixturePackRaw, TEST_CAP_MM } from "./test-fixtures.ts";

let k: SolidKernel;
let pack: RulePack;
before(async () => {
  k = await loadSolidKernel();
  pack = loadRulePack(envelopeFixturePackRaw());
});
const opts = { cap_height_mm: TEST_CAP_MM };
const build = (m: DesignModelV1, p: RulePack = pack) => buildEnvelope(m, p, k, opts);
const con = (o: EnvelopeOutput, key: string, edge?: string) => o.constraints.find((c) => c.key === key && c.edge_class === (edge as never));

test("가짜 구 기준: 볼륨이 해석해와 정확히 같다(이격·높이·일조 계단+비율)", () => {
  const o = build(fixtureModel({ application_date: "2000-06-30" }));
  // 지면: 20m×15m − 도로(남) 1.5m, 인접 1m → [1000,19000]×[1500,14000]
  assert.deepEqual(o.footprint, [{ outer: [[1000, 1500], [19000, 1500], [19000, 14000], [1000, 14000]], holes: [] }]);
  // 0~3m: 18000×12500×3000, 3~12m: 거리 ≥ z → y ≤ 15000 − z, 18000×∫(13500 − z)dz
  assert.equal(o.volume_mm3, 675_000_000_000n + 972_000_000_000n);
  assert.equal(o.top_mm, 12000);
  assert.equal(o.top_source, "height_rule");
  assert.equal(o.max_building_area_mm2, 120_000_000); // 가짜 조례 40% × 300㎡
  assert.ok(o.constraints.every((c) => c.status === "applied" && c.applied));
  assert.ok(o.warnings.some((w) => w.code === "FOOTPRINT_EXCEEDS_COVERAGE"));
  for (const v of o.solid.vertices) assert.ok(v.every(Number.isInteger));
});

test("미확인 배포 팩: 제약을 적용하지 않고 경고, 대지 × 표시 상한", () => {
  const raw = JSON.parse(readFileSync(new URL("../../packs/2026.10.0/pack.json", import.meta.url), "utf8").replace(/\r\n/g, "\n")) as unknown;
  const o = build(fixtureModel({ rule_pack_version: "2026.10.0", application_date: "2026-11-02" }), loadRulePack(raw));
  assert.ok(o.constraints.every((c) => c.status === "unverified" && !c.applied && c.reasons[0] === "UNVERIFIED_RULE"));
  assert.ok(o.constraints.every((c) => c.applied_params === undefined));
  assert.equal(o.warnings.filter((w) => w.code === "CONSTRAINT_NOT_APPLIED").length, 5);
  assert.ok(o.warnings.some((w) => w.code === "HEIGHT_DISPLAY_CAP"));
  assert.equal(o.max_building_area_mm2, null);
  assert.equal(o.top_source, "display_cap");
  assert.equal(o.volume_mm3, BigInt(20000 * 15000 * TEST_CAP_MM));
});

test("일조사선 수치 형식이 아니면(판정 테스트 팩의 빈 params) 적용하지 않고 경고", () => {
  const o = build(fixtureModel(), loadRulePack(structuredClone(FIXTURE_PACK_RAW)));
  const s = con(o, "sunlight");
  assert.equal(s?.status, "invalid_params");
  assert.equal(s?.applied, false);
  assert.ok(o.warnings.some((w) => w.code === "CONSTRAINT_NOT_APPLIED" && w.rule_ids?.includes("sunlight.fake-old")));
});

test("팩에 없는 용도지역: 수치 있는 제약도 적용하지 않음", () => {
  const m = fixtureModel();
  m.site.zoning.use_district = "가짜없는지역";
  const o = build(m);
  for (const key of ["coverage", "height", "sunlight"]) assert.equal(con(o, key)?.status, "district_not_in_pack", key);
  assert.equal(con(o, "setback", "road")?.status, "applied"); // 이격은 용도지역 구분 없는 가짜 수치
  assert.equal(o.top_source, "display_cap");
});

test("지원 지역 밖·조례 미확인: 참고(reference)로 적용", () => {
  const out = build(fixtureModel({ municipality_code: "X-NONE" }));
  assert.ok(out.constraints.every((c) => c.status === "reference" && c.applied && c.reasons.includes("UNSUPPORTED_REGION")));
  assert.ok(out.warnings.some((w) => w.code === "MUNICIPALITY_NOT_IN_PACK"));
  const no = build(fixtureModel({ municipality_code: "T-NO" }));
  assert.equal(con(no, "coverage")?.status, "reference"); // 조례 의존(가짜)
  assert.equal(con(no, "height")?.status, "applied");
});

test("정북 회전·도로 변 없음·결정성", () => {
  const m = fixtureModel();
  m.site.north_angle_deg = 30;
  const a = serializeEnvelope(build(m));
  assert.equal(serializeEnvelope(build(structuredClone(m))), a);
  const noRoad = fixtureModel();
  noRoad.site.roads = [];
  const o = build(noRoad);
  assert.equal(con(o, "setback", "road")?.status, "not_applicable");
  assert.equal(o.footprint_area_mm2, 18000 * 13000);
});

const shippedPack = () =>
  loadRulePack(JSON.parse(readFileSync(new URL("../../packs/2026.10.0/pack.json", import.meta.url), "utf8").replace(/\r\n/g, "\n")) as unknown);
const rectSite = (x0: number, y0: number, x1: number, y1: number) => ({
  outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][],
});

test("부피가 safe int를 넘어도 정확(bigint), JSON은 10진 문자열", () => {
  const m = fixtureModel({ rule_pack_version: "2026.10.0", application_date: "2026-11-02" });
  m.site.boundary = rectSite(0, 0, 1_000_000, 1_000_000); // 1km × 1km
  const o = build(m, shippedPack());
  assert.equal(o.volume_mm3, 30_000_000_000_000_000n); // 1e6 × 1e6 × 3e4 = 3e16 > 2^53
  assert.ok(serializeEnvelope(o).includes('"volume_mm3": "30000000000000000"'));
});

test("대지 끝이 좌표 한계(x = 10,000,000)에 붙어도 보조 도형이 한계 안에서 계산된다", () => {
  const dx = 10_000_000 - 20000;
  const base = build(fixtureModel({ application_date: "2000-06-30" }));
  const m = fixtureModel({ application_date: "2000-06-30" });
  m.site.boundary = rectSite(dx, 0, 10_000_000, 15000);
  const o = build(m);
  assert.deepEqual(o.footprint, [{ outer: [[dx + 1000, 1500], [10_000_000 - 1000, 1500], [10_000_000 - 1000, 14000], [dx + 1000, 14000]], holes: [] }]);
  assert.equal(o.volume_mm3, base.volume_mm3);
  assert.deepEqual(o.solid.vertices, base.solid.vertices.map(([x, y, z]) => [x + dx, y, z]));
});

/** 높이 z 단면의 꼭짓점들. */
const at = (o: EnvelopeOutput, z: number) => o.solid.vertices.filter((v) => v[2] === z);
const maxOf = (vs: number[][], i: number) => Math.max(...vs.map((v) => v[i] as number));

test("가짜 신 기준 독립 검증: 구간 경계 단면(손계산)", () => {
  const o = build(fixtureModel({ application_date: "2000-07-01" }));
  // 0~4m: 거리 1.2m → y ≤ 13800, 4~7m: 3m → y ≤ 12000, 7m~: 거리 ≥ 2z/3 → y ≤ 15000 − 2z/3, 높이 제한 12m(가짜)
  assert.equal(maxOf(at(o, 0), 1), 13800);
  assert.deepEqual([...new Set(at(o, 4000).map((v) => v[1]))].sort((a, b) => (a as number) - (b as number)), [1500, 12000, 13800]);
  assert.deepEqual([...new Set(at(o, 7000).map((v) => v[1]))].sort((a, b) => (a as number) - (b as number)), [1500, 10333, 12000]); // 15000 − 4666.67
  assert.equal(maxOf(at(o, 12000), 1), 7000); // 15000 − 8000
  assert.equal(maxOf(o.solid.vertices, 2), 12000);
  for (const z of [0, 4000, 7000, 12000]) {
    assert.equal(Math.min(...at(o, z).map((v) => v[0] as number)), 1000);
    assert.equal(maxOf(at(o, z), 0), 19000); // 동·서 변은 정북 쪽이 아니라 일조 기준선 아님
  }
});

test("정북 30° 독립 검증: 방향별 제한점(손계산, ±1mm)", () => {
  const m = fixtureModel(); // 가짜 구 기준: 3m까지 1m, 그 위 거리 ≥ z
  m.site.north_angle_deg = 30; // N = (0.5, 0.8660): 북변(y=15000)과 동변(x=20000)이 기준선
  const o = build(m);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  // z = 3000 위 구간 바닥: x ≤ 20000 − 0.5·3000 = 18500, y ≤ 15000 − 0.866·3000 = 12401.9
  const z3 = at(o, 3000);
  assert.ok(z3.some((v) => near(v[0] as number, 18500)), "x 18500");
  assert.ok(z3.some((v) => near(v[1] as number, 12402)), "y 12402");
  // z = 3000 아래 구간 윗면: 거리 1m → x ≤ 19500, y ≤ 14134 이지만 이격(19000, 14000)이 더 좁다
  assert.equal(maxOf(z3, 0), 19000);
  assert.equal(maxOf(z3, 1), 14000);
  // 꼭대기 z = 12000: x ≤ 20000 − 6000 = 14000, y ≤ 15000 − 10392.3 = 4607.7
  const top = at(o, 12000);
  assert.ok(near(maxOf(top, 0), 14000), `${maxOf(top, 0)}`);
  assert.ok(near(maxOf(top, 1), 4608), `${maxOf(top, 1)}`);
  assert.equal(Math.min(...top.map((v) => v[1] as number)), 1500);
});

test("입력 거부: 표시 상한·도로 변 번호·모델 형식", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof RulesError) return e.code;
      throw e;
    }
    return "none";
  };
  assert.equal(code(() => buildEnvelope(fixtureModel(), pack, k, { cap_height_mm: 0 })), "INVALID_INPUT");
  assert.equal(code(() => buildEnvelope(fixtureModel(), pack, k, { cap_height_mm: 1.5 })), "INVALID_INPUT");
  const bad = fixtureModel();
  bad.site.roads = [{ edge_index: 9, width_mm: 6000 }];
  assert.equal(code(() => build(bad)), "INVALID_INPUT");
  assert.equal(code(() => build({} as DesignModelV1)), "INVALID_INPUT");
});

test("sinCosDeg: 90 배수 정확, 다른 각도는 Math 기준 1e-14 안", () => {
  assert.deepEqual(sinCosDeg(0), [0, 1]);
  assert.deepEqual(sinCosDeg(90), [1, 0]);
  assert.deepEqual(sinCosDeg(-90), [-1, 0]);
  assert.deepEqual(sinCosDeg(540), [0, -1]);
  for (let d = -720; d <= 720; d += 7.25) {
    const [s, c] = sinCosDeg(d);
    const r = (d * Math.PI) / 180;
    assert.ok(Math.abs(s - Math.sin(r)) < 1e-14 && Math.abs(c - Math.cos(r)) < 1e-14, `${d}`);
  }
});

test("초월함수 미사용: envelope 소스의 Math는 허용 목록만, ** 없음", () => {
  const dir = new URL(".", import.meta.url);
  const allowed = new Set(["sqrt", "abs", "trunc", "sign", "min", "max", "floor", "round"]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const f of files) {
    readFileSync(new URL(f, dir), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const codePart = line.replace(/\/\/.*$/, "").replace(/^\s*\/?\*.*$/, "");
        const where = `${f}:${i + 1}: ${line.trim()}`;
        assert.equal(/\*\*/.test(codePart), false, where);
        for (const m of codePart.matchAll(/\bMath\b(\s*\.\s*([A-Za-z_$][\w$]*))?/g)) assert.ok(m[2] !== undefined && allowed.has(m[2]), where);
      });
  }
});
