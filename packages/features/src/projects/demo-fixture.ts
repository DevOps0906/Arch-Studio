// 개발 데모 전용 픽스처(useDemoMode()가 참일 때만 쓴다). 데모 어댑터·데모 fetch는 셸 소유라 클라우드 목록이 없다(404):
// 화면의 "클라우드 사본" 칩을 데모에서 보이려고, id가 가장 작은(가장 먼저 만든) 프로젝트에 클라우드 사본 v2가 있다고 가정한다. 값은 [예시].
// 데모 표식(DEMO_MARKER)과 demo/ 모듈을 import하지 않는다(릴리스 번들 검사 대상 문자열이 프로덕션 청크에 들어가지 않게).
import type { CloudList } from "./cloud.ts";
import type { CreditSnapshot } from "./credit.ts";
import type { VerdictFacts } from "./dashboard.ts";

export function demoCloudList(localIds: readonly string[], updatedAt: string): CloudList {
  const first = [...localIds].sort()[0];
  return {
    items: first
      ? [{ projectUuid: "0192f0a0-1c00-4a01-8a01-00000000c10d", localId: first, name: "[예시] 클라우드 사본", version: 2, bytes: 48_213, updatedAt }]
      : [],
    next: null,
    max: 3,
    retentionUntil: null,
  };
}

/** 데모 크레딧 [예시](3.17절 계약 모양). 사용 합계 = 항목 합. */
export function demoCredit(): CreditSnapshot {
  return {
    balance: 30,
    monthUsed: 18,
    usage: [
      { label: "렌더", times: 1, credits: 10 },
      { label: "대화형 입력", times: 4, credits: 8 },
    ],
    asOf: "2026-11-02T00:00:00.000Z",
    example: true,
  };
}

/**
 * 데모 판정 기록 [예시]: 로컬 judgment_snapshots 조회 경로가 아직 없어(운영은 "판정 기록 없음") 카드 배지·정렬을 보이려고
 * id 순 앞 3개 프로젝트에만 값을 둔다. 실제 판정 결과를 약속하지 않는다(화면에 [예시] 표기).
 */
const DEMO_VERDICTS: readonly Omit<VerdictFacts, "example">[] = [
  { pass: 4, warn: 1, fail: 1 },
  { pass: 6, warn: 0, fail: 2 },
  { pass: 5, warn: 2, fail: 0 },
];

export function demoVerdicts(localIds: readonly string[]): ReadonlyMap<string, VerdictFacts> {
  const out = new Map<string, VerdictFacts>();
  [...localIds].sort().forEach((id, i) => {
    const v = DEMO_VERDICTS[i];
    if (v) out.set(id, { ...v, example: true });
  });
  return out;
}

/** 미리보기 상태(`?state=`). 데모 모드에서만 읽는다(릴리스 화면은 데이터 상태로만 그린다). */
export const PREVIEW_STATES = ["loading", "error", "empty", "conflict", "conflict-cloud", "ar060", "ar061", "manage"] as const;
export type ProjectsPreview = (typeof PREVIEW_STATES)[number];

export function parsePreview(value: string | null): ProjectsPreview | null {
  return value !== null && (PREVIEW_STATES as readonly string[]).includes(value) ? (value as ProjectsPreview) : null;
}
