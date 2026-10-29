// 매스 제안 요청 훅: suggest 레인(최신만 유효)으로 목표를 보내고 마지막 요청의 결과만 받는다. 상태 전이는 state.ts(순수, 테스트됨).
// 데모 미리보기(`?state=suggest-*`)는 개발 서버에서만 동작하고 요청을 보내지 않는다.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useEngine } from "../../shell/index.ts";
import type { Model } from "../state/commands.ts";
import { buildSuggestRequest, nextSuggestReqId, nextSuggestSeq, targetsIssue, type SuggestTargets } from "./protocol.ts";
import type { SuggestPreviewKind } from "./preview-kind.ts";
import { INITIAL_SUGGEST_STATE, suggestInputKey, suggestReducer, type SuggestState } from "./state.ts";

export interface UseSuggest {
  readonly state: SuggestState;
  /** 목표가 올바르면 요청을 보내고 null, 아니면 화면 문구. */
  request(targets: SuggestTargets): string | null;
  markApplied(id: string): void;
}

export function useSuggest(model: Model, preview: SuggestPreviewKind | null): UseSuggest {
  const engine = useEngine();
  const [state, dispatch] = useReducer(suggestReducer, INITIAL_SUGGEST_STATE);
  const pending = useRef<string | null>(null);
  pending.current = state.pendingReqId;
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    if (!engine) return;
    return engine.subscribe((response) => dispatch({ type: "response", response }));
  }, [engine]);

  // 데모 미리보기(개발 서버만). 릴리스에서는 이 분기가 사라져 예시 모듈이 번들에 들어가지 않는다.
  useEffect(() => {
    if (!preview || !import.meta.env.DEV) return;
    let alive = true;
    void import("./preview.ts").then((m) => {
      if (alive) dispatch({ type: "preview", state: m.previewState(modelRef.current, preview) });
    });
    return () => {
      alive = false;
    };
  }, [preview]);

  // 화면을 떠나면 진행 중인 요청을 취소한다.
  useEffect(
    () => () => {
      const id = pending.current;
      if (engine && id && id !== "preview") {
        try {
          engine.send({ op: "cancel", req_id: id });
        } catch {
          /* 이미 종료된 엔진 */
        }
      }
    },
    [engine],
  );

  const request = useCallback(
    (targets: SuggestTargets): string | null => {
      const issue = targetsIssue(targets);
      if (issue) return issue;
      if (!engine) {
        dispatch({ type: "fail", code: "ENGINE_UNAVAILABLE" });
        return null;
      }
      const seq = nextSuggestSeq();
      const reqId = nextSuggestReqId();
      const m = modelRef.current;
      dispatch({ type: "request", reqId, seq, inputKey: suggestInputKey(m) });
      try {
        engine.send(buildSuggestRequest(reqId, seq, m, targets));
      } catch {
        dispatch({ type: "fail", code: "ENGINE_UNAVAILABLE" });
      }
      return null;
    },
    [engine],
  );

  const markApplied = useCallback((id: string) => dispatch({ type: "applied", id }), []);
  return { state, request, markApplied };
}
