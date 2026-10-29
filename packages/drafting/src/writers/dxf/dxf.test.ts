// DXF 작성기 단위 테스트(AR-06-021). 골든 비교는 golden/_harness/golden.test.ts.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { buildSheet, DISCLAIMER, DraftingError, validateDraftingInput, type SheetModel } from "../../index.ts";
import { sampleInput, sampleModel, sampleView } from "../../sheet/test-fixtures.ts";
import { mtextChunks, mtextValue, num, textValue } from "./format.ts";
import { DXF_DEFAULT_JULIAN, julianDate, writeDxf } from "./index.ts";

function sheetOf(model = sampleModel(), over = {}): SheetModel {
  const v = validateDraftingInput(sampleInput(model, over));
  if (!v.ok) throw new Error(v.issues.join("; "));
  return buildSheet(v.input, sampleView(v.input.model)).sheet;
}

/** [그룹 코드, 값] 쌍. */
function pairs(text: string): Array<[number, string]> {
  const lines = text.split("\r\n");
  const out: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1] as string]);
  return out;
}

test("숫자: 지수 표기 없음, 소수 3자리 반올림(half-away), 끝 0 제거, -0 → 0", () => {
  assert.equal(num(-0), "0");
  assert.equal(num(1.23456), "1.235");
  assert.equal(num(-1.2345), "-1.235");
  assert.equal(num(2.5), "2.5");
  assert.equal(num(1e-7), "0");
  assert.equal(num(-1e-7), "0");
  assert.equal(num(123456789012), "123456789012");
  assert.throws(() => num(Number.NaN), DraftingError);
  assert.throws(() => num(1e21), DraftingError);
  fc.assert(
    fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (x) => {
      const s = num(x);
      assert.match(s, /^-?\d+(\.\d{1,3})?$/);
      assert.ok(!s.endsWith("0") || !s.includes("."));
    }),
  );
});

test("문자: TEXT 제어 문자 제거, MTEXT 이스케이프·\\P, 250자 조각은 이스케이프·서로게이트를 자르지 않는다", () => {
  assert.equal(textValue("a\tb\nc\u0007"), "a b c ");
  assert.equal(mtextValue("x{y}\\z\r\n둘째\n셋째"), "x\\{y\\}\\\\z\\P둘째\\P셋째");
  const s = "a".repeat(249) + "\\\\" + "b".repeat(10);
  const chunks = mtextChunks(s);
  assert.equal(chunks.join(""), s);
  assert.equal(chunks[0], "a".repeat(249));
  const emoji = "a".repeat(249) + "😀" + "c";
  assert.equal(mtextChunks(emoji)[0], "a".repeat(249));
  for (const c of mtextChunks("가".repeat(1000))) assert.ok(c.length <= 250);
});

test("형식: AC1027, 줄 끝 CRLF만, 섹션 순서, 모든 TEXT·MTEXT 문자 스타일 ARCH-KR, $INSUNITS=4", () => {
  const { text } = writeDxf(sheetOf());
  assert.ok(text.endsWith("  0\r\nEOF\r\n"));
  assert.equal(text.replace(/\r\n/g, "").includes("\n"), false);
  assert.equal(text.includes("\r\r"), false);
  const p = pairs(text);
  const sections = p.flatMap(([c, v], i) => (c === 0 && v === "SECTION" ? [p[i + 1]?.[1]] : []));
  assert.deepEqual(sections, ["HEADER", "CLASSES", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS"]);
  const hv = (name: string) => p[p.findIndex(([c, v]) => c === 9 && v === name) + 1]?.[1];
  assert.equal(hv("$ACADVER"), "AC1027");
  assert.equal(hv("$INSUNITS"), "4");
  assert.equal(hv("$TEXTSTYLE"), "ARCH-KR");
  let inText = false;
  let styled = 0;
  let texts = 0;
  for (const [c, v] of p) {
    if (c === 0) {
      inText = v === "TEXT" || v === "MTEXT";
      if (inText) texts++;
    } else if (inText && c === 7) {
      assert.equal(v, "ARCH-KR");
      styled++;
    }
  }
  assert.ok(texts > 0);
  assert.equal(styled, texts);
});

test("결정성: 같은 입력 두 번 → 같은 바이트, 시각만 다르면 $TDCREATE·$TDUPDATE 값 두 줄만 다르다", () => {
  const sheet = sheetOf(sampleModel({ masses: 4, rooms: 8 }));
  const a = writeDxf(sheet).text;
  assert.equal(writeDxf(structuredClone(sheet)).text, a);
  const b = writeDxf(sheet, { timestamps: { created: julianDate(1_793_000_000_000), updated: julianDate(1_793_000_500_000) } }).text;
  const la = a.split("\r\n");
  const lb = b.split("\r\n");
  assert.equal(lb.length, la.length);
  const diff = la.flatMap((l, i) => (l === lb[i] ? [] : [la[i - 2]]));
  assert.deepEqual(diff, ["$TDCREATE", "$TDUPDATE"]);
  assert.ok(a.includes(`$TDCREATE\r\n 40\r\n${DXF_DEFAULT_JULIAN}\r\n`));
});

test("결정성 속성: 무작위 대지·매스·실 수에서 두 번 생성 바이트 동일", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 5_000, max: 200_000 }),
      fc.integer({ min: 5_000, max: 150_000 }),
      fc.integer({ min: 1, max: 6 }),
      fc.integer({ min: 1, max: 10 }),
      (w, h, masses, rooms) => {
        const sheet = sheetOf(sampleModel({ w, h, masses, rooms }));
        assert.equal(writeDxf(structuredClone(sheet)).text, writeDxf(sheet).text);
      },
    ),
    { numRuns: 25 },
  );
});

test("핸들: 유일, $HANDSEED는 마지막 핸들 + 1", () => {
  const p = pairs(writeDxf(sheetOf()).text);
  const seedIdx = p.findIndex(([c, v]) => c === 9 && v === "$HANDSEED");
  const seed = parseInt(p[seedIdx + 1]?.[1] as string, 16);
  const handles = p.filter(([c], i) => (c === 5 || c === 105) && i !== seedIdx + 1).map(([, v]) => parseInt(v, 16));
  assert.equal(new Set(handles).size, handles.length);
  assert.equal(Math.max(...handles) + 1, seed);
});

test("좌표: 첫 뷰는 모델 mm 그대로, 용지 요소는 축척 분모배로 모델 공간에 놓인다", () => {
  const sheet = sheetOf();
  const { text } = writeDxf(sheet);
  const p = pairs(text);
  const k = sheet.scale / 100;
  const firstPt = (layer: string) => {
    const i = p.findIndex(([c, v], j) => c === 8 && v === layer && p[j - 4]?.[1] === "LWPOLYLINE");
    const j = p.findIndex(([c], n) => n > i && c === 10);
    return [Number(p[j]?.[1]), Number(p[j + 1]?.[1])];
  };
  assert.deepEqual(firstPt("A-SITE-BNDY"), [0, 0]); // 대지 (0,0)
  const frame = sheet.paper_prims.find((x) => x.key === "ttlb:frame");
  assert.ok(frame && frame.t === "pline");
  const o = sheet.views[0]?.origin as [number, number];
  const [fx, fy] = frame.pts[0] as [number, number];
  assert.deepEqual(firstPt("A-TTLB"), [(fx - o[0]) * k, (fy - o[1]) * k]);
});

test("한글 UTF-8: 고지·사무소명이 그대로, byte_length = UTF-8 바이트 수, too_large=false", () => {
  const r = writeDxf(sheetOf());
  assert.ok(r.text.includes(`\r\n  1\r\n${DISCLAIMER}\r\n`));
  assert.ok(r.text.includes("테스트건축"));
  assert.equal(r.byte_length, new TextEncoder().encode(r.text).length);
  assert.equal(r.too_large, false);
});

test("고지: 표제란 고지가 없으면 DISCLAIMER_MISSING(출력 직전 assertDisclaimer)", () => {
  const sheet = sheetOf();
  const broken = { ...sheet, paper_prims: sheet.paper_prims.filter((x) => !(x.t === "text" && x.s === DISCLAIMER)) };
  assert.throws(() => writeDxf(broken), (e: unknown) => e instanceof DraftingError && e.code === "DISCLAIMER_MISSING");
  const small = {
    ...sheet,
    paper_prims: sheet.paper_prims.map((x) => (x.t === "text" && x.s === DISCLAIMER ? { ...x, h: 100 } : x)),
  };
  assert.throws(() => writeDxf(small), (e: unknown) => e instanceof DraftingError && e.code === "DISCLAIMER_MISSING");
});

test("layer_map: 사무소 이름으로 레이어 표·엔티티를 바꾸고, 합친 이름은 한 번만, 잘못된 이름은 경고", () => {
  const sheet = sheetOf();
  const r = writeDxf(sheet, { layer_map: { "A-SITE-BNDY": "대지경계", "A-MASS": "BLDG", "A-WALL": "BLDG", "A-AREA": "a|b" } });
  const p = pairs(r.text);
  const layerNames = p.filter(([c], i) => c === 2 && p.slice(Math.max(0, i - 6), i).some(([cc, vv]) => cc === 100 && vv === "AcDbLayerTableRecord")).map(([, v]) => v);
  assert.equal(layerNames.filter((n) => n === "BLDG").length, 1);
  assert.ok(layerNames.includes("대지경계"));
  assert.ok(layerNames.includes("A-AREA"));
  assert.equal(layerNames.includes("A-SITE-BNDY"), false);
  assert.ok(p.some(([c, v]) => c === 8 && v === "대지경계"));
  assert.deepEqual(r.layer_warnings, [{ kind: "invalid_name", key: "A-AREA", name: "a|b" }]);
});

test("엔티티 부분집합만 쓴다(LINE·LWPOLYLINE·ARC·CIRCLE·TEXT·MTEXT·HATCH·INSERT)", () => {
  const p = pairs(writeDxf(sheetOf(sampleModel({ masses: 3, rooms: 5 }))).text);
  const start = p.findIndex(([c, v]) => c === 2 && v === "ENTITIES");
  const end = p.findIndex(([c, v], i) => i > start && c === 0 && v === "ENDSEC");
  const types = new Set(p.slice(start + 1, end).filter(([c]) => c === 0).map(([, v]) => v));
  for (const t of types) assert.ok(["LINE", "LWPOLYLINE", "ARC", "CIRCLE", "TEXT", "MTEXT", "HATCH", "INSERT"].includes(t), t);
});

test("없는 블록 INSERT·제어 문자 블록 이름은 INVALID_ARGUMENT", () => {
  const sheet = sheetOf();
  const view = sheet.views[0] as SheetModel["views"][number];
  const bad = { ...sheet, views: [{ ...view, prims: [...view.prims, { layer: "A-DOOR" as const, key: "zz", t: "insert" as const, block: "NONE", at: [0, 0] as [number, number], rot_deg: 0 as const }] }] };
  assert.throws(() => writeDxf(bad), (e: unknown) => e instanceof DraftingError && e.code === "INVALID_ARGUMENT");
  assert.throws(() => writeDxf({ ...sheet, blocks: [{ name: "A\nB", entities: [] }] }), DraftingError);
});

test("layer_map 제어 문자·대소문자 충돌: DXF 줄 구조가 유지되고 레이어 표에 대소문자 무시 중복이 없다", () => {
  const r = writeDxf(sheetOf(), { layer_map: { "A-SITE-BNDY": "대지\r\n  0\r\nEOF", "A-MASS": "Bldg", "A-WALL": "BLDG", "A-DOOR": "0" } });
  assert.equal(r.text.indexOf("\r\nEOF\r\n"), r.text.length - "\r\nEOF\r\n".length);
  const p = pairs(r.text);
  const names = p.filter(([c], i) => c === 2 && p.slice(Math.max(0, i - 6), i).some(([cc, vv]) => cc === 100 && vv === "AcDbLayerTableRecord")).map(([, v]) => v.toUpperCase());
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(r.layer_warnings.map((w) => `${w.kind}:${w.key}`), ["invalid_name:A-SITE-BNDY", "name_conflict:A-WALL", "name_conflict:A-DOOR"]);
});
