// 개발용 체크리스트 질문·ProgramRuleSet(AR-06-038). 데모 모드 전용 — 실 목록·면적은 모두 화면 개발용으로 지어낸 값이며
// 승인된 기준·법규·설계 지침이 아니다. 질문 id는 samples.ts 데모 프로젝트의 checklist_answers 키와 맞춘다.
// 정본 규칙 세트가 확정되면 실제 공급원(서명 검증 경로)으로 바꾸고 이 파일은 데모에만 남긴다.
import type { ProgramChecklist } from "../program/rules.ts";

export const DEV_PROGRAM_CHECKLIST: ProgramChecklist = {
  label: "개발용 규칙 세트(데모 전용, 실제 기준 아님)",
  questions: [
    { id: "households", label: "세대 수", kind: "count" },
    { id: "family_size", label: "가족 수(침실)", kind: "count" },
    { id: "garage", label: "차고", kind: "boolean" },
    { id: "shop", label: "점포", kind: "boolean" },
    { id: "elevator", label: "승강기", kind: "boolean" },
    { id: "parking_spaces", label: "주차 대수", kind: "count" },
    { id: "budget_band", label: "예산 구간", kind: "choice", options: ["상", "중", "하"] },
  ],
  ruleSet: {
    version: "개발용-0.0.1",
    rules: [
      { question_id: "households", when: { gte: 1 }, rows: [
        { name: "거실", use: "거실", area_m2_hundredths: 3000 },
        { name: "주방·식당", use: "주방", area_m2_hundredths: 2000 },
      ] },
      { question_id: "family_size", when: { gte: 1 }, repeat: "answer", rows: [{ name: "침실", use: "침실", area_m2_hundredths: 1200 }] },
      { question_id: "garage", when: { equals: true }, rows: [{ name: "차고", use: "차고", area_m2_hundredths: 1800 }] },
      { question_id: "shop", when: { equals: true }, rows: [{ name: "점포", use: "근린생활시설", area_m2_hundredths: 10000 }] },
      { question_id: "elevator", when: { equals: true }, rows: [{ name: "승강기 홀", use: "공용", area_m2_hundredths: 800 }] },
      { question_id: "budget_band", when: { equals: "상" }, rows: [{ name: "서재", use: "업무", area_m2_hundredths: 1000 }] },
    ],
  },
};
