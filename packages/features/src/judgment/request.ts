// 판정 요청 상태기계(순수). 017 judge 레인은 "최신만 유효"라 오래된 요청은 superseded로 끝난다.
// 이 리듀서는 마지막으로 보낸 요청(pendingReqId·seq)의 응답만 받아들이고 나머지는 버린다(늦게 온 옛 결과가 새 모델 위에 덮이지 않게).
import { judgmentResultSchema } from "@arch-studio/domain";
import type { JudgmentData, JudgmentDetailLike, JudgmentWarningLike } from "./model.ts";

export type JudgePhase = "idle" | "loading" | "ready" | "error";

export interface JudgeError {
  /** 로컬 오류 코드(AR05x)·ENGINE_UNAVAILABLE·INVALID_RESPONSE. */
  readonly code: string;
}

export interface JudgeRequestState {
  readonly phase: JudgePhase;
  /** 마지막으로 보낸 요청의 seq(0부터 단조 증가). 아직 없으면 -1. */
  readonly seq: number;
  readonly pendingReqId: string | null;
  /** 가장 최근에 성공한 판정. 새 요청 중에도 남겨 화면이 깜박이지 않게 한다(loading + data = 갱신 중). */
  readonly data: JudgmentData | null;
  readonly error: JudgeError | null;
}

export const INITIAL_JUDGE_STATE: JudgeRequestState = { phase: "idle", seq: -1, pendingReqId: null, data: null, error: null };

export type JudgeEvent =
  | { readonly type: "request"; readonly reqId: string; readonly seq: number }
  | { readonly type: "response"; readonly response: unknown }
  | { readonly type: "fail"; readonly code: string }
  | { readonly type: "reset" };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** 엔진 응답 result(= {result, details, warnings, model_rev, ...}) → 화면 데이터. 형식이 틀리면 null. */
export function parseJudgeResult(raw: unknown, elapsedMs: number | null = null): JudgmentData | null {
  if (!isRecord(raw)) return null;
  const parsed = judgmentResultSchema.safeParse(raw.result);
  if (!parsed.success) return null;
  const details = Array.isArray(raw.details) ? (raw.details as JudgmentDetailLike[]) : [];
  const warnings = Array.isArray(raw.warnings) ? (raw.warnings as JudgmentWarningLike[]) : [];
  return {
    result: parsed.data,
    details,
    warnings,
    modelRev: typeof raw.model_rev === "string" ? raw.model_rev : null,
    elapsedMs,
  };
}

export function judgeReducer(state: JudgeRequestState, event: JudgeEvent): JudgeRequestState {
  switch (event.type) {
    case "reset":
      return INITIAL_JUDGE_STATE;
    case "fail":
      return { ...state, phase: "error", pendingReqId: null, data: null, error: { code: event.code } };
    case "request":
      // 더 오래된 seq의 요청은 무시(최신만 유효).
      if (event.seq <= state.seq) return state;
      return { ...state, phase: "loading", seq: event.seq, pendingReqId: event.reqId, error: null };
    case "response": {
      const r = event.response;
      if (!isRecord(r) || typeof r.req_id !== "string") return state;
      // 마지막 요청이 아닌 응답(옛 결과·옛 superseded·옛 오류)은 모두 버린다.
      if (r.req_id !== state.pendingReqId) return state;
      if ("status" in r) {
        // superseded: 더 새 요청이 이미 나갔으니 이 요청이 마지막이면 일어날 수 없다 — 그래도 상태는 바꾸지 않는다.
        if (r.status === "canceled") return { ...state, phase: state.data ? "ready" : "idle", pendingReqId: null };
        return state; // progress·superseded
      }
      if (r.ok === true) {
        if (typeof r.seq === "number" && r.seq !== state.seq) return state;
        const data = parseJudgeResult(r.result, typeof r.elapsed_ms === "number" ? r.elapsed_ms : null);
        if (!data) return { ...state, phase: "error", pendingReqId: null, data: null, error: { code: "INVALID_RESPONSE" } };
        return { ...state, phase: "ready", pendingReqId: null, data, error: null };
      }
      if (r.ok === false) {
        if (typeof r.seq === "number" && r.seq !== state.seq) return state;
        return { ...state, phase: "error", pendingReqId: null, data: null, error: { code: typeof r.code === "string" ? r.code : "UNKNOWN" } };
      }
      return state;
    }
  }
}

/** 판정 요청 봉투(017 protocol.ts의 judge 요청과 같은 모양). 모델 본문은 엔진이 검사한다. */
export function buildJudgeRequest(args: { reqId: string; seq: number; modelRev: string; model: unknown; pendingChanges?: number }) {
  return {
    op: "judge" as const,
    req_id: args.reqId,
    lane: "judge" as const,
    seq: args.seq,
    model_rev: args.modelRev,
    model: args.model,
    ...(args.pendingChanges === undefined ? {} : { pending_changes: args.pendingChanges }),
  };
}
