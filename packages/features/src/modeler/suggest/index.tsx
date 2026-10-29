// 매스 자동 제안 영역 공개 파일(AR-06-028). 모델러(index.tsx)가 이 파일만 import한다.
// 사용: <SuggestSection model={present} editable lockReason preview onApply={(masses) => dispatch(제안 적용 명령)} onClose />
import { useCallback } from "react";
import type { Mass, Model } from "../state/commands.ts";
import { applySuggestion } from "./apply.ts";
import type { SuggestPreviewKind } from "./preview-kind.ts";
import type { SuggestCandidateView } from "./protocol.ts";
import { SuggestPanel } from "./SuggestPanel.tsx";
import { useSuggest } from "./useSuggest.ts";

export { SUGGEST_LABEL, applySuggestion } from "./apply.ts";
export { suggestPreviewKind, type SuggestPreviewKind } from "./preview-kind.ts";

export interface SuggestSectionProps {
  readonly model: Model;
  readonly editable: boolean;
  readonly lockReason: string | null;
  /** `?state=suggest-*` 데모 미리보기 종류(개발 서버만). */
  readonly preview: SuggestPreviewKind | null;
  /** 후보 매스 적용 = 모델러 명령 1개(실행 취소 1단계). 거부되면(열람 잠금 등) 리듀서가 알림을 낸다. */
  readonly onApply: (masses: readonly Mass[]) => void;
  readonly onClose: () => void;
}

export function SuggestSection({ model, editable, lockReason, preview, onApply, onClose }: SuggestSectionProps) {
  const sg = useSuggest(model, preview);
  const apply = useCallback(
    (c: SuggestCandidateView) => {
      // 적용할 수 없는 결과(범위 밖 좌표 등)는 보내지 않는다. 명령 실행은 모델러 리듀서가 한 번 더 검사한다.
      if (!applySuggestion(model, c.masses).ok) return;
      onApply(c.masses);
      sg.markApplied(c.id);
    },
    [model, onApply, sg],
  );
  return <SuggestPanel model={model} state={sg.state} onRequest={sg.request} onApply={apply} onClose={onClose} editable={editable} lockReason={lockReason} />;
}
