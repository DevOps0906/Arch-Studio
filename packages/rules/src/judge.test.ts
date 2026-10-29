// 판정 엔진(AR-06-015): 수치 판정·신청일 선택·조례/지역 경고·근거 없는 행 0·결정성.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { judgmentResultSchema, type DesignModelV1 } from "@arch-studio/domain";
import { judge, loadRulePack, RulesError, type JudgeOutput } from "./index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "./test-fixtures.ts";
import { fixturePack, row } from "./test-helpers.ts";

const pack = fixturePack();

function only(out: JudgeOutput, ruleId: string) {
  const r = row(out, ruleId);
  assert.ok(r, `행 없음: ${ruleId}`);
  return r;
}

test("조례 확인 지자체: 측정값·한도·판정, 지자체 조례 규칙이 전국 규칙보다 우선", () => {
  const out = judge(fixtureModel(), pack);
  assert.equal(judgmentResultSchema.safeParse(out.result).success, true);
  assert.deepEqual(only(out, "coverage.fake-local").item, {
    key: "coverage",
    verdict: "PASS",
    value: 26.67,
    limit: 40,
    unit: "pct",
    basis: [{ law: "테스트법(가짜)", article: "가짜 조례 제1조", effective_from: "2000-01-01", ordinance: true }],
  });
  assert.equal(row(out, "coverage.fake"), undefined);
  assert.equal(only(out, "far.fake").item.value, 53.33);
  assert.equal(only(out, "far.fake").item.verdict, "PASS");
  assert.equal(only(out, "height.fake").item.value, 6000);
  assert.equal(only(out, "setback.fake-road").item.value, 2000);
  assert.equal(only(out, "setback.fake-adjacent").item.value, 2000);
  assert.equal(only(out, "parking.fake").item.value, 2); // 160㎡ / 100㎡ = 1.6 → 올림
  assert.equal(only(out, "parking.fake").item.verdict, "NA");
  assert.equal(only(out, "seismic.fake").item.value, 0);
  assert.equal(only(out, "zero-energy.fake-unverified").item.verdict, "WARN");
  assert.deepEqual(only(out, "zero-energy.fake-unverified").detail.reasons, ["UNVERIFIED_RULE"]);
  assert.deepEqual(out.result.items.map((i) => i.key), [
    "coverage",
    "far",
    "height",
    "sunlight",
    "setback",
    "setback",
    "parking",
    "seismic",
    "zero_energy",
  ]);
});

test("신청 예정일: 시행일(포함)·폐지일(제외) 경계에서 일조사선 규칙이 구·신으로 바뀐다", () => {
  const before = judge(fixtureModel({ application_date: "2000-06-30" }), pack);
  const at = judge(fixtureModel({ application_date: "2000-07-01" }), pack);
  assert.ok(row(before, "sunlight.fake-old"));
  assert.equal(row(before, "sunlight.fake-new"), undefined);
  assert.ok(row(at, "sunlight.fake-new"));
  assert.equal(row(at, "sunlight.fake-old"), undefined);
  assert.equal(only(at, "sunlight.fake-new").item.basis[0]?.effective_from, "2000-07-01");
});

test("예정 규칙: 시행 전이면 경고만, 시행 후에는 판정에 쓴다", () => {
  const before = judge(fixtureModel(), pack);
  const w = before.warnings.find((x) => x.code === "SCHEDULED_RULES");
  assert.deepEqual(w?.rule_ids, ["far.fake-future", "sunlight.fake-new"]);
  assert.equal(only(before, "far.fake").item.limit, 150);
  const after = judge(fixtureModel({ application_date: "2001-01-01" }), pack);
  assert.equal(only(after, "far.fake-future").item.limit, 200);
  assert.equal(row(after, "far.fake"), undefined);
});

test("조례 미확인 지자체: 조례 의존 규칙만 WARN(참고값 유지), 지자체 경고", () => {
  const out = judge(fixtureModel({ municipality_code: "T-NO" }), pack);
  const cov = only(out, "coverage.fake");
  assert.equal(cov.item.verdict, "WARN");
  assert.equal(cov.item.limit, 50);
  assert.deepEqual(cov.detail.reasons, ["ORDINANCE_UNVERIFIED"]);
  assert.equal(only(out, "far.fake").item.verdict, "PASS");
  assert.ok(out.warnings.some((w) => w.code === "ORDINANCE_UNVERIFIED_MUNICIPALITY"));
});

test("지원 지역 밖: 합격·불합격 0, 미지원 경고", () => {
  const out = judge(fixtureModel({ municipality_code: "X-UNKNOWN" }), pack);
  assert.ok(out.result.items.every((i) => i.verdict !== "PASS" && i.verdict !== "FAIL"));
  assert.ok(out.warnings.some((w) => w.code === "MUNICIPALITY_NOT_IN_PACK"));
  assert.ok(out.details.filter((d) => d.status === "confirmed" && d.key === "far").every((d) => d.reasons.includes("UNSUPPORTED_REGION")));
});

test("FAIL·경계: 높이 초과 FAIL, 이격은 정확 비교(같으면 PASS·1mm 모자라면 FAIL), 건폐율 한도와 같으면 PASS", () => {
  const m = fixtureModel();
  const mass = m.masses[0] as DesignModelV1["masses"][number];
  mass.floors.push({ id: "f3", level: 3, height_mm: 3000, use: "가짜용도A" }, { id: "f4", level: 4, height_mm: 3001, use: "가짜용도A" });
  mass.footprint = { outer: [[1500, 1499], [13500, 1499], [13500, 11500], [1500, 11500]] };
  const out = judge(m, pack);
  assert.equal(only(out, "height.fake").item.verdict, "FAIL");
  assert.equal(only(out, "setback.fake-road").item.verdict, "FAIL"); // 1499 < 1500
  assert.equal(only(out, "setback.fake-adjacent").item.verdict, "PASS"); // 1500 ≥ 1000
  assert.equal(only(out, "seismic.fake").item.value, 1);
  assert.deepEqual(only(out, "seismic.fake").detail.reasons, ["TARGET"]);

  mass.footprint = { outer: [[1500, 1500], [13500, 1500], [13500, 11500], [1500, 11500]] }; // 12m×10m = 120㎡ = 40%
  const eq = judge(m, pack);
  assert.equal(only(eq, "setback.fake-road").item.verdict, "PASS");
  assert.equal(only(eq, "coverage.fake-local").item.value, 40);
  assert.equal(only(eq, "coverage.fake-local").item.verdict, "PASS");
});

test("이격 비교는 반올림 거리가 아니라 정확 거리: 표시 1500인데 실제 1499.9…mm면 FAIL", () => {
  const m = fixtureModel();
  // 변 0: (0,0)→(20000,1). 꼭짓점 (8000,1500)까지 거리 = (20000·1500 − 8000) / √(20000²+1) ≈ 1499.59998mm → 표시 1500.
  m.site.boundary = { outer: [[0, 0], [20000, 1], [20000, 15000], [0, 15000]] };
  m.masses[0] = { ...(m.masses[0] as DesignModelV1["masses"][number]), footprint: { outer: [[6000, 1500], [8000, 1500], [8000, 8000], [6000, 8000]] } };
  const out = judge(m, pack);
  const r = only(out, "setback.fake-road");
  assert.equal(r.item.value, 1500);
  assert.equal(r.item.verdict, "FAIL");
});

test("roads.edge_index는 정규화 전 원래 변 순서를 쓴다(시계 방향 대지)", () => {
  const m = fixtureModel();
  // 시계 방향: 변 0 = (0,0)→(0,15000) 서쪽. 정규화(반시계)하면 변 0이 남쪽이 되지만 원래 순서를 써야 한다.
  m.site.boundary = { outer: [[0, 0], [0, 15000], [20000, 15000], [20000, 0]] };
  m.masses[0] = { ...(m.masses[0] as DesignModelV1["masses"][number]), footprint: { outer: [[3000, 2000], [12000, 2000], [12000, 10000], [3000, 10000]] } };
  const out = judge(m, pack);
  assert.equal(only(out, "setback.fake-road").item.value, 3000);
  assert.equal(only(out, "setback.fake-adjacent").item.value, 2000);
});

test("잘못된 입력: 도로 변 번호 범위 밖·신청일 형식 오류는 RulesError(INVALID_INPUT)", () => {
  const m = fixtureModel();
  m.site.roads = [{ edge_index: 4, width_mm: 6000 }];
  assert.throws(() => judge(m, pack), (e: unknown) => e instanceof RulesError && e.code === "INVALID_INPUT");
  assert.throws(
    () => judge(fixtureModel({ application_date: "2000-02-30" }), pack),
    (e: unknown) => e instanceof RulesError && e.code === "INVALID_INPUT",
  );
});

test("매스가 대지 밖: 이격 0 FAIL + 사유, 매스 없음: 이격 행 WARN·건폐율 0", () => {
  const m = fixtureModel();
  m.masses[0] = { ...(m.masses[0] as DesignModelV1["masses"][number]), footprint: { outer: [[15000, 2000], [25000, 2000], [25000, 10000], [15000, 10000]] } };
  const out = judge(m, pack);
  const r = only(out, "setback.fake-adjacent");
  assert.equal(r.item.value, 0);
  assert.equal(r.item.verdict, "FAIL");
  assert.ok(r.detail.reasons.includes("MASS_OUTSIDE_SITE"));

  const empty = fixtureModel();
  empty.masses = [];
  const e = judge(empty, pack);
  assert.equal(only(e, "setback.fake-road").item.verdict, "WARN");
  assert.deepEqual(only(e, "setback.fake-road").detail.reasons, ["NO_MASS"]);
  assert.equal(only(e, "coverage.fake-local").item.value, 0);
});

test("도로가 없으면 도로 이격 행을 만들지 않는다", () => {
  const m = fixtureModel();
  m.site.roads = [];
  const out = judge(m, pack);
  assert.equal(row(out, "setback.fake-road"), undefined);
  assert.ok(row(out, "setback.fake-adjacent"));
});

test("겹친 매스: 건축면적은 합집합, 용적률 연면적은 층별 합집합", () => {
  const m = fixtureModel();
  const base = m.masses[0] as DesignModelV1["masses"][number];
  m.masses.push({ ...base, id: "m2", footprint: { outer: [[7000, 2000], [17000, 2000], [17000, 10000], [7000, 10000]] }, floors: [{ id: "g1", level: 1, height_mm: 3000, use: "가짜용도A" }] });
  const out = judge(m, pack);
  // 합집합 15m×8m = 120㎡ → 40%. 연면적: 1층 120 + 2층 80 = 200㎡ → 66.67%
  assert.equal(only(out, "coverage.fake-local").item.value, 40);
  assert.equal(only(out, "far.fake").item.value, 66.67);
});

test("용적률 산정 제외: 팩 params가 지하층 포함이면 지하 면적을 더하고, 미확인 규칙은 지하 제외 + 사유 표기", () => {
  const m = fixtureModel();
  (m.masses[0] as DesignModelV1["masses"][number]).floors.push({ id: "b1", level: -1, height_mm: 3000, use: "가짜용도A" });
  assert.equal(only(judge(m, pack), "far.fake").item.value, 53.33);
  const raw = JSON.parse(JSON.stringify(FIXTURE_PACK_RAW));
  raw.rules.find((r: { id: string }) => r.id === "far.fake").params.far_floor_area_exclusions = [];
  assert.equal(only(judge(m, loadRulePack(raw)), "far.fake").item.value, 80); // 240㎡ / 300㎡
  const unv = JSON.parse(JSON.stringify(FIXTURE_PACK_RAW));
  const far = unv.rules.find((r: { id: string }) => r.id === "far.fake");
  Object.assign(far, { status: "unverified", basis: [{ law: "미확인", article: "미확인", effective_from: "미확인", ordinance: false }] });
  delete far.params;
  delete far.review;
  const r = only(judge(m, loadRulePack(unv)), "far.fake");
  assert.equal(r.item.value, 53.33);
  assert.deepEqual(r.detail.reasons, ["UNVERIFIED_RULE", "FAR_EXCLUSIONS_UNVERIFIED"]);
});

test("pendingChanges는 그대로 싣고, 음수는 거부한다", () => {
  assert.equal(judge(fixtureModel(), pack, { pendingChanges: 3 }).result.pending_changes, 3);
  assert.throws(() => judge(fixtureModel(), pack, { pendingChanges: -1 }), RulesError);
});

test("팩 버전이 rule_context와 다르면 경고", () => {
  const out = judge(fixtureModel({ rule_pack_version: "1999.12.1" }), pack);
  assert.ok(out.warnings.some((w) => w.code === "PACK_VERSION_MISMATCH"));
  assert.equal(out.result.rule_pack_version, "2000.01.1");
});
