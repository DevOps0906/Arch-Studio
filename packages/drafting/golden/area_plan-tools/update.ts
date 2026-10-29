// area_plan 골든 갱신(AR-06-024): node golden/area_plan-tools/update.ts [--accept]
// 새 케이스는 그냥 쓴다. 이미 있는 골든이 달라지면 목록을 보이고 실패한다 — 의도한 변경이면 --accept(이유는 커밋 본문에).
// 배치: golden/area_plan-<이름>/{sheet.json, sheet.sha256, meta.json}. sheet.json = SheetModel canonical JSON + LF 한 줄.
// eslint-disable-next-line no-restricted-imports -- 엔진 밖 스크립트: 파일 쓰기
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, sha256Hex } from "../../src/index.ts";
import { buildAreaSheet, CASES } from "../../src/views/area_plan/cases.ts";

const accept = process.argv.includes("--accept");
const changed: string[] = [];
const writes: Array<[URL, string]> = [];
for (const c of CASES) {
  const dir = new URL(`../${c.id}/`, import.meta.url);
  const sheet = buildAreaSheet(c.input());
  const body = `${canonicalJson(sheet)}\n`;
  const files: Record<string, string> = {
    "sheet.json": body,
    "sheet.sha256": `${sha256Hex(body)}\n`,
    "meta.json": `${canonicalJson({ case_id: c.id, note: c.note, engine_version: sheet.engine_version, features: ["AR-F-030"] })}\n`,
  };
  for (const [name, text] of Object.entries(files)) {
    const u = new URL(name, dir);
    if (existsSync(u)) {
      if (readFileSync(u, "utf8") === text) continue;
      changed.push(`${c.id}/${name}`);
    }
    writes.push([u, text]);
  }
}
if (changed.length > 0 && !accept) {
  console.error(`기존 골든이 달라집니다(의도한 변경이면 --accept, 이유는 커밋 본문에):\n  ${changed.join("\n  ")}`);
  process.exit(1);
}
for (const [u, text] of writes) {
  mkdirSync(new URL("./", u), { recursive: true });
  writeFileSync(u, text);
}
console.log(`골든 ${CASES.length}건, 쓴 파일 ${writes.length}개`);
