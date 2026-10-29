// 실행 취소·다시 실행 이력(순수, AR-F-003 100단계). 불변 모델 참조 + 명령 라벨([DECISION] 1절: 구조 공유).
// 명령 함수가 바뀐 매스만 새로 만들기 때문에 이력 100개는 바뀐 부분만 보관한다(매스 50개·1개 이동 100단계 ≈ 156KB, 스파이크 측정).
// 되돌리기는 참조 교체 O(1). 상한을 넘으면 가장 오래된 단계를 버린다.
import type { Model } from "./commands.ts";

export const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  readonly model: Model;
  /** 이 모델에서 다음 모델로 바꾼 명령 이름(예: "매스 이동"). 실행 취소·다시 실행 알림에 쓴다. */
  readonly label: string;
}

export interface History {
  readonly past: readonly HistoryEntry[];
  readonly present: Model;
  readonly future: readonly HistoryEntry[];
}

export function createHistory(model: Model): History {
  return { past: [], present: model, future: [] };
}

/** 새 모델 기록. 같은 참조면 그대로(빈 명령은 쌓지 않는다). 다시 실행 목록은 비운다. */
export function pushHistory(h: History, model: Model, label: string, limit = HISTORY_LIMIT): History {
  if (model === h.present) return h;
  const past = [...h.past, { model: h.present, label }];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: model, future: [] };
}

export function undo(h: History): { history: History; label: string | null } {
  const last = h.past[h.past.length - 1];
  if (!last) return { history: h, label: null };
  return {
    history: { past: h.past.slice(0, -1), present: last.model, future: [{ model: h.present, label: last.label }, ...h.future] },
    label: last.label,
  };
}

export function redo(h: History): { history: History; label: string | null } {
  const next = h.future[0];
  if (!next) return { history: h, label: null };
  return {
    history: { past: [...h.past, { model: h.present, label: next.label }], present: next.model, future: h.future.slice(1) },
    label: next.label,
  };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
