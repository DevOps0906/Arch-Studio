// 제안서 내용 스냅샷: 요청 본문 content(엔진 값) 스키마 · 정규화 JSON · content_sha256 (04_API.md 2.1절 proposal 행, 4.4절).
// 판정·면적·공사비 수치는 데스크톱 엔진 스냅샷 값 그대로다(서버는 계산하지 않는다). 금액은 정수(원).
// 서버가 저장하는 내용 파일(`<org>/arch/proposal_content/<uuid>.json`) = 정규화 JSON 바이트, content_sha256 = 그 바이트의 sha256.
// 시트는 경로가 아니라 바이트 sha256을 넣는다 → 같은 내용·같은 시트 바이트·같은 템플릿 버전이면 경로가 달라도 같은 해시
// (doc_template 같은 버전 재요청 0크레딧은 DB가 이 해시로 판정, start_ai_run proposal 분기). 워커는 이 해시·시트 해시를 다시 확인한다.
// 형식을 바꾸면 워커(workers/arch-jobs/src/handlers/proposal/content.ts)와 PROPOSAL_TEMPLATE_VERSION을 함께 바꾼다.
// server-only를 import하지 않는다(node --test 대상).
import { createHash } from "node:crypto";
import { z } from "zod";

/** 템플릿 버전(DB proposals_template_check ^[a-z0-9._-]{1,40}$). HTML 조립 규칙이 바뀌면 올린다. */
export const PROPOSAL_TEMPLATE_VERSION = "proposal-v1";
export const PROPOSAL_CONTENT_SCHEMA = "proposal_content.v1";

const num = z.number().finite();
const nonNeg = num.nonnegative();
const text = (max: number) => z.string().max(max);

// packages/domain judgment.ts(JudgmentResult)와 같은 모양. 웹은 domain 패키지에 의존하지 않아 여기서 같은 규칙으로 받는다.
export const judgmentSchema = z
  .object({
    engine_version: text(40),
    rule_pack_version: text(40),
    application_date: text(20),
    items: z
      .array(
        z
          .object({
            key: z.enum(["coverage", "far", "height", "sunlight", "setback", "parking", "seismic", "zero_energy", "supervision"]),
            verdict: z.enum(["PASS", "FAIL", "WARN", "NA"]),
            value: num.optional(),
            limit: num.optional(),
            unit: z.enum(["pct", "mm", "m2", "count", "bool"]),
            basis: z.array(z.object({ law: text(100), article: text(100), effective_from: text(20), ordinance: z.boolean() }).strict()).max(10),
          })
          .strict(),
      )
      .max(50),
    pending_changes: z.number().int().nonnegative(),
  })
  .strict();

export const proposalContentSchema = z
  .object({
    overview: z
      .object({
        title: text(100).min(1),
        address: text(200).optional(),
        use: text(60).optional(),
        zone: text(60).optional(),
        site_area_m2: nonNeg.optional(),
      })
      .strict(),
    judgment: judgmentSchema,
    area_table: z
      .object({
        rows: z.array(z.object({ name: text(60).min(1), floor: text(20).optional(), area_m2: nonNeg }).strict()).max(200),
        total_m2: nonNeg,
      })
      .strict(),
    cost: z
      .object({
        items: z.array(z.object({ label: text(60).min(1), amount_krw: z.number().int().nonnegative() }).strict()).max(50),
        total_krw: z.number().int().nonnegative(),
        basis: text(200).optional(),
      })
      .strict()
      .optional(),
    notes: text(2000).optional(),
  })
  .strict();

export type ProposalContent = z.infer<typeof proposalContentSchema>;
export type ProposalDocKind = "proposal" | "overview" | "area_table" | "cost";

/** 키를 정렬한 JSON(공백 없음). undefined 값 키는 뺀다. 같은 값 → 같은 문자열. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 내용 파일 바이트와 해시. sheetSha256 = drawing_sheets 순서대로 각 시트 바이트의 sha256. */
export function buildContentFile(input: {
  kind: ProposalDocKind;
  content: ProposalContent;
  renderIds: readonly string[];
  sheetSha256: readonly string[];
}): { bytes: Uint8Array; sha256: string } {
  const doc = {
    schema: PROPOSAL_CONTENT_SCHEMA,
    template_version: PROPOSAL_TEMPLATE_VERSION,
    kind: input.kind,
    content: input.content,
    render_ids: [...input.renderIds],
    sheet_sha256: [...input.sheetSha256],
  };
  const bytes = new TextEncoder().encode(canonicalJson(doc));
  return { bytes, sha256: sha256Hex(bytes) };
}
