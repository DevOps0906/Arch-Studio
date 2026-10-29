// 프로젝트 관리 시트: 이름 바꾸기·삭제 + 로컬 버전 이력(G시트: 오른쪽 시트, 목록 유지 — DASHBOARD_PATTERNS B). 복원은 새 버전으로 저장(조용한 덮어쓰기 0).
import { Banner, Button, Sheet } from "@arch-studio/ui";
import { LoadingState } from "../shell/index.ts";
import type { RevisionSummary } from "./history.ts";
import { formatDate, TEXT } from "./messages.ts";

export type HistoryLoad =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "unavailable"; readonly current: number }
  | { readonly status: "ready"; readonly items: readonly RevisionSummary[]; readonly current: number };

export function HistorySheet({
  open,
  name,
  load,
  writable,
  busyVersion,
  restoreError,
  onClose,
  onRestore,
  onRename,
  onDelete,
}: {
  open: boolean;
  name: string;
  load: HistoryLoad;
  writable: boolean;
  busyVersion: number | null;
  restoreError: string | null;
  onClose: () => void;
  onRestore: (version: number) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={name}>
      <div className="flex flex-col gap-gap">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!writable} onClick={onRename}>
            이름 바꾸기
          </Button>
          <Button size="sm" variant="danger" disabled={!writable} onClick={onDelete}>
            삭제
          </Button>
        </div>
        {!writable ? <p className="text-caption text-fg-2">지금은 열람만 됩니다. 이름 바꾸기·삭제·복원은 편집 권한과 쓸 수 있는 저장소가 필요합니다.</p> : null}
        <h3 className="text-body font-semibold text-fg">{TEXT.historyTitle}</h3>
        <p className="text-caption text-fg-2">복원하면 고른 버전의 내용이 새 버전으로 저장됩니다. 기존 버전은 지워지지 않습니다.</p>
        {restoreError ? <Banner tone="danger" title="복원하지 못했습니다">{restoreError}</Banner> : null}
        {load.status === "loading" ? (
          <LoadingState label="버전 이력을 불러오는 중" rows={2} />
        ) : load.status === "error" ? (
          <Banner tone="danger" title="버전 이력을 불러오지 못했습니다">
            {load.message}
          </Banner>
        ) : load.status === "unavailable" ? (
          <Banner tone="info" title={`지금 버전 v${load.current}`}>
            {TEXT.historyUnavailable}
          </Banner>
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
            {load.items.map((r) => (
              <li key={r.version} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-body font-semibold text-fg">
                    v{r.version}
                    {r.version === load.current ? <span className="ml-2 text-caption font-medium text-fg-2">지금 버전</span> : null}
                  </p>
                  <p className="text-caption text-fg-2">
                    <time dateTime={r.savedAt}>{formatDate(r.savedAt)}</time>
                    {r.note ? ` · ${r.note}` : ""}
                    <span className="text-num tabular-nums"> · {r.sha256.slice(0, 8)}</span>
                  </p>
                </div>
                {r.version !== load.current ? (
                  <Button size="sm" disabled={!writable || busyVersion !== null} loading={busyVersion === r.version} onClick={() => onRestore(r.version)}>
                    이 버전으로 복원
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Sheet>
  );
}
