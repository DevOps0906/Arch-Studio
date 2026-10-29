// 매스 제안 상태기계(순수). 판정 요청 상태기계(judgment/request.ts)와 같은 규칙: 마지막으로 보낸 요청의 응답만 받는다.
// 상태 4종: idle(빈: 아직 제안 없음) · loading · error · ready(성공).
import { engineErrorText } from "../engine/protocol.ts";
import { parseSuggestResult, type SuggestView } from "./protocol.ts";

export type SuggestPhase = "idle" | "loading" | "ready" | "error";

export interface SuggestState {
  readonly phase: SuggestPhase;
  /** 마지막으로 보낸 요청의 seq(없으면 -1). */
  readonly seq: number;
  readonly pendingReqId: string | null;
  readonly view: SuggestView | null;
  /** 결과를 받은 때의 대지·규칙 키. 지금 모델과 다르면 오래된 결과다(적용 잠금). */
  readonly inputKey: string | null;
  readonly error: string | null;
  /** 적용한 후보(다음 요청 때 지운다). */
  readonly applied: string | null;
}

export const INITIAL_SUGGEST_STATE: SuggestState = { phase: "idle", seq: -1, pendingReqId: null, view: null, inputKey: null, error: null, applied: null };

export type SuggestEvent =
  | { readonly type: "request"; readonly reqId: string; readonly seq: number; readonly inputKey: string }
  | { readonly type: "response"; readonly response: unknown }
  | { readonly type: "fail"; readonly code: string }
  | { readonly type: "applied"; readonly id: string }
  | { readonly type: "reset" }
  | { readonly type: "preview"; readonly state: SuggestState };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function suggestReducer(s: SuggestState, e: SuggestEvent): SuggestState {
  switch (e.type) {
    case "reset":
      return INITIAL_SUGGEST_STATE;
    case "preview":
      return e.state;
    case "applied":
      return s.view ? { ...s, applied: e.id } : s;
    case "fail":
      return { ...s, phase: "error", pendingReqId: null, view: null, inputKey: null, error: engineErrorText(e.code, null), applied: null };
    case "request":
      if (e.seq <= s.seq) return s;
      // 이전 결과는 갱신 중에도 남겨 화면이 깜박이지 않게 한다(loading + view).
      return { ...s, phase: "loading", seq: e.seq, pendingReqId: e.reqId, error: null, applied: null, inputKey: e.inputKey };
    case "response": {
      const r = e.response;
      if (!isRecord(r) || typeof r.req_id !== "string" || r.req_id !== s.pendingReqId) return s;
      if ("status" in r) {
        if (r.status === "canceled") return { ...s, phase: s.view ? "ready" : "idle", pendingReqId: null };
        return s; // progress·superseded
      }
      if (typeof r.seq === "number" && r.seq !== s.seq) return s;
      if (r.ok === true) {
        const view = parseSuggestResult(r.result);
        if (!view) return { ...s, phase: "error", pendingReqId: null, view: null, error: engineErrorText("INVALID_RESPONSE", "엔진 응답 형식이 올바르지 않습니다") };
        return { ...s, phase: "ready", pendingReqId: null, view, error: null };
      }
      if (r.ok === false) {
        return { ...s, phase: "error", pendingReqId: null, view: null, inputKey: null, error: engineErrorText(typeof r.code === "string" ? r.code : "UNKNOWN", r.detail) };
      }
      return s;
    }
  }
}

/** 제안이 기대는 입력(대지·규칙 문맥). 바뀌면 결과는 오래된 것이다. */
export function suggestInputKey(model: { site: unknown; rule_context: unknown }): string {
  return JSON.stringify([model.site, model.rule_context]);
}
