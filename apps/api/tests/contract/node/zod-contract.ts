// zod 정본(packages/domain) 쪽 계약 표: 이름 → zod 스키마, 코퍼스 실행.
// 이름은 pydantic 모델 이름과 같다(apps/api/app/ai/products/arch/schema.py).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  designModelV1Schema,
  draftingProfileSchema,
  judgmentResultSchema,
  sheetSpecSchema,
} from "../../../../../packages/domain/src/index.ts";
import { type JsonSchema, zodToJsonSchema } from "./zod-json-schema.ts";

interface SafeParser {
  safeParse(input: unknown): { success: boolean };
}

export const ZOD_SCHEMAS: Record<string, SafeParser> = {
  DesignModelV1: designModelV1Schema,
  JudgmentResult: judgmentResultSchema,
  SheetSpec: sheetSpecSchema,
  DraftingProfile: draftingProfileSchema,
};

export interface CorpusCase {
  name: string;
  expect: "accept" | "reject";
  value: unknown;
}
export interface CorpusFile {
  schema: string;
  cases: CorpusCase[];
}

export const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");

export function loadCorpus(): CorpusFile[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CORPUS_DIR, f), "utf8")) as CorpusFile);
}

export function dumpSchemas(): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [name, schema] of Object.entries(ZOD_SCHEMAS)) {
    out[name] = zodToJsonSchema(schema as unknown as Parameters<typeof zodToJsonSchema>[0]);
  }
  return out;
}

/** 코퍼스 각 사례의 zod 수락 여부. zod 정의가 없는 스키마(예: IntakeCandidateV1)는 건너뛴다. */
export function runCorpus(): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const file of loadCorpus()) {
    const schema = ZOD_SCHEMAS[file.schema];
    if (!schema) continue;
    const verdicts: Record<string, boolean> = (out[file.schema] ??= {});
    for (const c of file.cases) verdicts[c.name] = schema.safeParse(c.value).success;
  }
  return out;
}
