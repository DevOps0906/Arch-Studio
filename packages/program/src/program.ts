// 요구 체크리스트 → 실 프로그램·면적표(AR-F-011). 결정적 순수 함수만(I/O·시간·난수 금지).
// 실 목록과 면적은 코드에 박지 않고 입력 규칙 세트(ProgramRuleSet)로 받는다.
import type { DesignModelV1 } from "@arch-studio/domain";

export type ProgramModel = DesignModelV1["program"];
export type ChecklistAnswer = ProgramModel["checklist_answers"][string];
export type ProgramTarget = ProgramModel["targets"][number];

/** 규칙이 만드는 행. 면적은 0.01 m2 단위 정수(부동소수 누적 오차 방지). */
export interface ProgramRuleRow {
  name: string;
  use: string;
  area_m2_hundredths: number;
}

/** 답 조건: 같음 · 목록 포함 · 수 이상. */
export type ProgramRuleCondition =
  | { equals: string | number | boolean }
  | { includes: string }
  | { gte: number };

export interface ProgramRule {
  question_id: string;
  when: ProgramRuleCondition;
  rows: ProgramRuleRow[];
  /** "answer": 수치 답 N(정수)만큼 행을 반복하고 이름 뒤에 " 1".." N"을 붙인다. */
  repeat?: "answer";
}

export interface ProgramRuleSet {
  version: string;
  rules: ProgramRule[];
}

export interface BuildProgramInput {
  checklist_answers: ProgramModel["checklist_answers"];
  rule_set: ProgramRuleSet;
  /** 직전 면적표와 잠금 목록. 잠금 행은 값·순서를 그대로 보존한다. */
  previous: Pick<ProgramModel, "targets" | "user_locked_rows">;
}

export interface BuildProgramResult {
  targets: ProgramTarget[];
  user_locked_rows: string[];
  total_area_m2_hundredths: number;
  total_area_m2: number;
  rule_set_version: string;
}

/** m2 수치 → 0.01 m2 단위 정수(0에서 먼 쪽 반올림). 음수·NaN·Infinity는 거부한다. */
export function m2ToHundredths(areaM2: number): number {
  if (!Number.isFinite(areaM2) || areaM2 < 0) throw new RangeError(`면적은 0 이상의 유한한 수여야 합니다: ${areaM2}`);
  // toFixed(6)로 이진 부동소수 표현 오차(12.345*100=1234.4999…)를 걷어낸 뒤 반올림한다.
  return Math.round(Number.parseFloat((areaM2 * 100).toFixed(6)));
}

function matches(answer: ChecklistAnswer | undefined, when: ProgramRuleCondition): boolean {
  if (answer === undefined) return false;
  if ("equals" in when) return answer === when.equals;
  if ("includes" in when) return Array.isArray(answer) && answer.includes(when.includes);
  return typeof answer === "number" && answer >= when.gte;
}

function assertRow(row: ProgramRuleRow): void {
  if (!Number.isSafeInteger(row.area_m2_hundredths) || row.area_m2_hundredths < 0) {
    throw new RangeError(`규칙 행 면적은 0 이상의 정수(0.01 m2 단위)여야 합니다: ${row.name}`);
  }
}

/** 체크리스트 답과 규칙 세트로 규칙 행을 만든다. 같은 이름은 먼저 나온 규칙이 이긴다(규칙 순서 = 우선순위). */
export function deriveRows(answers: ProgramModel["checklist_answers"], ruleSet: ProgramRuleSet): ProgramRuleRow[] {
  const out: ProgramRuleRow[] = [];
  const seen = new Set<string>();
  const push = (row: ProgramRuleRow): void => {
    if (seen.has(row.name)) return;
    seen.add(row.name);
    out.push(row);
  };
  for (const rule of ruleSet.rules) {
    const answer = Object.hasOwn(answers, rule.question_id) ? answers[rule.question_id] : undefined;
    if (!matches(answer, rule.when)) continue;
    for (const row of rule.rows) assertRow(row);
    if (rule.repeat === "answer") {
      if (typeof answer !== "number" || !Number.isSafeInteger(answer) || answer < 0) {
        throw new RangeError(`반복 규칙의 답은 0 이상의 정수여야 합니다: ${rule.question_id}`);
      }
      for (let i = 1; i <= answer; i += 1) {
        for (const row of rule.rows) push({ ...row, name: `${row.name} ${i}` });
      }
    } else {
      for (const row of rule.rows) push({ ...row });
    }
  }
  return out;
}

/**
 * 면적표를 다시 계산한다. 행 식별자는 `name`(DesignModel `user_locked_rows`가 이름 목록).
 * - 직전 면적표에 같은 이름이 여럿이면 RangeError(이름 = 행 식별자).
 * - 잠금 행: 직전 행 값을 그대로 쓴다(덮어쓰기 0). 규칙이 같은 이름을 만들면 그 자리에, 아니면 끝에 직전 순서로 붙인다.
 * - 잠금 안 된 직전 행: 규칙 결과로 대체된다(규칙에 없으면 사라진다).
 * - 합계: 0.01 m2 정수 합. 표시값 = 합 / 100.
 */
export function buildProgram(input: BuildProgramInput): BuildProgramResult {
  const lockedNames = new Set(input.previous.user_locked_rows);
  const lockedRows = new Map<string, ProgramTarget>();
  const prevNames = new Set<string>();
  for (const row of input.previous.targets) {
    // 이름이 행 식별자라 직전 면적표의 중복 이름은 잠금 여부와 관계없이 거부한다(잠금 행 소실 방지).
    if (prevNames.has(row.name)) throw new RangeError(`직전 면적표에 같은 이름의 행이 여럿 있습니다: ${row.name}`);
    prevNames.add(row.name);
    if (lockedNames.has(row.name)) lockedRows.set(row.name, row);
  }

  const targets: ProgramTarget[] = [];
  const placed = new Set<string>();
  for (const row of deriveRows(input.checklist_answers, input.rule_set)) {
    const locked = lockedRows.get(row.name);
    if (locked) {
      targets.push({ ...locked });
      placed.add(row.name);
    } else {
      targets.push({ name: row.name, use: row.use, target_area_m2: row.area_m2_hundredths / 100 });
    }
  }
  for (const [name, row] of lockedRows) {
    if (!placed.has(name)) targets.push({ ...row });
  }

  let total = 0;
  for (const row of targets) total += m2ToHundredths(row.target_area_m2);
  return {
    targets,
    user_locked_rows: [...input.previous.user_locked_rows],
    total_area_m2_hundredths: total,
    total_area_m2: total / 100,
    rule_set_version: input.rule_set.version,
  };
}
