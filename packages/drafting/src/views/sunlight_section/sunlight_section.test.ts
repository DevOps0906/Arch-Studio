// sunlight_section 뷰 테스트(AR-06-025): 속성 + 골든. 엔벨로프 입력은 fixtures.ts의 가짜 구조적 값.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { buildSheet, canonicalJson, DraftingError, sha256Hex, validateDraftingInput, type Prim, type SheetModel } from "../../index.ts";
import { buildSunlightSectionView } from "./index.ts";
import { NEW_BANDS, OLD_BANDS, envelopeOf, sectionInput, sectionModel } from "./fixtures.ts";
import { SUNLIGHT_CASES, sunlightGoldenFiles } from "./golden-cases.ts";
import type { SunlightBandInput } from "./types.ts";

type Model = ReturnType<typeof sectionModel>;

function build(model: Model, kind: "old" | "new" | "unverified", sheet = {}, standard?: "new" | "old"): SheetModel {
  const v = validateDraftingInput(sectionInput(model, sheet));
  assert.ok(v.ok);
  if (!v.ok) throw new Error("unreachable");
  const env = envelopeOf(kind, { application_date: model.rule_context.application_date });
  return buildSheet(v.input, buildSunlightSectionView(v.input, env, standard ? { standard } : {})).sheet;
}

const viewPrims = (s: SheetModel) => (s.views[0] as SheetModel["views"][number]).prims;
const hatches = (s: SheetModel) => viewPrims(s).filter((p) => p.t === "hatch") as Array<Extract<Prim<number>, { t: "hatch" }>>;
const hatchArea = (s: SheetModel) =>
  hatches(s).reduce((sum, h) => {
    const l = h.loops[0] as Array<[number, number]>;
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i] as [number, number];
      const q = l[(i + 1) % l.length] as [number, number];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return sum + Math.abs(a) / 2;
  }, 0);
const legend = (s: SheetModel) => s.paper_prims.filter((p) => p.t === "text" && p.key.startsWith("legend:")).map((p) => (p.t === "text" ? p.s : ""));

/** 구현과 독립: 높이 z(구간 상한 포함은 아래 구간)의 요구 정북 거리. */
function required(bands: SunlightBandInput[], z: number): number {
  let prev = 0;
  for (const b of bands) {
    if (b.up_to_mm === null || z <= b.up_to_mm) {
      return Math.max(b.min_distance_mm ?? 0, b.distance_ratio ? (z * b.distance_ratio.num) / b.distance_ratio.den : 0);
    }
    prev = b.up_to_mm;
  }
  return prev;
}

/** 수치 적분으로 구한 초과 면적: 높이 z마다 너비 clamp(북쪽끝 − (경계 − d(z)), 0, 단면 길이). */
function expectedArea(bands: SunlightBandInput[], uN: number, uSouth: number, uNorth: number, zTop: number): number {
  let sum = 0;
  for (let z = 0.5; z < zTop; z += 1) {
    sum += Math.max(0, Math.min(uNorth - (uN - required(bands, z)), uNorth - uSouth));
  }
  return sum;
}

test("신·구 기준 쌍: 사선과 라벨이 함께 바뀐다", () => {
  const o = build(sectionModel({ date: "2000-06-30" }), "old", {}, "old");
  const n = build(sectionModel({ date: "2000-08-01" }), "new", {}, "new");
  const line = (s: SheetModel) => JSON.stringify(viewPrims(s).find((p) => p.key === "envelope:line"));
  assert.notEqual(line(o), line(n));
  assert.notDeepEqual(legend(o), legend(n));
  assert.ok((legend(o)[0] as string).includes("제86조(구)") && (legend(o)[0] as string).includes("구 기준"));
  assert.ok((legend(n)[0] as string).includes("제86조(신)") && (legend(n)[0] as string).includes("신 기준"));
  assert.ok((legend(o)[1] as string).includes("2000-06-30"));
  assert.ok((legend(n)[1] as string).includes("2000-08-01"));
});

test("사선 초과: 구 기준 2층은 초과(해치+라벨), 신 기준 2층은 없음", () => {
  const o = build(sectionModel({ date: "2000-06-30" }), "old");
  const n = build(sectionModel({ date: "2000-08-01" }), "new");
  assert.ok(hatches(o).length > 0);
  assert.ok(hatches(o).every((h) => h.layer === "A-ANNO-TEXT"));
  assert.ok(o.annotations.some((a) => a.kind === "warning" && a.prims.some((p) => p.t === "text" && p.s === "사선 초과")));
  assert.ok((legend(o)[2] as string).includes("초과"));
  assert.equal(hatches(n).length, 0);
  assert.equal(legend(n)[2], "사선 초과 없음");
});

test("초과 면적이 수치 적분과 같다(구·신 기준, 북쪽 매스 끝 y1 임의)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 4000, max: 14_000 }), fc.integer({ min: 1, max: 4 }), fc.constantFrom("old", "new"), (y1, floors, kind) => {
      const s = build(sectionModel({ y1, floors, date: kind === "old" ? "2000-06-30" : "2000-08-01" }), kind);
      const bands = kind === "old" ? OLD_BANDS : NEW_BANDS;
      const want = expectedArea(bands, 15_000, 2000, y1, floors * 3000);
      const got = hatchArea(s);
      assert.ok(Math.abs(got - want) <= Math.max(2000, want * 0.002), `y1=${y1} floors=${floors} ${kind}: ${got} vs ${want}`);
    }),
    { numRuns: 60 },
  );
});

test("정북이 +X(north_angle_deg 90)여도 같은 방식으로 초과를 구한다", () => {
  const s = build(sectionModel({ date: "2000-06-30", north_angle_deg: 90 }), "old");
  // 대지 x 0~20000, 매스 x 2000~14000, 정북 경계 x=20000
  const want = expectedArea(OLD_BANDS, 20_000, 2000, 14_000, 6000);
  assert.ok(Math.abs(hatchArea(s) - want) <= want * 0.002);
});

test("매스가 사선 안쪽이면 초과가 없다", () => {
  const s = build(sectionModel({ date: "2000-06-30", y1: 7000 }), "old");
  assert.equal(hatches(s).length, 0);
});

test("section_line 지정: 단면선이 달라도 정북 투영으로 그려진다", () => {
  const def = build(sectionModel({ date: "2000-06-30", floors: 3 }), "old");
  const sl = build(sectionModel({ date: "2000-06-30", floors: 3 }), "old", { section_line: { a: [5000, 0], b: [5000, 15_000] } });
  // 매스가 x 방향으로 균일한 직사각형이라 초과 면적은 같다.
  assert.ok(Math.abs(hatchArea(def) - hatchArea(sl)) <= 2);
  // 대각선: 정북 투영 좌표라 매스 단면이 더 길어져 초과도 늘 수 있지만 정수 좌표·유효 시트여야 한다.
  const diag = build(sectionModel({ date: "2000-06-30", floors: 3 }), "old", { section_line: { a: [3000, 0], b: [9000, 15_000] } });
  assert.ok(hatches(diag).length > 0);
  assert.throws(
    () => build(sectionModel(), "new", { section_line: { a: [0, 5000], b: [20_000, 5000] } }),
    (e: unknown) => e instanceof DraftingError && e.code === "INVALID_ARGUMENT",
  );
  assert.throws(
    () => build(sectionModel(), "new", { section_line: { a: [0, 5000], b: [0, 5000] } }),
    (e: unknown) => e instanceof DraftingError && e.code === "INVALID_ARGUMENT",
  );
});

test("층고·최고 높이 치수는 값과 source_ref를 가진다", () => {
  const s = build(sectionModel({ floors: 3 }), "new");
  const dims = s.annotations.filter((a) => a.kind === "dim");
  const texts = dims.flatMap((a) => a.prims.filter((p) => p.t === "text")).map((p) => (p.t === "text" ? `${p.s}:${p.source_ref}` : ""));
  assert.ok(texts.includes("3000:model.masses.m1.floors.f2.height_mm"));
  assert.ok(texts.includes("9000:geometry.mass_height.m1"));
  assert.equal(dims.length, 4);
});

test("사선 미확인: 사선·초과 없이 미적용 라벨", () => {
  const s = build(sectionModel({ date: "2026-11-02" }), "unverified");
  assert.ok(!viewPrims(s).some((p) => p.layer === "A-ENVL"));
  assert.equal(hatches(s).length, 0);
  assert.ok((legend(s)[2] as string).includes("미적용"));
});

test("정북 경계가 도로 변이고 팩이 제외하면 사선을 그리지 않는다", () => {
  const m = sectionModel({ date: "2000-06-30" });
  m.site.roads = [{ edge_index: 2, width_mm: 6000 }];
  const s = build(m, "old");
  assert.ok(!viewPrims(s).some((p) => p.layer === "A-ENVL"));
  assert.ok((legend(s)[2] as string).includes("도로"));
});

test("결정성: 같은 입력 같은 바이트, 모든 좌표 정수", () => {
  const a = canonicalJson(build(sectionModel({ date: "2000-06-30", floors: 3 }), "old", {}, "old"));
  const b = canonicalJson(build(structuredClone(sectionModel({ date: "2000-06-30", floors: 3 })), "old", {}, "old"));
  assert.equal(a, b);
});

test("sunlight_section 시트가 아니면 거부", () => {
  const v = validateDraftingInput(sectionInput(sectionModel(), { kind: "site_plan" }));
  assert.ok(v.ok);
  if (v.ok) assert.throws(() => buildSunlightSectionView(v.input, envelopeOf("new")), DraftingError);
});

// --- 골든 ---
const GOLDEN = new URL("../../../golden/", import.meta.url);
const dirs = readdirSync(GOLDEN)
  .filter((d) => d.startsWith("sunlight_section-") && existsSync(new URL(`${d}/sheet.json`, GOLDEN)))
  .sort();

test("골든 4건 이상, 케이스 정의와 디렉터리가 1:1", () => {
  assert.ok(dirs.length >= 4, `골든 ${dirs.length}건`);
  assert.deepEqual(dirs, SUNLIGHT_CASES.map((c) => c.id).sort());
});

for (const c of SUNLIGHT_CASES) {
  test(`골든 ${c.id}`, () => {
    const want = sunlightGoldenFiles(c);
    for (const name of ["sheet.json", "sheet.sha256", "meta.json"] as const) {
      assert.equal(readFileSync(new URL(`${c.id}/${name}`, GOLDEN), "utf8"), want[name], `${name} 불일치(의도한 변경이면 update-golden.ts + 커밋 본문에 이유)`);
    }
    const json = readFileSync(new URL(`${c.id}/sheet.json`, GOLDEN), "utf8");
    assert.equal(readFileSync(new URL(`${c.id}/sheet.sha256`, GOLDEN), "utf8").trim(), sha256Hex(json));
  });
}
