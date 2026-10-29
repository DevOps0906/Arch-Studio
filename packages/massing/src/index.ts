// @arch-studio/massing — 매스 자동 제안 3안(AR-06-028, AR-F-033, D-26). 결정적 순수 함수. 규칙 팩은 호출자가 고른 것을 받는다.
export {
  DEFAULTS,
  MASSING_ENGINE_VERSION,
  MassingError,
  STRATEGY_TITLE,
  suggestMasses,
  targetsFromProgram,
  validateTargets,
  type Candidate,
  type Mass,
  type StrategyKey,
  type SuggestNotice,
  type SuggestNoticeCode,
  type SuggestOptions,
  type SuggestResult,
  type SuggestTargets,
} from "./suggest.ts";
export { type Rect } from "./grid.ts";
