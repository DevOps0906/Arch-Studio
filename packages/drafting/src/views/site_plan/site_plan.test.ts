// site_plan 뷰 생성기 테스트(AR-06-023): 판정 값 일치 속성 테스트(이격 1mm·주차 1대), 결정성, 개별 동작.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import type { JudgmentResult } from "@arch-studio/domain";
import { buildSheet, canonicalJson, validateDraftingInput, type DraftingInput, type Prim, type SheetModel } from "../../index.ts";
import { CASES, make, passItems, rect, siteModel } from "./cases.ts";
import { buildSitePlanView, type SitePlanExtras } from "./index.ts";

type Item = JudgmentResult["items"][number];

function run(input: DraftingInput, extras: SitePlanExtras = {}): SheetModel {
  const v = validateDraftingInput(input);
  assert.ok(v.ok, JSON.stringify(v.ok ? "" : v.issues));
  return buildSheet(input, buildSitePlanView(input, extras)).sheet;
}

const allTexts = (s: SheetModel): Array<Extract<Prim<number>, { t: "text" }>> => {
  const out: Array<Extract<Prim<number>, { t: "text" }>> = [];
  const take = (ps: Prim<number>[]) => {
    for (const p of ps) if (p.t === "text") out.push(p);
  };
  take(s.paper_prims);
  for (const v of s.views) take(v.prims);
  for (const a of s.annotations) take(a.prims);
  return out;
};

const bays = (s: SheetModel) => (s.views[0]?.prims ?? []).filter((p) => /^park:\d+:\d+$/.test(p.key));

const arbCase = fc.record({
  w: fc.integer({ min: 20, max: 60 }).map((n) => n * 1_000),
  h: fc.integer({ min: 15, max: 40 }).map((n) => n * 1_000),
  road: fc.integer({ min: 0, max: 3 }),
  road_w: fc.integer({ min: 4, max: 12 }).map((n) => n * 1_000),
  setback: fc.integer({ min: 0, max: 6_000 }),
  parking: fc.integer({ min: 0, max: 45 }),
  accessible: fc.integer({ min: 0, max: 3 }),
  mx: fc.integer({ min: 1, max: 6 }).map((n) => n * 1_000),
  my: fc.integer({ min: 1, max: 6 }).map((n) => n * 1_000),
});

test("속성: 이격 치수는 판정 값과 1mm 단위로, 주차 대수는 1대 단위로 같다", () => {
  fc.assert(
    fc.property(arbCase, (c) => {
      const model = siteModel([{ id: "m000", fp: rect(c.mx, c.my, c.w - 2 * c.mx, c.h - 2 * c.my) }]);
      model.site = { ...model.site, boundary: rect(0, 0, c.w, c.h), roads: [{ edge_index: c.road, width_mm: c.road_w }] };
      const input = make(model, passItems({ setback: c.setback, parking: c.parking }));
      const sheet = run(input, { parking_accessible: c.accessible });

      // 이격 치수: dim 주석의 TEXT == 판정 value(정수 mm), source_ref 있음.
      const dim = sheet.annotations.find((a) => a.anno_id.startsWith("dim:setback:"));
      assert.ok(dim, "이격 치수 주석");
      const t = dim.prims.find((p) => p.t === "text");
      assert.ok(t && t.t === "text");
      assert.equal(t.s, String(c.setback));
      assert.equal(t.source_ref, "judgment.setback.value");
      assert.equal(sheet.checks.min_setback_mm, c.setback);

      // 주차: 요약표 값 == 판정 대수, 배치 + 부족 == 대수.
      const table = allTexts(sheet).find((p) => p.source_ref === "judgment.parking.value" && p.key === "tbl:value:03");
      assert.ok(table);
      assert.equal(table.s, String(c.parking));
      assert.equal(sheet.checks.parking_count, c.parking);
      const placed = bays(sheet).length;
      const shortage = sheet.annotations.find((a) => a.anno_id === "warn:parking:shortage");
      if (shortage) {
        const need = shortage.prims.find((p) => p.t === "text" && p.source_ref === "judgment.parking.value");
        const got = shortage.prims.find((p) => p.t === "text" && p.source_ref === "site_plan.parking.placed");
        assert.ok(need && need.t === "text" && got && got.t === "text");
        assert.equal(need.s, `필요 ${c.parking}대`);
        assert.equal(got.s, `배치 ${placed}대`);
        assert.ok(placed < c.parking);
        assert.ok(shortage.prims.some((p) => p.t === "text" && p.s === "배치 공간 부족"));
      } else {
        assert.equal(placed, c.parking);
      }
      // 장애인 구획은 요청 대수를 넘지 않는다.
      const acc = (sheet.views[0]?.prims ?? []).filter((p) => p.key.endsWith(":mark")).length;
      assert.ok(acc <= Math.min(c.accessible, c.parking));
    }),
    { numRuns: 60 },
  );
});

test("속성: source_ref 숫자 TEXT는 판정의 같은 값과 일치(pct 소수 둘째 자리, mm·대 정수)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 50_000 }), (cov, far) => {
      const items: Item[] = passItems().map((i) =>
        i.key === "coverage" ? { ...i, value: cov / 100 } : i.key === "far" ? { ...i, value: far / 100 } : i,
      );
      const sheet = run(make(siteModel(), items));
      const judged: Record<string, number | undefined> = {};
      for (const i of items) {
        judged[`judgment.${i.key}.value`] = i.value;
        judged[`judgment.${i.key}.limit`] = i.limit;
      }
      let seen = 0;
      for (const p of allTexts(sheet)) {
        const ref = p.source_ref;
        if (ref === undefined || !(ref in judged)) continue;
        const v = judged[ref] as number;
        assert.ok(Math.abs(Number(p.s.replace("%", "")) - v) <= 0.005 + 1e-9, `${ref}: ${p.s} vs ${v}`);
        seen += 1;
      }
      assert.ok(seen >= 7);
    }),
    { numRuns: 60 },
  );
});

test("같은 입력 -> 같은 SheetModel 바이트(canonicalJson), 입력 복제본도 동일", () => {
  for (const c of CASES) {
    const a = canonicalJson(run(c.input, c.extras));
    const b = canonicalJson(run(structuredClone(c.input), structuredClone(c.extras)));
    assert.equal(a, b, c.id);
  }
  fc.assert(
    fc.property(arbCase, (c) => {
      const model = siteModel([{ id: "m000", fp: rect(c.mx, c.my, c.w - 2 * c.mx, c.h - 2 * c.my) }]);
      model.site = { ...model.site, boundary: rect(0, 0, c.w, c.h), roads: [{ edge_index: c.road, width_mm: c.road_w }] };
      const input = make(model, passItems({ setback: c.setback, parking: c.parking }));
      assert.equal(canonicalJson(run(input)), canonicalJson(run(structuredClone(input))));
    }),
    { numRuns: 30 },
  );
});

test("FAIL 항목에 검토 필요 라벨(요약표 쪽 + 이격은 도면 쪽도)", () => {
  const c = CASES.find((x) => x.id === "site_plan-fail-items");
  assert.ok(c);
  const sheet = run(c.input, c.extras);
  const ids = sheet.annotations.map((a) => a.anno_id);
  assert.ok(ids.includes("warn:review:coverage"));
  assert.ok(ids.includes("warn:review:setback"));
  assert.ok(ids.includes("warn:review:setback:view"));
  assert.ok(!ids.includes("warn:review:far"));
  for (const id of ["warn:review:coverage", "warn:review:setback"]) {
    const a = sheet.annotations.find((x) => x.anno_id === id);
    assert.ok(a?.prims.some((p) => p.t === "text" && p.s === "검토 필요"));
    assert.ok(a?.prims.some((p) => p.t === "pline"));
  }
  // 점 쌍은 입력 그대로: 치수선 끝점이 그 쌍이다.
  const dim = sheet.annotations.find((a) => a.anno_id.startsWith("dim:setback:"));
  assert.ok(dim?.prims.some((p) => p.t === "line" && p.key === "line" && p.a[0] === 5_000 && p.a[1] === 12_000 && p.b[0] === 0));
});

test("PASS만이면 검토 필요 없음, 주차 충분하면 경고 없음", () => {
  const sheet = run(CASES[0]!.input, CASES[0]!.extras);
  assert.ok(!sheet.annotations.some((a) => a.anno_id.startsWith("warn:")));
  assert.equal(bays(sheet).length, 6);
  assert.equal((sheet.views[0]?.prims ?? []).filter((p) => p.key.endsWith(":mark")).length, 1);
});

test("주차 자리 부족: 대수 유지 + 경고", () => {
  const c = CASES.find((x) => x.id === "site_plan-parking-shortage");
  assert.ok(c);
  const sheet = run(c.input, c.extras);
  assert.equal(sheet.checks.parking_count, 40);
  assert.ok(bays(sheet).length < 40);
  assert.ok(sheet.annotations.some((a) => a.anno_id === "warn:parking:shortage"));
});

test("매스 여러 개는 합집합 외곽으로 투영(겹치면 하나)", () => {
  const c = CASES.find((x) => x.id === "site_plan-multi-mass");
  assert.ok(c);
  const sheet = run(c.input, c.extras);
  const masses = (sheet.views[0]?.prims ?? []).filter((p) => p.layer === "A-MASS");
  assert.equal(masses.length, 2); // 겹친 m000+m001 하나, m002 하나
  assert.ok(sheet.annotations.some((a) => a.anno_id === "label:parcel"));
});

test("도로·이격선·대지 경계가 표준 레이어에 그려진다", () => {
  const sheet = run(CASES[0]!.input, CASES[0]!.extras);
  const layers = new Set((sheet.views[0]?.prims ?? []).map((p) => p.layer));
  for (const l of ["A-SITE-BNDY", "A-SITE-ROAD", "A-SITE-SETB", "A-MASS", "A-PARK"]) assert.ok(layers.has(l as never), l);
  const road = sheet.annotations.find((a) => a.anno_id === "label:road:edge0");
  const t = road?.prims.find((p) => p.t === "text");
  assert.ok(t && t.t === "text" && t.s === "도로 폭 6000" && t.source_ref === "model.site.roads[0].width_mm");
});

test("도로가 없어도 만들어진다(주차는 다른 변에)", () => {
  const model = siteModel();
  model.site = { ...model.site, roads: [] };
  const sheet = run(make(model, passItems({ parking: 3 })));
  assert.equal(bays(sheet).length, 3);
});

test("판정에 이격 항목이 없으면 치수 없음", () => {
  const input = make(siteModel(), passItems().filter((i) => i.key !== "setback"));
  const sheet = run(input);
  assert.ok(!sheet.annotations.some((a) => a.anno_id.startsWith("dim:")));
  assert.equal(sheet.checks.min_setback_mm, undefined);
});
