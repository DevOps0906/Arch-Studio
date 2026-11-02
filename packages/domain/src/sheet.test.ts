// SheetSpec 주석 이행(AR-06-086): annotation_overrides(v1) → annotations. 1:1·같은 target 합치기·note 메모·항목 단위 실패 격리.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { ANNOTATIONS_MAX, migrateAnnotationOverrides, migrateSheetSpecV1, sheetSpecSchema } from "./index.ts";

const v1 = (annotation_overrides: unknown) => ({
  id: "site_plan-1",
  kind: "site_plan",
  paper: "A3",
  orientation: "landscape",
  scale: "auto",
  annotation_overrides,
  include_in_proposal: true,
});

test("override 1:1 이행: id = ov- + target, 값 그대로(오프셋 정밀도 유지)", () => {
  const m = migrateSheetSpecV1(v1([{ target: "dim:setback:edge0:mass-m000", dx_mm: 1.234, dy_mm: -2 }, { target: "label:road:edge0", hidden: true }]));
  assert.equal(m.dropped, 0);
  const r = sheetSpecSchema.safeParse(m.spec);
  assert.ok(r.success);
  assert.deepEqual(r.data.annotations, [
    { id: "ov-dim:setback:edge0:mass-m000", kind: "override", target: "dim:setback:edge0:mass-m000", dx_mm: 1.234, dy_mm: -2 },
    { id: "ov-label:road:edge0", kind: "override", target: "label:road:edge0", hidden: true },
  ]);
  assert.ok(!("annotation_overrides" in (m.spec as object)));
});

test("같은 target은 기존 의미대로 칸 단위로 합친다(뒤 항목이 이김), note:는 앵커 없는 text", () => {
  const m = migrateAnnotationOverrides([
    { target: "dim:a", dx_mm: 1 },
    { target: "note:1", text: "메모", dx_mm: 30, dy_mm: 50 },
    { target: "dim:a", dy_mm: 2, text: "x" },
    { target: "dim:a", dx_mm: 3 },
    { target: "note:2", hidden: true, text: "숨김" },
  ]);
  assert.equal(m.dropped, 0);
  assert.deepEqual(m.annotations, [
    { id: "ov-dim:a", kind: "override", target: "dim:a", dx_mm: 3, dy_mm: 2, text: "x" },
    { id: "ov-note:1", kind: "text", dx_mm: 30, dy_mm: 50, text: "메모" },
    { id: "ov-note:2", kind: "text", dx_mm: 0, dy_mm: 0, text: "숨김", hidden: true },
  ]);
});

test("항목 단위 실패 격리: 틀린 항목만 버리고 개수 보고, 나머지는 유지", () => {
  const m = migrateAnnotationOverrides([
    { target: "dim:a", dx_mm: 1 },
    { target: "", dx_mm: 1 },
    { target: "dim:b", dx_mm: "1" },
    { target: "dim:c", extra: 1 },
    null,
    { target: "dim:d", text: "가".repeat(201) },
    { target: "dim:e", dx_mm: Number.POSITIVE_INFINITY },
    { target: "dim:f", hidden: false },
  ]);
  assert.deepEqual(m.annotations.map((a) => a.id), ["ov-dim:a", "ov-dim:f"]);
  assert.equal(m.dropped, 6);
  assert.equal(migrateAnnotationOverrides("x").dropped, 1);
  assert.deepEqual(migrateAnnotationOverrides(Array.from({ length: ANNOTATIONS_MAX + 2 }, (_, i) => ({ target: `t${i}` }))).dropped, 2);
});

test("이미 v2(annotations)인 시트·객체가 아닌 값은 그대로", () => {
  const v2 = { ...v1([]), annotations: [] } as Record<string, unknown>;
  delete v2.annotation_overrides;
  assert.equal(migrateSheetSpecV1(v2).spec, v2);
  assert.equal(migrateSheetSpecV1(null).spec, null);
  const both = { ...v1([]), annotations: [] };
  assert.equal(migrateSheetSpecV1(both).spec, both);
  assert.equal(sheetSpecSchema.safeParse(both).success, false);
});
