// 게시 파일 검사: manifest 해시 = public/samples 파일, 생성 스크립트 결정성(두 번 생성 → 바이트 동일, 게시 파일과도 동일).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SAMPLE_IDS, sampleFileName } from "./catalog.ts";
import { parseManifest } from "./manifest.ts";

const PUBLIC = fileURLToPath(new URL("../../../public/samples/", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../../../../../scripts/samples/build.ts", import.meta.url));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("manifest 해시·크기가 public/samples 파일과 일치하고 3건이 모두 있다", () => {
  const m = parseManifest(readFileSync(path.join(PUBLIC, "manifest.json"), "utf8"));
  assert.deepEqual(m.samples.map((s) => s.id).sort(), [...SAMPLE_IDS].sort());
  for (const s of m.samples) {
    assert.equal(s.file, sampleFileName(s.id, "dxf"));
    const bytes = readFileSync(path.join(PUBLIC, s.file));
    assert.equal(sha(bytes), s.sha256, `${s.file} sha256`);
    assert.equal(bytes.length, s.bytes, `${s.file} bytes`);
    assert.ok(bytes.toString("utf8").startsWith("  0\r\nSECTION") || bytes.toString("utf8").includes("AC1027"), `${s.file} DXF 헤더`);
  }
  // manifest 에 없는 DXF 가 섞여 있지 않다(손으로 만든 파일 금지).
  const dxf = readdirSync(PUBLIC).filter((f) => f.endsWith(".dxf")).sort();
  assert.deepEqual(dxf, m.samples.map((s) => s.file).sort());
});

test("생성 스크립트는 결정적이고 게시 파일과 바이트가 같다", () => {
  const dirs = [mkdtempSync(path.join(tmpdir(), "samples-a-")), mkdtempSync(path.join(tmpdir(), "samples-b-"))];
  try {
    for (const d of dirs) execFileSync(process.execPath, [SCRIPT, "--out", d], { stdio: "pipe" });
    const [a, b] = dirs as [string, string];
    const names = readdirSync(a).sort();
    assert.deepEqual(names, readdirSync(b).sort());
    assert.deepEqual(names, readdirSync(PUBLIC).filter((f) => f.endsWith(".dxf") || f === "manifest.json").sort());
    for (const n of names) {
      const first = readFileSync(path.join(a, n));
      assert.ok(first.equals(readFileSync(path.join(b, n))), `${n}: 두 번 생성 결과가 다름`);
      assert.ok(first.equals(readFileSync(path.join(PUBLIC, n))), `${n}: 게시 파일과 다름(pnpm --filter ./apps/web samples:build 로 다시 생성)`);
    }
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});
