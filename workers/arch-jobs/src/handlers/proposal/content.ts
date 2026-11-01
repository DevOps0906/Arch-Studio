// 제안서 내용 파일 읽기(웹 apps/web/src/server/ai/proposal/content.ts가 쓴 정규화 JSON, 스키마 proposal_content.v1).
// 워커에는 zod가 없어 같은 모양을 손으로 검사한다. HTML에 들어가는 값(문자열·유한수·정수 금액)만 통과시키고 모르는 키는 거부한다.
// 판정·면적·공사비 수치는 이 스냅샷 값이 유일한 출처다(서술·템플릿은 수치를 만들지 않는다).
import { createHash } from "node:crypto";

export const PROPOSAL_CONTENT_SCHEMA = "proposal_content.v1";
export const PROPOSAL_TEMPLATE_VERSION = "proposal-v1";

export type DocKind = "proposal" | "overview" | "area_table" | "cost";
export type JudgmentKey = "coverage" | "far" | "height" | "sunlight" | "setback" | "parking" | "seismic" | "zero_energy" | "supervision";
export type Verdict = "PASS" | "FAIL" | "WARN" | "NA";
export type JudgmentUnit = "pct" | "mm" | "m2" | "count" | "bool";

export interface JudgmentItem {
  key: JudgmentKey;
  verdict: Verdict;
  value?: number;
  limit?: number;
  unit: JudgmentUnit;
  basis: { law: string; article: string; effective_from: string; ordinance: boolean }[];
}

export interface ProposalContent {
  overview: { title: string; address?: string; use?: string; zone?: string; site_area_m2?: number };
  judgment: { engine_version: string; rule_pack_version: string; application_date: string; items: JudgmentItem[]; pending_changes: number };
  area_table: { rows: { name: string; floor?: string; area_m2: number }[]; total_m2: number };
  cost?: { items: { label: string; amount_krw: number }[]; total_krw: number; basis?: string };
  notes?: string;
}

export interface ContentFile {
  kind: DocKind;
  template_version: string;
  content: ProposalContent;
  render_ids: string[];
  sheet_sha256: string[];
}

const DOC_KINDS = new Set<DocKind>(["proposal", "overview", "area_table", "cost"]);
const KEYS = new Set<JudgmentKey>(["coverage", "far", "height", "sunlight", "setback", "parking", "seismic", "zero_energy", "supervision"]);
const VERDICTS = new Set<Verdict>(["PASS", "FAIL", "WARN", "NA"]);
const UNITS = new Set<JudgmentUnit>(["pct", "mm", "m2", "count", "bool"]);
const SHA_RE = /^[0-9a-f]{64}$/;

class Bad extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, keys: readonly string[], required: readonly string[]): Obj {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Bad();
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new Bad();
  for (const k of required) if (!(k in o)) throw new Bad();
  return o;
}

function str(v: unknown, max: number, min = 0): string {
  if (typeof v !== "string" || v.length > max || v.length < min) throw new Bad();
  return v;
}

function optStr(v: unknown, max: number): string | undefined {
  return v === undefined ? undefined : str(v, max);
}

function fin(v: unknown, nonNeg = false): number {
  if (typeof v !== "number" || !Number.isFinite(v) || (nonNeg && v < 0)) throw new Bad();
  return v;
}

function optFin(v: unknown, nonNeg = false): number | undefined {
  return v === undefined ? undefined : fin(v, nonNeg);
}

function krw(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Bad();
  return v;
}

function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new Bad();
  return v;
}

function pick<T extends string>(v: unknown, set: ReadonlySet<T>): T {
  if (typeof v !== "string" || !set.has(v as T)) throw new Bad();
  return v as T;
}

/** undefined 값 키를 남기지 않는다(exactOptionalPropertyTypes). */
function clean<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function parseContent(v: unknown): ProposalContent {
  const c = obj(v, ["overview", "judgment", "area_table", "cost", "notes"], ["overview", "judgment", "area_table"]);
  const ov = obj(c["overview"], ["title", "address", "use", "zone", "site_area_m2"], ["title"]);
  const jd = obj(c["judgment"], ["engine_version", "rule_pack_version", "application_date", "items", "pending_changes"], [
    "engine_version",
    "rule_pack_version",
    "application_date",
    "items",
    "pending_changes",
  ]);
  const at = obj(c["area_table"], ["rows", "total_m2"], ["rows", "total_m2"]);
  const pending = jd["pending_changes"];
  if (typeof pending !== "number" || !Number.isSafeInteger(pending) || pending < 0) throw new Bad();
  const content: ProposalContent = {
    overview: clean({
      title: str(ov["title"], 100, 1),
      address: optStr(ov["address"], 200),
      use: optStr(ov["use"], 60),
      zone: optStr(ov["zone"], 60),
      site_area_m2: optFin(ov["site_area_m2"], true),
    }) as ProposalContent["overview"],
    judgment: {
      engine_version: str(jd["engine_version"], 40),
      rule_pack_version: str(jd["rule_pack_version"], 40),
      application_date: str(jd["application_date"], 20),
      items: arr(jd["items"], 50).map((raw) => {
        const it = obj(raw, ["key", "verdict", "value", "limit", "unit", "basis"], ["key", "verdict", "unit", "basis"]);
        return clean({
          key: pick(it["key"], KEYS),
          verdict: pick(it["verdict"], VERDICTS),
          value: optFin(it["value"]),
          limit: optFin(it["limit"]),
          unit: pick(it["unit"], UNITS),
          basis: arr(it["basis"], 10).map((b) => {
            const x = obj(b, ["law", "article", "effective_from", "ordinance"], ["law", "article", "effective_from", "ordinance"]);
            if (typeof x["ordinance"] !== "boolean") throw new Bad();
            return { law: str(x["law"], 100), article: str(x["article"], 100), effective_from: str(x["effective_from"], 20), ordinance: x["ordinance"] };
          }),
        }) as JudgmentItem;
      }),
      pending_changes: pending,
    },
    area_table: {
      rows: arr(at["rows"], 200).map((raw) => {
        const r = obj(raw, ["name", "floor", "area_m2"], ["name", "area_m2"]);
        return clean({ name: str(r["name"], 60, 1), floor: optStr(r["floor"], 20), area_m2: fin(r["area_m2"], true) }) as ProposalContent["area_table"]["rows"][number];
      }),
      total_m2: fin(at["total_m2"], true),
    },
  };
  if (c["cost"] !== undefined) {
    const co = obj(c["cost"], ["items", "total_krw", "basis"], ["items", "total_krw"]);
    content.cost = clean({
      items: arr(co["items"], 50).map((raw) => {
        const it = obj(raw, ["label", "amount_krw"], ["label", "amount_krw"]);
        return { label: str(it["label"], 60, 1), amount_krw: krw(it["amount_krw"]) };
      }),
      total_krw: krw(co["total_krw"]),
      basis: optStr(co["basis"], 200),
    }) as NonNullable<ProposalContent["cost"]>;
  }
  if (c["notes"] !== undefined) content.notes = str(c["notes"], 2000);
  return content;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 내용 파일 바이트 → 검사된 값. 해시 불일치·형식 오류는 null(호출자가 재시도 없는 실패로 바꾼다). */
export function parseContentFile(bytes: Uint8Array, expectedSha256: string): ContentFile | null {
  if (sha256Hex(bytes) !== expectedSha256) return null;
  try {
    const doc = obj(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), ["schema", "template_version", "kind", "content", "render_ids", "sheet_sha256"], [
      "schema",
      "template_version",
      "kind",
      "content",
      "render_ids",
      "sheet_sha256",
    ]);
    if (doc["schema"] !== PROPOSAL_CONTENT_SCHEMA) return null;
    const sheets = arr(doc["sheet_sha256"], 6).map((s) => {
      if (typeof s !== "string" || !SHA_RE.test(s)) throw new Bad();
      return s;
    });
    const renderIds = arr(doc["render_ids"], 8).map((s) => str(s, 36));
    return {
      kind: pick(doc["kind"], DOC_KINDS),
      template_version: str(doc["template_version"], 40),
      content: parseContent(doc["content"]),
      render_ids: renderIds,
      sheet_sha256: sheets,
    };
  } catch {
    return null;
  }
}
