// 프로젝트 목록 정렬·필터(DASHBOARD_PATTERNS B "필터·정렬 상태를 URL에 남김"). 순수 함수만(node --test 대상).
// URL 키: sort(updated|name|violations — 초과 많은 순은 판정 기록으로 dashboard.ts sortCards가 정렬) · dir(asc|desc) · q(이름·대지 검색, 80자) · store(all|local|cloud). 기본값은 URL에 쓰지 않는다.
// 다른 쿼리(?state=·?demo-*)는 그대로 둔다.

export const SORT_KEYS = ["updated", "name", "violations"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const STORE_FILTERS = ["all", "local", "cloud"] as const;
export type StoreFilter = (typeof STORE_FILTERS)[number];

export interface ListQuery {
  readonly sort: SortKey;
  readonly dir: "asc" | "desc";
  readonly q: string;
  readonly store: StoreFilter;
}

export const QUERY_MAX_CHARS = 80;
export const DEFAULT_QUERY: ListQuery = Object.freeze({ sort: "updated", dir: "desc", q: "", store: "all" });

/** 정렬 키별 기본 방향: 수정일은 최근 먼저, 이름은 가나다순. */
export function defaultDir(sort: SortKey): "asc" | "desc" {
  return sort === "name" ? "asc" : "desc";
}

const pick = <T extends string>(allowed: readonly T[], v: string | null): T | null =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** URL → 상태. 모르는 값은 기본값(오류 없이). 검색어는 앞뒤 공백 제거·80자 자름. */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const sort = pick(SORT_KEYS, params.get("sort")) ?? DEFAULT_QUERY.sort;
  const dir = pick(["asc", "desc"] as const, params.get("dir")) ?? defaultDir(sort);
  const q = Array.from((params.get("q") ?? "").trim()).slice(0, QUERY_MAX_CHARS).join("");
  const store = pick(STORE_FILTERS, params.get("store")) ?? DEFAULT_QUERY.store;
  return { sort, dir, q, store };
}

/** 상태 → URL. 기본값인 키는 지우고 나머지 쿼리는 보존한다(새 객체를 돌려준다). */
export function writeListQuery(base: URLSearchParams, query: ListQuery): URLSearchParams {
  const next = new URLSearchParams(base);
  const set = (key: string, value: string, isDefault: boolean) => (isDefault ? next.delete(key) : next.set(key, value));
  set("sort", query.sort, query.sort === DEFAULT_QUERY.sort);
  set("dir", query.dir, query.dir === defaultDir(query.sort));
  const q = Array.from(query.q.trim()).slice(0, QUERY_MAX_CHARS).join("");
  set("q", q, q === "");
  set("store", query.store, query.store === DEFAULT_QUERY.store);
  return next;
}

export interface ListRow {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  readonly updatedAt: string;
  /** 클라우드 사본이 있으면 그 버전, 없으면 null(확인 못 했으면 undefined). */
  readonly cloudVersion?: number | null;
}

const collator = new Intl.Collator("ko", { sensitivity: "base", numeric: true });

/**
 * 필터·정렬 적용. 같은 값이면 id로 순서를 고정한다(결정적). store 필터는 클라우드 확인이 안 된 행(undefined)을
 * "cloud"에서 빼고 "local"에는 넣는다(사본이 있다고 보이지 않게: 확인된 것만 클라우드 사본).
 */
export function applyListQuery<T extends ListRow>(rows: readonly T[], query: ListQuery): T[] {
  const needle = query.q.toLocaleLowerCase("ko");
  const filtered = rows.filter((r) => {
    if (needle && !`${r.name}\n${r.siteLabel ?? ""}`.toLocaleLowerCase("ko").includes(needle)) return false;
    if (query.store === "cloud") return typeof r.cloudVersion === "number";
    if (query.store === "local") return typeof r.cloudVersion !== "number";
    return true;
  });
  const sign = query.dir === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    const primary = query.sort === "name" ? collator.compare(a.name, b.name) : a.updatedAt.localeCompare(b.updatedAt);
    return primary !== 0 ? primary * sign : a.id.localeCompare(b.id);
  });
}

/** 필터 결과 없음과 데이터 없음을 구분한다(DASHBOARD_PATTERNS B). */
export function isFiltered(query: ListQuery): boolean {
  return query.q !== "" || query.store !== "all";
}
