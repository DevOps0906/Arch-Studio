// 매스 제안 골든(AR-06-028): 입력 → suggestMasses → 정규 JSON 바이트 비교(같은 입력 같은 바이트). 팩은 가짜.
// 갱신: pnpm --filter @arch-studio/massing golden:update (의도한 변경이면 커밋 본문에 이유).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { before, test } from "node:test";
import { loadSolidKernel, type SolidKernel } from "@arch-studio/geometry";
import { canonicalJson, type RulePack } from "@arch-studio/rules";
import { suggestMasses } from "./index.ts";
import { fixturePack, goldenCases } from "./test-fixtures.ts";

let kernel: SolidKernel;
let pack: RulePack;
before(async () => {
  kernel = await loadSolidKernel();
  pack = fixturePack();
});

const readText = (u: URL) => readFileSync(u, "utf8").replace(/\r\n/g, "\n"); // autocrlf 체크아웃 대비

for (const [id, c] of Object.entries(goldenCases())) {
  test(`매스 제안 골든 ${id}`, () => {
    const first = canonicalJson(suggestMasses(c.model, pack, kernel, c.targets));
    const second = canonicalJson(suggestMasses(structuredClone(c.model), pack, kernel, { ...c.targets }));
    assert.equal(second, first, "같은 입력 다른 바이트");
    assert.equal(first.trimEnd(), readText(new URL(`../golden/${id}.json`, import.meta.url)).trimEnd(), "골든 불일치(의도한 변경이면 golden:update 후 커밋 본문에 이유)");
  });
}
