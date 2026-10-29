// 요청 합치기(순수, [DECISION] 1절 "드래그 중 증분"): 응답을 기다리는 동안에는 새 요청을 보내지 않고 마지막 값만 들고 있다가
// 응답이 오면(성공·실패·superseded 모두) 마지막 값을 한 번 보낸다. 드래그 매 프레임 요청이 워커 큐를 채우지 않게 한다.
export interface Coalescer<T> {
  readonly inFlight: boolean;
  readonly pending: T | null;
}

export const idleCoalescer = <T>(): Coalescer<T> => ({ inFlight: false, pending: null });

/** 새 값을 내놓는다. 비어 있으면 바로 보낼 값(send)을 돌려준다. */
export function offer<T>(c: Coalescer<T>, value: T): { state: Coalescer<T>; send: T | null } {
  if (c.inFlight) return { state: { inFlight: true, pending: value }, send: null };
  return { state: { inFlight: true, pending: null }, send: value };
}

/** 보낸 요청이 끝났다. 기다리던 값이 있으면 그것을 보낸다. */
export function settle<T>(c: Coalescer<T>): { state: Coalescer<T>; send: T | null } {
  if (c.pending !== null) return { state: { inFlight: true, pending: null }, send: c.pending };
  return { state: { inFlight: false, pending: null }, send: null };
}

/** 판정 입력 합치기: 판정 중이면 지금 입력을 유지하고, 끝났으면 최신으로 바꾼다. */
export function nextJudgeInput<T>(latest: T, current: T, busy: boolean): T {
  return busy ? current : latest;
}
