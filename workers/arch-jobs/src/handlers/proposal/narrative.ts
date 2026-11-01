// 서술 섹션(arch.proposal_narrative) 호출 인터페이스. 실제 구현은 기존 AI 게이트 경로 그대로:
// JobTokenClient.get(job_id, "graph:arch.proposal_narrative")로 잡 토큰을 받아 FastAPI `POST /products/arch/proposal/narrative`
// (04_API.md 6.3절)를 부른다 — Python narrative.py와 함께 다음 단계에서 붙인다(지금은 모의 구현만).
// 서술에는 수치를 넣지 않는다: 요약에는 열거값(문서 종류·판정 항목·판정 결과)만 보내고(자유 문장·숫자 없음),
// 돌아온 문장에 숫자가 하나라도 있으면 재시도 없이 실패시킨다. 판정·면적·공사비 수치는 HTML 템플릿이 스냅샷에서만 넣는다.
import type { ContentFile, JudgmentKey, Verdict } from "./content.ts";

/** 서술 입력(숫자·자유 문장 없음). */
export interface NarrativeSummary {
  doc_kind: "proposal";
  verdicts: { key: JudgmentKey; verdict: Verdict }[];
  has_cost: boolean;
  sheet_count_label: "none" | "some";
}

export interface NarrativeSection {
  heading: string;
  body: string;
}

export interface NarrativeOutput {
  sections: NarrativeSection[];
  /** proposals.narrative.model(120자 이내). */
  model: string;
}

export interface NarrativeRequest {
  jobId: string;
  summary: NarrativeSummary;
  signal: AbortSignal;
}

export interface NarrativeClient {
  /** 국외 제공자로 보내는가. 설정(ARCH_PROPOSAL_NARRATIVE_ROUTE)이 "oss"인데 true면 핸들러가 부르지 않고 실패시킨다(웹이 동의 확인을 건너뛴 경로). */
  readonly crossBorder: boolean;
  narrate(req: NarrativeRequest): Promise<NarrativeOutput>;
}

export function narrativeSummaryOf(file: ContentFile): NarrativeSummary {
  return {
    doc_kind: "proposal",
    verdicts: file.content.judgment.items.map((it) => ({ key: it.key, verdict: it.verdict })),
    has_cost: file.content.cost !== undefined,
    sheet_count_label: file.sheet_sha256.length > 0 ? "some" : "none",
  };
}

/** 숫자(ASCII·전각·로마 숫자·원문자 등 유니코드 Nd·Nl·No)와 한자 숫자(번체·간체·갖은자)가 있는가. 있으면 서술로 쓰지 않는다. */
const NUMERIC_RE = /[\p{N}〇零一二两兩三四五六七八九十廿百千萬万億亿兆壹貳贰參叁拾佰仟]/u;
/** 한글 수사 + 단위(예: "삼십 퍼센트", "이층", "오천만 원"). 수사 글자 뒤에 단위가 바로 오는 경우만 막는다("일반"·"이웃"은 통과). */
const KOREAN_NUMERAL_UNIT_RE = /[일이삼사오육칠팔구십백천만억]+\s*(?:퍼센트|프로|%|미터|m|층|㎡|제곱미터|평|원|대|개|세대)/u;

export const NARRATIVE_LIMITS = { sections: 8, heading: 60, body: 2000 } as const;

/** 서술 출력 검사. 통과하면 그대로, 아니면 null. */
export function checkNarrative(out: NarrativeOutput): NarrativeOutput | null {
  if (!Array.isArray(out.sections) || out.sections.length === 0 || out.sections.length > NARRATIVE_LIMITS.sections) return null;
  if (typeof out.model !== "string" || out.model.length === 0) return null;
  for (const s of out.sections) {
    if (typeof s.heading !== "string" || typeof s.body !== "string") return null;
    if (s.heading.length === 0 || s.heading.length > NARRATIVE_LIMITS.heading || s.body.length === 0 || s.body.length > NARRATIVE_LIMITS.body) return null;
    for (const t of [s.heading, s.body]) if (NUMERIC_RE.test(t) || KOREAN_NUMERAL_UNIT_RE.test(t)) return null;
  }
  return { sections: out.sections.map((s) => ({ heading: s.heading, body: s.body })), model: out.model.slice(0, 120) };
}
