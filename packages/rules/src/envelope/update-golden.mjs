// 엔벨로프 골든 갱신(테스트 밖에서 수동 실행): pnpm --filter @arch-studio/rules golden:envelope:update
// .mjs인 이유: rules tsconfig는 Node 타입이 없어 src의 .ts 스크립트가 typecheck를 깨뜨린다(엔진 코드 아님).
// 골든 변경은 이유를 커밋 본문에 적는다(AGENTS.md 3절).
// eslint-disable-next-line no-restricted-imports -- 갱신 스크립트(엔진 밖)는 파일을 쓴다
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadSolidKernel } from "@arch-studio/geometry";
import { canonicalJson } from "../canonical.ts";
import { goldenInputs, runGolden } from "./golden-cases.ts";

const ROOT = new URL("../../", import.meta.url);
const GOLDEN = new URL("golden/envelope/", ROOT);
const kernel = await loadSolidKernel();
const readPack = (v) => JSON.parse(readFileSync(new URL(`packs/${v}/pack.json`, ROOT), "utf8").replace(/\r\n/g, "\n"));
for (const [id, input] of Object.entries(goldenInputs())) {
  const dir = new URL(`${id}/`, GOLDEN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("input.json", dir), canonicalJson(input));
  writeFileSync(new URL("envelope.json", dir), runGolden(input, kernel, readPack));
  console.log(`golden/envelope/${id}`);
}
