// 크레딧 잔액 요약(03장 3.3절 크레딧 카드·요약 칸, 3.17절과 같은 계약: core.wallets·core.credit_ledger). 순수 함수만(node --test 대상).
// 조회 훅은 useCreditBalance.ts(크레딧 화면 AR-06-044와 공유 예정). 크레딧은 정수. 오프라인이면 마지막 값 + 기준 시각.

export interface CreditUsage {
  readonly label: string;
  readonly times: number;
  readonly credits: number;
}

export interface CreditSnapshot {
  readonly balance: number;
  /** 이번 달 사용 합계. */
  readonly monthUsed: number;
  readonly usage: readonly CreditUsage[];
  /** 값을 받은 시각(ISO 8601). */
  readonly asOf: string;
  /** 데모 [예시] 값. */
  readonly example: boolean;
}

export type CreditView =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: CreditSnapshot; readonly stale: boolean }
  | { readonly status: "unavailable"; readonly reason: string };

export const CREDIT_CACHE_KEY = "arch.credits.v1";
export const ZERO_CREDIT_TEXT = "도면 작도·판정·내보내기는 0 크레딧입니다.";
export const CREDIT_SIGNED_OUT = "로그인하면(인터넷 연결 후) 잔액이 보입니다.";
export const CREDIT_NOT_CONNECTED = "잔액을 아직 불러올 수 없습니다. 크레딧 화면에서 확인하세요.";

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** 캐시 문자열 → 값. 정수가 아니거나 키가 틀리면 null(신뢰하지 않는다). 캐시에서 읽은 값은 [예시]가 아니다. */
export function parseCreditCache(raw: string | null): CreditSnapshot | null {
  if (!raw || raw.length > 4096) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isInt(o.balance) || !isInt(o.monthUsed) || typeof o.asOf !== "string" || Number.isNaN(Date.parse(o.asOf)) || !Array.isArray(o.usage)) return null;
  const usage: CreditUsage[] = [];
  for (const u of o.usage as unknown[]) {
    if (u === null || typeof u !== "object") return null;
    const r = u as Record<string, unknown>;
    if (typeof r.label !== "string" || r.label === "" || r.label.length > 40 || !isInt(r.times) || !isInt(r.credits)) return null;
    usage.push({ label: r.label, times: r.times, credits: r.credits });
  }
  return { balance: o.balance, monthUsed: o.monthUsed, usage, asOf: o.asOf, example: false };
}

export function serializeCredit(s: CreditSnapshot): string {
  return JSON.stringify({ balance: s.balance, monthUsed: s.monthUsed, usage: s.usage, asOf: s.asOf });
}

/**
 * 화면 상태. 새 값(fetched)이 있으면 그것, 없으면 캐시를 기준 시각과 함께(stale), 둘 다 없으면 이유 문구.
 * 로그인·온라인이 아니면 새 값을 받지 않는다.
 */
export function creditView(input: { readonly signedIn: boolean; readonly online: boolean; readonly fetched: CreditSnapshot | null | undefined; readonly cached: CreditSnapshot | null }): CreditView {
  if (input.signedIn && input.online && input.fetched === undefined) return { status: "loading" };
  if (input.signedIn && input.online && input.fetched) return { status: "ready", snapshot: input.fetched, stale: false };
  if (input.cached) return { status: "ready", snapshot: input.cached, stale: true };
  return { status: "unavailable", reason: input.signedIn && input.online ? CREDIT_NOT_CONNECTED : CREDIT_SIGNED_OUT };
}

/** 이번 달 사용 비율(사용 / (사용 + 잔액), 0~100 정수). 둘 다 0이면 0. */
export function usagePercent(s: CreditSnapshot): number {
  const total = s.monthUsed + s.balance;
  return total === 0 ? 0 : Math.round((s.monthUsed * 100) / total);
}
