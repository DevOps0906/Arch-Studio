// 매스 자동 제안 테스트(AR-06-028). 팩은 가짜(rules test-fixtures) 또는 배포 팩(전 항목 미확인).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 배포 팩 읽기(테스트 전용)
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { before, test } from "node:test";
import { designModelV1Schema, type DesignModelV1 } from "@arch-studio/domain";
import { loadSolidKernel, type SolidKernel, type SolidNode } from "@arch-studio/geometry";
import { buildEnvelope, judge, loadRulePack, type RulePack } from "@arch-studio/rules";
import { MassingError, STRATEGY_TITLE, suggestMasses, targetsFromProgram, type SuggestResult, type SuggestTargets } from "./index.ts";
import { emptySiteModel, fixturePack, L_SHAPE, lcg } from "./test-fixtures.ts";

let kernel: SolidKernel;
let pack: RulePack;
before(async () => {
  kernel = await loadSolidKernel();
  pack = fixturePack();
});

const T = (over: Partial<SuggestTargets> = {}): SuggestTargets => ({ target_gfa_m2: null, floors: null, floor_height_mm: 3000, use: "가짜용도A", ...over });
const GEO_KEYS = ["coverage", "far", "height", "setback"];

/** 후보 매스가 정말 엔벨로프 안에 있는지 커널로 독립 확인(제안 엔진의 허용 오차와 별개로 1리터 이하). */
function outsideVolume(model: DesignModelV1, candidate: SuggestResult["candidates"][number], p: RulePack): number {
  const env = buildEnvelope(model, p, kernel, { cap_height_mm: 60_000 });
  let total = 0;
  for (const m of candidate.masses) {
    const h = m.floors.reduce((s, f) => s + f.height_mm, 0);
    const prism: SolidNode = { op: "extrude", region: { op: "polygons", polygons: [m.footprint] }, z0: m.base_level_mm, z1: m.base_level_mm + h };
    const [r] = kernel.renderMeshes([{ op: "subtract", base: prism, minus: [{ op: "mesh", mesh: env.solid }] }]);
    if (!r || r.index.length === 0) continue;
    for (let i = 0; i < r.index.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => (r.index[i + k] as number) * 3) as [number, number, number];
      const P = r.positions;
      total += (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) / 6;
    }
  }
  return Math.abs(total);
}

function assertValid(model: DesignModelV1, r: SuggestResult, p: RulePack): void {
  for (const c of r.candidates) {
    // 후보는 FAIL 0(핵심: 판정 엔진 재실행으로 독립 확인), 스키마 통과, 엔벨로프 안.
    const out = judge({ ...model, masses: c.masses }, p);
    assert.equal(out.result.items.filter((i) => i.verdict === "FAIL").length, 0, `${c.id}: FAIL 항목 있음`);
    assert.deepEqual(out, c.judge, `${c.id}: 동봉한 판정이 다시 계산한 판정과 다름`);
    assert.ok(designModelV1Schema.safeParse({ ...model, masses: c.masses }).success, `${c.id}: 스키마 위반`);
    assert.ok(outsideVolume(model, c, p) <= 1_000_000, `${c.id}: 엔벨로프 밖으로 나감`);
    assert.equal(c.status === "pass", c.judge.result.items.filter((i) => GEO_KEYS.includes(i.key)).every((i) => i.verdict === "PASS"));
    assert.equal(c.title, STRATEGY_TITLE[c.strategy]);
    for (const m of c.masses) for (const [x, y] of m.footprint.outer) assert.ok(Number.isInteger(x) && Number.isInteger(y));
  }
}

test("직사각형 대지: 건폐 최대·일조 여유·정형 평면 3안, 모두 판정 FAIL 0·핵심 4항목 PASS·엔벨로프 안", () => {
  const model = emptySiteModel();
  const r = suggestMasses(model, pack, kernel, T({ target_gfa_m2: 300 }));
  assert.deepEqual(r.candidates.map((c) => c.strategy), ["max_coverage", "sunlight_margin", "regular_plan"]);
  assert.ok(r.candidates.every((c) => c.status === "pass"));
  assertValid(model, r, pack);
  // 세 안은 서로 다르다(같은 바닥·층 조합 없음).
  const keys = new Set(r.candidates.map((c) => JSON.stringify([c.masses[0]?.footprint, c.floors])));
  assert.equal(keys.size, 3);
  // 건폐 최대안은 건폐율 한도(가짜 조례 40%)를 꽉 채운다.
  const a = r.candidates[0]!;
  assert.equal(a.footprint_area_m2, 120);
  const cov = a.judge.result.items.find((i) => i.key === "coverage");
  assert.equal(cov?.value, 40);
  // 일조 여유안은 정북 쪽(+Y)을 건폐 최대안보다 더 물렸다.
  const maxY = (c: SuggestResult["candidates"][number]) => Math.max(...c.masses[0]!.footprint.outer.map((p) => p[1]));
  assert.ok(maxY(r.candidates[1]!) < maxY(a));
  // 정형안: 긴 변 ≤ 짧은 변 × 1.5, 두 변이 1,000mm 배수.
  const c = r.candidates[2]!;
  assert.ok(Math.max(c.width_mm, c.depth_mm) <= Math.min(c.width_mm, c.depth_mm) * 1.5);
  assert.equal(c.width_mm % 1000, 0);
  assert.equal(c.depth_mm % 1000, 0);
});

test("같은 입력 → 같은 출력(바이트), 입력은 바뀌지 않는다", () => {
  const model = emptySiteModel();
  const before = JSON.stringify(model);
  const first = JSON.stringify(suggestMasses(model, pack, kernel, T({ target_gfa_m2: 300 })));
  const second = JSON.stringify(suggestMasses(structuredClone(model), pack, kernel, T({ target_gfa_m2: 300 })));
  assert.equal(second, first);
  assert.equal(JSON.stringify(model), before);
});

test("목표를 못 채우면 '엔벨로프 안에서 최대 <값>㎡'와 함께 FAIL 없는 후보를 돌려준다", () => {
  const model = emptySiteModel();
  const r = suggestMasses(model, pack, kernel, T({ target_gfa_m2: 5000 }));
  assert.equal(r.target_met, false);
  const n = r.notices.find((x) => x.code === "TARGET_NOT_MET");
  assert.ok(n);
  assert.match(n.message, /^엔벨로프 안에서 최대 [\d.]+㎡입니다\.$/);
  assert.ok(r.max_gfa_m2 > 0 && r.max_gfa_m2 < 5000);
  assert.ok(n.message.includes(String(r.max_gfa_m2)));
  assert.ok(r.candidates.length > 0);
  assertValid(model, r, pack);
  // 안내한 최대값이 실제 후보의 연면적 이상이다(과대 약속 없음).
  for (const c of r.candidates) assert.ok(c.gfa_m2 <= r.max_gfa_m2 + 0.01);
});

test("목표 층수만 주면 그 층수(들어가는 범위)로 만든다", () => {
  const model = emptySiteModel();
  const r = suggestMasses(model, pack, kernel, T({ floors: 2 }));
  assert.ok(r.candidates.length > 0);
  assert.ok(r.candidates.every((c) => c.floors <= 2));
  assertValid(model, r, pack);
});

test("배포 팩(전 항목 미확인): PASS를 만들지 않는다 — 후보는 '확인 필요'이고 안내가 붙는다", () => {
  const raw = JSON.parse(readFileSync(new URL("../../rules/packs/2026.10.0/pack.json", import.meta.url), "utf8").replace(/\r\n/g, "\n")) as unknown;
  const shipped = loadRulePack(raw);
  const model = emptySiteModel({ rule_pack_version: "2026.10.0", application_date: "2026-11-02" });
  const r = suggestMasses(model, shipped, kernel, T({ target_gfa_m2: 300 }));
  assert.ok(r.notices.some((x) => x.code === "LAW_UNVERIFIED"));
  assert.ok(r.candidates.length > 0);
  for (const c of r.candidates) {
    assert.equal(c.status, "check");
    assert.ok(c.judge.result.items.filter((i) => GEO_KEYS.includes(i.key)).every((i) => i.verdict === "WARN"));
    assert.equal(c.judge.result.items.filter((i) => i.verdict === "FAIL").length, 0);
  }
});

test("L자 대지 + 정북 30°: 후보 FAIL 0, 엔벨로프 안, 결정적", () => {
  const model = emptySiteModel();
  model.site.boundary = { outer: L_SHAPE };
  model.site.north_angle_deg = 30;
  model.site.roads = [{ edge_index: 0, width_mm: 6000 }];
  const r = suggestMasses(model, pack, kernel, T({ target_gfa_m2: 200 }));
  assert.ok(r.candidates.length >= 1);
  assertValid(model, r, pack);
  assert.equal(JSON.stringify(suggestMasses(model, pack, kernel, T({ target_gfa_m2: 200 }))), JSON.stringify(r));
});

test("속성: 무작위(고정 시드) 목표·정북·대지에서 후보 FAIL 0, 엔벨로프 안", () => {
  const rand = lcg(20261029);
  for (let i = 0; i < 12; i++) {
    const model = emptySiteModel();
    const w = 14000 + Math.floor(rand() * 20) * 1000;
    const d = 12000 + Math.floor(rand() * 15) * 1000;
    model.site.boundary = { outer: [[0, 0], [w, 0], [w, d], [0, d]] };
    model.site.north_angle_deg = Math.floor(rand() * 4) * 90 + (i % 3 === 0 ? 0 : 17);
    model.site.roads = i % 2 === 0 ? [{ edge_index: 0, width_mm: 6000 }] : [];
    const targets = T({ target_gfa_m2: rand() < 0.5 ? null : 100 + Math.floor(rand() * 600), floors: rand() < 0.3 ? 1 + Math.floor(rand() * 4) : null, floor_height_mm: 2800 + Math.floor(rand() * 3) * 200 });
    const r = suggestMasses(model, pack, kernel, targets);
    assertValid(model, r, pack);
  }
});

test("엔벨로프가 비면 후보 0 + 안내", () => {
  const model = emptySiteModel();
  model.site.boundary = { outer: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]] }; // 이격으로 다 사라진다
  const r = suggestMasses(model, pack, kernel, T());
  assert.equal(r.candidates.length, 0);
  assert.ok(r.notices.some((n) => n.code === "ENVELOPE_EMPTY"));
  // 이격 뒤 남지만 한 변 최소 길이에 못 미치는 대지는 후보 없음(NO_CANDIDATE).
  model.site.boundary = { outer: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]] };
  const r2 = suggestMasses(model, pack, kernel, T());
  assert.equal(r2.candidates.length, 0);
  assert.ok(r2.notices.some((n) => n.code === "NO_CANDIDATE"));
});

test("목표 입력 검사와 면적표 기본값", () => {
  const model = emptySiteModel();
  for (const bad of [T({ target_gfa_m2: -1 }), T({ floors: 0 }), T({ floors: 1.5 }), T({ floor_height_mm: 100 }), T({ use: "" })]) {
    assert.throws(() => suggestMasses(model, pack, kernel, bad), (e: unknown) => e instanceof MassingError && e.code === "INVALID_TARGETS");
  }
  model.program.targets = [
    { name: "거실", use: "가짜용도A", target_area_m2: 30.5 },
    { name: "침실", use: "가짜용도A", target_area_m2: 20 },
  ];
  assert.deepEqual(targetsFromProgram(model), { target_gfa_m2: 50.5, floors: null, floor_height_mm: 3000, use: "가짜용도A" });
});
