// 판정 골든(AR-06-015): input.json → judge → judgment.json 바이트 비교(같은 입력 같은 바이트).
// 갱신: pnpm --filter @arch-studio/rules golden:update (scripts/rule-packs/update-golden.ts). golden/envelope·eval은 제외.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { canonicalJson, judge, loadRulePack, type JudgeOptions } from "./index.ts";
import { FIXTURE_PACK_RAW } from "./test-fixtures.ts";

const ROOT = new URL("../", import.meta.url);
const GOLDEN = new URL("golden/", ROOT);
const readText = (u: URL) => readFileSync(u, "utf8").replace(/\r\n/g, "\n"); // autocrlf 체크아웃 대비
const cases = readdirSync(GOLDEN)
  .filter((d) => existsSync(new URL(`${d}/input.json`, GOLDEN)))
  .sort();

test("골든 케이스가 있다(신·구 일조사선 경계 쌍, 조례 반영 전후 쌍 포함)", () => {
  for (const id of ["fixture-sunlight-old", "fixture-sunlight-new", "fixture-ordinance-verified", "fixture-ordinance-unverified"]) {
    assert.ok(cases.includes(id), id);
  }
});

for (const id of cases) {
  test(`골든 ${id}`, () => {
    const input = JSON.parse(readText(new URL(`${id}/input.json`, GOLDEN))) as {
      pack: string;
      model: DesignModelV1;
      options: JudgeOptions;
    };
    const raw = input.pack === "fixture" ? structuredClone(FIXTURE_PACK_RAW) : JSON.parse(readText(new URL(`packs/${input.pack}/pack.json`, ROOT)));
    const pack = loadRulePack(raw);
    const first = canonicalJson(judge(input.model, pack, input.options));
    const second = canonicalJson(judge(structuredClone(input.model), pack, input.options));
    assert.equal(second, first, "같은 입력 다른 바이트");
    assert.equal(first, readText(new URL(`${id}/judgment.json`, GOLDEN)), "골든 불일치(의도한 변경이면 golden:update 후 커밋 본문에 이유)");
  });
}

test("신·구 경계 쌍: 일조사선 근거 시행일이 바뀐다", () => {
  const sun = (id: string) => {
    const out = JSON.parse(readText(new URL(`${id}/judgment.json`, GOLDEN))) as { result: { items: { key: string; basis: { effective_from: string }[] }[] } };
    return out.result.items.find((i) => i.key === "sunlight")?.basis[0]?.effective_from;
  };
  assert.equal(sun("fixture-sunlight-old"), "2000-01-01");
  assert.equal(sun("fixture-sunlight-new"), "2000-07-01");
});
