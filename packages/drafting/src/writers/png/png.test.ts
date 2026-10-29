// PNG 작성기 테스트(AR-06-022). resvg-js 2.6.2 + 번들 Noto Sans KR. 골든은 golden/png-*(3건).
// 비교: 같은 환경이면 바이트까지 같아야 한다. 다른 플랫폼에서는 바이트 동일을 약속하지 않으므로 디코드한 픽셀 허용오차로 대신한다(README.md).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 골든 해시
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 골든 파일 읽기
import { readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { Resvg } from "@resvg/resvg-js";
import { decodePng, GOLDEN, pngCaseId, PNG_CASES, readGolden, renderCase, sha256, type PngGoldenMeta } from "../../../golden/png-tools/harness.ts";
import { OutputError } from "../pdf/errors.ts";
import { bundledFontPath } from "../pdf/node.ts";
import { BUNDLED_FONT_FILE } from "../pdf/bundled.ts";
import { PNG_WRITER_VERSION, writePng } from "./index.ts";
import { sheetOf } from "../../../golden/png-tools/harness.ts";

const sha = (u8: Uint8Array) => createHash("sha256").update(u8).digest("hex");

test("PNG 골든은 3건 이내이고 케이스 정의와 같다", () => {
  const dirs = readdirSync(GOLDEN).filter((d) => d.startsWith("png-") && d !== "png-tools").sort();
  assert.ok(dirs.length >= 1 && dirs.length <= 3, `${dirs.length}건`);
  assert.deepEqual(dirs, PNG_CASES.map((c) => pngCaseId(c.source)).sort());
});

for (const c of PNG_CASES) {
  const id = pngCaseId(c.source);
  test(`PNG 골든 ${id}: 같은 입력 2회 바이트 동일, 골든과 같은 그림(바이트 또는 픽셀 허용오차)`, () => {
    const meta = JSON.parse(readFileSync(new URL(`${id}/meta.json`, GOLDEN), "utf8")) as PngGoldenMeta;
    assert.equal(meta.writer_version, PNG_WRITER_VERSION, "PNG_WRITER_VERSION을 올렸으면 golden/png-tools/update.ts --force");
    const { svg, r } = renderCase(c.source, c.width_px);
    const again = renderCase(c.source, c.width_px).r;
    assert.equal(sha(r.bytes), sha(again.bytes), "같은 환경 2회 바이트 동일");
    assert.equal(svg, Buffer.from(readGolden(id, "input.svg")).toString("utf8"), "input.svg(writeSvg 결과) 불일치");
    assert.deepEqual([r.width_px, r.height_px], [meta.width_px, meta.height_px]);
    assert.deepEqual(r.warnings, []);
    const want = readGolden(id, "expected.png");
    assert.equal(sha256(want), meta.png_sha256, "expected.png가 meta와 다름");
    if (sha256(r.bytes) === meta.png_sha256) return; // 같은 환경: 바이트 동일
    const a = decodePng(r.bytes);
    const b = decodePng(want);
    assert.deepEqual([a.width, a.height], [b.width, b.height]);
    let bad = 0;
    for (let i = 0; i < a.rgba.length; i++) if (Math.abs((a.rgba[i] as number) - (b.rgba[i] as number)) > 3) bad++;
    assert.ok(bad / a.rgba.length < 0.001, `픽셀 차이 ${bad}/${a.rgba.length}`);
  });
}

test("PNG 구조: IHDR·pHYs(선택)·IDAT·IEND만 — 시각·경로 등 메타데이터 청크 없음, 흰 배경", () => {
  const { r } = renderCase("writer-site-a3-basic", 420);
  const b = Buffer.from(r.bytes);
  const types: string[] = [];
  for (let i = 8; i < b.length; ) {
    types.push(b.toString("latin1", i + 4, i + 8));
    i += 12 + b.readUInt32BE(i);
  }
  const allowed = new Set(["IHDR", "pHYs", "IDAT", "IEND"]);
  assert.ok(types.every((t) => allowed.has(t)), types.join(","));
  assert.equal(types[0], "IHDR");
  assert.equal(types[types.length - 1], "IEND");
  const d = decodePng(r.bytes);
  assert.deepEqual([d.rgba[0], d.rgba[1], d.rgba[2], d.rgba[3]], [255, 255, 255, 255], "모서리는 흰 배경");
});

test("크기: dpi·width_px 옵션(A3 420mm @50dpi = 827px), 잘못된 값은 INVALID_ARGUMENT", () => {
  const s = sheetOf("writer-site-a3-basic");
  const r = writePng(s, { dpi: 50 });
  assert.equal(r.width_px, 827);
  assert.ok(Math.abs(r.height_px - 585) <= 1, String(r.height_px));
  assert.throws(() => writePng(s, { dpi: 5 }), /dpi/);
  assert.throws(() => writePng(s, { width_px: 0 }), /width_px/);
  assert.throws(() => writePng(s, { width_px: 100000 }), /너무 큽니다/);
});

test("한글 렌더: 번들 글꼴로 '가나다'가 그려지고 두부(.notdef)·빈칸이 아니다(시스템 글꼴 미사용)", () => {
  const font = bundledFontPath(BUNDLED_FONT_FILE);
  const draw = (ch: string, fam: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="50"><rect width="120" height="50" fill="#fff"/><text x="4" y="38" font-family="${fam}" font-size="34">${ch}</text></svg>`;
    const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [font], defaultFontFamily: "Noto Sans KR" }, fitTo: { mode: "original" } });
    return new Uint8Array(r.render().pixels);
  };
  const ink = (p: Uint8Array) => p.reduce((n, v, i) => (i % 4 === 0 && v < 128 ? n + 1 : n), 0);
  const hangul = draw("가나다", "'Noto Sans KR'");
  const notdef = draw("一二三", "'Noto Sans KR'"); // 부분 집합 밖 → .notdef 상자
  const none = draw("가나다", "'No Such Font'"); // 없는 family → defaultFontFamily(번들)로 대체
  assert.ok(ink(hangul) > 300, `한글 잉크 ${ink(hangul)}`);
  assert.notEqual(sha(hangul), sha(notdef), "한글이 .notdef 상자와 같으면 두부");
  assert.equal(sha(none), sha(hangul), "없는 family는 번들 글꼴로 대체(시스템 글꼴 아님)");
  // 시스템 글꼴을 켜면 번들 글꼴과 다른 결과가 나올 수 있다 = 번들 고정이 필요한 이유(시스템 글꼴은 PC마다 다름).
  const sysOff = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text x="2" y="30" font-size="30">가</text></svg>`, { font: { loadSystemFonts: false } });
  const alpha = new Uint8Array(sysOff.render().pixels).reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0);
  assert.equal(alpha, 0, "글꼴 없이 시스템 글꼴 끔 → 아무 것도 그리지 않음(조용한 대체 없음)");
});

test("부분 집합 밖 글자는 AR057 경고로 알린다(한자)", () => {
  const s = structuredClone(sheetOf("writer-site-a3-basic"));
  s.paper_prims.push({ layer: "A-ANNO-TEXT", key: "t:hanja", t: "text", at: [1000, 1000], h: 250, s: "一", align: "l" });
  const r = writePng(s, { width_px: 300 });
  assert.ok(r.warnings.some((w) => w.code === "AR057" && w.detail.includes("1종")), JSON.stringify(r.warnings));
});

test("글꼴 파일이 없으면 OutputError(font_unavailable)", () => {
  assert.throws(
    () => writePng(sheetOf("writer-site-a3-basic"), { width_px: 300, font_file: "/no/such/font.ttf" }),
    (e: unknown) => e instanceof OutputError && e.user_code === "AR056" && e.failure === "font_unavailable",
  );
});

test("패키지 루트는 resvg를 끌어오지 않는다: src/index.ts가 ./writers/png/index.ts를 가져오지 않고 package.json에 ./writers/png export가 있다", () => {
  const root = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
  assert.ok(!/writers\/png\/index\.ts/.test(root) && !/resvg/.test(root.replace(/\/\/.*$/gm, "")), "루트가 PNG 구현을 import");
  assert.ok(/writers\/png\/types\.ts/.test(root));
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; dependencies: Record<string, string> };
  assert.equal(pkg.exports["./writers/png"], "./src/writers/png/index.ts");
  assert.equal(pkg.dependencies["@resvg/resvg-js"], "2.6.2", "정확한 버전 고정");
  assert.ok(!("sharp" in pkg.dependencies));
});
