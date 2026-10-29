// site_plan 골든(AR-06-023): golden/site_plan-<case>/{input.json, sheet.json, sheet.sha256}.
// sheet.json = SheetModel canonical JSON(+개행 1개), sheet.sha256 = 그 본문(개행 제외)의 sha256.
// 갱신(골든 변경은 이유를 커밋 본문에): SITE_PLAN_GOLDEN_UPDATE=1 pnpm --filter @arch-studio/drafting test
// 갱신 모드는 파일이 없거나 내용이 다르면 쓰고, 기본 모드는 다르면 실패한다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 골든 파일 읽기·쓰기(테스트 전용)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { buildSheet, canonicalJson, sha256Hex, validateDraftingInput } from "../../index.ts";
import { CASES, type SitePlanCase } from "./cases.ts";
import { buildSitePlanView } from "./index.ts";

const GOLDEN = new URL("../../../golden/", import.meta.url);
const UPDATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SITE_PLAN_GOLDEN_UPDATE === "1";

function render(c: SitePlanCase): { input: string; sheet: string; sha: string } {
  const r = validateDraftingInput(c.input);
  assert.ok(r.ok, `${c.id}: validate 실패`);
  const { sheet } = buildSheet(c.input, buildSitePlanView(c.input, c.extras));
  const body = canonicalJson(sheet);
  return { input: canonicalJson({ input: c.input, extras: c.extras }) + "\n", sheet: body + "\n", sha: sha256Hex(body) + "\n" };
}

for (const c of CASES) {
  test(`골든 ${c.id}`, () => {
    const out = render(c);
    const dir = new URL(`${c.id}/`, GOLDEN);
    const files: Array<[string, string]> = [
      ["input.json", out.input],
      ["sheet.json", out.sheet],
      ["sheet.sha256", out.sha],
    ];
    if (UPDATE) {
      mkdirSync(dir, { recursive: true });
      for (const [name, body] of files) {
        const u = new URL(name, dir);
        if (!existsSync(u) || readFileSync(u, "utf8") !== body) writeFileSync(u, body);
      }
    }
    for (const [name, body] of files) {
      assert.equal(readFileSync(new URL(name, dir), "utf8"), body, `${c.id}/${name} 불일치(의도한 변경이면 SITE_PLAN_GOLDEN_UPDATE=1로 갱신, 이유는 커밋 본문에)`);
    }
    // 저장된 입력으로 다시 만들어도 같은 바이트(입력 직렬화 왕복).
    const saved = JSON.parse(readFileSync(new URL("input.json", dir), "utf8")) as Pick<SitePlanCase, "input" | "extras">;
    const again = buildSheet(saved.input, buildSitePlanView(saved.input, saved.extras)).sheet;
    assert.equal(canonicalJson(again) + "\n", out.sheet);
    assert.equal(sha256Hex(out.sheet.slice(0, -1)) + "\n", out.sha);
  });
}

test("골든 4건 이상", () => {
  assert.ok(CASES.length >= 4);
});
