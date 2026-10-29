// 판정 골든 갱신(AR-06-015): packages/rules/golden/<case>/{input.json, judgment.json}. golden/envelope/는 건드리지 않는다.
// 사용: pnpm --filter @arch-studio/rules golden:update — 골든이 바뀌면 커밋 본문에 이유를 적는다(AGENTS.md 3장).
// 검사는 src/golden.test.ts가 input.json만 읽어 다시 판정하고 judgment.json과 바이트 비교한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, judge, loadRulePack } from "../../packages/rules/src/index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "../../packages/rules/src/test-fixtures.ts";

const ROOT = new URL("../../packages/rules/", import.meta.url);

type Ctx = Parameters<typeof fixtureModel>[0];
interface Case {
  id: string;
  note: string;
  pack: string; // "fixture" | 배포 팩 버전
  ctx: Ctx;
}

const CASES: Case[] = [
  {
    id: "shipped-2026.10.0-basic",
    note: "배포 팩(전 항목 미확인): 모든 행 WARN, 조례 미확인 지자체 경고",
    pack: "2026.10.0",
    ctx: { rule_pack_version: "2026.10.0", application_date: "2026-11-01", municipality_code: "11000" },
  },
  {
    id: "fixture-sunlight-old",
    note: "신·구 일조사선 경계 쌍(구): 신청일이 신 기준 시행일 전날(가짜 값)",
    pack: "fixture",
    ctx: { application_date: "2000-06-30" },
  },
  {
    id: "fixture-sunlight-new",
    note: "신·구 일조사선 경계 쌍(신): 신청일 = 신 기준 시행일(가짜 값)",
    pack: "fixture",
    ctx: { application_date: "2000-07-01" },
  },
  {
    id: "fixture-ordinance-verified",
    note: "조례 반영 전후 쌍(확인): 지자체 조례 규칙 적용, PASS·FAIL 판정",
    pack: "fixture",
    ctx: { municipality_code: "T-OK" },
  },
  {
    id: "fixture-ordinance-unverified",
    note: "조례 반영 전후 쌍(미확인): 조례 의존 규칙 WARN, 국가 기준 참고값",
    pack: "fixture",
    ctx: { municipality_code: "T-NO" },
  },
  {
    id: "fixture-unsupported-region",
    note: "지원 지역 밖: 합격·불합격 0",
    pack: "fixture",
    ctx: { municipality_code: "X-UNKNOWN" },
  },
];

for (const c of CASES) {
  const raw = c.pack === "fixture" ? FIXTURE_PACK_RAW : JSON.parse(readFileSync(new URL(`packs/${c.pack}/pack.json`, ROOT), "utf8"));
  const input = { note: c.note, pack: c.pack, model: fixtureModel(c.ctx), options: { pendingChanges: 0 } };
  const out = judge(input.model, loadRulePack(structuredClone(raw)), input.options);
  const dir = new URL(`golden/${c.id}/`, ROOT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("input.json", dir), canonicalJson(input));
  writeFileSync(new URL("judgment.json", dir), canonicalJson(out));
  console.log(`✓ ${c.id}`);
}
