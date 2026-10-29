// 실행취소 이력(순수·불변). 값 T는 통째로 바꾸는 스냅샷이다(구조 공유라 100단계도 가볍다). 03장 6.1절: 모델 100단계.
// coalesce: 같은 키가 연속이면 한 단계로 합친다(화살표 연타). 취소·다시 실행·다른 키가 오면 끊긴다.
export const HISTORY_LIMIT = 100;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  readonly key: string | null;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], key: null };
}

export function commit<T>(h: History<T>, next: T, coalesce: string | null = null): History<T> {
  if (Object.is(next, h.present)) return h;
  if (coalesce !== null && h.key === coalesce && h.past.length > 0) return { ...h, present: next, future: [] };
  const past = [...h.past, h.present];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [], key: coalesce };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], key: null };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1), key: null };
}
