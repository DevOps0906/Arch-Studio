// `/tools/answer`·`/tools/answer-direct` 응답 계약(04_API.md 6.4절, apps/api/app/ai/tools/arch/routes.py)과 웹 쪽 재검증.
// 봉투 `{ ok: true, data: { answer, citations[{ law, article, effective_from, source_id }], no_source, usage } }`.
// 웹도 출처 규칙을 다시 지킨다: 출처 0개면 답변 문장을 버리고 "근거를 찾지 못했습니다".
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";

export const NO_SOURCE_ANSWER = "근거를 찾지 못했습니다";
const MAX_ANSWER = 4000;

const citationSchema = z
  .object({
    law: z.string().min(1).max(300),
    article: z.string().max(40).nullable(),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120),
  })
  .strict();

export type Citation = z.infer<typeof citationSchema>;

const toolAnswerSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    answer: z.string().max(MAX_ANSWER),
    citations: z.array(citationSchema).max(20),
    no_source: z.boolean(),
    usage: z.unknown().optional(),
  }),
});

export interface ChatAnswer {
  answer: string;
  citations: Citation[];
  noSource: boolean;
}

export class AnswerContractError extends Error {
  constructor() {
    super("tool answer contract mismatch");
    this.name = "AnswerContractError";
  }
}

/** 도구 응답 → 전달할 답. 계약 위반은 AnswerContractError(호출자가 장애로 본다). */
export function toChatAnswer(raw: unknown): ChatAnswer {
  const parsed = toolAnswerSchema.safeParse(raw);
  if (!parsed.success) throw new AnswerContractError();
  const { answer, citations, no_source } = parsed.data.data;
  const text = answer.trim();
  if (no_source || citations.length === 0 || !text) return { answer: NO_SOURCE_ANSWER, citations: [], noSource: true };
  return { answer: text, citations, noSource: false };
}
