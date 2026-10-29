// 대지 순수 로직: 초안 ↔ 모델, 정규화·도로 변 번호, 면적·둘레, mm 입력, 조회 응답 → 후보(mToMm half-away), 권한·조회 실패 안내.
import assert from "node:assert/strict";
import { test } from "node:test";
import { designModelV1Schema, type DesignModelV1, type Point } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { EXPIRED_TEXT, LOOKUP_TEXT, lookupFailure, lookupInputOk, siteAccess } from "./access.ts";
import {
  applyDraft,
  candidateFromLookup,
  draftFromModel,
  draftWithCandidate,
  formatM,
  hasSite,
  normalizeOutline,
  outlineIssue,
  parseAngleInput,
  parseDesignModel,
  parseLookupData,
  parseMmInput,
  roadsAfterRemove,
  sameDraft,
  siteMetrics,
  vertexWarning,
} from "./model.ts";
import { svgToModel, viewBoxFor } from "./view.ts";

const sample = (): DesignModelV1 => structuredClone(DEMO_PROJECTS[0]!.model);

test("초안 왕복: 모델 → 초안 → 그대로 반영하면 같은 site(정규화된 반시계 경계는 유지)", () => {
  const m = sample();
  const d = draftFromModel(m);
  assert.equal(hasSite(m), true);
  const r = applyDraft(m, d);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.model.site, m.site);
  assert.ok(sameDraft(d, draftFromModel(m)));
});

test("시계 방향 경계는 반시계로 정규화하고 도로 변 번호를 따라 옮긴다", () => {
  const m = sample();
  const cw: Point[] = [
    [0, 0],
    [0, 22000],
    [18000, 22000],
    [18000, 0],
  ];
  // 시계 방향에서 변 3 = (18000,0)→(0,0) 남측 변
  const d = { ...draftFromModel(m), outer: cw, roads: { 3: 6000 } };
  const r = applyDraft(m, d);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.model.site.boundary.outer, [
    [0, 0],
    [18000, 0],
    [18000, 22000],
    [0, 22000],
  ]);
  assert.deepEqual(r.model.site.roads, [{ edge_index: 0, width_mm: 6000 }]);
  assert.ok(designModelV1Schema.safeParse(r.model).success);
  const n = normalizeOutline(cw);
  assert.equal(n.edgeOf(3), 0);
});

test("반영 거부: 자기교차·점 부족·용도지역 없음·도로 폭 범위 밖·날짜 형식", () => {
  const m = sample();
  const base = draftFromModel(m);
  const bow: Point[] = [
    [0, 0],
    [10000, 10000],
    [10000, 0],
    [0, 4000],
  ];
  const r1 = applyDraft(m, { ...base, outer: bow });
  assert.ok(!r1.ok && r1.issues.some((i) => /교차/.test(i)), JSON.stringify(r1));
  assert.ok(!applyDraft(m, { ...base, outer: [[0, 0], [1000, 0]] }).ok);
  assert.ok(!applyDraft(m, { ...base, use_district: " " }).ok);
  assert.ok(!applyDraft(m, { ...base, roads: { 0: 0 } }).ok);
  assert.ok(!applyDraft(m, { ...base, roads: { 0: 100_001 } }).ok);
  assert.ok(!applyDraft(m, { ...base, roads: { 9: 6000 } }).ok);
  assert.ok(!applyDraft(m, { ...base, application_date: "2026/12/01" }).ok);
  assert.equal(outlineIssue([[0, 0], [0, 0], [10, 10]]), "같은 자리에 꼭짓점이 겹쳐 있습니다.");
});

test("면적·둘레(geometry area, half-away), 표시 형식", () => {
  const m = siteMetrics([
    [0, 0],
    [18000, 0],
    [18000, 22000],
    [0, 22000],
  ]);
  assert.deepEqual(m, { area_mm2: 396_000_000, area_m2_text: "396.00", perimeter_mm: 80_000, vertex_count: 4 });
  // 직각삼각형 3-4-5(m): 둘레 12m, 면적 6㎡
  assert.equal(siteMetrics([[0, 0], [3000, 0], [0, 4000]])?.perimeter_mm, 12_000);
  assert.equal(siteMetrics([[0, 0], [1, 1], [2, 2]]), null);
  assert.equal(formatM(6005), "6.01");
  assert.equal(formatM(-6005), "-6.01");
});

test("mm 입력: 쉼표·소수 half-away, 범위·형식 거부, 각도 정규화", () => {
  assert.equal(parseMmInput("12,345"), 12345);
  assert.equal(parseMmInput("2.5"), 3);
  assert.equal(parseMmInput("-2.5"), -3);
  assert.equal(parseMmInput("1e3"), null);
  assert.equal(parseMmInput("10000001"), null);
  assert.equal(parseMmInput("-5", false), null);
  assert.equal(parseMmInput(""), null);
  assert.equal(parseAngleInput("370"), 10);
  assert.equal(parseAngleInput("-15"), 345);
  assert.equal(parseAngleInput("17.55"), 17.6);
  assert.equal(parseAngleInput("북"), null);
});

test("꼭짓점 삭제 시 도로 변 재배치", () => {
  // 사각형에서 점 2 삭제: 변 1·2가 합쳐져 변 1, 변 3 → 변 2
  assert.deepEqual(roadsAfterRemove({ 0: 6000, 2: 4000, 3: 8000 }, 2, 4), { 0: 6000, 2: 8000 });
  // 점 0 삭제: 변 0 제거, 변 3 → 변 2
  assert.deepEqual(roadsAfterRemove({ 0: 6000, 3: 8000 }, 0, 4), { 2: 8000 });
});

const lookupRaw = {
  parcel: { pnu: "4113510900100120004", address_label: "<script>alert(1)</script> 운중동 12-4" },
  crs: "EPSG:5186",
  boundary_m: [
    [200118.125, 550100.5],
    [200118.125, 550122.5],
    [200100.125, 550122.5],
    [200100.125, 550100.5],
  ],
  zoning: { use_district: "제1종일반주거지역", districts: ["지구단위계획구역"] },
  roads: [],
  sources: [{ provider: "vworld", datasets: [], fetched_at: "2026-10-29T03:00:00.000Z" }],
  source: { kind: "input_candidate", judgment_basis: false, notice: "공공 데이터 값은 입력 후보이며 판정 기준이 아닙니다." },
  notes: ["multipart", "evil"],
  remaining_today: 29,
};

test("조회 응답 → 후보: 원점 이동 후 mm 정수(half-away), 반시계, 면적, 알림", () => {
  const data = parseLookupData(lookupRaw);
  assert.ok(data);
  const c = candidateFromLookup(data!);
  assert.ok(c);
  if (!c) return;
  assert.deepEqual(c.origin_mm, [200100000, 550100000]);
  // 200100.125 m → 200100125 mm, 원점 200100000 → 125
  assert.deepEqual(c.outer[0], [18125, 500]);
  assert.ok(c.outer.some(([x, y]) => x === 125 && y === 500));
  assert.equal(c.area_mm2, 396_000_000);
  assert.ok(c.outer.every(([x, y]) => Number.isSafeInteger(x) && Number.isSafeInteger(y)));
  assert.deepEqual(c.notes, ["필지가 여러 조각이라 가장 큰 조각만 가져왔습니다."]);
  assert.equal(c.use_district, "제1종일반주거지역");
  // 후보 반영: 도로 지정은 비우고 용도지역·지번을 가져온다
  const d = draftWithCandidate({ ...draftFromModel(sample()), roads: { 0: 6000 } }, c);
  assert.deepEqual(d.roads, {});
  assert.equal(d.parcel.pnu, "4113510900100120004");
});

test("조회 응답 검증: 좌표계·PNU·좌표 타입·점 수가 틀리면 null, 자기교차 후보는 null", () => {
  assert.equal(parseLookupData({ ...lookupRaw, crs: "EPSG:4326" }), null);
  assert.equal(parseLookupData({ ...lookupRaw, parcel: { pnu: "12-4" } }), null);
  assert.equal(parseLookupData({ ...lookupRaw, boundary_m: [[1, "2"], [3, 4], [5, 6]] }), null);
  assert.equal(parseLookupData({ ...lookupRaw, boundary_m: [[1, 2]] }), null);
  const bow = parseLookupData({ ...lookupRaw, boundary_m: [[200100, 550100], [200110, 550110], [200110, 550100], [200100, 550110]] });
  assert.ok(bow);
  assert.equal(candidateFromLookup(bow!), null);
});

test("권한: 판정 전·거부는 편집 불가(체험만료 문구), 오프라인은 조회만 막는다", () => {
  assert.deepEqual(siteAccess(undefined, true), { edit: false, pending: true, lockReason: null, lookup: "locked" });
  const expired = siteAccess({ allowed: false, reason: "expired" }, true);
  assert.equal(expired.edit, false);
  assert.equal(expired.lockReason, EXPIRED_TEXT);
  assert.deepEqual(siteAccess({ allowed: true }, false), { edit: true, pending: false, lockReason: null, lookup: "offline" });
});

test("조회 실패 안내: AR020·AR021(사유별)·형식 오류, 모두 입력값을 문구에 넣지 않는다", () => {
  assert.deepEqual(lookupFailure("AR020", undefined, "x"), { message: LOOKUP_TEXT.AR020, toDraw: true });
  assert.equal(lookupFailure("AR021", "not_configured", "x").message, LOOKUP_TEXT.notConfigured);
  assert.equal(lookupFailure("AR021", "timeout", "x").message, LOOKUP_TEXT.AR021);
  assert.equal(lookupFailure("invalid_input", undefined, "x").toDraw, false);
  assert.equal(lookupInputOk("jibun", "운중동 12-4"), true);
  assert.equal(lookupInputOk("jibun", "운중동&key=1"), false);
  assert.equal(lookupInputOk("pnu", "4113510900100120004"), true);
  assert.equal(lookupInputOk("pnu", "41135"), false);
});

test("뷰: 클릭 좌표는 100mm 격자 mm 정수(y 반전), 빈 캔버스 기본 범위", () => {
  assert.deepEqual(svgToModel(1049.9, -2050), [1000, 2100]);
  assert.deepEqual(svgToModel(-150, 0), [-200, 0]);
  assert.ok(viewBoxFor([]).w > 0);
  assert.equal(vertexWarning(201), "대지 꼭짓점이 201개라 계산이 느릴 수 있습니다.");
  assert.equal(vertexWarning(200), null);
});

test("설계 모델 JSON이 깨졌으면 ok:false", () => {
  assert.deepEqual(parseDesignModel("{"), { ok: false });
  assert.deepEqual(parseDesignModel("{}"), { ok: false });
  assert.equal(parseDesignModel(JSON.stringify(sample())).ok, true);
});
