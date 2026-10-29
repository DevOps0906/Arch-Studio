// DXF 골든(AR-06-021): input.json(SheetModel + 옵션) → writeDxf → sheet-<kind>.dxf 원시 바이트 비교(CRLF 포함, 줄 끝 정규화 없음).
// 갱신 가드: manifest.json(DXF_WRITER_VERSION + DXF sha256 목록)과 골든 해시가 다르면 실패 — meta.json만 믿지 않는다.
// 갱신: pnpm --filter @arch-studio/drafting golden:update — DXF_WRITER_VERSION을 올렸을 때만 덮어쓴다(update.ts). 이유는 커밋 본문에.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 골든 해시
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { DISCLAIMER } from "../../src/index.ts";
import { DXF_WRITER_VERSION, writeDxf } from "../../src/writers/dxf/index.ts";
import { CASES } from "./cases.ts";
import { dxfName, GOLDEN, goldenFiles, MANIFEST, maskTimestamps, type GoldenInput, type GoldenManifest, type GoldenMeta } from "./harness.ts";

const raw = (id: string, name: string) => readFileSync(new URL(`${id}/${name}`, GOLDEN));
const read = (id: string, name: string) => raw(id, name).toString("utf8");
const dirs = readdirSync(GOLDEN)
  .filter((d) => d.startsWith("writer-") && existsSync(new URL(`${d}/input.json`, GOLDEN)))
  .sort();

test("골든 20건 이상, cases.ts와 디렉터리가 1:1", () => {
  assert.ok(dirs.length >= 20, `골든 ${dirs.length}건`);
  assert.deepEqual(dirs, CASES.map((c) => c.id).sort());
});

for (const id of dirs) {
  test(`골든 ${id}`, () => {
    const meta = JSON.parse(read(id, "meta.json")) as GoldenMeta;
    assert.equal(meta.writer_version, DXF_WRITER_VERSION, "DXF_WRITER_VERSION을 올렸으면 golden:update로 골든을 다시 만든다");
    const input = JSON.parse(read(id, "input.json")) as GoldenInput;
    const first = writeDxf(input.sheet, input.options).text;
    assert.equal(writeDxf(structuredClone(input.sheet), structuredClone(input.options)).text, first, "같은 입력 다른 바이트");
    const golden = raw(id, dxfName(input.sheet));
    assert.ok(Buffer.from(first, "utf8").equals(golden), "골든 바이트 불일치(의도한 변경이면 버전 올림 + golden:update)");
    assert.equal(maskTimestamps(first), maskTimestamps(golden.toString("utf8")));
    assert.ok(first.includes(DISCLAIMER), "고지 문구");
  });
}

test("골든 입력이 cases.ts 정의와 같다(케이스·시트 모델이 바뀌면 버전 올림 + golden:update)", () => {
  for (const c of CASES) {
    const files = goldenFiles(c);
    assert.equal(read(c.id, "input.json"), files["input.json"], c.id);
    assert.equal(read(c.id, "meta.json"), files["meta.json"], c.id);
  }
});

test("시각 가리기: $TDCREATE·$TDUPDATE 값 줄만 바뀐다", () => {
  const input = JSON.parse(read("writer-font-timestamps", "input.json")) as GoldenInput;
  const a = writeDxf(input.sheet, input.options).text;
  const b = writeDxf(input.sheet, { ...input.options, timestamps: { created: 2470000.125, updated: 2470001 } }).text;
  assert.notEqual(a, b);
  assert.equal(maskTimestamps(a), maskTimestamps(b));
});

test("manifest: writer_version = DXF_WRITER_VERSION, 골든 DXF sha256이 manifest와 같다(버전 그대로 해시 변경 금지)", () => {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as GoldenManifest;
  assert.equal(m.writer_version, DXF_WRITER_VERSION, "DXF_WRITER_VERSION을 올렸으면 golden:update로 manifest·골든을 다시 만든다");
  const actual: Record<string, string> = {};
  for (const id of dirs) {
    for (const f of readdirSync(new URL(`${id}/`, GOLDEN)).filter((n) => n.endsWith(".dxf")).sort()) {
      actual[`${id}/${f}`] = createHash("sha256").update(raw(id, f)).digest("hex");
    }
  }
  assert.deepEqual(actual, m.sha256, "골든 DXF가 바뀌었는데 DXF_WRITER_VERSION이 그대로다");
});

test("골든 DXF는 CRLF 원시 바이트로 저장돼 있다(.gitattributes -text)", () => {
  for (const id of dirs) {
    const input = JSON.parse(read(id, "input.json")) as GoldenInput;
    const t = read(id, dxfName(input.sheet));
    assert.ok(t.endsWith("EOF\r\n") && !/(^|[^\r])\n/.test(t), id);
  }
});
