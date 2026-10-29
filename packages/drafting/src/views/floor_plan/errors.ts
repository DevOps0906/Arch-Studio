// floor_plan 시트 거부(AR051). sheet/errors.ts의 DraftingError는 엔진 불변식 위반(호출자 버그)용이라 고치지 않고,
// 사용자 안내 코드 AR051은 뷰 안의 오류 타입으로 둔다(02_ARCHITECTURE.md floor_plan 행 "AR051이면 시트 생성 거부").
import type { LayoutIssue } from "@arch-studio/layout";

export class FloorPlanError extends Error {
  readonly code = "AR051" as const;
  readonly issues: LayoutIssue[];
  constructor(issues: LayoutIssue[]) {
    super(`[AR051] 실 겹침·외곽 이탈·문창 위치 오류 ${issues.length}건으로 평면 개략도를 만들지 않습니다: ${issues.map((i) => i.detail).join("; ")}`);
    this.name = "FloorPlanError";
    this.issues = issues;
  }
}
