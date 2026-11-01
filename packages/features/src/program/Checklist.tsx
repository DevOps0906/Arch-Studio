// 요구 체크리스트 영역(03장 3.6절 "답 고치기 → 면적표 재계산(잠금 행 제외)"). 질문·규칙 세트는 rules.ts 공급분만 쓴다.
import type { ChecklistAnswer, ProgramModel } from "@arch-studio/program";
import { Banner, Checkbox, Input, Select } from "@arch-studio/ui";
import { useState } from "react";
import { answerText, commitCount, countText, parseCount, type ChecklistQuestion, type ProgramChecklist } from "./rules.ts";

type Answers = ProgramModel["checklist_answers"];
/** undefined = 답 제거. 반환값: 반영 여부(재계산 실패면 false). */
type OnAnswer = (id: string, value: ChecklistAnswer | undefined) => boolean;

export function ChecklistSection({ answers, checklist, editable, error, onAnswer }: {
  answers: Answers; checklist: ProgramChecklist | null; editable: boolean; error: string | null;
  onAnswer: OnAnswer;
}) {
  const asked = new Set(checklist?.questions.map((q) => q.id) ?? []);
  const rest = Object.entries(answers).filter(([key]) => !asked.has(key));
  return (
    <section className="rounded-panel border border-line bg-surface p-pad" aria-labelledby="program-checklist">
      <h2 id="program-checklist" className="text-h2 font-semibold">요구 체크리스트</h2>
      {checklist ? <>
        <p className="mt-2 text-caption text-fg-2">답을 고치면 잠기지 않은 행을 다시 계산합니다. 잠긴 행은 그대로 유지됩니다.</p>
        <div className="mt-3 grid grid-cols-1 gap-gap md:grid-cols-2 xl:grid-cols-3">
          {checklist.questions.map((q) => <Question key={q.id} q={q} value={answers[q.id]} disabled={!editable} onAnswer={onAnswer} />)}
        </div>
        <p className="mt-3 break-words text-caption text-fg-3">기준: {checklist.label} · 버전 {checklist.ruleSet.version}</p>
      </> : <Banner tone="info" title="규칙 세트 미연결">승인된 체크리스트 기준이 아직 연결되지 않아 답 수정과 면적표 자동 재계산을 쓸 수 없습니다. 면적표는 직접 입력할 수 있습니다.</Banner>}
      {rest.length ? <dl className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{rest.map(([key, value]) => <div key={key} className="min-w-0 break-words"><dt className="text-caption text-fg-3">{key}</dt><dd className="text-body">{answerText(value)}</dd></div>)}</dl>
        : !checklist ? <p className="mt-2 text-body text-fg-2">저장된 요구 사항이 없습니다.</p> : null}
      {error ? <Banner tone="warn" title="재계산하지 못했습니다">{error}</Banner> : null}
    </section>
  );
}

function Question({ q, value, disabled, onAnswer }: { q: ChecklistQuestion; value: ChecklistAnswer | undefined; disabled: boolean; onAnswer: OnAnswer }) {
  if (q.kind === "boolean") return <Checkbox label={q.label} checked={value === true} disabled={disabled} onChange={(e) => onAnswer(q.id, e.currentTarget.checked)} />;
  if (q.kind === "choice") return <label className="text-body">{q.label}<Select value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onAnswer(q.id, e.currentTarget.value || undefined)}>
    <option value="">선택 안 함</option>
    {q.options.map((o) => <option key={o}>{o}</option>)}
  </Select></label>;
  return <CountField q={q} value={value} disabled={disabled} onAnswer={onAnswer} />;
}

function CountField({ q, value, disabled, onAnswer }: { q: ChecklistQuestion; value: ChecklistAnswer | undefined; disabled: boolean; onAnswer: OnAnswer }) {
  const [text, setText] = useState(countText(value));
  const invalid = text.trim() !== "" && parseCount(text) === null;
  return <label className="text-body">{q.label}<Input inputMode="numeric" value={text} invalid={invalid} disabled={disabled}
    onChange={(e) => setText(commitCount(e.currentTarget.value, value, (n) => onAnswer(q.id, n)))}
    onBlur={() => setText(countText(value))} />{invalid ? <span className="text-caption text-danger">0~99 사이 정수로 입력하세요.</span> : null}</label>;
}
