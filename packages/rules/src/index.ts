// @arch-studio/rules — 판정 엔진·규칙 팩 로더(AR-06-015). 결정적 순수 함수. 규칙 팩(packs/)은 엔진 밖 데이터라 import하지 않는다.
export { RulesError, type RulesErrorCode } from "./errors.ts";
export { canonicalJson } from "./canonical.ts";
export {
  UNVERIFIED,
  compareVersions,
  isIsoDate,
  loadRulePack,
  selectRulePack,
  selectRules,
  type PackSelection,
  type Rule,
  type RuleKey,
  type RulePack,
  type RuleSelection,
} from "./pack.ts";
export { displayDistanceMm, measure, type EdgeMeasure, type ExactD2, type Measurements } from "./measure.ts";
export {
  ENGINE_VERSION,
  REASON_MESSAGES,
  judge,
  type JudgeOptions,
  type JudgeOutput,
  type JudgeWarning,
  type JudgmentDetail,
  type ReasonCode,
  type WarningCode,
} from "./judge.ts";
