// SheetSpec.annotations[] 스키마(AR-06-086): 상한·중복 id·옛 키 거부, 빈 배열 정규화, v1(annotation_overrides) 1:1 이행.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { ANNOTATION_LIMITS, migrateLegacySheetSpec, normalizeSheetSpec, sheetSpecSchema } from "./sheet.ts";

const base = { id: "s1", kind: "site_plan", paper: "A3", orientation: "landscape", scale: 200, include_in_proposal: true };
const anchor = { ref: "m000", part: "vertex", index: 0 };
const ok = (annotations: unknown) => sheetSpecSchema.safeParse({ ...base, annotations }).success;

test("모든 주석 종류를 받는다", () => {
  assert.ok(
    ok([
      { id: "o", kind: "override", target: "dim:1", dx_mm: 1, hidden: false },
      { id: "d", kind: "dim", a: anchor, b: { ref: "m000", part: "edge", index: 1, at: "mid" }, offset_mm: -3, text: "{값}" },
      { id: "t", kind: "text", anchor: { ref: "site", part: "center" }, dx_mm: 1, dy_mm: 2, text: "메모" },
      { id: "n", kind: "text", dx_mm: 1, dy_mm: 2, text: "용지 메모" },
      { id: "l", kind: "leader", anchors: [anchor], dx_mm: 1, dy_mm: 1, text: "x" },
      { id: "c", kind: "cloud", anchors: [anchor, anchor, anchor] },
    ]),
  );
});

test("옛 annotation_overrides 키는 거부한다(이행 함수만 받는다)", () => {
  assert.equal(sheetSpecSchema.safeParse({ ...base, annotation_overrides: [] }).success, false);
});

test("중복 id·빈 id·모르는 kind·추가 키 거부", () => {
  const t = { kind: "text", dx_mm: 0, dy_mm: 0, text: "a" };
  assert.equal(ok([{ id: "a", ...t }, { id: "a", ...t }]), false);
  assert.equal(ok([{ id: "", ...t }]), false);
  assert.equal(ok([{ id: "a", kind: "arrow" }]), false);
  assert.equal(ok([{ id: "a", ...t, extra: 1 }]), false);
  assert.equal(ok([{ id: "a", kind: "dim", a: anchor, b: { ...anchor, extra: 1 }, offset_mm: 0 }]), false);
});

test("상한: 주석 500개, 문구 200자, cloud 정점 64, leader 정점 16, 용지 오프셋 ±10m", () => {
  const t = (i: number) => ({ id: `t${i}`, kind: "text", dx_mm: 0, dy_mm: 0, text: "a" });
  const L = ANNOTATION_LIMITS;
  assert.ok(ok(Array.from({ length: L.count }, (_, i) => t(i))));
  assert.equal(ok(Array.from({ length: L.count + 1 }, (_, i) => t(i))), false);
  assert.ok(ok([{ ...t(0), text: "가".repeat(L.text) }]));
  assert.equal(ok([{ ...t(0), text: "가".repeat(L.text + 1) }]), false);
  const pts = (n: number) => Array.from({ length: n }, () => anchor);
  assert.ok(ok([{ id: "c", kind: "cloud", anchors: pts(L.cloud_points) }]));
  assert.equal(ok([{ id: "c", kind: "cloud", anchors: pts(L.cloud_points + 1) }]), false);
  assert.equal(ok([{ id: "c", kind: "cloud", anchors: pts(2) }]), false);
  assert.ok(ok([{ id: "l", kind: "leader", anchors: pts(L.leader_points), dx_mm: 0, dy_mm: 0, text: "" }]));
  assert.equal(ok([{ id: "l", kind: "leader", anchors: pts(L.leader_points + 1), dx_mm: 0, dy_mm: 0, text: "" }]), false);
  assert.equal(ok([{ id: "l", kind: "leader", anchors: [], dx_mm: 0, dy_mm: 0, text: "" }]), false);
  assert.equal(ok([{ ...t(0), dx_mm: L.offset_mm + 1 }]), false);
});

test("정규화: 빈 annotations 는 키를 뺀다", () => {
  const spec = sheetSpecSchema.parse({ ...base, annotations: [] });
  assert.equal("annotations" in normalizeSheetSpec(spec), false);
  const full = sheetSpecSchema.parse({ ...base, annotations: [{ id: "n", kind: "text", dx_mm: 0, dy_mm: 0, text: "a" }] });
  assert.equal(normalizeSheetSpec(full), full);
});

const legacy = { ...base, annotation_overrides: [] as unknown[] };

test("이행: 주석이 없으면 annotations 키 없음, 나머지 필드는 그대로", () => {
  const out = migrateLegacySheetSpec(legacy);
  assert.deepEqual(out, { ...base });
});

test("이행: 같은 target 은 뒤 칸이 이기는 병합 하나로 ov-<target>, id 사전순", () => {
  const out = migrateLegacySheetSpec({
    ...legacy,
    annotation_overrides: [
      { target: "dim:b", dx_mm: 1.5, dy_mm: -2 },
      { target: "dim:a", hidden: true },
      { target: "dim:b", dx_mm: 9, text: "무시됨" },
    ],
  });
  assert.deepEqual(out?.annotations, [
    { id: "ov-dim:a", kind: "override", target: "dim:a", hidden: true },
    { id: "ov-dim:b", kind: "override", target: "dim:b", dx_mm: 9, dy_mm: -2, text: "무시됨" },
  ]);
});

test("이행: note:<id> 는 text 주석 note-<id>, 숨김·빈 문구 메모는 출력이 없었으므로 뺀다", () => {
  const out = migrateLegacySheetSpec({
    ...legacy,
    annotation_overrides: [
      { target: "note:1", dx_mm: 10, dy_mm: 20, text: "메모" },
      { target: "note:2", text: "숨김", hidden: true },
      { target: "note:3", text: "  " },
      { target: "note:4", text: "위치 없음" },
    ],
  });
  assert.deepEqual(out?.annotations, [
    { id: "note-1", kind: "text", dx_mm: 10, dy_mm: 20, text: "메모" },
    { id: "note-4", kind: "text", dx_mm: 0, dy_mm: 0, text: "위치 없음" },
  ]);
});

test("이행: 옛 스키마에 맞지 않거나 새 상한을 넘으면 null(그 시트만 버린다)", () => {
  assert.equal(migrateLegacySheetSpec({ ...legacy, extra: 1 }), null);
  assert.equal(migrateLegacySheetSpec({ ...base }), null, "이미 새 모양이면 이행 대상이 아니다");
  assert.equal(migrateLegacySheetSpec({ ...legacy, annotation_overrides: [{ target: "x", text: "가".repeat(201) }] }), null);
  assert.equal(migrateLegacySheetSpec(null), null);
});
