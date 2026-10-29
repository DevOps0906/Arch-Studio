// 테스트 공용 도우미(배포 코드에서 import하지 않는다).
import { loadRulePack, type JudgeOutput, type RulePack } from "./index.ts";
import { FIXTURE_PACK_RAW } from "./test-fixtures.ts";

export function fixturePack(): RulePack {
  return loadRulePack(JSON.parse(JSON.stringify(FIXTURE_PACK_RAW)));
}

/** rule_id로 행(item·detail 쌍)을 찾는다. */
export function row(out: JudgeOutput, ruleId: string) {
  const i = out.details.findIndex((d) => d.rule_id === ruleId);
  if (i < 0) return undefined;
  return { item: out.result.items[i] as JudgeOutput["result"]["items"][number], detail: out.details[i] as JudgeOutput["details"][number] };
}
