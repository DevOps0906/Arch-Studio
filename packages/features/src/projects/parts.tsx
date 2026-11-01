// /projects 화면 조각(표시 전용: 상태는 index.tsx가 갖고 props로만 받는다 → renderToStaticMarkup 테스트 대상).
// 색·크기는 토큰 유틸리티만. 상태색은 아이콘 + 글자와 함께(DESIGN.md 6장).
import { Badge, Input, Select } from "@arch-studio/ui";
import { useId } from "react";
import type { ListQuery, SortKey, StoreFilter } from "./list-query.ts";
import { TEXT } from "./messages.ts";

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

const SORT_OPTIONS: readonly { value: string; label: string; sort: SortKey; dir: "asc" | "desc" }[] = [
  { value: "updated-desc", label: "최근 수정순", sort: "updated", dir: "desc" },
  { value: "updated-asc", label: "오래된 수정순", sort: "updated", dir: "asc" },
  { value: "name-asc", label: "이름 가나다순", sort: "name", dir: "asc" },
  { value: "name-desc", label: "이름 역순", sort: "name", dir: "desc" },
  { value: "violations-desc", label: "초과 많은 순", sort: "violations", dir: "desc" },
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
      <div className="grid grid-cols-2 gap-2 md:flex">
        <div className="flex min-w-0 flex-col gap-1">
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
        <div className="flex min-w-0 flex-col gap-1">
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
    </div>
  );
}
