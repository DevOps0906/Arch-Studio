// JudgmentResult (04_API.md 4.7.2, 파생 결과). 문서상 필드는 제안 — 02·05장과 함께 확정한다.
import { z } from "zod";

export const judgmentKeySchema = z.enum([
  "coverage",
  "far",
  "height",
  "sunlight",
  "setback",
  "parking",
  "seismic",
  "zero_energy",
  "supervision",
]);

export const judgmentBasisSchema = z
  .object({
    law: z.string(),
    article: z.string(),
    effective_from: z.string(),
    ordinance: z.boolean(),
  })
  .strict();

export const judgmentItemSchema = z
  .object({
    key: judgmentKeySchema,
    verdict: z.enum(["PASS", "FAIL", "WARN", "NA"]),
    value: z.number().optional(),
    limit: z.number().optional(),
    unit: z.enum(["pct", "mm", "m2", "count", "bool"]),
    basis: z.array(judgmentBasisSchema), // 빈 배열 행은 표시하지 않는다(AR-F-004)
  })
  .strict();

export const judgmentResultSchema = z
  .object({
    engine_version: z.string(),
    rule_pack_version: z.string(),
    application_date: z.string(),
    items: z.array(judgmentItemSchema),
    pending_changes: z.number().int().nonnegative(), // 폴백 배너 "이후 개정 n건"
  })
  .strict();

export type JudgmentResult = z.infer<typeof judgmentResultSchema>;
