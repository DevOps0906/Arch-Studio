// floor_plan 뷰(AR-06-026): 골든, 결정성, AR051 거부, 문·창 INSERT/BLOCK이 DXF로 나온다, 면적 라벨 source_ref.
// 골든 갱신: node golden/floor_plan-tools/update.ts [--accept] (packages/drafting에서). 골든이 바뀌면 이유를 커밋 본문에.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { createLayoutState } from "@arch-studio/layout";
import { buildSheet, canonicalJson, DraftingError, sha256Hex, validateDraftingInput, type SheetModel } from "../../index.ts";
import { writeDxf } from "../../writers/dxf/index.ts";
import { writeSvg } from "../../writers/svg/index.ts";
import { buildFloorPlanCase, CASES, floorPlanGoldenFiles, planInput, planModel, rect, type FloorPlanCase } from "./cases.ts";
import { buildFloorPlanView, FloorPlanError, labelPoint, tryBuildFloorPlanView } from "./index.ts";

const GOLDEN = new URL("../../../golden/", import.meta.url);
const byId = (id: string) => CASES.find((c) => c.id === id) as FloorPlanCase;
const sheetOf = (id: string): SheetModel => {
  const r = buildFloorPlanCase(byId(id));
  assert.ok(r.ok, id);
  return r.sheet;
};

test("골든: 4건 이상(거부 1건 포함), cases.ts와 디렉터리 1:1, 바이트·sha256 일치", () => {
  const dirs = readdirSync(GOLDEN)
    .filter((d) => d.startsWith("floor_plan-") && existsSync(new URL(`${d}/meta.json`, GOLDEN)))
    .sort();
  assert.ok(dirs.length >= 4);
  assert.ok(CASES.some((c) => c.rejected));
  assert.deepEqual(dirs, CASES.map((c) => c.id).sort());
  for (const c of CASES) {
    const files = floorPlanGoldenFiles(c);
    assert.deepEqual(readdirSync(new URL(`${c.id}/`, GOLDEN)).sort(), Object.keys(files).sort(), c.id);
    for (const [name, body] of Object.entries(files)) {
      assert.equal(readFileSync(new URL(`${c.id}/${name}`, GOLDEN), "utf8"), body, `${c.id}/${name}: 골든 불일치(의도한 변경이면 golden/floor_plan-tools/update.ts --accept + 커밋 본문에 이유)`);
    }
    if (files["sheet.json"] !== undefined) assert.equal(files["sheet.sha256"]?.trim(), sha256Hex(files["sheet.json"]));
  }
});

test("결정성: 같은 입력·깊은 복사 입력 → 같은 SheetModel 바이트와 DXF 바이트", () => {
  for (const c of CASES.filter((x) => !x.rejected)) {
    const a = buildFloorPlanCase(c);
    const b = buildFloorPlanCase({ ...c, input: () => structuredClone(c.input()) });
    assert.ok(a.ok && b.ok);
    assert.equal(canonicalJson(a.sheet), canonicalJson(b.sheet));
    assert.equal(writeDxf(a.sheet).text, writeDxf(b.sheet).text);
  }
});

test("AR051 모델은 시트 생성 거부(FloorPlanError, 값 결과 동일)", () => {
  const c = byId("floor_plan-rejected-overlap");
  const v = validateDraftingInput(c.input());
  assert.ok(v.ok, "AR050은 없다(형식은 정상)");
  assert.throws(
    () => buildFloorPlanView(v.input),
    (e: unknown) => e instanceof FloorPlanError && e.code === "AR051" && e.issues.length === 3,
  );
  const r = tryBuildFloorPlanView(v.input);
  assert.ok(!r.ok);
  assert.deepEqual(
    r.issues.map((i) => [i.code, i.kind, i.room_ids, i.opening_ids ?? []]),
    [
      ["AR051", "outside", ["b"], []],
      ["AR051", "overlap", ["a", "b"], []],
      ["AR051", "opening", ["a"], ["w1"]],
    ],
  );
  // 편집기(validate_layout)와 같은 판정.
  assert.deepEqual(createLayoutState(v.input.model, "f1").issues, r.issues);
});

test("문·창 INSERT/BLOCK이 DXF로 나온다(블록 정의·참조·레이어 A-DOOR·A-GLAZ, 회전)", () => {
  const s = sheetOf("floor_plan-doors-windows");
  const inserts = s.views[0]?.prims.filter((p) => p.t === "insert") ?? [];
  assert.equal(inserts.length, 5);
  assert.deepEqual(
    inserts.map((p) => (p.t === "insert" ? [p.key, p.layer, p.block, p.rot_deg] : [])).sort(),
    [
      ["opening:d-entry", "A-DOOR", "DOOR-W900-T200-R", 0],
      ["opening:d-inner", "A-DOOR", "DOOR-W800-T100-L", 90],
      // r2는 시계 방향 고리: 2번 변 (12000,8000)→(12000,2000)은 아래로 가지만 실 안쪽(서쪽)이 국소 +y가 되도록 국소 x = 위(90°).
      ["opening:w-bed", "A-GLAZ", "WIN-W1500-T200", 90],
      ["opening:w-living", "A-GLAZ", "WIN-W2400-T200", 180],
      ["opening:w-west", "A-GLAZ", "WIN-W1200-T200", 270],
    ].sort(),
  );
  const dxf = writeDxf(s).text;
  const lines = dxf.split("\r\n");
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([(lines[i] as string).trim(), lines[i + 1] as string]);
  for (const b of s.blocks) {
    const at = pairs.findIndex(([c, v], i) => c === "0" && v === "BLOCK" && pairs.slice(i, i + 12).some(([c2, v2]) => c2 === "2" && v2 === b.name));
    assert.ok(at >= 0, `BLOCK ${b.name}`);
  }
  const inserted = pairs.flatMap(([c, v], i) => (c === "0" && v === "INSERT" ? [pairs.slice(i, i + 12).find(([c2]) => c2 === "2")?.[1]] : []));
  assert.deepEqual(inserted.sort(), inserts.map((p) => (p.t === "insert" ? p.block : "")).sort());
  assert.ok(dxf.includes("AcDbBlockReference"));
  // 블록 안 엔티티의 레이어는 A-DOOR·A-GLAZ, 문 호는 ARC.
  for (const b of s.blocks) for (const e of b.entities) assert.ok(e.layer === (b.name.startsWith("DOOR") ? "A-DOOR" : "A-GLAZ"));
  assert.ok(s.blocks.filter((b) => b.name.startsWith("DOOR")).every((b) => b.entities.some((e) => e.t === "arc")));
  // SVG도 같은 시트로 그려진다(블록 펼침).
  assert.ok(writeSvg(s).includes("A-DOOR"));
});

test("대각선 벽: 미리 돌린 블록(rot 0, 이름에 방향), 문 호는 꺾은선", () => {
  const s = sheetOf("floor_plan-skew-wall");
  const ins = (s.views[0]?.prims ?? []).filter((p) => p.t === "insert");
  assert.deepEqual(ins.map((p) => (p.t === "insert" ? [p.block, p.rot_deg] : [])).sort(), [["DOOR-W900-T200-R-Dm5_4", 0], ["WIN-W1800-T200-Dm5_4", 0]]);
  const door = s.blocks.find((b) => b.name.startsWith("DOOR"));
  assert.ok(door?.entities.some((e) => e.t === "pline" && e.key === "swing" && e.pts.length === 7));
  assert.ok(writeDxf(s).text.includes("DOOR-W900-T200-R-Dm5_4"));
});

test("실명·면적 라벨: 면적 값 TEXT는 source_ref, 값 = layout 면적(㎡ 소수 둘째 자리), checks와 같다", () => {
  for (const c of CASES.filter((x) => !x.rejected)) {
    const s = sheetOf(c.id);
    const model = c.input().model;
    const rows = createLayoutState(model, "f1").rows;
    for (const row of rows) {
      const a = s.annotations.find((x) => x.anno_id === `label:room:${row.room_id}`);
      assert.ok(a, `${c.id} ${row.room_id}`);
      const value = a.prims.find((p) => p.t === "text" && p.s.endsWith("㎡"));
      assert.ok(value && value.t === "text");
      assert.equal(value.source_ref, `geometry.area.room:${row.room_id}`);
      assert.equal(value.s, `${(row.area_h100 / 100).toFixed(2)}㎡`);
      assert.equal(s.checks.area_table_m2[`room:${row.room_id}`], row.area_m2);
    }
    for (const a of s.annotations) for (const p of a.prims) if (p.t === "text" && /\d+\.\d\d/.test(p.s)) assert.ok(p.source_ref, `${a.anno_id} "${p.s}"`);
  }
});

test("벽: 외벽·내벽 띠는 A-WALL, 실 외곽은 A-AREA(중심선), 단층 한 실의 벽 띠 = 외벽 200 고리", () => {
  const s = sheetOf("floor_plan-single-room");
  const prims = s.views[0]?.prims ?? [];
  const pts = (key: string) => {
    const p = prims.find((x) => x.key === key);
    return p?.t === "pline" ? p.pts : null;
  };
  // 외곽 8×6m 중심선 ± 100mm: 바깥 고리(반시계)와 안쪽 구멍(시계).
  assert.deepEqual(pts("wall:000:o"), [[1_900, 1_900], [10_100, 1_900], [10_100, 8_100], [1_900, 8_100]]);
  assert.deepEqual(pts("wall:000:h001"), [[2_100, 2_100], [2_100, 7_900], [9_900, 7_900], [9_900, 2_100]]);
  assert.equal(prims.filter((p) => p.layer === "A-WALL" && p.t === "pline").length, 2);
  assert.ok(prims.some((p) => p.key === "wall:000:hatch" && p.t === "hatch"));
  assert.deepEqual(prims.filter((p) => p.layer === "A-AREA").map((p) => p.key), ["room:r1:o"]);
});

test("라벨 점은 실 안(ㄷ자·L자)", () => {
  assert.deepEqual(labelPoint(rect(0, 0, 4_000, 2_000)), [2_000, 1_000]);
  // ㄷ자: 상자 중심(3000, 3000)이 홈 안 → 가장 넓은 안쪽 구간 가운데.
  const u = { outer: [[0, 0], [6_000, 0], [6_000, 6_000], [4_000, 6_000], [4_000, 2_000], [2_000, 2_000], [2_000, 6_000], [0, 6_000]] as [number, number][] };
  const [x, y] = labelPoint(u);
  assert.equal(y, 3_000);
  assert.ok(x === 1_000 || x === 5_000);
});

test("floor_id 없음·실 배치 없는 층은 DraftingError", () => {
  const model = planModel([rect(0, 0, 5_000, 5_000)], { rooms: [], openings: [] });
  const input = planInput(model);
  assert.throws(() => buildFloorPlanView({ ...input, sheet: { ...input.sheet, floor_id: undefined } }), DraftingError);
  assert.throws(() => buildFloorPlanView({ ...input, sheet: { ...input.sheet, floor_id: "zz" } }), DraftingError);
  // 실이 없어도 외벽은 그린다.
  const { sheet } = buildSheet(input, buildFloorPlanView(input));
  assert.ok(sheet.views[0]?.prims.some((p) => p.layer === "A-WALL"));
});
