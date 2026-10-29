// 매스 제안 골든 갱신: pnpm --filter @arch-studio/massing golden:update. 엔진 코드가 아니라 파일 쓰기를 한다(.mjs).
// eslint-disable-next-line no-restricted-imports -- 골든 파일 쓰기(엔진 밖 스크립트)
import { mkdirSync, writeFileSync } from "node:fs";
import { loadSolidKernel } from "@arch-studio/geometry";
import { canonicalJson } from "@arch-studio/rules";
import { suggestMasses } from "./suggest.ts";
import { fixturePack, goldenCases } from "./test-fixtures.ts";

const kernel = await loadSolidKernel();
const pack = fixturePack();
const dir = new URL("../golden/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [id, c] of Object.entries(goldenCases())) {
  writeFileSync(new URL(`${id}.json`, dir), `${canonicalJson(suggestMasses(c.model, pack, kernel, c.targets))}\n`);
  console.log("wrote", id);
}
