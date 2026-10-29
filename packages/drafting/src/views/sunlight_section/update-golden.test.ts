// 골든 갱신(AR-06-025): SUNLIGHT_GOLDEN_UPDATE=1 node --test src/views/sunlight_section/update-golden.test.ts  (packages/drafting에서)
// 환경 변수가 없으면 건너뛴다(일반 테스트에서는 아무것도 쓰지 않음). 골든이 바뀌면 이유를 커밋 본문에 적는다(AGENTS.md 3장).
// eslint-disable-next-line no-restricted-imports -- 골든 파일 쓰기(엔진 밖 스크립트)
import { mkdirSync, writeFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { SUNLIGHT_CASES, sunlightGoldenFiles } from "./golden-cases.ts";

const ROOT = new URL("../../../golden/", import.meta.url);

// eslint-disable-next-line no-restricted-properties -- 갱신 스위치(테스트 밖 엔진 코드는 환경 변수를 읽지 않는다)
const UPDATE = process.env.SUNLIGHT_GOLDEN_UPDATE === "1";

test("sunlight_section 골든 쓰기", { skip: !UPDATE }, () => {
  for (const c of SUNLIGHT_CASES) {
    const dir = new URL(`${c.id}/`, ROOT);
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(sunlightGoldenFiles(c))) writeFileSync(new URL(name, dir), body);
  }
});
