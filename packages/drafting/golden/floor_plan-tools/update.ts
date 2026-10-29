// floor_plan 골든 갱신(AR-06-026): node golden/floor_plan-tools/update.ts [--accept]  (packages/drafting에서)
// 새 케이스는 그냥 쓴다. 이미 있는 골든이 달라지면 목록을 보이고 실패한다 — 의도한 변경이면 --accept(이유는 커밋 본문에).
// 배치: golden/floor_plan-<이름>/{sheet.json, sheet.sha256, meta.json}, 거부 케이스는 {rejected.json, meta.json}.
// eslint-disable-next-line no-restricted-imports -- 엔진 밖 스크립트: 파일 쓰기
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CASES, floorPlanGoldenFiles } from "../../src/views/floor_plan/cases.ts";

const accept = process.argv.includes("--accept");
const changed: string[] = [];
const writes: Array<[URL, string]> = [];
for (const c of CASES) {
  const dir = new URL(`../${c.id}/`, import.meta.url);
  for (const [name, text] of Object.entries(floorPlanGoldenFiles(c))) {
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
