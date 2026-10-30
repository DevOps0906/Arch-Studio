import { designModelV1Schema, type DesignModelV1 } from "@arch-studio/domain";

export interface DraftRow { name: string; use: string; area: string; locked: boolean }

export function parseModel(text: string): DesignModelV1 | null {
  try {
    const parsed = designModelV1Schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function draftRows(model: DesignModelV1): DraftRow[] {
  return model.program.targets.map((r) => ({ name: r.name, use: r.use, area: String(r.target_area_m2), locked: model.program.user_locked_rows.includes(r.name) }));
}

export function validateRows(rows: readonly DraftRow[]): string | null {
  const names = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || !row.use.trim()) return "실 이름과 용도를 모두 입력하세요.";
    if (names.has(name)) return "실 이름은 서로 달라야 합니다. 같은 종류의 실은 이름 뒤에 번호를 붙이세요.";
    names.add(name);
    if (!/^\d+(?:\.\d+)?$/.test(row.area.trim()) || !Number.isFinite(Number(row.area)) || Number(row.area) > Number.MAX_SAFE_INTEGER / 100) return "목표 면적은 0 이상의 유효한 숫자로 입력하세요.";
  }
  return null;
}

export function withRows(model: DesignModelV1, rows: readonly DraftRow[]): DesignModelV1 {
  const issue = validateRows(rows);
  if (issue) throw new Error(issue);
  return { ...model, program: { ...model.program,
    targets: rows.map((r) => ({ name: r.name.trim(), use: r.use.trim(), target_area_m2: Number(r.area) })),
    user_locked_rows: rows.filter((r) => r.locked).map((r) => r.name.trim()),
  } };
}
