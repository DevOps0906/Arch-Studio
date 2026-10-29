// 개발 데모 전용 픽스처(useDemoMode()가 참일 때만 쓴다). 데모 어댑터·데모 fetch는 셸 소유라 클라우드 목록이 없다(404):
// 화면의 "클라우드 사본" 칩을 데모에서 보이려고, id가 가장 작은(가장 먼저 만든) 프로젝트에 클라우드 사본 v2가 있다고 가정한다. 값은 [예시].
// 데모 표식(DEMO_MARKER)과 demo/ 모듈을 import하지 않는다(릴리스 번들 검사 대상 문자열이 프로덕션 청크에 들어가지 않게).
import type { CloudList } from "./cloud.ts";

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

/** 미리보기 상태(`?state=`). 데모 모드에서만 읽는다(릴리스 화면은 데이터 상태로만 그린다). */
export const PREVIEW_STATES = ["loading", "error", "empty", "conflict", "conflict-cloud", "ar060", "ar061", "manage"] as const;
export type ProjectsPreview = (typeof PREVIEW_STATES)[number];

export function parsePreview(value: string | null): ProjectsPreview | null {
  return value !== null && (PREVIEW_STATES as readonly string[]).includes(value) ? (value as ProjectsPreview) : null;
}
