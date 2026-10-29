// 속성(AR-06-015): 근거 없는 행 0, 계약 스키마 통과, 같은 입력 같은 바이트, 팩 규칙 순서 무관, 입력 불변,
// 배포 팩(전 항목 미확인)으로는 합격·불합격이 나오지 않는다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 팩 파일을 읽는다
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { judgmentResultSchema, type DesignModelV1 } from "@arch-studio/domain";
import { canonicalJson, judge, loadRulePack, UNVERIFIED } from "./index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "./test-fixtures.ts";

const SHIPPED = JSON.parse(readFileSync(new URL("../packs/2026.10.0/pack.json", import.meta.url), "utf8")) as unknown;

const massArb = fc.record({
    x: fc.integer({ min: 0, max: 18_000 }),
    y: fc.integer({ min: 0, max: 13_000 }),
    w: fc.integer({ min: 500, max: 10_000 }),
    h: fc.integer({ min: 500, max: 10_000 }),
    floors: fc.array(
      fc.record({ level: fc.integer({ min: -1, max: 6 }), height_mm: fc.integer({ min: 2000, max: 5000 }), use: fc.constantFrom("가짜용도A", "가짜용도B") }),
      { minLength: 1, maxLength: 4 },
    ),
  });

const modelArb = fc
  .record({
    masses: fc.array(massArb, { maxLength: 3 }),
    date: fc.constantFrom("2000-01-01", "2000-06-30", "2000-07-01", "2001-01-01", "2026-11-01"),
    muni: fc.constantFrom("T-OK", "T-NO", "X-UNKNOWN", "11000"),
    district: fc.constantFrom("가짜주거", "가짜상업", "없는지역"),
    roadEdge: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ masses, date, muni, district, roadEdge }) => {
    const m = fixtureModel({ application_date: date, municipality_code: muni });
    m.site.zoning.use_district = district;
    m.site.roads = [{ edge_index: roadEdge, width_mm: 4000 }];
    m.masses = masses.map((s, i): DesignModelV1["masses"][number] => ({
      id: `m${i}`,
      footprint: { outer: [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]] },
      base_level_mm: 0,
      floors: s.floors.map((f, j) => ({ id: `m${i}f${j}`, ...f })),
      roof: { type: "flat" },
    }));
    return m;
  });

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 48271) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

test("근거 없는 행 0·계약 통과·결정성·규칙 순서 무관·입력 불변", () => {
  const fixture = loadRulePack(structuredClone(FIXTURE_PACK_RAW));
  const shipped = loadRulePack(SHIPPED);
  fc.assert(
    fc.property(modelArb, fc.integer({ min: 1, max: 2147483646 }), (model, seed) => {
      for (const pack of [fixture, shipped]) {
        const copy = structuredClone(model);
        const out = judge(model, pack);
        assert.deepEqual(model, copy);
        assert.equal(judgmentResultSchema.safeParse(out.result).success, true);
        assert.equal(out.details.length, out.result.items.length);
        assert.equal(out.result.rule_pack_version, pack.version);
        for (const item of out.result.items) {
          assert.ok(item.basis.length > 0, "근거 없는 행");
          for (const b of item.basis) {
            assert.ok(b.law.trim() && b.article.trim() && b.effective_from.trim(), "빈 근거 칸");
          }
        }
        const again = judge(structuredClone(model), pack);
        assert.equal(canonicalJson(again), canonicalJson(out));
        const reordered = loadRulePack({ ...structuredClone(pack), rules: shuffled(pack.rules, seed) });
        assert.equal(canonicalJson(judge(model, reordered)), canonicalJson(out));
      }
      for (const item of judge(model, shipped).result.items) {
        assert.equal(item.verdict, "WARN");
        assert.ok(item.basis.every((b) => b.article === UNVERIFIED));
      }
    }),
    { numRuns: 200 },
  );
});
