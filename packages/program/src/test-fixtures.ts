// 테스트 전용 가짜 데이터. 실 목록·면적·단가는 모두 지어낸 값이며 실제 규칙 세트·단가표가 아니다.
import type { CostCatalog } from "./cost.ts";
import type { ProgramRuleSet } from "./program.ts";

export const FAKE_RULE_SET: ProgramRuleSet = {
  version: "fake-0.0.1",
  rules: [
    { question_id: "q_base", when: { equals: true }, rows: [{ name: "공용실A", use: "fake_use_a", area_m2_hundredths: 3800 }] },
    { question_id: "q_count", when: { gte: 1 }, repeat: "answer", rows: [{ name: "개별실", use: "fake_use_b", area_m2_hundredths: 1200 }] },
    { question_id: "q_tags", when: { includes: "tag_x" }, rows: [{ name: "부속실X", use: "fake_use_c", area_m2_hundredths: 905 }] },
    { question_id: "q_mode", when: { equals: "m1" }, rows: [{ name: "공용실A", use: "fake_use_a", area_m2_hundredths: 9999 }] },
  ],
};

export const FAKE_CATALOG: CostCatalog = {
  version: "0000.00.0",
  basis_date: "2000-01-01",
  source_note: "테스트용 가짜 단가표(실제 출처 아님)",
  items: [
    { structure: "fake_struct", finish_grade: "fake_grade", unit_price_won_per_m2: 1001 },
    { structure: "fake_struct", finish_grade: "fake_grade", use: "fake_use_c", unit_price_won_per_m2: 2003 },
    { structure: "fake_struct", finish_grade: "other_grade", unit_price_won_per_m2: 7 },
  ],
};
