import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateRows, parseCatalog } from "./catalog.ts";

const catalog = () => ({ version: "2026.10.1", basis_date: "2026-10-01", source_note: "테스트 전용 가상 단가",
  items: [{ structure: "테스트 구조", finish_grade: "테스트 등급", use: "업무", unit_price_won_per_m2: 10000 }] });

test("204는 단가 없음이며 출처·날짜·정수 단가가 없거나 중복되면 거부한다", () => {
  assert.equal(parseCatalog(undefined), null);
  assert.deepEqual(parseCatalog(catalog()), catalog());
  for (const value of [null, {}, { ...catalog(), source_note: "" }, { ...catalog(), basis_date: "2026-02-30" },
    { ...catalog(), items: [...catalog().items, ...catalog().items] },
    { ...catalog(), items: [{ ...catalog().items[0], unit_price_won_per_m2: -1 }] },
    { ...catalog(), items: [{ ...catalog().items[0], unit_price_won_per_m2: 1.5 }] }]) assert.throws(() => parseCatalog(value));
});

test("공사비는 기존 엔진의 정수 원 계산을 쓰고 단가 누락 실을 보존한다", () => {
  const data = parseCatalog(catalog())!;
  const rows = [{ name: "서재", use: "업무", area: "12.34", locked: true }];
  const priced = estimateRows(data, "테스트 구조", "테스트 등급", rows);
  assert.equal(priced.kind, "ready");
  if (priced.kind !== "ready") return;
  assert.equal(priced.estimate.supply_won, 123400);
  assert.equal(priced.estimate.total_won, 135740);
  const missing = estimateRows(data, "테스트 구조", "테스트 등급", [...rows, { ...rows[0]!, name: "방", use: "다른 용도" }]);
  assert.equal(missing.kind, "ready");
  if (missing.kind === "ready") assert.deepEqual(missing.estimate.unpriced_rows, ["방"]);
  assert.equal(estimateRows(data, "테스트 구조", "테스트 등급", []).kind, "empty");
  assert.equal(estimateRows(data, "테스트 구조", "테스트 등급", [{ ...rows[0]!, area: "" }]).kind, "invalid");
});
