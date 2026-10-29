// 폴백 배너 로직(순수). EntitlementStatus에 업데이트 기한 필드가 아직 없어(074·044) 값은 props로 주입받는다.
// 문구는 03장 2.7절 단계 2: "판정 기준: 규칙 팩 <버전>(기준일 <날짜>). 이후 개정 <n>건." + "개정 목록 보기" + "업데이트 연장".

/** 업데이트 만료 폴백 정보(앱 시작 때 라이선스 파일 updates_until < 오늘이면 만든다 — 연결은 044). */
export interface FallbackNotice {
  /** 판정에 쓰는 마지막 규칙 팩 버전. */
  readonly packVersion: string;
  /** 규칙 팩 기준일(YYYY-MM-DD). */
  readonly basisDate: string;
  /** 이후 개정 건수(서버 arch.rule_pack_changes). 오프라인이라 모르면 null. */
  readonly pendingChanges: number | null;
}

export function fallbackSentence(n: FallbackNotice): string {
  const head = `판정 기준: 규칙 팩 ${n.packVersion}(기준일 ${n.basisDate}).`;
  return n.pendingChanges === null ? `${head} 이후 개정 건수는 온라인에서 확인합니다.` : `${head} 이후 개정 ${n.pendingChanges}건.`;
}

export const FALLBACK_BANNER_TITLE = "업데이트 기간이 끝나 마지막 규칙 팩으로 판정합니다";
export const SHOW_LIST_LABEL = "개정 목록 보기";
export const EXTEND_LABEL = "업데이트 연장";

/** 마지막 개정 확인 뒤 이 일수가 지나면 "개정 확인 필요"(제안, 03장 확정 전). */
export const REVISION_CHECK_STALE_DAYS = 30;
export const REVISION_CHECK_TITLE = "개정 확인 필요";
export const CHECK_NOW_LABEL = "지금 확인";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function dayNumber(iso: string): number | null {
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : Math.floor(t / 86_400_000);
}

/** 두 날짜(YYYY-MM-DD…) 사이 일수. 형식이 틀리면 null. 시계를 읽지 않는다(today는 호출자가 준다). */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = dayNumber(fromIso);
  const b = dayNumber(toIso);
  return a === null || b === null ? null : b - a;
}

/** 개정 확인이 오래됐는가: 기록 없음·형식 오류·미래 날짜 아님 + 30일 이상이면 참. */
export function revisionCheckStale(lastCheckedAt: string | null | undefined, today: string): boolean {
  if (!lastCheckedAt) return true;
  const d = daysBetween(lastCheckedAt, today);
  return d === null || d >= REVISION_CHECK_STALE_DAYS;
}

export function revisionCheckSentence(lastCheckedAt: string | null | undefined, today: string): string {
  const d = lastCheckedAt ? daysBetween(lastCheckedAt, today) : null;
  const since = d === null ? "개정 확인 기록이 없습니다." : `마지막 개정 확인이 ${d}일 전입니다.`;
  return `${since} 온라인에서 규칙 팩 개정을 확인하세요. 확인하기 전 판정은 최신 법규와 다를 수 있습니다.`;
}
