// annotate: 분해 치수, 수치 TEXT source_ref 필수, 값 덮어쓰기 불가, offset(용지 mm)·hide·note.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { applyOverrides, buildSheet, dimension, DraftingError, label, type Annotation } from "../index.ts";
import { sampleInput, sampleModel, sampleView } from "../sheet/test-fixtures.ts";

const ctx = { scale: 200 as const, text_h: 250 };
const isCode = (code: string) => (e: unknown) => e instanceof DraftingError && e.code === code;

function dim(): Annotation {
  return dimension({ anno_id: "dim:a", view_id: "v", a: [0, 0], b: [10_000, 0], offset: 2_000, value_mm: 10_000, source_ref: "judgment.x" }, ctx);
}

test("치수는 LINE 5개 + TEXT 1개(A-ANNO-DIMS), 값은 정수 mm 문자열·source_ref", () => {
  const d = dim();
  assert.equal(d.kind, "dim");
  assert.deepEqual(d.prims.map((p) => p.t).sort(), ["line", "line", "line", "line", "line", "text"]);
  assert.ok(d.prims.every((p) => p.layer === "A-ANNO-DIMS"));
  const line = d.prims.find((p) => p.key === "line");
  assert.deepEqual(line?.t === "line" && [line.a, line.b], [[0, 2_000], [10_000, 2_000]]);
  const ext = d.prims.find((p) => p.key === "ext:a");
  // 보조선: 간격 1mm×200 = 200, 넘침 2mm×200 = 400.
  assert.deepEqual(ext?.t === "line" && [ext.a, ext.b], [[0, 200], [0, 2_400]]);
  const text = d.prims.find((p) => p.t === "text");
  assert.ok(text?.t === "text" && text.s === "10000" && text.source_ref === "judgment.x" && text.h === 250);
  for (const p of d.prims) if (p.t === "line") for (const v of [...p.a, ...p.b]) assert.ok(Number.isSafeInteger(v));
});

test("엔진 계산 값(치수·값 줄)만 source_ref 필수, 실명 라벨은 대상 아님", () => {
  assert.throws(
    () => dimension({ anno_id: "d", view_id: "v", a: [0, 0], b: [1, 0], offset: 0, value_mm: 1, source_ref: "" }, ctx),
    isCode("INVALID_ARGUMENT"),
  );
  const badValue = { kind: "value", s: "24.00㎡" } as unknown as { kind: "value"; s: string; source_ref: string };
  assert.throws(() => label({ anno_id: "l", kind: "label", at: [0, 0], lines: [badValue] }, ctx), isCode("NUMERIC_TEXT_SOURCE"));
  assert.doesNotThrow(() => label({ anno_id: "l", kind: "label", at: [0, 0], lines: [{ s: "침실2" }, { s: "2층 거실" }] }, ctx));
  const ok = label({ anno_id: "l", kind: "label", at: [0, 0], lines: [{ s: "침실2" }, { kind: "value", s: "12.00㎡", source_ref: "geometry.area.r2" }] }, ctx);
  assert.deepEqual(ok.prims.map((p) => (p.t === "text" ? p.source_ref : null)), [undefined, "geometry.area.r2"]);

  // source_ref가 빠진 치수 주석은 조립이 거부한다. 뷰의 "침실2" 같은 일반 TEXT는 통과.
  const model = sampleModel();
  const view = sampleView(model);
  view.views[0]?.prims.push({ layer: "A-AREA-IDEN", key: "t", t: "text", at: [0, 0], h: 250, s: "침실2", align: "l" });
  assert.doesNotThrow(() => buildSheet(sampleInput(model), view));
  const inner = view.annotate;
  view.annotate = (c) =>
    (inner ? inner(c) : []).map((an) =>
      an.kind === "dim" ? { ...an, prims: an.prims.map((p) => (p.t === "text" ? { ...p, source_ref: "" } : p)) } : an,
    );
  assert.throws(() => buildSheet(sampleInput(model), view), isCode("NUMERIC_TEXT_SOURCE"));
});

test("치수·라벨 값은 덮어쓸 수 없다(text 무시 + unapplied), 위치 이동은 적용", () => {
  const { annotations, unapplied } = applyOverrides([dim()], [{ target: "dim:a", text: "9999", dx_mm: 1.5, dy_mm: -2 }], ctx);
  assert.deepEqual(unapplied, [{ target: "dim:a", reason: "text_not_allowed" }]);
  const text = annotations[0]?.prims.find((p) => p.t === "text");
  assert.ok(text?.t === "text" && text.s === "10000");
  const before = dim().prims.find((p) => p.key === "line");
  const after = annotations[0]?.prims.find((p) => p.key === "line");
  // 용지 1.5mm × 1/200 = 모델 300mm, -2mm → -400mm.
  assert.ok(before?.t === "line" && after?.t === "line");
  assert.deepEqual(after.a, [before.a[0] + 300, before.a[1] - 400]);
});

test("용지 주석은 0.01mm 그대로 이동, hide·없는 대상·note", () => {
  const paperLabel = label({ anno_id: "lab", kind: "warning", at: [1_000, 1_000], lines: [{ s: "검토 필요" }] }, ctx);
  const { annotations, unapplied } = applyOverrides(
    [dim(), paperLabel],
    [
      { target: "lab", dx_mm: 2.345 },
      { target: "dim:a", hidden: true },
      { target: "dim:gone", dx_mm: 1 },
      { target: "note:1", text: "메모 1", dx_mm: 30, dy_mm: 50 },
      { target: "note:2", dx_mm: 1 },
      { target: "note:3", text: "숨김", hidden: true },
    ],
    ctx,
  );
  assert.deepEqual(annotations.map((a) => a.anno_id), ["lab", "note:1"]);
  const lp = annotations[0]?.prims[0];
  assert.deepEqual(lp?.t === "text" && lp.at, [1_235, 1_000]);
  const note = annotations[1];
  assert.equal(note?.kind, "note");
  assert.equal(note?.view_id, undefined);
  const np = note?.prims[0];
  assert.deepEqual(np?.t === "text" && [np.at, np.s, np.layer], [[3_000, 5_000], "메모 1", "A-ANNO-TEXT"]);
  assert.deepEqual(unapplied, [
    { target: "dim:gone", reason: "missing_target" },
    { target: "note:2", reason: "note_without_text" },
  ]);
});

test("덮어쓰기 불가 주석·잘못된 offset", () => {
  const fixed: Annotation = { ...dim(), overridable: [] };
  const r = applyOverrides([fixed], [{ target: "dim:a", dx_mm: 1 }], ctx);
  assert.deepEqual(r.unapplied, [{ target: "dim:a", reason: "not_overridable" }]);
  const nan = applyOverrides([dim()], [{ target: "dim:a", dx_mm: Number.NaN }], ctx);
  assert.deepEqual(nan.unapplied, [{ target: "dim:a", reason: "invalid_offset" }]);
});
