// 시간·타이머 주입점. 순수 로직은 이 인터페이스만 받아서 테스트에서 가짜 시계로 돌린다.
export interface Clock {
  now(): number;
  /** ms 동안 기다린다. signal이 abort되면 바로 끝난다. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    }),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
