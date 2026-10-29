// engine.worker 핸들러: 판정(judge)만 실제 호출한다. 기하·판정 값은 기존 순수 함수가 만든다(직접 계산 금지).
// suggest_mass·validate_layout 은 packages/massing·layout 이 아직 비어 있어 미구현 오류로 답한다(후속).
import { ENGINE_VERSION, judge } from "@arch-studio/rules";
import type { LaneRequest } from "./protocol.ts";
import { HandlerError, type Handler, type RuntimeOptions } from "./runtime.ts";
import type { RulePackStore } from "./rulePacks.ts";

const notImplemented: Handler = () => {
  throw new HandlerError("AR050", "아직 구현되지 않은 요청입니다");
};

export function createEngineHandlers(store: RulePackStore): Pick<RuntimeOptions, "handlers" | "control"> {
  const judgeHandler: Handler = async (req: LaneRequest, ctx) => {
    if (req.op !== "judge") throw new HandlerError("AR050", "잘못된 요청입니다");
    const selection = await store.select(req.model.rule_context.rule_pack_version);
    await ctx.checkpoint();
    const options = req.pending_changes === undefined ? {} : { pendingChanges: req.pending_changes };
    const out = judge(req.model, selection.pack, options);
    return { result: { ...out, model_rev: req.model_rev, rule_pack_fallback: selection.fallback }, engine_version: ENGINE_VERSION };
  };
  return {
    handlers: { judge: judgeHandler, suggest_mass: notImplemented, validate_layout: notImplemented },
    control: (req) => {
      if (req.unavailable !== undefined) {
        store.markUnavailable(req.unavailable);
        return { engine_version: ENGINE_VERSION, result: { unavailable: req.unavailable } };
      }
      const { reused } = store.load(req.version, req.sha256, req.pack);
      return { engine_version: ENGINE_VERSION, result: { version: req.version, reused } };
    },
  };
}
