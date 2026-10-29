// area_plan 뷰(AR-06-024): 면적표 값 ≡ 판정/집계 값, 규칙 팩 버전·산정 기준 표시, 결정성, 골든.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { canonicalJson, DraftingError, sha256Hex } from "../../index.ts";
import type { SheetModel } from "../../sheet/types.ts";
import { buildAreaSheet, CASES, areaInput, judgmentOf, modelWith, rect } from "./cases.ts";
import { formatH100, h100OfArea2, type AreaBreakdown } from "./areas.ts";
import { buildAreaPlanView, type AreaPlanInput } from "./index.ts";

const GOLDEN = new URL("../../../golden/", import.meta.url);
const texts = (s: SheetModel) => s.paper_prims.flatMap((p) => (p.t === "text" ? [p] : []));
const flat = { type: "flat" as const };

test("골든: 4건 이상, cases.ts와 디렉터리가 1:1, 바이트·sha256 일치", () => {
  const dirs = readdirSync(GOLDEN)
    .filter((d) => d.startsWith("area_plan-") && existsSync(new URL(`${d}/sheet.json`, GOLDEN)))
    .sort();
  assert.ok(dirs.length >= 4);
  assert.deepEqual(dirs, CASES.map((c) => c.id).sort());
  for (const c of CASES) {
    const body = `${canonicalJson(buildAreaSheet(c.input()))}\n`;
    const golden = readFileSync(new URL(`${c.id}/sheet.json`, GOLDEN), "utf8");
    assert.equal(body, golden, `${c.id}: 골든 불일치(의도한 변경이면 golden/area_plan-tools/update.ts --accept + 커밋 본문에 이유)`);
    assert.equal(readFileSync(new URL(`${c.id}/sheet.sha256`, GOLDEN), "utf8").trim(), sha256Hex(golden));
  }
});

test("같은 입력 → 같은 SheetModel 바이트(깊은 복사 입력도)", () => {
  for (const c of CASES) {
    const a = canonicalJson(buildAreaSheet(c.input()));
    assert.equal(canonicalJson(buildAreaSheet(structuredClone(c.input()))), a);
    assert.equal(canonicalJson(buildAreaSheet(c.input())), a);
  }
});

test("규칙 팩 버전과 산정 기준(외벽 중심선 가정)이 표 아래에 있다", () => {
  for (const c of CASES) {
    const input = c.input();
    const s = buildAreaSheet(input);
    const t = texts(s);
    const end = Math.min(...s.paper_prims.filter((p) => p.t === "line" && p.key === "tbl:h:end").map((p) => (p.t === "line" ? p.a[1] : 0)));
    const ver = t.find((p) => p.s === `규칙 팩 버전 ${input.judgment.rule_pack_version}`);
    const basis = t.find((p) => p.s.includes("외벽 중심선 가정") && p.key.startsWith("note:"));
    assert.ok(ver && basis, c.id);
    assert.equal(ver.source_ref, "judgment.rule_pack_version");
    assert.ok(ver.at[1] < end && basis.at[1] < end, "표 아래");
  }
});

test("수치가 든 TEXT는 모두 source_ref가 있다(표·라벨)", () => {
  for (const c of CASES) {
    const s = buildAreaSheet(c.input());
    const all = [...texts(s).filter((p) => !p.key.startsWith("ttlb:")), ...s.annotations.flatMap((a) => a.prims.flatMap((p) => (p.t === "text" ? [p] : [])))];
    for (const p of all) {
      if (/\d+\.\d\d/.test(p.s) || /^\d+(\.\d+)?%/.test(p.s)) assert.ok(p.source_ref, `${p.key} "${p.s}"`);
    }
  }
});

test("판정 행은 JudgmentResult 값 그대로, 근거 없는 행은 없다", () => {
  const c = CASES.find((x) => x.id === "area_plan-rule-pack-unverified");
  const input = (c as NonNullable<typeof c>).input();
  const t = texts(buildAreaSheet(input)).map((p) => p.s);
  assert.ok(t.includes("23.33%") && t.includes("46.66%"));
  assert.ok(!t.includes("높이") && !t.includes("주차"));
  assert.ok(t.includes("참고(미확인)"));
  assert.ok(t.includes("미확인 항목은 참고값이며 판정이 아닙니다"));
  assert.ok(t.includes("이후 개정 2건"));
});

test("면적표 값 = 판정 엔진 값 (속성: 임의 area_breakdown을 그대로 옮긴다)", () => {
  const nat = fc.integer({ min: 0, max: 99_999_999 });
  const useName = fc.constantFrom("주택", "근생", "창고", "주차장");
  fc.assert(
    fc.property(nat, nat, nat, fc.array(fc.record({ area: nat, u: useName }), { minLength: 1, maxLength: 3 }), (b, g, f, uses) => {
      const model = modelWith([{ id: "m1", footprint: rect(1_000, 1_000, 8_000, 6_000), base_level_mm: 0, floors: [{ id: "m1-1", level: 1, height_mm: 3_000, use: "주택" }], roof: flat }]);
      const uniq = [...new Map(uses.map((u) => [u.u, u.area])).entries()].sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0));
      const bd: AreaBreakdown = {
        building_h100: b,
        gross_h100: g,
        far_gross_h100: f,
        floors: [{ level: 1, area_h100: g, uses: uniq.map(([use, area_h100]) => ({ use, area_h100 })) }],
        uses: uniq.map(([use, area_h100]) => ({ use, area_h100 })),
      };
      const input: AreaPlanInput = { ...areaInput(model, judgmentOf(model, [{ key: "coverage", verdict: "PASS", value: 12.34, limit: 60, unit: "pct", basis: [{ law: "법", article: "1", effective_from: "2026-01-01", ordinance: false }] }])), area_breakdown: bd };
      const s = buildAreaSheet(input);
      const byRef = new Map(texts(s).flatMap((p) => (p.source_ref ? [[p.source_ref, p.s] as const] : [])));
      assert.equal(byRef.get("area_breakdown.building"), formatH100(b));
      assert.equal(byRef.get("area_breakdown.gross"), formatH100(g));
      assert.equal(byRef.get("area_breakdown.far_gross"), formatH100(f));
      assert.equal(byRef.get("area_breakdown.floor:1"), formatH100(g));
      for (const [use, a] of uniq) assert.equal(byRef.get(`area_breakdown.use:${use}`), formatH100(a));
      assert.equal(byRef.get("judgment.items[0].value"), "12.34%");
      assert.equal(s.checks.area_table_m2["building_area"], b / 100);
      assert.equal(s.checks.area_table_m2["gross_area"], g / 100);
    }),
    { numRuns: 100 },
  );
});

test("집계: 직사각형 w×h mm → ㎡ 소수 둘째 자리 half-away (속성, 독립 기대식)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 60_000 }), fc.integer({ min: 1, max: 60_000 }), (w, h) => {
      const model = modelWith([{ id: "m1", footprint: rect(0, 0, w, h), base_level_mm: 0, floors: [{ id: "m1-1", level: 1, height_mm: 3_000, use: "주택" }], roof: flat }]);
      const input = areaInput(model, judgmentOf(model, [{ key: "coverage", verdict: "PASS", value: 1, unit: "pct", basis: [] }]));
      const view = buildAreaPlanView(input);
      const expect = Number((BigInt(w) * BigInt(h) * 2n + 10_000n) / 20_000n) / 100; // 0.01㎡ = 10^4 mm², 반올림
      assert.equal(view.checks?.area_table_m2["building_area"], expect);
      assert.equal(h100OfArea2(BigInt(w) * BigInt(h) * 2n), Math.round(expect * 100));
    }),
    { numRuns: 200 },
  );
});

test("formatH100·잘못된 area_breakdown", () => {
  assert.equal(formatH100(0), "0.00");
  assert.equal(formatH100(5), "0.05");
  assert.equal(formatH100(12_345), "123.45");
  assert.throws(() => formatH100(-1), DraftingError);
  assert.throws(() => formatH100(1.5), DraftingError);
  const c = CASES[0];
  const input = (c as NonNullable<typeof c>).input();
  const bad: AreaPlanInput = { ...input, area_breakdown: { building_h100: 1.5, gross_h100: 0, far_gross_h100: 0, floors: [], uses: [] } };
  assert.throws(() => buildAreaPlanView(bad), DraftingError);
});

test("sheet.floor_id가 있으면 그 층만 그린다", () => {
  const c = CASES.find((x) => x.id === "area_plan-multi-floor");
  const base = (c as NonNullable<typeof c>).input();
  const s = buildAreaSheet({ ...base, sheet: { ...base.sheet, floor_id: "m1-2" } });
  assert.deepEqual(s.annotations.map((a) => a.anno_id), ["label:floor:2"]);
  assert.ok(texts(s).some((p) => p.source_ref === "geometry.area.floor:2"));
  assert.ok(!texts(s).some((p) => p.source_ref === "geometry.area.floor:1"));
});

test("층이 아주 많으면 표를 줄이고, 그래도 안 맞으면 AR058", () => {
  const floors = Array.from({ length: 60 }, (_, i) => ({ id: `f${i}`, level: i + 1, height_mm: 3_000, use: `용도${i % 7}` }));
  const model = modelWith([{ id: "m1", footprint: rect(1_000, 1_000, 8_000, 6_000), base_level_mm: 0, floors, roof: flat }]);
  const s = buildAreaSheet(areaInput(model, judgmentOf(model, [{ key: "coverage", verdict: "PASS", value: 1, unit: "pct", basis: [] }])));
  assert.ok(s.warnings.some((w) => w.code === "AR058" && w.detail.includes("면적표")));
});
