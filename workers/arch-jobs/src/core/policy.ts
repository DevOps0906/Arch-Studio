import type { Clock } from "./clock.ts";
import { JobTimeoutError } from "./errors.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export interface JobPolicy {
  timeoutMs: number;
  /** 타임아웃을 재시도 대상으로 볼지. 재시도 횟수 한도는 jobs.max_attempts(start_ai_run은 2 = 재시도 1회). */
  retryOnTimeout: boolean;
}

// 02_ARCHITECTURE.md 4절 잡 표. "제안" 표시는 문서에 수치가 없어 정한 값(팀장 확인).
export const JOB_POLICIES: Readonly<Record<string, JobPolicy>> = {
  "arch.render": { timeoutMs: 3 * MINUTE, retryOnTimeout: false }, // 3분 초과 → 환불, 재시도는 제출·네트워크 오류만
  "arch.review": { timeoutMs: 10 * MINUTE, retryOnTimeout: true }, // 10분 초과, 타임아웃 재시도 1회
  "arch.proposal_pdf": { timeoutMs: 5 * MINUTE, retryOnTimeout: true }, // 제안: 서술+조립 합계. PDF 렌더 단계 120초는 핸들러가 건다
  "arch.intake": { timeoutMs: 5 * MINUTE, retryOnTimeout: false }, // 제안: 재시도는 제공자 오류만
  "arch.stt": { timeoutMs: 30 * MINUTE, retryOnTimeout: false }, // 제안: 녹음 최대 2시간 기준
};

export const DEFAULT_POLICY: JobPolicy = { timeoutMs: 5 * MINUTE, retryOnTimeout: false };

export function policyFor(jobType: string): JobPolicy {
  return JOB_POLICIES[jobType] ?? DEFAULT_POLICY;
}

/** fail_job의 재큐잉 시각과 같은 계산: base * 2^(attempts-1)초 뒤(SQL과 동치, 표시·테스트용). */
export function retryAt(now: number, attempts: number, baseDelaySeconds: number): number {
  return now + baseDelaySeconds * 2 ** Math.max(attempts - 1, 0) * SECOND;
}

/** 빈 폴링이 이어질 때 대기 시간: min * 2^streak, max 상한. */
export function idleDelayMs(emptyStreak: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, minMs * 2 ** Math.max(emptyStreak, 0));
}

/**
 * fn을 timeoutMs 안에 끝내지 못하면 signal을 abort하고 JobTimeoutError로 끝낸다.
 * 바깥 signal(종료 요청·하트비트 잠금 상실)도 같은 signal로 전달한다.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  clock: Clock,
  outer?: AbortSignal,
): Promise<T> {
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort(outer?.reason);
  if (outer?.aborted) onOuter();
  outer?.addEventListener("abort", onOuter, { once: true });
  let timer: unknown;
  const timeout = new Promise<never>((_, reject) => {
    timer = clock.setTimer(() => {
      const err = new JobTimeoutError(timeoutMs);
      ctrl.abort(err);
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeout]);
  } finally {
    clock.clearTimer(timer);
    outer?.removeEventListener("abort", onOuter);
  }
}
