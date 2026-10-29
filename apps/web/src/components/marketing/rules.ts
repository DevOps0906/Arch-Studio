// 마케팅 컴포넌트 규칙(LANDING_PERSUASION 3·4장, PRD 6.1·D-27·D-30)을 코드로 강제하는 순수 함수.
// 위반하면 MarketingRuleError 를 던진다. 서버 컴포넌트가 렌더 중 호출하므로 빌드(정적 생성) 단계에서 잡힌다.

export class MarketingRuleError extends Error {
  readonly component: string;
  constructor(component: string, message: string) {
    super(`[${component}] ${message}`);
    this.name = "MarketingRuleError";
    this.component = component;
  }
}

/** 클래스 이름 결합(falsy 제외). */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** 증거 ID 모양: `<제품 약어>-E-<번호 두 자리>` (예: AS-E-02, LANDING_PERSUASION 3.3·03장 7.3절). */
export type EvidenceId = `${string}-E-${string}`;
export const EVIDENCE_ID_PATTERN = /^[A-Z]{2,6}-E-\d{2}$/;

/** 증거 등급(LANDING_PERSUASION 3.3절). 숫자가 클수록 방문자가 직접 확인하기 어렵다. */
export type EvidenceGrade = "E1" | "E2" | "E3" | "E4" | "E5";

export const GRADE_LABEL: Record<EvidenceGrade, string> = {
  E1: "가입 없이 직접 해 보기",
  E2: "실제 결과 파일",
  E3: "실제 화면 기록",
  E4: "측정 기록",
  E5: "실제 고객 사례",
};

/** 버튼 문구는 일어나는 일을 말한다(LP 4장 ProofLink). label 을 생략하면 등급별 기본 문구. */
export const GRADE_ACTION: Record<EvidenceGrade, string> = {
  E1: "가입 없이 해 보기",
  E2: "샘플 파일 받기",
  E3: "화면 기록 보기",
  E4: "측정 기록 보기",
  E5: "고객 사례 보기",
};

const TRAILING_ARROW = /[→↗↘➜➔›»>]\s*$/u;
const SENTENCE_BREAK = /[.!?。]\s+\S/u;

export function assertText(component: string, field: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MarketingRuleError(component, `${field}: 빈 문자열은 허용하지 않습니다.`);
  }
}

export function assertOneLine(component: string, field: string, value: unknown): asserts value is string {
  assertText(component, field, value);
  if (/[\r\n]/.test(value)) throw new MarketingRuleError(component, `${field}: 한 줄이어야 합니다.`);
}

/** 해당 필드가 한 문장인지(문장 사이에 마침표+공백이 없는지) 확인한다. */
export function assertOneSentence(component: string, field: string, value: unknown): asserts value is string {
  assertOneLine(component, field, value);
  if (SENTENCE_BREAK.test(value.trim())) throw new MarketingRuleError(component, `${field}: 한 문장이어야 합니다.`);
}

/** YYYY-MM-DD 이고 실제 존재하는 날짜여야 한다(확인일). */
export function assertIsoDate(component: string, field: string, value: unknown): asserts value is string {
  assertText(component, field, value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !d || d.toISOString().slice(0, 10) !== value) {
    throw new MarketingRuleError(component, `${field}: YYYY-MM-DD 형식의 실제 날짜여야 합니다(받은 값 "${String(value)}").`);
  }
}

/** 링크 대상은 사이트 안 경로, 쪽 이동, https 만 허용한다. */
export function assertHref(component: string, field: string, value: unknown): asserts value is string {
  assertText(component, field, value);
  const ok = (value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#") || value.startsWith("https://");
  if (!ok) throw new MarketingRuleError(component, `${field}: "/", "#", "https://" 로 시작하는 주소만 허용합니다.`);
}

export type ProofBase = {
  /** 증거로 가는 주소(필수). 사이트 안 경로, 쪽 이동, https. */
  href: string;
  /** 증거 ID(필수, 예: AS-E-02). 주장 장부의 증거 열과 같은 값. */
  evidenceId: EvidenceId;
  /** 링크 문구. 일어나는 일을 말하고 끝에 화살표를 붙이지 않는다. 생략하면 등급별 기본 문구. */
  label?: string;
  /** 파일 내려받기면 true(download 속성). */
  download?: boolean;
  className?: string;
};

/** E4(측정 기록)는 측정 조건을 숫자 옆에 둔다(LP 3.3·3.5절)라서 `conditions` 가 필수다. */
export type ProofLinkProps =
  | (ProofBase & { grade: "E1" | "E2" | "E3" | "E5"; conditions?: undefined })
  | (ProofBase & { grade: "E4"; conditions: string });

export function assertProofLink(component: string, p: ProofLinkProps): void {
  assertHref(component, "href", p.href);
  if (!EVIDENCE_ID_PATTERN.test(String(p.evidenceId))) {
    throw new MarketingRuleError(component, `evidenceId: "AS-E-02" 같은 증거 ID 가 필요합니다(받은 값 "${String(p.evidenceId)}").`);
  }
  if (!(p.grade in GRADE_LABEL)) throw new MarketingRuleError(component, "grade: E1~E5 중 하나여야 합니다.");
  if (p.label !== undefined) {
    assertOneLine(component, "label", p.label);
    if (TRAILING_ARROW.test(p.label)) throw new MarketingRuleError(component, "label: 끝에 화살표를 붙이지 않습니다.");
  }
  if (p.grade === "E4") {
    assertOneLine(component, "conditions", p.conditions);
  } else if (p.conditions !== undefined) {
    throw new MarketingRuleError(component, "conditions: E4(측정 기록)에서만 씁니다.");
  }
}

/** 대안 이름은 범주 이름만 받는다(D-27). 소문자가 든 영문 단어(실명·상호의 흔한 모양)와 주소·기호는 거부한다. */
export function assertCategoryName(component: string, field: string, value: unknown): asserts value is string {
  assertOneLine(component, field, value);
  if (value.length > 40) throw new MarketingRuleError(component, `${field}: 범주 이름은 40자 이하입니다.`);
  if (/(?=[A-Za-z]*[a-z])[A-Za-z]{3,}/.test(value) || /[@/:™®©]|https?|www\./i.test(value)) {
    throw new MarketingRuleError(component, `${field}: "${value}" 는 범주 이름이 아닌 것 같습니다. 회사·서비스 이름은 쓰지 않습니다(D-27).`);
  }
}
