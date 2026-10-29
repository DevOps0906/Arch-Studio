// engine.worker 매스 제안 핸들러(AR-06-028): suggest_mass(suggest 레인, 최신만 유효). 02_ARCHITECTURE 2.4절 기존 op를 채운다.
// - 좌표는 packages/massing 의 결정적 순수 함수가 만든다. 여기서는 요청 검사·규칙 팩 선택·커널 주입만 한다(LLM·난수 없음).
// - 판정 값(건폐·용적·높이·이격)은 후보마다 같은 엔진 judge() 결과를 동봉한다. 화면은 다시 계산하지 않는다.
// - 오류 detail 에는 본문 값을 넣지 않는다(고정 문구).
import { designModelV1Schema } from "@arch-studio/domain";
import type { SolidKernel } from "@arch-studio/geometry";
import { MASSING_ENGINE_VERSION, MassingError, suggestMasses } from "@arch-studio/massing";
import { z } from "zod";
import type { LaneRequest } from "./protocol.ts";
import type { RulePackStore } from "./rulePacks.ts";
import { HandlerError, type Handler, type HandlerResult } from "./runtime.ts";

/** 매스 제안 요청 목표(대화상자 입력). 모르는 필드는 거부한다. */
export const suggestTargetsSchema = z
  .object({
    target_gfa_m2: z.number().finite().positive().max(1_000_000).nullable(),
    floors: z.number().int().min(1).max(60).nullable(),
    floor_height_mm: z.number().int().min(1500).max(10_000),
    use: z.string().min(1).max(40),
  })
  .strict();

export interface SuggestHandlerDeps {
  store: RulePackStore;
  /** 솔리드 커널 로더(워커: manifold.wasm URL, 테스트: Node). 첫 요청 때 한 번 부른다. */
  loadKernel: () => Promise<SolidKernel>;
}

export function createSuggestHandlers(deps: SuggestHandlerDeps): { suggest_mass: Handler } {
  let kernelP: Promise<SolidKernel> | null = null;
  const kernel = (): Promise<SolidKernel> => {
    kernelP ??= deps.loadKernel().catch((e: unknown) => {
      kernelP = null;
      throw e;
    });
    return kernelP.catch(() => {
      throw new HandlerError("AR050", "솔리드 엔진을 시작하지 못했습니다");
    });
  };

  const suggest: Handler = async (req: LaneRequest, ctx): Promise<HandlerResult> => {
    if (req.op !== "suggest_mass") throw new HandlerError("AR050", "잘못된 요청입니다");
    const model = designModelV1Schema.safeParse(req.model);
    if (!model.success) throw new HandlerError("AR050", "설계 모델 형식이 올바르지 않습니다");
    const targets = suggestTargetsSchema.safeParse(req.targets);
    if (!targets.success) throw new HandlerError("AR050", "제안 목표 형식이 올바르지 않습니다");
    const selection = await deps.store.select(model.data.rule_context.rule_pack_version);
    const k = await kernel();
    await ctx.checkpoint();
    try {
      const result = suggestMasses(model.data, selection.pack, k, targets.data);
      return { result: { ...result, rule_pack_version: selection.pack.version, rule_pack_fallback: selection.fallback }, engine_version: MASSING_ENGINE_VERSION };
    } catch (e) {
      if (e instanceof MassingError) throw new HandlerError("AR050", e.message);
      throw e; // RulesError 등은 런타임이 고정 문구로 바꾼다
    }
  };
  return { suggest_mass: suggest };
}
