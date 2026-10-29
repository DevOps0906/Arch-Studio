// SVG 골든(AR-06-022): golden/writer-*/input.json(DXF 골든 입력, 읽기 전용 재사용) → writeSvg → golden/svg-*/sheet-<kind>.svg 원시 바이트 비교.
// 갱신 가드: golden/svg-tools/manifest.json(SVG_WRITER_VERSION + sha256 목록). 갱신: node golden/svg-tools/update.ts(버전을 올렸을 때만).
// package.json test 글롭이 src/**/*.test.ts라 골든 비교 테스트를 여기에 둔다(하네스 코드는 golden/svg-tools).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 골든 해시
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { CASES } from "../../../golden/_harness/cases.ts";
import type { GoldenInput } from "../../../golden/_harness/harness.ts";
import { GOLDEN, SVG_MANIFEST, svgCaseId, svgGoldenFiles, svgName, type SvgGoldenManifest, type SvgGoldenMeta } from "../../../golden/svg-tools/harness.ts";
import { DISCLAIMER } from "../../index.ts";
import { SVG_WRITER_VERSION, writeSvg } from "./index.ts";

const raw = (id: string, name: string) => readFileSync(new URL(`${id}/${name}`, GOLDEN));
const read = (id: string, name: string) => raw(id, name).toString("utf8");
const dirs = readdirSync(GOLDEN)
  .filter((d) => d.startsWith("svg-") && d !== "svg-tools" && existsSync(new URL(`${d}/meta.json`, GOLDEN)))
  .sort();

test("SVG 골든 20건 이상, DXF 골든 케이스와 1:1", () => {
  assert.ok(dirs.length >= 20, `SVG 골든 ${dirs.length}건`);
  assert.deepEqual(dirs, CASES.map((c) => svgCaseId(c.id)).sort());
});

for (const id of dirs) {
  test(`SVG 골든 ${id}`, () => {
    const meta = JSON.parse(read(id, "meta.json")) as SvgGoldenMeta;
    assert.equal(meta.writer_version, SVG_WRITER_VERSION, "SVG_WRITER_VERSION을 올렸으면 golden/svg-tools/update.ts로 다시 만든다");
    const input = JSON.parse(read(meta.source_case, "input.json")) as GoldenInput;
    const first = writeSvg(input.sheet);
    assert.equal(writeSvg(structuredClone(input.sheet)), first, "같은 입력 다른 바이트");
    assert.ok(Buffer.from(first, "utf8").equals(raw(id, svgName(input.sheet))), "SVG 골든 바이트 불일치(의도한 변경이면 버전 올림 + update.ts)");
    assert.ok(first.includes(DISCLAIMER), "고지 문구");
  });
}

test("SVG 골든 meta가 cases.ts 정의와 같다", () => {
  for (const c of CASES) assert.equal(read(svgCaseId(c.id), "meta.json"), svgGoldenFiles(c)["meta.json"], c.id);
});

test("SVG manifest: writer_version = SVG_WRITER_VERSION, 골든 sha256이 manifest와 같다", () => {
  const m = JSON.parse(readFileSync(SVG_MANIFEST, "utf8")) as SvgGoldenManifest;
  assert.equal(m.writer_version, SVG_WRITER_VERSION);
  const actual: Record<string, string> = {};
  for (const id of dirs) {
    for (const f of readdirSync(new URL(`${id}/`, GOLDEN)).filter((n) => n.endsWith(".svg")).sort()) {
      actual[`${id}/${f}`] = createHash("sha256").update(raw(id, f)).digest("hex");
    }
  }
  assert.deepEqual(actual, m.sha256, "골든 SVG가 바뀌었는데 SVG_WRITER_VERSION이 그대로다");
});

test("layer_map은 SVG에 적용하지 않는다: layer_map 케이스 SVG = 기본 케이스 SVG", () => {
  const basic = read("svg-site-a3-basic", "sheet-site_plan.svg");
  for (const id of ["svg-layer-map-rename", "svg-layer-map-merge-invalid", "svg-layer-map-control-chars", "svg-font-timestamps"]) {
    assert.equal(read(id, "sheet-site_plan.svg"), basic, id);
  }
});

test("골든 SVG는 LF, CR 없음", () => {
  for (const id of dirs) {
    for (const f of readdirSync(new URL(`${id}/`, GOLDEN)).filter((n) => n.endsWith(".svg"))) {
      const t = read(id, f);
      assert.ok(t.endsWith("</svg>\n") && !t.includes("\r"), `${id}/${f}`);
    }
  }
});
