// 판정 요청 훅. 모델이 바뀔 때 useEngine().send로 judge 요청을 보내고 최신 요청의 결과만 받는다(017 판정 레인 최신만 유효).
// 상태 전이는 request.ts(순수, 테스트됨). 기하·판정 계산은 워커의 결정적 순수 함수만 한다.
import type { DesignModelV1 } from "@arch-studio/domain";
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { useEngine } from "../shell/index.ts";
import type { JudgmentData } from "./model.ts";
import { INITIAL_JUDGE_STATE, buildJudgeRequest, judgeReducer, type JudgeError, type JudgePhase } from "./request.ts";

export interface UseJudgmentArgs {
  /** 판정할 모델. null이면 요청하지 않는다(매스 없음·불러오는 중). */
  readonly model: DesignModelV1 | null;
  /** 모델 판 식별(저장 버전·편집 카운터). 응답의 model_rev와 대조하는 용도로 같이 보낸다. */
  readonly modelRev: string;
  /** 폴백 배너 "이후 개정 n건"(서버 값, 엔진은 계산하지 않는다). */
  readonly pendingChanges?: number;
  readonly enabled?: boolean;
}

export interface UseJudgment {
  readonly phase: JudgePhase;
  /** 가장 최근에 성공한 판정(갱신 중에도 남는다). */
  readonly data: JudgmentData | null;
  readonly error: JudgeError | null;
  /** 같은 모델로 다시 요청. */
  retry(): void;
}

export function useJudgment({ model, modelRev, pendingChanges, enabled = true }: UseJudgmentArgs): UseJudgment {
  const engine = useEngine();
  const [state, dispatch] = useReducer(judgeReducer, INITIAL_JUDGE_STATE);
  const [nonce, setNonce] = useState(0);
  const seqRef = useRef(-1);
  const instance = useId();
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = state.pendingReqId;

  // 응답 구독: 마지막 요청의 응답만 리듀서가 받아들인다.
  useEffect(() => {
    if (!engine) return;
    return engine.subscribe((response) => dispatch({ type: "response", response }));
  }, [engine]);

  useEffect(() => {
    if (!enabled || model === null) {
      dispatch({ type: "reset" });
      return;
    }
    if (!engine) {
      dispatch({ type: "fail", code: "ENGINE_UNAVAILABLE" });
      return;
    }
    seqRef.current += 1;
    const seq = seqRef.current;
    const reqId = `judge:${instance}:${seq}`;
    dispatch({ type: "request", reqId, seq });
    try {
      const request = buildJudgeRequest({ reqId, seq, modelRev, model, ...(pendingChanges === undefined ? {} : { pendingChanges }) });
      engine.send(request);
    } catch {
      dispatch({ type: "fail", code: "ENGINE_UNAVAILABLE" });
    }
  }, [engine, model, modelRev, pendingChanges, enabled, nonce, instance]);

  // 화면을 떠날 때 진행 중인 요청 취소.
  useEffect(
    () => () => {
      const id = pendingRef.current;
      if (engine && id) {
        try {
          engine.send({ op: "cancel", req_id: id });
        } catch {
          /* 이미 종료된 엔진 */
        }
      }
    },
    [engine],
  );

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { phase: state.phase, data: state.data, error: state.error, retry };
}
