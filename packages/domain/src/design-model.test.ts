// 판정 필수 필드 누락 → 검증 실패(02_ARCHITECTURE.md 위험 #2), mm 정수 강제(04_API.md 4.7.1).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { designModelV1Schema, draftingProfileSchema } from "./index.ts";
import { validDesignModel } from "./test-fixtures.ts";

function failurePaths(input: unknown): string[] {
  const result = designModelV1Schema.safeParse(input);
  assert.equal(result.success, false, "검증이 실패해야 한다");
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

test("필수 필드를 모두 채운 모델은 통과한다", () => {
  const model = validDesignModel();
  assert.deepEqual(designModelV1Schema.parse(model), model);
});

test("north_angle_deg가 없으면 실패한다", () => {
  const model = validDesignModel() as unknown as { site: Record<string, unknown> };
  delete model.site.north_angle_deg;
  assert.deepEqual(failurePaths(model), ["site.north_angle_deg"]);
});

test("north_angle_deg가 null·NaN이면 실패한다", () => {
  for (const bad of [null, Number.NaN]) {
    const model = validDesignModel() as unknown as { site: Record<string, unknown> };
    model.site.north_angle_deg = bad;
    assert.deepEqual(failurePaths(model), ["site.north_angle_deg"]);
  }
});

test("도로 폭이 없으면 실패한다", () => {
  const model = validDesignModel() as unknown as { site: { roads: Record<string, unknown>[] } };
  delete model.site.roads[0]!.width_mm;
  assert.deepEqual(failurePaths(model), ["site.roads.0.width_mm"]);
});

test("도로 목록이 없으면 실패한다(빈 목록은 맹지로 허용)", () => {
  const model = validDesignModel();
  const site: Record<string, unknown> = { ...model.site };
  delete site.roads;
  assert.deepEqual(failurePaths({ ...model, site }), ["site.roads"]);
  assert.equal(designModelV1Schema.safeParse({ ...model, site: { ...model.site, roads: [] } }).success, true);
});

test("용도지역이 없거나 빈 문자열이면 실패한다", () => {
  const missing = validDesignModel() as unknown as { site: { zoning: Record<string, unknown> } };
  delete missing.site.zoning.use_district;
  assert.deepEqual(failurePaths(missing), ["site.zoning.use_district"]);

  const empty = validDesignModel();
  empty.site.zoning.use_district = "";
  assert.deepEqual(failurePaths(empty), ["site.zoning.use_district"]);
});

test("좌표·길이가 mm 정수가 아니면 실패한다", () => {
  const coord = validDesignModel();
  coord.site.boundary.outer[1] = [20000.5, 0];
  assert.deepEqual(failurePaths(coord), ["site.boundary.outer.1.0"]);

  const width = validDesignModel();
  width.site.roads[0]!.width_mm = 6000.1;
  assert.deepEqual(failurePaths(width), ["site.roads.0.width_mm"]);
});

test("문서에 없는 필드는 거부한다", () => {
  const model = { ...validDesignModel(), extra: true };
  assert.equal(designModelV1Schema.safeParse(model).success, false);
});

test("DraftingProfile layer_map은 표준 레이어 이름만 키로 받는다", () => {
  const base = { office_name: "사무소", default_paper: "A3", default_text_height_mm: 2.5, font_family: "맑은 고딕" };
  assert.equal(draftingProfileSchema.safeParse({ ...base, layer_map: { "A-WALL": "벽" } }).success, true);
  assert.equal(draftingProfileSchema.safeParse({ ...base, layer_map: { WALL: "벽" } }).success, false);
});
