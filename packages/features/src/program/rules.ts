// 체크리스트 질문 + ProgramRuleSet 공급 자리(AR-06-038). 승인된 정본 규칙 세트·질문은 아직 없다(미결정).
// 공급원은 개발 데모(demo/program-rules.ts, 개발 빌드 + VITE_DEMO_MODE=1에서만 로드)뿐이라 운영은 null → '규칙 세트 미연결' 안내.
// 이 파일에는 규칙 수치를 두지 않는다(릴리스 번들 0).
import { buildProgram, type ChecklistAnswer, type ProgramModel, type ProgramRuleSet } from "@arch-studio/program";
import { validateRows, type DraftRow } from "./model.ts";

export type ChecklistQuestion =
  | { readonly id: string; readonly label: string; readonly kind: "boolean" }
  | { readonly id: string; readonly label: string; readonly kind: "count" }
  | { readonly id: string; readonly label: string; readonly kind: "choice"; readonly options: readonly string[] };

export interface ProgramChecklist {
  /** 화면에 그대로 보이는 이름(출처 표시). */
  readonly label: string;
  readonly questions: readonly ChecklistQuestion[];
  readonly ruleSet: ProgramRuleSet;
}

let supplied: ProgramChecklist | null = null;

/** 개발 데모 런타임만 부른다. */
export function provideProgramChecklist(checklist: ProgramChecklist | null): void {
  supplied = checklist;
}

export function programChecklist(): ProgramChecklist | null {
  return supplied;
}

export type RecalcResult = { readonly kind: "ok"; readonly rows: DraftRow[] } | { readonly kind: "error"; readonly message: string };

/** 답 → 면적표 재계산. 잠금 행은 buildProgram이 값·순서를 보존한다(잠금 안 된 행은 규칙 결과로 대체되므로 넘기지 않는다). */
export function recalcRows(answers: ProgramModel["checklist_answers"], rows: readonly DraftRow[], ruleSet: ProgramRuleSet): RecalcResult {
  const locked = rows.filter((r) => r.locked);
  const issue = validateRows(locked);
  if (issue) return { kind: "error", message: `잠긴 행 입력을 먼저 확인하세요. ${issue}` };
  const targets = locked.map((r) => ({ name: r.name.trim(), use: r.use.trim(), target_area_m2: Number(r.area) }));
  try {
    const result = buildProgram({ checklist_answers: answers, rule_set: ruleSet,
      previous: { targets, user_locked_rows: targets.map((t) => t.name) } });
    const lockedNames = new Set(result.user_locked_rows);
    return { kind: "ok", rows: result.targets.map((t) => ({ name: t.name, use: t.use, area: String(t.target_area_m2), locked: lockedNames.has(t.name) })) };
  } catch (e) {
    return { kind: "error", message: e instanceof RangeError ? "체크리스트 답으로 면적표를 계산하지 못했습니다. 답을 확인하세요." : "면적표를 다시 계산하지 못했습니다." };
  }
}

/** 수량 답 입력: 0 이상 정수만. */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n <= 99 ? n : null;
}

export function countText(value: ChecklistAnswer | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

/** 수량 칸 입력 처리 → 칸에 보일 글자. 유효한 수는 apply로 반영하고, 반영 실패면 저장된 답으로 되돌린다(화면 = 저장값).
 * 아직 고치는 중인 잘못된 글자는 그대로 두고, blur 때 countText(value)로 되돌린다. */
export function commitCount(text: string, value: ChecklistAnswer | undefined, apply: (n: number) => boolean): string {
  const n = parseCount(text);
  if (n === null || n === value) return text;
  return apply(n) ? text : countText(value);
}

export function answerText(value: ChecklistAnswer): string {
  return Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? value ? "예" : "아니요" : String(value);
}
