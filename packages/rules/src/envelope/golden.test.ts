// 엔벨로프 골든(AR-06-016): input.json → buildEnvelope → envelope.json 바이트 비교(같은 입력 같은 바이트).
// 갱신: pnpm --filter @arch-studio/rules golden:envelope:update. 신·구 일조사선 쌍은 가짜 팩(시행 경계 2000-07-01, 가짜).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { before, test } from "node:test";
import { loadSolidKernel, type SolidKernel } from "@arch-studio/geometry";
import type { EnvelopeOutput } from "./envelope.ts";
import { goldenInputs, runGolden, type EnvelopeGoldenInput } from "./golden-cases.ts";

const ROOT = new URL("../../", import.meta.url);
const GOLDEN = new URL("golden/envelope/", ROOT);
const readText = (u: URL) => readFileSync(u, "utf8").replace(/\r\n/g, "\n"); // autocrlf 체크아웃 대비
const readPack = (v: string) => JSON.parse(readText(new URL(`packs/${v}/pack.json`, ROOT))) as unknown;
const cases = readdirSync(GOLDEN)
  .filter((d) => existsSync(new URL(`${d}/input.json`, GOLDEN)))
  .sort();
/** 골든 JSON(부피는 10진 문자열). */
const output = (id: string) => JSON.parse(readText(new URL(`${id}/envelope.json`, GOLDEN))) as Omit<EnvelopeOutput, "volume_mm3"> & { volume_mm3: string };

let kernel: SolidKernel;
before(async () => {
  kernel = await loadSolidKernel();
});

test("골든 케이스가 입력 생성기와 같다", () => {
  assert.deepEqual(cases, Object.keys(goldenInputs()).sort());
});

for (const id of cases) {
  test(`엔벨로프 골든 ${id}`, () => {
    const input = JSON.parse(readText(new URL(`${id}/input.json`, GOLDEN))) as EnvelopeGoldenInput;
    const first = runGolden(input, kernel, readPack);
    const second = runGolden(structuredClone(input), kernel, readPack);
    assert.equal(second, first, "같은 입력 다른 바이트");
    assert.equal(first, readText(new URL(`${id}/envelope.json`, GOLDEN)), "골든 불일치(의도한 변경이면 golden:envelope:update 후 커밋 본문에 이유)");
  });
}

test("신·구 경계 쌍: 신청 예정일을 시행일 전후로 바꾸면 일조사선 기준과 볼륨이 바뀐다", () => {
  const sun = (o: ReturnType<typeof output>) => o.constraints.find((c) => c.key === "sunlight");
  const old = output("fixture-sunlight-old");
  const neu = output("fixture-sunlight-new");
  assert.deepEqual(sun(old)?.rule_ids, ["sunlight.fake-old"]);
  assert.deepEqual(sun(neu)?.rule_ids, ["sunlight.fake-new"]);
  assert.equal(sun(old)?.basis[0]?.effective_from, "2000-01-01");
  assert.equal(sun(neu)?.basis[0]?.effective_from, "2000-07-01");
  assert.notEqual(old.volume_mm3, neu.volume_mm3);
  assert.notDeepEqual(old.solid, neu.solid);
});
