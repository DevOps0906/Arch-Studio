// 표제란: 고정 고지는 DraftingProfile·덮어쓰기·레이어 매핑으로 바뀌거나 지워지지 않는다(AR-F-028 수용 기준).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { assertDisclaimer, buildSheet, buildTitleBlock, DISCLAIMER, DISCLAIMER_MIN_H, DraftingError, resolveLayerMap, type DraftingProfile } from "../index.ts";
import { sampleInput, sampleModel, sampleView } from "../sheet/test-fixtures.ts";

const texts = (prims: Array<{ t: string; s?: string }>) => prims.filter((p) => p.t === "text").map((p) => p.s);
const base = {
  kind: "site_plan" as const,
  paper: "A3" as const,
  orientation: "landscape" as const,
  scale: 200 as const,
  project_name: "P",
  date: "2026-10-29",
  rule_pack_version: "2026.10.0",
};

test("고지 문구는 상수 그대로", () => {
  assert.equal(DISCLAIMER, "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다");
  const { values, prims } = buildTitleBlock({ ...base, profile: { office_name: "A", default_text_height_mm: 2.5 }, license: { drafting_watermark: false } });
  assert.equal(values.disclaimer, DISCLAIMER);
  assert.equal(texts(prims).filter((s) => s === DISCLAIMER).length, 1);
  assert.ok(!texts(prims).includes("체험판"));
  assert.ok(!texts(prims).some((s) => s?.startsWith("이후 개정")));
});

test("DraftingProfile 값·모르는 칸으로 고지가 바뀌지 않는다", () => {
  const evil = {
    office_name: DISCLAIMER.slice(0, 5),
    default_text_height_mm: 9,
    disclaimer: "고지 없음",
    layer_map: { "A-TTLB": "MY-TTLB" },
  } as unknown as DraftingProfile;
  const { values, prims } = buildTitleBlock({ ...base, profile: evil, license: { drafting_watermark: false } });
  assert.equal(values.disclaimer, DISCLAIMER);
  assert.ok(texts(prims).includes(DISCLAIMER));
  assert.ok(!texts(prims).includes("고지 없음"));
});

test("덮어쓰기로 표제란·고지를 숨기거나 바꿀 수 없다", () => {
  const model = sampleModel();
  const input = sampleInput(model);
  input.sheet.annotation_overrides = [
    { target: "ttlb:disclaimer", hidden: true },
    { target: "ttlb:disclaimer", text: "삭제" },
    { target: "ttlb:frame", dx_mm: 100 },
    { target: "disclaimer", text: "" },
  ];
  input.profile.layer_map = { "A-TTLB": "OFFICE-TB" };
  const { sheet, unapplied_overrides } = buildSheet(input, sampleView(model));
  assert.equal(texts(sheet.paper_prims).filter((s) => s === DISCLAIMER).length, 1);
  assert.equal(sheet.title_block.disclaimer, DISCLAIMER);
  assert.ok(!sheet.annotations.some((a) => a.prims.some((p) => p.t === "text" && p.s === "삭제")));
  assert.deepEqual(
    unapplied_overrides.map((u) => [u.target, u.reason]),
    [
      ["disclaimer", "missing_target"],
      ["ttlb:disclaimer", "missing_target"],
      ["ttlb:frame", "missing_target"],
    ],
  );
  // 레이어 매핑은 이름만 바꾼다. 시트에는 표준 A-TTLB 고지가 그대로.
  assert.equal(resolveLayerMap(input.profile.layer_map).names["A-TTLB"], "OFFICE-TB");
  assertDisclaimer(sheet.paper_prims);
});

test("체험판·폴백 '이후 개정 n건'", () => {
  const p = { office_name: "A", default_text_height_mm: 2.5 };
  const trial = buildTitleBlock({ ...base, profile: p, license: { drafting_watermark: true } });
  assert.equal(trial.values.watermark, true);
  assert.ok(texts(trial.prims).includes("체험판"));
  const fb = buildTitleBlock({ ...base, profile: p, license: { drafting_watermark: false, fallback_revisions: 3 } });
  assert.equal(fb.values.pending_changes, 3);
  assert.ok(texts(fb.prims).includes("이후 개정 3건"));
  const t = fb.prims.find((x) => x.t === "text" && x.s === "이후 개정 3건");
  assert.equal(t?.t === "text" && t.source_ref, "license.fallback_revisions");
  assert.throws(() => buildTitleBlock({ ...base, profile: p, license: { drafting_watermark: false, fallback_revisions: -1 } }));
});

test("고지가 없는 용지 요소는 assertDisclaimer가 거부한다", () => {
  const { prims } = buildTitleBlock({ ...base, profile: { office_name: "A", default_text_height_mm: 2.5 }, license: { drafting_watermark: false } });
  const removed = prims.filter((p) => !(p.t === "text" && p.s === DISCLAIMER));
  assert.throws(() => assertDisclaimer(removed), (e) => e instanceof DraftingError && e.code === "DISCLAIMER_MISSING");
});

test("고지 글자 높이: 프로필과 무관하게 최소 2.5mm, 0.01mm 미만 프로필은 거부", () => {
  const lic = { drafting_watermark: false };
  const at = (mm: number) => buildTitleBlock({ ...base, profile: { office_name: "A", default_text_height_mm: mm }, license: lic });
  const disc = (mm: number) => at(mm).prims.find((p) => p.t === "text" && p.s === DISCLAIMER);
  assert.equal(DISCLAIMER_MIN_H, 250);
  assert.equal(disc(1)?.t === "text" && disc(1)?.h, 250, "프로필 1mm여도 고지는 2.5mm");
  assert.equal(disc(4)?.t === "text" && disc(4)?.h, 400);
  for (const mm of [0.001, 0.004, 0, -1, Number.NaN]) {
    assert.throws(() => at(mm), (e) => e instanceof DraftingError && e.code === "INVALID_ARGUMENT", String(mm));
  }
  const prims = at(2.5).prims;
  const swap = (f: (p: Extract<(typeof prims)[number], { t: "text" }>) => object) =>
    prims.map((p) => (p.t === "text" && p.s === DISCLAIMER ? { ...p, ...f(p) } : p)) as typeof prims;
  for (const bad of [swap(() => ({ h: 0 })), swap(() => ({ h: 249 })), swap(() => ({ layer: "A-ANNO-TEXT" })), swap((p) => ({ s: p.s + " " }))]) {
    assert.throws(() => assertDisclaimer(bad), (e) => e instanceof DraftingError && e.code === "DISCLAIMER_MISSING");
  }
});
