// 테스트용 가짜 시계: advance(ms)로만 시간이 흐른다. sleep은 즉시 시간을 넘기고 끝난다.
import type { Clock } from "./clock.ts";

export class FakeClock implements Clock {
  t: number;
  timers = new Map<number, { at: number; fn: () => void }>();
  sleeps: number[] = [];
  private seq = 0;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.advance(ms);
  }
  setTimer(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}
