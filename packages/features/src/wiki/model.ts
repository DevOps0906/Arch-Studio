// 법규 해설 위키 순수 로직(AR-06-055, 03장 3.13절). 계약(04_API.md 2.1절 끝 문단, 읽기 전용·0크레딧·전 상태 열람):
//   GET /api/ai/wiki/pages?category&q&cursor → { items: [{ slug, title, category, checked_at, stale }], next }
//   GET /api/ai/wiki/pages/{slug}            → 본문 body_md, 출처·확인일, 링크, 개정 이력, 최근 점검일
// 서버 경로는 아직 없다(tasks/logs/AR-06-055.md). 페이지 응답의 칸 이름은 문서 문장에서 정한 제안값이라 서버가 생기면 맞춘다.
import type { ApiClient } from "../api-client/index.ts";

export const WIKI_PATH = "/api/ai/wiki/pages";

export type WikiCategory = "ordinance_diff" | "qa_summary" | "glossary";
export const WIKI_CATEGORIES: ReadonlyArray<{ readonly id: WikiCategory; readonly label: string }> = [
  { id: "ordinance_diff", label: "조례별 차이" },
  { id: "qa_summary", label: "질의회신 요약" },
  { id: "glossary", label: "용어" },
];
const CATEGORY_IDS: ReadonlySet<string> = new Set(WIKI_CATEGORIES.map((c) => c.id));

export function categoryLabel(c: string): string {
  return WIKI_CATEGORIES.find((x) => x.id === c)?.label ?? c;
}

export interface WikiListItem {
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  /** 확인일(YYYY-MM-DD 또는 RFC 3339). */
  readonly checked_at: string;
  /** 출처 확인 필요(위키 점검에서 낡은 출처·깨진 링크). */
  readonly stale: boolean;
}
export interface WikiList {
  readonly items: readonly WikiListItem[];
  readonly next: string | null;
}
export interface WikiSourceRef {
  readonly title: string;
  readonly checked_at: string;
  readonly url?: string;
}
export interface WikiPage {
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  readonly body_md: string;
  readonly sources: readonly WikiSourceRef[];
  readonly links: ReadonlyArray<{ readonly label: string; readonly slug?: string }>;
  readonly revisions: ReadonlyArray<{ readonly date: string; readonly sections: readonly string[] }>;
  /** 최근 점검일. */
  readonly checked_at: string;
  readonly stale: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const SLUG_RE = /^[a-z0-9][a-z0-9/_-]{0,199}$/;

export function isSlug(s: string): boolean {
  return SLUG_RE.test(s) && !s.includes("..");
}

export function parseList(data: unknown): WikiList {
  if (!isObj(data) || !Array.isArray(data["items"])) throw new Error("invalid");
  const items = data["items"].flatMap((it): WikiListItem[] =>
    isObj(it) && isStr(it["slug"]) && isSlug(it["slug"]) && isStr(it["title"]) && isStr(it["category"]) && isStr(it["checked_at"])
      ? [{ slug: it["slug"], title: it["title"], category: it["category"], checked_at: it["checked_at"], stale: it["stale"] === true }]
      : [],
  );
  return { items, next: isStr(data["next"]) && data["next"] !== "" ? data["next"] : null };
}

export function parsePage(data: unknown): WikiPage {
  if (!isObj(data) || !isStr(data["slug"]) || !isStr(data["title"]) || !isStr(data["body_md"])) throw new Error("invalid");
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    slug: data["slug"],
    title: data["title"],
    category: isStr(data["category"]) ? data["category"] : "",
    body_md: data["body_md"],
    sources: arr(data["sources"]).flatMap((s): WikiSourceRef[] =>
      isObj(s) && isStr(s["title"]) && isStr(s["checked_at"])
        ? [{ title: s["title"], checked_at: s["checked_at"], ...(isStr(s["url"]) && /^https:\/\//.test(s["url"]) ? { url: s["url"] } : {}) }]
        : [],
    ),
    links: arr(data["links"]).flatMap((l) =>
      isObj(l) && isStr(l["label"]) ? [{ label: l["label"], ...(isStr(l["slug"]) && isSlug(l["slug"]) ? { slug: l["slug"] } : {}) }] : [],
    ),
    revisions: arr(data["revisions"]).flatMap((r) =>
      isObj(r) && isStr(r["date"]) ? [{ date: r["date"], sections: arr(r["sections"]).filter(isStr) }] : [],
    ),
    checked_at: isStr(data["checked_at"]) ? data["checked_at"] : "",
    stale: data["stale"] === true,
  };
}

/** 날짜 표시: 앞 10자(YYYY-MM-DD). 모양이 다르면 그대로. */
export function dateOnly(s: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** 본문(마크다운)을 단락·제목 블록으로만 나눈다(HTML로 해석하지 않음 → 주입 없음). */
export type WikiBlock = { readonly kind: "heading" | "paragraph" | "item"; readonly text: string };
export function wikiBlocks(md: string): WikiBlock[] {
  const out: WikiBlock[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") flush();
    else if (/^#{1,6}\s/.test(line)) {
      flush();
      out.push({ kind: "heading", text: line.replace(/^#{1,6}\s+/, "") });
    } else if (/^[-*]\s/.test(line)) {
      flush();
      out.push({ kind: "item", text: line.replace(/^[-*]\s+/, "") });
    } else para.push(line.replace(/\*\*|__|`/g, ""));
  }
  flush();
  return out;
}

/* ---------- 데이터 소스(어댑터) ---------- */
export interface WikiQuery {
  readonly category: WikiCategory | null;
  readonly q: string;
  readonly cursor: string | null;
}
export interface WikiSource {
  list(query: WikiQuery, signal?: AbortSignal): Promise<WikiList>;
  page(slug: string, signal?: AbortSignal): Promise<WikiPage>;
}

export function httpWikiSource(api: ApiClient): WikiSource {
  return {
    list: (query, signal) =>
      api.request({
        method: "GET",
        path: WIKI_PATH,
        query: {
          ...(query.category && CATEGORY_IDS.has(query.category) ? { category: query.category } : {}),
          ...(query.q.trim() ? { q: query.q.trim().slice(0, 100) } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        parse: parseList,
        ...(signal ? { signal } : {}),
      }),
    page: (slug, signal) => {
      if (!isSlug(slug)) return Promise.reject(new Error("invalid_slug"));
      const path = `${WIKI_PATH}/${slug.split("/").map(encodeURIComponent).join("/")}`;
      return api.request({ method: "GET", path, parse: parsePage, ...(signal ? { signal } : {}) });
    },
  };
}
