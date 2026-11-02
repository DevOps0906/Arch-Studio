// 사람 주석(AR-06-086): A-ANNO-USER, 앵커 해석·고아(출력 0건 + unapplied), 다른 층은 고아 아님, 배열 순서 무관, 치수 값은 엔진 계산.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { annotationsSchema, type SheetAnnotation } from "@arch-studio/domain";
import { buildSheet, canonicalJson, type DraftingInput, type SheetModel } from "../index.ts";
import { sampleInput, sampleModel, sampleOrphanAnnotations, sampleUserAnnotations, sampleView } from "../sheet/test-fixtures.ts";
import { CASES as SITE_CASES } from "../views/site_plan/cases.ts";
import { buildSitePlanView } from "../views/site_plan/index.ts";
import { writeDxf } from "../writers/dxf/index.ts";
import { writeSvg } from "../writers/svg/index.ts";

// 샘플: 대지 (0,0)-(20000,15000), 매스 m000 외곽 (1200,1200)-(18800,13800), 실 r000(층 m000-f1) 같은 사각형.
const ANNOS: SheetAnnotation[] = [
  {
    id: "u-dim-1",
    kind: "dim",
    a: { ref: "m000", part: "vertex", index: 0, snap: [1200, 1200] },
    b: { ref: "site:boundary", part: "edge", index: 0, at: "foot", snap: [1200, 0] },
    offset_mm: 5,
    text: "이격 {값}",
  },
  { id: "u-text-1", kind: "text", anchor: { ref: "m000", part: "center", snap: [10000, 7500] }, dx_mm: 1, dy_mm: 2, text: "주출입" },
  { id: "u-leader-1", kind: "leader", anchor: { ref: "road:0", part: "edge", index: 0, at: "mid", snap: [10000, 0] }, dx_mm: 0, dy_mm: -10, text: "전면도로" },
  { id: "u-cloud-1", kind: "cloud", anchor: { ref: "line:setback", part: "vertex", index: 0, snap: [1000, 1000] }, dx_mm: 0, dy_mm: 0, text: "검토", size_mm: 10 },
  { id: "ov-note:1", kind: "text", dx_mm: 30, dy_mm: 50, text: "메모 1" },
];

function build(annotations: SheetAnnotation[], over: Partial<DraftingInput["sheet"]> = {}) {
  const model = sampleModel();
  const input = sampleInput(model);
  input.sheet = { ...input.sheet, ...over, annotations };
  return buildSheet(input, sampleView(model));
}

const user = (s: SheetModel) => s.annotations.filter((a) => a.anno_id.startsWith("u-") || a.anno_id.startsWith("ov-note:"));

test("사람 주석은 A-ANNO-USER, 앵커 좌표 + 용지 mm 오프셋, 치수 값은 두 앵커 거리(엔진 계산)", () => {
  assert.ok(annotationsSchema.safeParse(ANNOS).success);
  const { sheet, unapplied } = build(ANNOS);
  assert.deepEqual(unapplied, []);
  const ids = user(sheet).map((a) => a.anno_id);
  assert.deepEqual(ids, ["ov-note:1", "u-cloud-1", "u-dim-1", "u-leader-1", "u-text-1"]);
  // 사람이 만든 u- 주석은 A-ANNO-USER, 이행 메모(ov-note:)는 기존과 같은 A-ANNO-TEXT.
  for (const a of user(sheet)) assert.ok(a.prims.every((p) => p.layer === (a.anno_id.startsWith("u-") ? "A-ANNO-USER" : "A-ANNO-TEXT")), a.anno_id);
  const k = sheet.scale / 100;

  const dim = sheet.annotations.find((a) => a.anno_id === "u-dim-1");
  const dt = dim?.prims.find((p) => p.t === "text");
  assert.ok(dt?.t === "text" && dt.s === "이격 1200" && dt.source_ref === "user", JSON.stringify(dt));
  assert.equal(dim?.kind, "dim");
  assert.equal(dim?.view_id, "main");

  const text = sheet.annotations.find((a) => a.anno_id === "u-text-1")?.prims[0];
  assert.deepEqual(text?.t === "text" && text.at, [10000 + 100 * k, 7500 + 200 * k]);

  const leader = sheet.annotations.find((a) => a.anno_id === "u-leader-1")?.prims;
  const line = leader?.find((p) => p.t === "line");
  assert.deepEqual(line?.t === "line" && [line.a, line.b], [[10000, 0], [10000, -1000 * k]]);

  const cloud = sheet.annotations.find((a) => a.anno_id === "u-cloud-1")?.prims ?? [];
  assert.ok(cloud.filter((p) => p.t === "arc").length >= 4);
  for (const p of cloud) if (p.t === "arc") assert.ok(Number.isSafeInteger(p.r) && Number.isSafeInteger(p.c[0]) && Number.isSafeInteger(p.c[1]));

  // 이행한 자유 메모: 앵커 없음 → 용지 좌표 그대로(0.01mm), 뷰 없음.
  const note = sheet.annotations.find((a) => a.anno_id === "ov-note:1");
  assert.equal(note?.view_id, undefined);
  const np = note?.prims[0];
  assert.deepEqual(np?.t === "text" && [np.at, np.s], [[3_000, 5_000], "메모 1"]);

  // 레이어 표·SVG 그룹에 A-ANNO-USER가 나온다.
  assert.match(writeDxf(sheet).text, /\r\n {2}2\r\nA-ANNO-USER\r\n/);
  assert.match(writeSvg(sheet), /<g id="A-ANNO-USER"/);
});

test("고아: ref 없음·index 범위 밖·기준 좌표 불일치 → 출력 0건, unapplied에 id·사유", () => {
  const orphans: SheetAnnotation[] = [
    { id: "u-a", kind: "text", anchor: { ref: "m999", part: "center", snap: [0, 0] }, dx_mm: 0, dy_mm: 0, text: "없음" },
    { id: "u-b", kind: "text", anchor: { ref: "m000", part: "vertex", index: 9, snap: [0, 0] }, dx_mm: 0, dy_mm: 0, text: "범위" },
    { id: "u-c", kind: "leader", anchor: { ref: "m000", part: "vertex", index: 1, snap: [1200, 1200] }, dx_mm: 0, dy_mm: 5, text: "밀림" },
    { id: "u-d", kind: "dim", a: { ref: "road:7", part: "edge", index: 0, snap: [0, 0] }, b: { ref: "m000", part: "center", snap: [10000, 7500] }, offset_mm: 0 },
  ];
  const base = build([]);
  const { sheet, unapplied } = build(orphans);
  assert.deepEqual(unapplied, [
    { id: "u-a", reason: "orphan_missing" },
    { id: "u-b", reason: "orphan_index" },
    { id: "u-c", reason: "orphan_moved" },
    { id: "u-d", reason: "orphan_missing" },
  ]);
  assert.deepEqual(user(sheet), []);
  // 고아만 있는 시트는 주석 없는 시트와 형상·레이어 표가 같다(input_hash만 다름).
  assert.equal(writeDxf({ ...sheet, input_hash: base.sheet.input_hash }).text, writeDxf(base.sheet).text);
});

test("다른 층의 실·이 시트에 없는 대상은 고아가 아니라 그리지 않는다", () => {
  const room: SheetAnnotation = { id: "u-r", kind: "text", anchor: { ref: "r000", part: "vertex", index: 0, snap: [1200, 1200] }, dx_mm: 0, dy_mm: 0, text: "거실" };
  const r = build([room]);
  assert.deepEqual(r.unapplied, []);
  assert.deepEqual(user(r.sheet), []);
});

test("주석 배열 순서를 섞어도 같은 시트(input_hash 포함)·같은 DXF·SVG 바이트", () => {
  const a = build(ANNOS).sheet;
  const b = build([...ANNOS].reverse()).sheet;
  const c = build([ANNOS[2], ANNOS[0], ANNOS[4], ANNOS[1], ANNOS[3]] as SheetAnnotation[]).sheet;
  assert.equal(canonicalJson(b), canonicalJson(a));
  assert.equal(canonicalJson(c), canonicalJson(a));
  assert.equal(writeDxf(b).text, writeDxf(a).text);
  assert.equal(writeSvg(c), writeSvg(a));
});

test("빈 문자·0 길이 치수·0 길이 지시선·foot 단독은 unapplied, 숨긴 메모는 조용히 뺀다", () => {
  const { sheet, unapplied } = build([
    { id: "u-e", kind: "text", anchor: { ref: "m000", part: "center", snap: [10000, 7500] }, dx_mm: 0, dy_mm: 0, text: "  " },
    { id: "u-f", kind: "dim", a: { ref: "m000", part: "vertex", index: 0, snap: [1200, 1200] }, b: { ref: "m000", part: "vertex", index: 0, snap: [1200, 1200] }, offset_mm: 0 },
    { id: "u-g", kind: "leader", anchor: { ref: "m000", part: "edge", index: 0, at: "foot", snap: [0, 0] }, dx_mm: 0, dy_mm: 0, text: "x" },
    { id: "u-h", kind: "leader", anchor: { ref: "m000", part: "center", snap: [10000, 7500] }, dx_mm: 0, dy_mm: 0, text: "길이 0" },
    { id: "ov-note:h", kind: "text", dx_mm: 0, dy_mm: 0, text: "숨김", hidden: true },
  ]);
  assert.deepEqual(unapplied, [
    { id: "u-e", reason: "empty_text" },
    { id: "u-f", reason: "zero_length" },
    { id: "u-g", reason: "invalid_anchor" },
    { id: "u-h", reason: "zero_length" },
  ]);
  assert.deepEqual(user(sheet), []);
});

test("스키마: id 형식·시트 내 유일·상한(500개, 200자)", () => {
  const t = (id: string): SheetAnnotation => ({ id, kind: "text", dx_mm: 0, dy_mm: 0, text: "a" });
  assert.equal(annotationsSchema.safeParse([t("u-1"), t("u-1")]).success, false);
  assert.equal(annotationsSchema.safeParse([t("dim:x")]).success, false);
  assert.equal(annotationsSchema.safeParse([{ id: "ov-x", kind: "override", target: "y" }]).success, false);
  assert.equal(annotationsSchema.safeParse([{ id: "ov-note:1", kind: "override", target: "note:1" }]).success, false);
  assert.equal(annotationsSchema.safeParse([{ ...t("u-1"), text: "가".repeat(201) }]).success, false);
  assert.equal(annotationsSchema.safeParse(Array.from({ length: 501 }, (_, i) => t(`u-${i}`))).success, false);
  assert.equal(annotationsSchema.safeParse(Array.from({ length: 500 }, (_, i) => t(`u-${i}`))).success, true);
});

test("골든 케이스: 고아 3건은 unapplied(id·사유), 대상 없는 덮어쓰기와 같은 경로", () => {
  const c = SITE_CASES.find((x) => x.id === "site_plan-orphan-annotations");
  assert.ok(c);
  const r = buildSheet(c.input, buildSitePlanView(c.input, c.extras));
  assert.deepEqual(r.unapplied, [
    { id: "u-gone", reason: "orphan_missing" },
    { id: "u-moved", reason: "orphan_moved" },
    { id: "u-range", reason: "orphan_index" },
  ]);
  const withAnnos = (annotations: SheetAnnotation[]) => {
    const input = sampleInput(sampleModel());
    input.sheet = { ...input.sheet, annotations };
    return buildSheet(input, sampleView(input.model));
  };
  assert.deepEqual(
    withAnnos(sampleOrphanAnnotations()).unapplied.map((u) => `${u.id}:${u.reason}`),
    ["ov-dim:gone:missing_target", "u-gone:orphan_missing", "u-moved:orphan_moved", "u-range:orphan_index"],
  );
  assert.deepEqual(withAnnos(sampleUserAnnotations()).unapplied, []);
});
