// 홈 "오늘 처리할 일"(03장 8.5절 ①, D-33 기본값). 순수 함수(node --test 대상).
// 근거 데이터가 있는 항목만 만든다: 열람 모드(편집 권리 거부), 폴백(권리 사유 fallback), 이 세션의 충돌.
// 저장소 읽기 전용(AR061)은 화면 맨 위 배너가, 저장소 손상(AR060)은 목록 자리의 복구 안내가 맡는다(같은 내용을 두 번 보이지 않게).
// 클라우드 검토 결과·실패 AI 작업·새 규칙 팩 개정 건수·체험 만료 임박은 조회 경로가 아직 없어 만들지 않는다(수집하지 않은 지표의 0 표시 금지, 8.6절).
import type { EntitlementDecision } from "@arch-studio/shell-bridge";
import { TEXT, viewOnlyReason } from "./messages.ts";

export type TodayTone = "warn" | "danger" | "info";

export interface TodayItem {
  readonly id: "view-only" | "fallback" | "conflict";
  readonly tone: TodayTone;
  readonly title: string;
  readonly detail: string;
  /** 누르면 갈 곳. "conflict"는 대화상자를 연다(경로 없음). */
  readonly to: string | null;
  readonly action: string;
}

export interface TodayInput {
  /** desktop_edit(로컬 편집) 판정. 판정 중이면 undefined → 항목 없음. */
  readonly edit: EntitlementDecision | undefined;
  /** cloud_review 판정(폴백 사유를 보려고 읽는다). */
  readonly cloudReview: EntitlementDecision | undefined;
  /** 이 세션에서 생긴 저장 충돌 중 아직 고르지 않은 건수. */
  readonly openConflicts: number;
}

export function todayItems(input: TodayInput): TodayItem[] {
  const out: TodayItem[] = [];
  if (input.openConflicts > 0) {
    out.push({
      id: "conflict",
      tone: "danger",
      title: `저장 충돌 ${input.openConflicts}건`,
      detail: "다른 곳에서 먼저 저장되어 내 변경을 저장하지 않았습니다. 사본으로 저장하거나 최신을 여세요.",
      to: null,
      action: "고르기",
    });
  }
  const viewOnly = viewOnlyReason(input.edit);
  if (viewOnly) {
    out.push({ id: "view-only", tone: "warn", title: TEXT.viewOnlyTitle, detail: viewOnly, to: "/license", action: "라이선스 보기" });
  } else if (input.cloudReview && !input.cloudReview.allowed && input.cloudReview.reason === "fallback") {
    out.push({
      id: "fallback",
      tone: "info",
      title: "업데이트 만료(폴백)",
      detail: "로컬 판정·도면은 그대로 됩니다. 클라우드 법규 검토는 업데이트 플랜에서 씁니다.",
      to: "/license",
      action: "업데이트 연장 보기",
    });
  }
  return out;
}
