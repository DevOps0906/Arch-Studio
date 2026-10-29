// `/projects` 홈(03장 3.3·8.5절, D-33). 소유: AR-06-034. 지금은 셸 규약 예시를 겸한 자리표시자:
// 데이터는 useAdapters().projects(070 ProjectStore)로만 읽고, 빈·로딩·오류 상태를 5장 문구로 보인다.
// 034가 채울 것: "오늘 처리할 일" 줄(8.5 ①), 판정 요약 배지·시트 수·저장 모드 칩(5.1), 새 프로젝트·샘플 시작·이름 바꾸기·삭제·클라우드 사본.
import type { ProjectSummary } from "@arch-studio/shell-bridge";
import { Button, Table } from "@arch-studio/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { EmptyBlock, ErrorState, LoadingState, PageHeader, bridgeErrorText, useAdapters, usePreviewState } from "../shell/index.ts";

type Load = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; items: readonly ProjectSummary[] };

/** 수정일 표시(로캘 비의존, 결정적): YYYY-MM-DD HH:mm(UTC 아님 주의 — 034가 표시 규칙 확정). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function useProjectList() {
  const { projects } = useAdapters();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad({ status: "loading" });
    projects.list().then(
      (items) => alive && setLoad({ status: "ready", items }),
      (error: unknown) => alive && setLoad({ status: "error", error }),
    );
    return () => {
      alive = false;
    };
  }, [projects, tick]);
  return { load, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function Screen() {
  const { load, reload } = useProjectList();
  const preview = usePreviewState("ready");
  const actions = (
    <>
      <Button variant="primary" icon="plus" disabled title="AR-06-034에서 구현">
        새 프로젝트
      </Button>
      <Button disabled title="AR-06-034에서 구현">
        샘플 대지로 시작
      </Button>
    </>
  );

  let body;
  if (preview === "loading" || load.status === "loading") body = <LoadingState label="프로젝트 목록을 불러오는 중" />;
  else if (preview === "error" || load.status === "error")
    body = <ErrorState title="프로젝트 목록을 불러오지 못했습니다" description={bridgeErrorText(load.status === "error" ? load.error : null)} onRetry={reload} />;
  else if (preview === "empty" || load.items.length === 0)
    body = <EmptyBlock icon="box" title="아직 프로젝트가 없습니다" description="예시 대지로 판정과 도면을 먼저 확인해 보세요." action={actions} />;
  else
    body = (
      <Table
        caption="최근 프로젝트"
        columns={[
          { key: "name", header: "이름" },
          { key: "site", header: "대지" },
          { key: "updated", header: "수정일", numeric: true },
        ]}
        rows={load.items.map((p) => ({
          id: p.id,
          name: (
            <Link to={`/projects/${p.id}/model`} className="focus-ring rounded-sm font-medium text-info hover:underline">
              {p.name}
            </Link>
          ),
          site: p.siteLabel ?? "-",
          updated: formatDate(p.updatedAt),
        }))}
      />
    );

  return (
    <div className="flex flex-col gap-gap">
      <PageHeader title="프로젝트" description="만들던 프로젝트를 이어서 엽니다. (자리표시자 · 03장 3.3·8.5절 · AR-06-034)" actions={actions} />
      {body}
    </div>
  );
}
