// PNG 골든 갱신(AR-06-022): node golden/png-tools/update.ts (packages/drafting에서). 골든 3건(input.svg·expected.png·meta.json)을 다시 쓴다.
// 갱신은 PNG_WRITER_VERSION 또는 resvg-js 버전을 올렸을 때만 의미가 있다(이유는 커밋 본문에). 기존 골든이 있고 내용이 다르면
// --force 없이는 쓰지 않고 실패한다(의도하지 않은 래스터 변경 방지).
// eslint-disable-next-line no-restricted-imports -- 골든 파일 쓰기(엔진 밖 스크립트)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { GOLDEN, goldenFiles, pngCaseId, PNG_CASES, readGolden, sha256 } from "./harness.ts";

const force = process.argv.includes("--force");
const diffs: string[] = [];
const writes: Array<[URL, Uint8Array | string]> = [];
for (const c of PNG_CASES) {
  const id = pngCaseId(c.source);
  const dir = new URL(`${id}/`, GOLDEN);
  const g = goldenFiles(c);
  const meta = JSON.stringify(g.meta, null, 2) + "\n";
  if (existsSync(new URL("expected.png", dir)) && sha256(readGolden(id, "expected.png")) !== sha256(g.png) && !force) diffs.push(id);
  mkdirSync(dir, { recursive: true });
  writes.push([new URL("input.svg", dir), g.svg], [new URL("expected.png", dir), g.png], [new URL("meta.json", dir), meta]);
}
if (diffs.length > 0) {
  console.error(`PNG 골든이 바뀌었습니다: ${diffs.join(", ")}. 의도한 변경이면 --force로 다시 실행하고 커밋 본문에 이유를 적으세요.`);
  process.exit(1);
}
for (const [u, body] of writes) writeFileSync(u, body);
console.log(`PNG 골든 ${PNG_CASES.length}건 기록`);
