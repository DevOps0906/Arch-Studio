// 위키 목업 어댑터(개발 데모 전용, AR-06-055). 서버 경로 GET /api/ai/wiki/pages가 생기기 전 화면 확인용.
// 화면은 데모 모드에서만 동적 import한다(릴리스 번들의 실행 경로에 없음). 내용은 "예시" 표시 문장이며 법적 근거가 아니다.
import type { WikiList, WikiListItem, WikiPage, WikiSource } from "./model.ts";

const PAGES: readonly WikiPage[] = [
  {
    slug: "ordinance/far-by-municipality",
    title: "[예시] 지자체별 용적률 조례 차이 읽는 법",
    category: "ordinance_diff",
    body_md:
      "## 무엇을 보나\n같은 용도지역이라도 지자체 조례가 정한 상한이 다를 수 있습니다.\n\n## 확인 순서\n- 대지의 용도지역 확인\n- 해당 지자체 도시계획 조례의 상한 조항 확인\n- 지구단위계획 구역이면 계획 결정 고시 확인",
    sources: [{ title: "국토의 계획 및 이용에 관한 법률 시행령 제85조", checked_at: "2026-10-20" }],
    links: [{ label: "규칙 팩 항목: 용적률" }],
    revisions: [{ date: "2026-10-20", sections: ["확인 순서"] }],
    checked_at: "2026-10-20",
    stale: false,
  },
  {
    slug: "qa/sunlight-setback",
    title: "[예시] 정북 방향 일조 사선 질의회신 요약",
    category: "qa_summary",
    body_md: "## 요지\n전용주거지역과 일반주거지역의 일조 사선 적용 기준을 질의회신으로 정리한 예시 문서입니다.\n\n개별 사안은 허가권자 판단을 따릅니다.",
    sources: [{ title: "건축법 시행령 제86조", checked_at: "2026-08-02" }],
    links: [{ label: "규칙 팩 항목: 일조 사선" }],
    revisions: [{ date: "2026-08-02", sections: ["요지"] }],
    checked_at: "2026-08-02",
    stale: true,
  },
  {
    slug: "glossary/building-coverage",
    title: "[예시] 건폐율",
    category: "glossary",
    body_md: "대지면적에 대한 건축면적의 비율입니다. 판정 값은 로컬 규칙 엔진이 계산합니다.",
    sources: [{ title: "건축법 제55조", checked_at: "2026-10-01" }],
    links: [],
    revisions: [],
    checked_at: "2026-10-01",
    stale: false,
  },
];

export function mockWikiSource(): WikiSource {
  return {
    list: async (query): Promise<WikiList> => {
      const q = query.q.trim();
      const items: WikiListItem[] = PAGES.filter((p) => (!query.category || p.category === query.category) && (!q || p.title.includes(q))).map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        checked_at: p.checked_at,
        stale: p.stale,
      }));
      return { items, next: null };
    },
    page: async (slug): Promise<WikiPage> => {
      const p = PAGES.find((x) => x.slug === slug);
      if (!p) throw new Error("not_found");
      return p;
    },
  };
}
