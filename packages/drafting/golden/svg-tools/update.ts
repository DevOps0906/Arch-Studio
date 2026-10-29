// SVG 골든 갱신(AR-06-022): node golden/svg-tools/update.ts (packages/drafting에서)
// 규칙은 DXF 골든(golden/_harness/update.ts)과 같다: manifest.writer_version이 SVG_WRITER_VERSION과 같으면 기존 골든을 바꾸지 않고
// 바뀐 케이스를 나열하고 실패한다. 새 케이스 추가만 허용. 버전을 올렸거나 manifest가 없을 때만 전체를 다시 쓴다. 이유는 커밋 본문에.
// eslint-disable-next-line no-restricted-imports -- 골든 해시(엔진 밖 스크립트)
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 골든 파일 쓰기(엔진 밖 스크립트)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { CASES } from "../_harness/cases.ts";
import { SVG_WRITER_VERSION } from "../../src/writers/svg/index.ts";
import { GOLDEN, SVG_MANIFEST, svgCaseId, svgGoldenFiles, type SvgGoldenManifest } from "./harness.ts";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const old = existsSync(SVG_MANIFEST) ? (JSON.parse(readFileSync(SVG_MANIFEST, "utf8")) as SvgGoldenManifest) : null;
const bumped = old === null || old.writer_version !== SVG_WRITER_VERSION;

const refused: string[] = [];
const writes: Array<[URL, string]> = [];
const hashes: Record<string, string> = {};
for (const c of CASES) {
  const id = svgCaseId(c.id);
  const dir = new URL(`${id}/`, GOLDEN);
  const files = svgGoldenFiles(c);
  for (const [name, body] of Object.entries(files)) if (name.endsWith(".svg")) hashes[`${id}/${name}`] = sha256(body);
  const isNew = !existsSync(dir);
  const changed = Object.entries(files).filter(([name, body]) => {
    const u = new URL(name, dir);
    return !existsSync(u) || readFileSync(u, "utf8") !== body;
  });
  const stale = isNew ? [] : readdirSync(dir).filter((f) => !(f in files));
  if (changed.length === 0 && stale.length === 0) continue;
  if (!bumped && !isNew) {
    refused.push(`${id}: ${[...changed.map(([n]) => n), ...stale.map((n) => `${n}(남는 파일)`)].join(", ")}`);
    continue;
  }
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of changed) writes.push([new URL(name, dir), body]);
}
const known = new Set(CASES.map((c) => svgCaseId(c.id)));
for (const d of readdirSync(GOLDEN)) {
  if (d.startsWith("svg-") && d !== "svg-tools" && !known.has(d)) refused.push(`${d}: cases.ts에 없는 골든(직접 지우고 커밋 본문에 이유)`);
}
if (!bumped) {
  for (const [k, v] of Object.entries(old.sha256)) {
    if (hashes[k] !== undefined && hashes[k] !== v) refused.push(`${k}: manifest 해시와 다름`);
  }
}
if (refused.length > 0) {
  console.error(`SVG 골든이 바뀌었지만 SVG_WRITER_VERSION(${SVG_WRITER_VERSION})이 그대로입니다. 의도한 변경이면 버전을 올리고 다시 실행하세요.`);
  for (const r of [...new Set(refused)]) console.error(`  ${r}`);
  process.exit(1);
}
for (const [u, body] of writes) writeFileSync(u, body);
const sorted = Object.fromEntries(Object.keys(hashes).sort().map((k) => [k, hashes[k] as string]));
const manifest: SvgGoldenManifest = { writer_version: SVG_WRITER_VERSION, sha256: sorted };
const text = JSON.stringify(manifest, null, 2) + "\n";
if (!existsSync(SVG_MANIFEST) || readFileSync(SVG_MANIFEST, "utf8") !== text) writeFileSync(SVG_MANIFEST, text);
console.log(`SVG 골든 ${CASES.length}건 확인, 파일 ${writes.length}개 갱신, manifest ${bumped ? "재작성" : "유지/추가"} (${SVG_WRITER_VERSION})`);
