import { estimateCost, type CostCatalog, type CostEstimate } from "@arch-studio/program";
import type { DraftRow } from "./model.ts";
import { validateRows } from "./model.ts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("단가 형식 오류");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error("단가 형식 오류");
  return value;
}

/** ApiClient가 봉투를 제거한 data. 204는 undefined로 전달된다. */
export function parseCatalog(value: unknown): CostCatalog | null {
  if (value === undefined) return null;
  const data = object(value);
  const version = text(data.version);
  const basis_date = text(data.basis_date);
  if (!/^\d{4}\.(0[1-9]|1[0-2])\.(0|[1-9]\d{0,2})$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(basis_date)) throw new Error("단가 형식 오류");
  const day = new Date(`${basis_date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== basis_date) throw new Error("단가 형식 오류");
  if (!Array.isArray(data.items) || data.items.length > 10000) throw new Error("단가 형식 오류");
  const keys = new Set<string>();
  const items = data.items.map((raw: unknown) => {
    const item = object(raw);
    const structure = text(item.structure);
    const finish_grade = text(item.finish_grade);
    const use = item.use === undefined ? undefined : text(item.use);
    const price = item.unit_price_won_per_m2;
    if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) throw new Error("단가 형식 오류");
    const key = JSON.stringify([structure, finish_grade, use]);
    if (keys.has(key)) throw new Error("중복 단가");
    keys.add(key);
    return { structure, finish_grade, ...(use === undefined ? {} : { use }), unit_price_won_per_m2: price };
  });
  return { version, basis_date, source_note: text(data.source_note), items };
}

export type EstimateView = { kind: "empty" | "invalid" | "overflow" } | { kind: "ready"; estimate: CostEstimate };
export function estimateRows(catalog: CostCatalog, structure: string, grade: string, rows: readonly DraftRow[]): EstimateView {
  if (!rows.length) return { kind: "empty" };
  if (validateRows(rows)) return { kind: "invalid" };
  try {
    return { kind: "ready", estimate: estimateCost({ catalog, structure, finish_grade: grade,
      rows: rows.map((row) => ({ name: row.name.trim(), use: row.use.trim(), target_area_m2: Number(row.area) })) }) };
  } catch { return { kind: "overflow" }; }
}
