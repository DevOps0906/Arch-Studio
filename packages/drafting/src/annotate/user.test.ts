// 주석 편집층(AR-06-086): 앵커 해석, 고아 제외·보고, 배열 순서 무관, 주석 없는 시트 출력 불변, 레이어 A-ANNO-USER.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import type { SheetAnnotation } from "@arch-studio/domain";
import { buildSheet, buildSitePlanView, canonicalJson, USER_LAYER, type DraftingInput } from "../index.ts";
import { ANNOTATED, make, passItems, siteModel, WITH_ORPHANS } from "../views/site_plan/cases.ts";
import { writeDxf } from "../writers/dxf/index.ts";
import { writeSvg } from "../writers/svg/index.ts";
import { anchorTable, resolveAnchor } from "./user.ts";

const ring = [
  [0, 0],
  [1000, 0],
  [1000, 500],
  [0, 500],
] as [number, number][];
const table = anchorTable([{ ref: "obj", ring }]);

function build(annotations: SheetAnnotation[] | undefined) {
  const base = make(siteModel(), passItems());
  const input: DraftingInput = { ...base, sheet: { ...base.sheet, ...(annotations === undefined ? {} : { annotations }) } };
  return { input, ...buildSheet(input, buildSitePlanView(input, { parking_accessible: 1 })) };
}

test("앵커: vertex·edge(start·end·mid)·center, 범위 밖·없는 ref는 null", () => {
  assert.deepEqual(resolveAnchor(table, { ref: "obj", part: "vertex", index: 2 }), [1000, 500]);
  assert.deepEqual(resolveAnchor(table, { ref: "obj", part: "edge", index: 0 }), [500, 0]);
  assert.deepEqual(resolveAnchor(table, { ref: "obj", part: "edge", index: 0, at: "start" }), [0, 0]);
  assert.deepEqual(resolveAnchor(table, { ref: "obj", part: "edge", index: 3, at: "end" }), [0, 0], "마지막 변은 첫 점으로 닫힌다");
  assert.deepEqual(resolveAnchor(table, { ref: "obj", part: "center" }), [500, 250]);
  assert.equal(resolveAnchor(table, { ref: "obj", part: "vertex", index: 4 }), null);
  assert.equal(resolveAnchor(table, { ref: "obj", part: "vertex" }), null);
  assert.equal(resolveAnchor(table, { ref: "none", part: "center" }), null);
  assert.equal(resolveAnchor(table, { ref: "toString", part: "center" }), null, "프로토타입 이름은 ref가 아니다");
});

test("중간점은 half-away 반올림 정수 mm", () => {
  const t = anchorTable([{ ref: "o", ring: [[0, 0], [3, 1], [3, 3]] }]);
  assert.deepEqual(resolveAnchor(t, { ref: "o", part: "edge", index: 0 }), [2, 1]);
  assert.deepEqual(resolveAnchor(t, { ref: "o", part: "edge", index: 2, at: "mid" }), [2, 2]);
});

test("사람 주석은 A-ANNO-USER에만 그려지고 override는 기존 경로로 적용된다", () => {
  const { sheet, unapplied_overrides } = build(ANNOTATED);
  assert.deepEqual(unapplied_overrides, []);
  const user = sheet.annotations.filter((a) => a.anno_id.startsWith("user:"));
  assert.deepEqual(user.map((a) => a.anno_id), ["user:cloud-1", "user:dim-1", "user:leader-1", "user:note-1", "user:text-1"]);
  for (const a of user) for (const p of a.prims) assert.equal(p.layer, USER_LAYER, a.anno_id);
  const dim = user.find((a) => a.anno_id === "user:dim-1");
  const text = dim?.prims.find((p) => p.t === "text");
  assert.ok(text && text.t === "text" && text.s === "폭 15000" && typeof text.source_ref === "string", "치수 값은 엔진 계산 + source_ref");
  const road = sheet.annotations.find((a) => a.anno_id === "label:road:edge0");
  assert.ok(road, "override 대상 자동 주석은 남는다");
});

test("고아 주석은 출력에 0건이고 unapplied에 orphan_anchor로 돌아온다(다중 앵커는 하나만 고아여도 전체)", () => {
  const { sheet, unapplied_overrides } = build(WITH_ORPHANS);
  assert.deepEqual(
    unapplied_overrides.map((u) => [u.target, u.reason]),
    [
      ["b-no-ref", "orphan_anchor"],
      ["c-range", "orphan_anchor"],
      ["d-multi", "orphan_anchor"],
      ["e-edge", "orphan_anchor"],
    ],
  );
  assert.deepEqual(sheet.annotations.filter((a) => a.anno_id.startsWith("user:")).map((a) => a.anno_id), ["user:a-ok"]);
});

test("area_plan·sunlight_section처럼 앵커 표가 없는 뷰에서는 앵커 주석이 모두 고아, 용지 메모는 남는다", () => {
  const base = make(siteModel(), passItems());
  const input: DraftingInput = { ...base, sheet: { ...base.sheet, annotations: ANNOTATED } };
  const view = buildSitePlanView(input, { parking_accessible: 1 });
  delete view.anchors;
  const { sheet, unapplied_overrides } = buildSheet(input, view);
  assert.deepEqual(sheet.annotations.filter((a) => a.anno_id.startsWith("user:")).map((a) => a.anno_id), ["user:note-1"]);
  assert.deepEqual(unapplied_overrides.map((u) => u.target), ["cloud-1", "dim-1", "leader-1", "text-1"]);
});

test("치수: 두 점이 같거나 문구에 {값}이 없으면 그리지 않고 보고한다", () => {
  const same = { ref: "m000", part: "vertex" as const, index: 0 };
  const { unapplied_overrides, sheet } = build([
    { id: "d1", kind: "dim", a: same, b: same, offset_mm: 1 },
    { id: "d2", kind: "dim", a: same, b: { ref: "m000", part: "vertex", index: 1 }, offset_mm: 1, text: "9999" },
  ]);
  assert.deepEqual(unapplied_overrides.map((u) => [u.target, u.reason]), [["d1", "degenerate_dim"], ["d2", "invalid_template"]]);
  assert.ok(!sheet.annotations.some((a) => a.anno_id.startsWith("user:")));
});

test("배열 순서를 섞어도 같은 시트·같은 DXF·SVG 바이트", () => {
  const a = build(ANNOTATED);
  const b = build([...ANNOTATED].reverse());
  const c = build([ANNOTATED[3] as SheetAnnotation, ...ANNOTATED.slice(0, 3), ...ANNOTATED.slice(4)]);
  const ref = canonicalJson(a.sheet);
  assert.equal(canonicalJson(b.sheet), ref.replace(a.sheet.input_hash, b.sheet.input_hash), "입력 배열 순서만 해시에 반영된다");
  assert.equal(canonicalJson(c.sheet), ref.replace(a.sheet.input_hash, c.sheet.input_hash));
  const strip = (s: string, h: string) => s.split(h).join("<hash>");
  assert.equal(strip(writeDxf(b.sheet).text, b.sheet.input_hash), strip(writeDxf(a.sheet).text, a.sheet.input_hash));
  assert.equal(writeDxf(b.sheet).text, writeDxf(a.sheet).text, "DXF에는 해시가 없어 바이트가 그대로 같다");
  assert.equal(strip(writeSvg(b.sheet), b.sheet.input_hash), strip(writeSvg(a.sheet), a.sheet.input_hash));
});

test("같은 입력 2회 → 같은 바이트", () => {
  assert.equal(canonicalJson(build(ANNOTATED).sheet), canonicalJson(build(ANNOTATED).sheet));
});

test("주석이 없으면 annotations 키가 없거나 빈 배열이어도 같은 시트(해시 포함), A-ANNO-USER는 DXF·SVG에 나오지 않는다", () => {
  const none = build(undefined);
  const empty = build([]);
  assert.equal(canonicalJson(none.sheet), canonicalJson(empty.sheet));
  assert.ok(!writeDxf(none.sheet).text.includes(USER_LAYER));
  assert.ok(!writeSvg(none.sheet).includes(USER_LAYER));
  const only = build([{ id: "ov", kind: "override", target: "label:road:edge0", dx_mm: 1 }]);
  assert.ok(!writeDxf(only.sheet).text.includes(USER_LAYER), "override만 있으면 사용자 레이어 없음");
});

test("주석이 있으면 DXF 레이어 표·SVG 그룹에 A-ANNO-USER가 붙는다. 사무소 이름이 겹쳐도 표에 대소문자 무시 중복 0", () => {
  const { sheet } = build(ANNOTATED);
  const dxf = writeDxf(sheet).text;
  assert.ok(dxf.includes(USER_LAYER));
  assert.ok(writeSvg(sheet).includes(`<g id="${USER_LAYER}"`));
  const mapped = writeDxf(sheet, { layer_map: { "A-ANNO-TEXT": "a-anno-user" } }).text;
  const section = (mapped.split("TABLE\r\n  2\r\nLAYER")[1] ?? "").split("ENDTAB")[0] ?? "";
  const names = [...section.matchAll(/\r\n  2\r\n([^\r\n]+)\r\n 70/g)].map((m) => (m[1] as string).toUpperCase());
  assert.ok(names.length > 10, "레이어 표를 읽었다");
  assert.equal(new Set(names).size, names.length, "레이어 이름 중복(대소문자 무시) 없음");
});
