// 판정 패널 공개 파일(AR-06-037). 모델러(036)가 `../judgment/index.ts`로 import한다. 패키지 서브패스 진입점은 없다.
// 사용: const j = useJudgment({ model, modelRev, pendingChanges }); <JudgmentPanel phase={j.phase} data={j.data} errorCode={j.error?.code} onRetry={j.retry} ... />
export { JudgmentPanel, StatusBadge, type JudgmentPanelProps, type RevisionCheck } from "./JudgmentPanel.tsx";
export { useJudgment, type UseJudgment, type UseJudgmentArgs } from "./useJudgment.ts";
export type { FallbackNotice } from "./fallback.ts";
// 모델러(036) 좁은 화면 하단 시트 접힘 요약이 패널 머리 요약과 같은 수를 보이도록 공개(AR-06-036 추가).
export { buildRows, countStatuses, type StatusCounts } from "./model.ts";
export type { DisplayStatus, JudgmentData, JudgmentDetailLike, JudgmentWarningLike, RowView } from "./model.ts";
export type { JudgeError, JudgePhase } from "./request.ts";
export { DISCLAIMER } from "./messages.ts";
