// SVG 작성기·장면 단위 테스트(AR-06-022). 골든 비교는 golden.test.ts.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { STD_LAYERS } from "@arch-studio/domain";
import { CASES } from "../../../golden/_harness/cases.ts";
import { buildSheet, DISCLAIMER, DraftingError, validateDraftingInput, type Prim, type SheetModel } from "../../index.ts";
import { sampleInput, sampleModel, sampleView } from "../../sheet/test-fixtures.ts";
import { writeDxf } from "../dxf/index.ts";
import { cleanLine, fmt, xmlEscape } from "./format.ts";
import { ansi31, approxEm, buildScene, DEFAULT_SVG_FONT_FAMILY, wrapLine, writeSvg, type Pt } from "./index.ts";
import { approxEm as approxEmDirect } from "./scene.ts";

function sheetOf(model = sampleModel(), over = {}): SheetModel {
  const v = validateDraftingInput(sampleInput(model, over));
  if (!v.ok) throw new Error(v.issues.join("; "));
  return buildSheet(v.input, sampleView(v.input.model)).sheet;
}
/** 객체 키 순서를 깊게 뒤집은 복제(작성기가 키 순서에 의존하지 않는지). */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const caseSheet =(id: string) => (CASES.find((c) => c.id === id) as (typeof CASES)[number]).build().sheet;

/** <g id="..."> 순서대로 [레이어, 본문]. */
function groups(svg: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /<g id="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/g>)/g;
  for (let m = re.exec(svg); m !== null; m = re.exec(svg)) out.push([m[1] as string, m[3] ?? ""]);
  return out;
}

test("숫자: 지수 표기 없음, 소수 3자리 반올림(half-away), 끝 0 제거, -0 → 0", () => {
  assert.equal(fmt(-0), "0");
  assert.equal(fmt(1.2345), "1.235");
  assert.equal(fmt(-1.2345), "-1.235");
  assert.equal(fmt(1e-7), "0");
  assert.throws(() => fmt(Number.NaN), DraftingError);
  assert.throws(() => fmt(1e21), DraftingError);
  fc.assert(fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (x) => /^-?\d+(\.\d{1,3})?$/.test(fmt(x))));
});

test("문자 정리: 제어 문자 → 공백, 짝 없는 서로게이트 → U+FFFD, XML 이스케이프", () => {
  assert.equal(cleanLine("a\tb\u0000c"), "a b c");
  assert.equal(cleanLine("x\ud800y\udc00z"), "x�y�z");
  assert.equal(cleanLine("😀"), "😀");
  assert.equal(xmlEscape(`<a & "b" 'c'>`), "&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
});

test("결정성: 같은 입력 → 같은 바이트(복제 입력·다른 키 순서 포함)", () => {
  for (const c of CASES) {
    const { sheet } = c.build();
    const a = writeSvg(sheet);
    assert.equal(writeSvg(structuredClone(sheet)), a, c.id);
    const shuffled = reverseKeys(sheet) as SheetModel;
    assert.equal(writeSvg(shuffled), a, c.id);
  }
});

test("표준 레이어 16개가 표 순서대로 <g id>, 다른 그룹 없음", () => {
  const svg = writeSvg(sheetOf());
  assert.deepEqual(
    groups(svg).map(([id]) => id),
    [...STD_LAYERS],
  );
  assert.equal((svg.match(/<g /g) ?? []).length, 16);
});

test("루트: 용지 mm 크기·viewBox(모델 mm)·font-family 이름만, 글꼴 파일·외부 참조 없음", () => {
  const s = sheetOf();
  const svg = writeSvg(s);
  const k = s.scale / 100;
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${s.paper.w / 100}mm" height="${s.paper.h / 100}mm" viewBox="0 0 ${s.paper.w * k} ${s.paper.h * k}"`));
  assert.ok(svg.includes(`font-family="${xmlEscape(DEFAULT_SVG_FONT_FAMILY)}"`));
  assert.ok(!/@font-face|<style|href=|url\(|<image|<script|<use/.test(svg));
  assert.ok(svg.includes(DISCLAIMER));
  assert.ok(svg.endsWith("</svg>\n"));
  const fam = writeSvg(s, { font_family: "Noto Sans KR" });
  assert.ok(fam.includes(`font-family="Noto Sans KR"`));
  assert.throws(() => writeSvg(s, { font_family: `a"><script>` }), DraftingError);
  assert.throws(() => writeSvg(s, { font_family: " " }), DraftingError);
});

test("태그 균형·속성 따옴표: 모든 골든 케이스에서 <text>·<g> 열림/닫힘 수가 같고 이스케이프 안 된 & 없음", () => {
  for (const c of CASES) {
    const svg = writeSvg(c.build().sheet);
    for (const tag of ["text", "g", "svg", "title"]) {
      const open = (svg.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
      const selfClose = (svg.match(new RegExp(`<${tag} [^>]*/>`, "g")) ?? []).length;
      const close = (svg.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(open - selfClose, close, `${c.id} ${tag}`);
    }
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(svg), c.id);
    assert.ok(!/[\u0000-\u0009\u000b-\u001f￾￿]/.test(svg), c.id);
  }
});

test("고지 없는 시트 → DISCLAIMER_MISSING", () => {
  const s = sheetOf();
  s.paper_prims = s.paper_prims.filter((p) => !(p.t === "text" && p.s === DISCLAIMER));
  assert.throws(() => writeSvg(s), (e: unknown) => e instanceof DraftingError && e.code === "DISCLAIMER_MISSING");
});

test("좌표 규약이 DXF와 같다: 모든 LINE이 평행 이동(첫 뷰 원점 × k) + y 뒤집기로 일치", () => {
  for (const id of ["writer-site-a3-basic", "writer-multi-view", "writer-negative-coords", "writer-scale-600-large-site", "writer-text-align"]) {
    const s = caseSheet(id);
    const k = s.scale / 100;
    const ref = s.views[0]?.origin ?? [0, 0];
    const H = s.paper.h * k;
    const dxf = writeDxf(s).text.split("\r\n");
    const fromDxf: string[] = [];
    for (let i = 0; i < dxf.length; i++) {
      if (dxf[i] === "  0" && dxf[i + 1] === "LINE") {
        const g: Record<string, string> = {};
        for (let j = i + 2; dxf[j] !== "  0"; j += 2) g[(dxf[j] as string).trim()] = dxf[j + 1] as string;
        const x = (v: string, o: number) => fmt(Number(v) + o);
        const y = (v: string) => fmt(H - (Number(v) + (ref[1] as number) * k));
        fromDxf.push(`${g["8"]} ${x(g["10"] as string, (ref[0] as number) * k)} ${y(g["20"] as string)} ${x(g["11"] as string, (ref[0] as number) * k)} ${y(g["21"] as string)}`);
      }
    }
    const fromSvg: string[] = [];
    for (const [layer, body] of groups(writeSvg(s))) {
      for (const m of body.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"\/>/g)) fromSvg.push(`${layer} ${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
    }
    assert.ok(fromDxf.length > 5, id);
    assert.deepEqual(fromSvg, fromDxf, id);
  }
});

test("용지 요소는 × k, 뷰 요소는 + 뷰 원점 × k (y 뒤집기)", () => {
  const s = sheetOf();
  const k = s.scale / 100;
  const H = s.paper.h * k;
  const o = s.views[0]?.origin as [number, number];
  s.paper_prims.push({ layer: "A-ANNO-NRTH", key: "zz:p", t: "line", a: [1000, 2000], b: [3000, 2000] });
  (s.views[0] as SheetModel["views"][number]).prims.push({ layer: "A-ANNO-NRTH", key: "zz:v", t: "line", a: [0, 0], b: [500, 0] });
  const body = groups(writeSvg(s)).find(([l]) => l === "A-ANNO-NRTH")?.[1] ?? "";
  assert.ok(body.includes(`<line x1="${o[0] * k}" y1="${H - o[1] * k}" x2="${o[0] * k + 500}" y2="${H - o[1] * k}"/>`), body);
  assert.ok(body.includes(`<line x1="${1000 * k}" y1="${H - 2000 * k}" x2="${3000 * k}" y2="${H - 2000 * k}"/>`), body);
});

test("INSERT 펼침: 회전 0·90·180·270이 블록 정의를 정수 회전, 자기 레이어 그룹에 들어간다", () => {
  const s = caseSheet("writer-blocks-inserts");
  const sc = buildScene(s);
  const door = sc.layers.find((l) => l.layer === "A-DOOR")?.items ?? [];
  const k = s.scale / 100;
  const o = s.views[0]?.origin as [number, number];
  const at = (x: number, y: number): Pt => [x + o[0] * k, y + o[1] * k];
  const lines = door.filter((i) => i.t === "line");
  const arcs = door.filter((i) => i.t === "arc");
  assert.equal(lines.length, 3);
  assert.equal(arcs.length, 3);
  // door:1 rot 0 at (3000,2000): leaf (0,0)-(0,900)
  assert.deepEqual(lines[0], { t: "line", a: at(3000, 2000), b: at(3000, 2900) });
  // door:2 rot 90 at (6000,2000): (0,900) → (-900,0)
  assert.deepEqual(lines[1], { t: "line", a: at(6000, 2000), b: at(5100, 2000) });
  // door:3 rot 180: (0,900) → (0,-900), 호 0..90 → 180..270
  assert.deepEqual(lines[2], { t: "line", a: at(9000, 2000), b: at(9000, 1100) });
  assert.deepEqual(arcs.map((a) => (a.t === "arc" ? [a.a0, a.a1] : [])), [[0, 90], [90, 180], [180, 270]]);
  // 창(A-GLAZ) rot 270
  const glaz = sc.layers.find((l) => l.layer === "A-GLAZ")?.items ?? [];
  assert.equal(glaz.length, 2);
});

test("블록 순환·없는 블록·없는 뷰 → INVALID_ARGUMENT", () => {
  const s = caseSheet("writer-blocks-inserts");
  const bad = structuredClone(s);
  bad.blocks.push({ name: "LOOP", entities: [{ layer: "A-DOOR", key: "self", t: "insert", block: "LOOP", at: [0, 0], rot_deg: 0 }] });
  (bad.views[0] as SheetModel["views"][number]).prims.push({ layer: "A-DOOR", key: "zz", t: "insert", block: "LOOP", at: [0, 0], rot_deg: 0 });
  assert.throws(() => writeSvg(bad), (e: unknown) => e instanceof DraftingError && /순환/.test(e.message));
  const missing = structuredClone(s);
  (missing.views[0] as SheetModel["views"][number]).prims.push({ layer: "A-DOOR", key: "zz", t: "insert", block: "NOPE", at: [0, 0], rot_deg: 0 });
  assert.throws(() => writeSvg(missing), DraftingError);
  const noView = structuredClone(s);
  noView.annotations.push({ anno_id: "zz", kind: "note", view_id: "ghost", prims: [], overridable: [] });
  assert.throws(() => writeSvg(noView), DraftingError);
});

test("호: 반시계 → sweep 0, 180° 넘으면 large-arc 1, 시작 = 끝이면 원 전체", () => {
  const s = sheetOf();
  const v = s.views[0] as SheetModel["views"][number];
  const add = (key: string, a0: number, a1: number) => v.prims.push({ layer: "A-ENVL", key, t: "arc", c: [1000, 1000], r: 500, a0, a1 } as Prim<number>);
  add("a", 0, 90);
  add("b", 0, 270);
  add("c", 45, 45);
  const body = groups(writeSvg(s)).find(([l]) => l === "A-ENVL")?.[1] ?? "";
  const ds = [...body.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1] as string);
  assert.equal(ds.length, 3);
  assert.match(ds[0] as string, / A500 500 0 0 0 /);
  assert.match(ds[1] as string, / A500 500 0 1 0 /);
  assert.equal((ds[2]?.match(/A500/g) ?? []).length, 2);
});

test("문자: 정렬 l·c·r → text-anchor, 높이 × 1.25 = font-size, 한글·특수문자 그대로", () => {
  const svg = writeSvg(caseSheet("writer-text-align"));
  assert.match(svg, /<text [^>]*text-anchor="middle"[^>]*>가운데 정렬<\/text>/);
  assert.match(svg, /<text [^>]*text-anchor="end"[^>]*>오른쪽 정렬<\/text>/);
  const k = caseSheet("writer-text-align").scale / 100;
  assert.ok(svg.includes(`font-size="${fmt(300 * k * 1.25)}"`));
  const kr = writeSvg(caseSheet("writer-korean-long-names"));
  assert.ok(kr.includes("자녀방 1 × 2 — 남향 ㎡"));
  assert.ok(kr.includes("다용도실 세탁 50%"), "탭 → 공백");
});

test("MTEXT: 명시 줄바꿈 + 폭 줄바꿈(tspan), 이스케이프·제어 문자 정리", () => {
  const svg = writeSvg(caseSheet("writer-mtext-escapes"));
  const m = svg.match(/<text font-size="[^"]+"[^>]*>(<tspan[\s\S]*?)<\/text>/);
  assert.ok(m, "MTEXT");
  const spans = [...(m?.[1] as string).matchAll(/<tspan x="[^"]+" y="([^"]+)">([^<]*)<\/tspan>/g)];
  assert.ok(spans.length > 3, `${spans.length}줄`);
  assert.equal(spans[0]?.[2], "메모 {중괄호} 와 역슬래시 \\P 그대로");
  assert.equal(spans[1]?.[2], "둘째 줄 벨");
  const ys = spans.map((s) => Number(s[1]));
  for (let i = 1; i < ys.length; i++) assert.ok((ys[i] as number) > (ys[i - 1] as number));
});

test("wrapLine: 폭 안에 들어가고, 이어 붙이면 원문(나눈 자리 공백 1개 제외)", () => {
  assert.deepEqual(wrapLine("가나다 라마", 0, 10), ["가나다 라마"]);
  assert.deepEqual(wrapLine("", 10, 10), [""]);
  assert.deepEqual(wrapLine("가나다 라마", 35, 10), ["가나다", "라마"]);
  assert.deepEqual(wrapLine("가나다라마", 25, 10), ["가나", "다라", "마"]);
  assert.equal(approxEm(0x41), 0.55);
  assert.equal(approxEmDirect(0xac00), 1);
  fc.assert(
    fc.property(fc.array(fc.constantFrom("가", "a", " ", "1", "㎡"), { maxLength: 60 }), fc.integer({ min: 5, max: 200 }), (chars, maxW) => {
      const line = chars.join("");
      const out = wrapLine(line, maxW, 10);
      for (const l of out) {
        let w = 0;
        for (const ch of l) w += approxEm(ch.codePointAt(0) as number) * 10;
        assert.ok(w <= maxW || [...l].length === 1 || out.length === 1, JSON.stringify({ line, out, maxW }));
      }
      assert.equal(out.join("").replace(/ /g, ""), line.replace(/ /g, ""));
    }),
  );
});

test("ANSI31: 45° 조각이 경계 상자 안, 간격 = 3.175mm × 분모, 구멍 안에는 선 없음", () => {
  const sq: Pt[] = [[0, 0], [10_000, 0], [10_000, 10_000], [0, 10_000]];
  const hole: Pt[] = [[4_000, 4_000], [6_000, 4_000], [6_000, 6_000], [4_000, 6_000]];
  const d = 3.175 * 100;
  const segs = ansi31([sq, hole], [0, 0], d);
  assert.ok(segs.length > 50);
  for (const [a, b] of segs) {
    assert.ok(Math.abs(b[0] - a[0] - (b[1] - a[1])) < 1e-6, "45°");
    for (const p of [a, b]) assert.ok(p[0] >= -1e-6 && p[0] <= 10_000 + 1e-6 && p[1] >= -1e-6 && p[1] <= 10_000 + 1e-6);
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    assert.ok(!(mx > 4_000 && mx < 6_000 && my > 4_000 && my < 6_000), "구멍 안 조각");
    const t = (-(a[0]) + a[1]) * Math.SQRT1_2;
    assert.ok(Math.abs(t / d - Math.round(t / d)) < 1e-6, "간격");
  }
  assert.deepEqual(ansi31([], [0, 0], d), []);
  assert.throws(() => ansi31([sq], [0, 0], 0.01), DraftingError);
  const svg = writeSvg(caseSheet("writer-hatch-ansi31"));
  assert.match(svg, /<path d="M[^"]+" stroke-width="[^"]+" stroke-dasharray="none"\/>/);
  const solid = writeSvg(caseSheet("writer-hatch-solid-holes"));
  assert.match(solid, /fill-rule="evenodd"/);
  assert.equal((solid.match(/ Z/g) ?? []).length >= 3, true);
});
