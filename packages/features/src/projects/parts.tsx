// /projects 화면 조각(표시 전용: 상태는 index.tsx가 갖고 props로만 받는다 → renderToStaticMarkup 테스트 대상).
// 색·크기는 토큰 유틸리티만. 상태색은 아이콘 + 글자와 함께(DESIGN.md 6장).
import { Badge, Button, Icon, Input, Select, Table, type IconName } from "@arch-studio/ui";
import { useId } from "react";
import { Link } from "react-router";
import type { ListQuery, SortKey, StoreFilter } from "./list-query.ts";
import { formatDate, TEXT } from "./messages.ts";
import type { TodayItem } from "./today.ts";

/**
 * 저장 모드 칩(5.1절, ADR-001 3.2). 클라우드 사본이 확인되면 수동 사본 칩 "이 PC v3 · 클라우드 사본 v2",
 * 아니면 "이 PC에만 · v3". 클라우드를 확인하지 못했으면(undefined) 사본이 없다고 단정하지 않고 로컬 버전만 보인다.
 */
export function StoreChip({ version, cloudVersion }: { version: number; cloudVersion: number | null | undefined }) {
  if (typeof cloudVersion === "number") {
    return (
      <Badge tone="info" icon="download">
        이 PC v{version} · {TEXT.chipCloud} v{cloudVersion}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon="box">
      {cloudVersion === null ? `${TEXT.chipLocal} · v${version}` : `이 PC · v${version}`}
    </Badge>
  );
}

const TODAY_ICON: Record<TodayItem["tone"], IconName> = { warn: "triangle-alert", danger: "circle-x", info: "info" };
const TODAY_TEXT: Record<TodayItem["tone"], string> = { warn: "text-warn", danger: "text-danger", info: "text-info" };

/** "오늘 처리할 일"(8.5절 ①). 항목이 없으면 빈 상태 하나. */
export function TodayBlock({ items, cloudNote, onConflict }: { items: readonly TodayItem[]; cloudNote: string | null; onConflict: () => void }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-h2 font-semibold text-fg">
        {TEXT.todayTitle}
      </h2>
      {items.length === 0 ? (
        // 홈 맨 위 줄이라 큰 빈 상태 상자 대신 한 줄(8.5절 "0이면 칩을 숨긴다"). 목록이 주인공이다.
        <p className="flex items-center gap-2 rounded-panel border border-dashed border-line px-3 py-2 text-body text-fg-2">
          <Icon name="circle-check" className="text-ok" />
          <span>
            <span className="font-medium text-fg">{TEXT.todayEmpty}</span> · {TEXT.todayEmptyDescription}
          </span>
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
              <p className="flex items-center gap-2 text-body font-semibold text-fg">
                <Icon name={TODAY_ICON[item.tone]} className={TODAY_TEXT[item.tone]} />
                {item.title}
              </p>
              <p className="text-caption text-fg-2">{item.detail}</p>
              {item.to ? (
                <Link to={item.to} className="focus-ring self-start rounded-sm text-body text-info underline">
                  {item.action}
                </Link>
              ) : item.id === "conflict" ? (
                <Button size="sm" className="self-start" onClick={onConflict}>
                  {item.action}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cloudNote ? (
        <p className="flex items-center gap-2 text-caption text-fg-2">
          <Icon name="info" className="text-fg-3" />
          {cloudNote}
        </p>
      ) : null}
    </section>
  );
}

const SORT_OPTIONS: readonly { value: string; label: string; sort: SortKey; dir: "asc" | "desc" }[] = [
  { value: "updated-desc", label: "최근 수정순", sort: "updated", dir: "desc" },
  { value: "updated-asc", label: "오래된 수정순", sort: "updated", dir: "asc" },
  { value: "name-asc", label: "이름 가나다순", sort: "name", dir: "asc" },
  { value: "name-desc", label: "이름 역순", sort: "name", dir: "desc" },
];
const STORE_OPTIONS: readonly { value: StoreFilter; label: string }[] = [
  { value: "all", label: "모든 저장 위치" },
  { value: "local", label: "이 PC에만" },
  { value: "cloud", label: "클라우드 사본 있음" },
];

/** 필터 바(검색·저장 위치·정렬). 값은 URL 쿼리(list-query.ts)와 같다. */
export function FilterBar({ query, onChange }: { query: ListQuery; onChange: (next: ListQuery) => void }) {
  const id = useId();
  return (
    <div role="search" className="flex flex-col gap-2 md:flex-row md:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={`${id}-q`} className="text-caption font-medium text-fg-2">
          이름·대지 검색
        </label>
        <Input id={`${id}-q`} type="search" value={query.q} maxLength={80} placeholder="예: 운중동" onChange={(e) => onChange({ ...query, q: e.currentTarget.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-store`} className="text-caption font-medium text-fg-2">
          저장 위치
        </label>
        <Select id={`${id}-store`} value={query.store} onChange={(e) => onChange({ ...query, store: e.currentTarget.value as StoreFilter })}>
          {STORE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-sort`} className="text-caption font-medium text-fg-2">
          정렬
        </label>
        <Select
          id={`${id}-sort`}
          value={`${query.sort}-${query.dir}`}
          onChange={(e) => {
            const o = SORT_OPTIONS.find((x) => x.value === e.currentTarget.value) ?? SORT_OPTIONS[0]!;
            onChange({ ...query, sort: o.sort, dir: o.dir });
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

export interface TableRow {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  readonly updatedAt: string;
  readonly version: number;
  readonly cloudVersion: number | null | undefined;
}

/**
 * 프로젝트 표(DASHBOARD_PATTERNS B 고밀도 표). 판정 요약·시트 수 열은 조회 경로가 없어 두지 않는다(0 표시 금지).
 * 행 작업은 "관리" 하나 → 오른쪽 시트(G시트: 버전 이력 + 이름 바꾸기·삭제). 위험 행동(삭제)은 시트 안쪽에 둔다(패턴 G).
 */
export function ProjectTable({ rows, onManage }: { rows: readonly TableRow[]; onManage: (id: string) => void }) {
  return (
    <Table
      caption="프로젝트 목록"
      columns={[
        { key: "name", header: "이름" },
        { key: "site", header: "대지" },
        { key: "store", header: "저장" },
        { key: "updated", header: "수정일", numeric: true },
        { key: "actions", header: "작업" },
      ]}
      rows={rows.map((p) => ({
        id: p.id,
        name: (
          <Link to={`/projects/${p.id}/model`} className="focus-ring rounded-sm font-medium text-info hover:underline">
            {p.name}
          </Link>
        ),
        site: p.siteLabel ?? "-",
        store: <StoreChip version={p.version} cloudVersion={p.cloudVersion} />,
        updated: <time dateTime={p.updatedAt}>{formatDate(p.updatedAt)}</time>,
        actions: (
          <Button size="sm" variant="ghost" onClick={() => onManage(p.id)} aria-label={`${p.name} 관리`}>
            관리
          </Button>
        ),
      }))}
    />
  );
}
