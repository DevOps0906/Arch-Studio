// 크레딧 단가 상수(서버 정본, 정수). 크레딧 수·원 금액의 하드코딩은 이 파일에만 둔다(AGENTS.md 3장 "금액·크레딧은 정수").
// 값의 근거: 01_PRD.md 4.5절(단가)·4.6절(크레딧팩), 02_ARCHITECTURE.md 4장, 04_API.md 3장 `arch.start_ai_run`.
// DB seed(`supabase/modular/2400_arch.sql` 12절 `runtime_config price.<variant>`, credit_packs)와 같은 값이어야 한다:
// pricing.test.ts가 seed를 읽어 비교한다(AR-06-049가 다시 검증). 실제 차감액은 DB 함수가 seed로 정하고,
// 이 상수는 화면 표시·사전 검사·반환값 대조용이다(클라이언트가 보낸 금액은 어디에도 쓰지 않는다).
// status: "근거" = PRD에 원가·타 제품 근거가 있는 값, "제안" = PRD가 제안으로 적은 값, "미확정" = 원가 측정 전·보정 예정(D-4 등).

export type PriceStatus = "근거" | "제안" | "미확정";

export interface PriceEntry {
  readonly credits: number;
  readonly status: PriceStatus;
  readonly note: string;
}

/** `arch.start_ai_run`의 kind → 허용 variant(04_API.md 3장). */
export const RUN_KIND_VARIANTS = {
  render: ["render_std", "render_hq", "upscale"],
  review: ["review"],
  intake: ["intake_text", "intake_consult"],
  proposal: ["proposal", "doc_template"],
  layout: ["layout"],
  walkthrough: ["walkthrough"],
} as const;

export type RunKind = keyof typeof RUN_KIND_VARIANTS;
export type RunVariant = (typeof RUN_KIND_VARIANTS)[RunKind][number];

/** Phase 2 kind: DB가 실행 테이블이 생길 때까지 22023으로 거부한다. 헬퍼도 먼저 거부한다. */
export const PHASE2_KINDS: ReadonlySet<RunKind> = new Set<RunKind>(["layout", "walkthrough"]);

/** variant → 크레딧(seed `price.<variant>`와 같은 값). */
export const RUN_PRICES: Readonly<Record<RunVariant, PriceEntry>> = {
  render_std: { credits: 3, status: "근거", note: "AI 렌더 표준 1024px(PRD 4.5·4.7 원가)" },
  render_hq: { credits: 5, status: "근거", note: "AI 렌더 고품질 2K(PRD 4.5·4.7 원가)" },
  upscale: { credits: 2, status: "제안", note: "업스케일 4K(PRD 4.5 제안)" },
  review: { credits: 15, status: "미확정", note: "클라우드 법규 검토. 베타 2주 원가 측정 후 보정(PRD 4.5, D-4)" },
  intake_text: { credits: 2, status: "근거", note: "대화형 설계 입력(PRD 9.4). STT 분당 1은 별도" },
  intake_consult: { credits: 5, status: "근거", note: "상담 녹음 → 요구사항 후보 그래프(PRD 4.5). STT 분당 1은 별도" },
  proposal: { credits: 10, status: "제안", note: "제안서 PDF(서술 LLM, 렌더 별도)(PRD 4.5 제안)" },
  doc_template: { credits: 1, status: "근거", note: "설계개요서·면적표·개략 공사비 PDF. 같은 내용·버전 재요청 0(PRD 4.5)" },
  layout: { credits: 5, status: "제안", note: "AI 실 배치 초안(Phase 2, 02_ARCHITECTURE 4장)" },
  walkthrough: { credits: 40, status: "미확정", note: "워크스루 영상 5초(Phase 2). 원가 측정 전(PRD 4.5)" },
};

/** start_ai_run 밖 경로의 단가(정수). 차감 경로는 각 작업(chat·voice)이 소유. */
export const CHAT_TURN_CREDITS: PriceEntry = { credits: 1, status: "근거", note: "법규 질의 채팅 1턴(PRD 4.5)" };
export const STT_CREDITS_PER_MINUTE: PriceEntry = { credits: 1, status: "근거", note: "STT 분당 1, 실제 길이로 정산(PRD 4.5)" };

/** 크레딧팩(PRD 4.6절, seed credit_packs와 같은 값). 가격은 원(정수). */
export const CREDIT_PACKS = {
  pack_100: { credits: 100, priceKrw: 10_000 },
  pack_550: { credits: 550, priceKrw: 50_000 },
  pack_1200: { credits: 1_200, priceKrw: 100_000 },
} as const satisfies Record<string, { credits: number; priceKrw: number }>;

export function isRunKind(value: unknown): value is RunKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RUN_KIND_VARIANTS, value);
}

/** kind·variant 조합이 04_API 3장 표에 있는가. */
export function isValidRunVariant(kind: RunKind, variant: unknown): variant is RunVariant {
  return typeof variant === "string" && (RUN_KIND_VARIANTS[kind] as readonly string[]).includes(variant);
}

/** variant의 크레딧(정수). 모르는 variant는 throw(기본값으로 0을 돌려주지 않는다). */
export function priceOf(variant: RunVariant): number {
  const entry = Object.prototype.hasOwnProperty.call(RUN_PRICES, variant) ? RUN_PRICES[variant] : undefined;
  if (!entry) throw new Error("unknown variant");
  return entry.credits;
}
