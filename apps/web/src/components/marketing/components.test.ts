// 마케팅 컴포넌트 8종: 서버 렌더(renderToStaticMarkup) 구조·접근성 속성·규칙 위반 시 오류.
// 테스트 러너(node --test "src/**/*.test.ts")가 .tsx 를 직접 못 읽으므로 JSX 대신 createElement 를 쓰고,
// 컴포넌트는 tsx-hooks.mjs 로더로 불러온다.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AlternativesTableProps, OurCell } from "./AlternativesTable.tsx";
import type { AssumptionTableProps } from "./AssumptionTable.tsx";
import type { CalloutProps } from "./Callout.tsx";
import type { ContrastPairProps } from "./ContrastPair.tsx";
import type { DualTimelineProps } from "./DualTimeline.tsx";
import type { SampleTagProps } from "./SampleTag.tsx";
import type { SourceNoteProps } from "./SourceNote.tsx";
import { MarketingRuleError, type ProofLinkProps } from "./rules.ts";

register("./tsx-hooks.mjs", import.meta.url);
const M = {
  AlternativesTable: (await import("./AlternativesTable.tsx")).AlternativesTable,
  AssumptionTable: (await import("./AssumptionTable.tsx")).AssumptionTable,
  Callout: (await import("./Callout.tsx")).Callout,
  ContrastPair: (await import("./ContrastPair.tsx")).ContrastPair,
  DualTimeline: (await import("./DualTimeline.tsx")).DualTimeline,
  ProofLink: (await import("./ProofLink.tsx")).ProofLink,
  SampleTag: (await import("./SampleTag.tsx")).SampleTag,
  SourceNote: (await import("./SourceNote.tsx")).SourceNote,
};

const alternatives = (p: AlternativesTableProps) => renderToStaticMarkup(h(M.AlternativesTable, p));
const assumptions = (p: AssumptionTableProps) => renderToStaticMarkup(h(M.AssumptionTable, p));
const callout = (p: CalloutProps) => renderToStaticMarkup(h(M.Callout, p));
const contrast = (p: ContrastPairProps) => renderToStaticMarkup(h(M.ContrastPair, p));
const timeline = (p: DualTimelineProps) => renderToStaticMarkup(h(M.DualTimeline, p));
const proofLink = (p: ProofLinkProps) => renderToStaticMarkup(h(M.ProofLink, p));
const sampleTag = (p: SampleTagProps = {}) => renderToStaticMarkup(h(M.SampleTag, p));
const sourceNote = (p: SourceNoteProps) => renderToStaticMarkup(h(M.SourceNote, p));

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const ruleError = (fn: () => unknown, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof MarketingRuleError && re.test(e.message), `규칙 오류 ${String(re)} 기대`);

const proof: ProofLinkProps = { href: "/samples", evidenceId: "AS-E-01", grade: "E2", download: true };

function table(over: Partial<AlternativesTableProps> = {}): AlternativesTableProps {
  const alt = (mark: "yes" | "partial" | "no", reason: string) => ({ mark, reason });
  return {
    caption: "대안별 판정",
    alternativeNames: ["그대로 둔다", "범용 AI 이미지 도구", "사람에게 맡긴다", "전용 대지 분석 도구"],
    rows: [
      { criterion: "법규 판정", alternatives: [alt("partial", "직접 계산"), alt("no", "법규와 무관"), alt("yes", "회신 대기"), alt("partial", "도구마다 다름")], ours: { mark: "yes", reason: "지원 항목 판정", proof } },
      { criterion: "볼륨", alternatives: [alt("partial", "작도 필요"), alt("partial", "법규와 무관"), alt("no", "회신 대기"), alt("partial", "도구마다 다름")], ours: { mark: "yes", reason: "엔벨로프 생성", proof } },
      { criterion: "이어서 편집", alternatives: [alt("yes", "CAD 원본"), alt("no", "불가"), alt("yes", "도면 납품"), alt("partial", "도구마다 다름")], ours: { mark: "yes", reason: "DXF", proof } },
      { criterion: "지원 범위", alternatives: [alt("yes", "익숙함"), alt("yes", "익숙함"), alt("yes", "맡기면 됨"), alt("partial", "도구마다 다름")], ours: { mark: "partial", reason: "지원 항목 밖은 판정하지 않음" } },
    ],
    unfit: [
      { situation: "인허가 설계도서가 필요하다", instead: "건축사가 작성해야 합니다" },
      { situation: "macOS만 쓴다", instead: "현재 Windows만 지원합니다" },
    ],
    ...over,
  };
}

// ---------- AlternativesTable ----------
test("AlternativesTable: table·caption·scope, 기호+글자, 증거 링크, 모바일 목록", () => {
  const out = alternatives(table());
  assert.ok(out.includes("<caption"));
  assert.equal(count(out, /<th scope="col"/g), 1 + 4 + 1 + 1 + 2); // 기준·대안4·우리·증거 + 맞지 않는 경우 2
  assert.equal(count(out, /<th scope="row"/g), 4 + 2);
  for (const g of ["○", "△", "✕"]) assert.ok(out.includes(g), g);
  for (const t of ["된다", "일부·조건부", "안 된다"]) assert.ok(out.includes(t), `글자 ${t}`);
  assert.equal(count(out, /data-evidence-id="AS-E-01"/g), 3 * 2); // ○ 3행 x (표 + 모바일 목록)
  assert.ok(out.includes("이런 경우엔 다른 방법이 낫습니다"));
  assert.ok(out.includes("md:hidden") && out.includes("hidden overflow-x-auto"), "보이는 쪽이 구간으로 갈린다");
});

test("AlternativesTable: 가로 스크롤은 표 영역 안에서만, 영역은 키보드 포커스 가능", () => {
  const out = alternatives(table());
  assert.match(out, /<div role="region"[^>]*tabindex="0"[^>]*class="[^"]*focus-ring[^"]*overflow-x-auto/);
  assert.equal(count(out, /overflow-x-auto/g), 1);
});

test("AlternativesTable: 우리 열이 전부 ○ 이면 오류", () => {
  const t = table();
  const rows = t.rows.map((r) => ({ ...r, ours: { mark: "yes" as const, reason: r.ours.reason, proof } }));
  ruleError(() => alternatives({ ...t, rows }), /△ 또는 ✕/);
});

test("AlternativesTable: ○ 에 증거가 없으면 오류(런타임)", () => {
  const t = table();
  const rows = [...t.rows];
  rows[0] = { ...rows[0]!, ours: { mark: "yes", reason: "x" } as never };
  ruleError(() => alternatives({ ...t, rows }), /증거/);
});

test("AlternativesTable: ○ 에 증거가 없으면 타입 오류(컴파일)", () => {
  // @ts-expect-error mark yes 는 proof 가 필수
  const bad: OurCell = { mark: "yes", reason: "근거" };
  assert.ok(bad);
});

test("AlternativesTable: 증거 ID 모양이 틀리면 오류", () => {
  const t = table();
  const rows = [...t.rows];
  rows[0] = { ...rows[0]!, ours: { mark: "yes", reason: "x", proof: { ...proof, evidenceId: "증거" as never } } };
  ruleError(() => alternatives({ ...t, rows }), /증거 ID/);
});

test("AlternativesTable: 대안 이름은 범주만(영문 상호·주소 거부)", () => {
  for (const bad of ["SketchUp", "Forma", "PlanReviewer", "https://x.kr", "TestFit 서비스"]) {
    const t = table();
    ruleError(() => alternatives({ ...t, alternativeNames: [bad, ...t.alternativeNames.slice(1)] }), /범주 이름/);
  }
  const ok = table({ alternativeNames: ["손으로 작도", "범용 AI 이미지 도구", "협력 건축사·외주", "CAD·모델러 직접"] });
  assert.doesNotThrow(() => alternatives(ok));
});

test("AlternativesTable: 행 수·열 수·빈 근거·맞지 않는 경우 개수 검사", () => {
  const t = table();
  ruleError(() => alternatives({ ...t, rows: t.rows.slice(0, 3) }), /4~6행/);
  ruleError(() => alternatives({ ...t, unfit: t.unfit.slice(0, 1) }), /2~4행/);
  ruleError(() => alternatives({ ...t, alternativeNames: t.alternativeNames.slice(0, 3) }), /대안 범주 수/);
  const rows = [...t.rows];
  rows[1] = { ...rows[1]!, alternatives: rows[1]!.alternatives.map((a) => ({ ...a, reason: " " })) };
  ruleError(() => alternatives({ ...t, rows }), /빈 문자열/);
});

// ---------- ContrastPair ----------
test("ContrastPair: dl 구조, 기호+글자 머리글, 같은 속성 같은 줄", () => {
  const out = contrast({
    label: "원인 비교",
    beforeLabel: "손으로 작도·검토",
    afterLabel: "Arch Studio",
    rows: [
      { attribute: "법규 확인", before: "직접 계산", after: "근거 조항과 함께 판정" },
      { attribute: "볼륨", before: "사선을 작도", after: "엔벨로프가 생김" },
    ],
  });
  assert.ok(out.includes('aria-label="원인 비교"'));
  assert.equal(count(out, /<dt /g), 2);
  assert.equal(count(out, /<dd /g), 4);
  assert.ok(out.includes("−") && out.includes("+"));
  assert.ok(!/(text|bg|border)-(red|green|rose|emerald)/.test(out), "빨강·초록 클래스 금지");
});

test("ContrastPair: 행 수 규칙", () => {
  ruleError(() => contrast({ label: "a", beforeLabel: "b", afterLabel: "c", rows: [{ attribute: "x", before: "y", after: "z" }] }), /2~6행/);
});

// ---------- DualTimeline ----------
test("DualTimeline: ol·단계마다 두 줄, 승인 지점은 사용자 줄에만", () => {
  const out = timeline({
    label: "도입 단계",
    steps: [
      { title: "체험", user: "설치하고 예시 대지로 판정을 만들어 본다", product: "판정과 도면을 만든다", approval: "결과를 확인하고 계속 쓸지 정한다", meta: { label: "요금", value: "준비 중" } },
      { title: "영구 라이선스", user: "시리얼을 받아 활성화한다", product: "라이선스를 확인한다" },
    ],
  });
  assert.match(out, /<ol role="list" aria-label="도입 단계"/);
  assert.equal(count(out, /<li /g), 2);
  assert.equal(count(out, /사용자가 하는 일/g), 2);
  assert.equal(count(out, /제품이 하는 일/g), 2);
  assert.equal(count(out, /승인 지점: /g), 1);
  const user = out.slice(out.indexOf("사용자가 하는 일"), out.indexOf("제품이 하는 일"));
  assert.ok(user.includes("승인 지점"), "승인 지점이 사용자 줄 안에 있다");
  const product = out.slice(out.indexOf("제품이 하는 일"), out.indexOf("요금"));
  assert.ok(!product.includes("승인 지점"));
});

test("DualTimeline: 단계가 없으면 오류", () => {
  ruleError(() => timeline({ label: "x", steps: [] }), /1~8단계/);
});

// ---------- ProofLink ----------
test("ProofLink: 링크·증거 ID·등급 표시, 기본 문구, 포커스 링", () => {
  const out = proofLink({ href: "/samples", evidenceId: "AS-E-01", grade: "E2" });
  assert.match(out, /<a href="\/samples"[^>]*data-evidence-id="AS-E-01"[^>]*data-evidence-grade="E2"/);
  assert.ok(out.includes("샘플 파일 받기") && out.includes("실제 결과 파일"));
  assert.ok(out.includes("focus-ring"));
});

test("ProofLink: https 는 rel 부여, download 속성", () => {
  const out = proofLink({ href: "https://example.kr/a", evidenceId: "AS-E-02", grade: "E3", label: "화면 기록 보기", download: true });
  assert.ok(out.includes('rel="noopener noreferrer"') && out.includes("download"));
});

test("ProofLink: 주소·증거 ID 없음, 위험한 주소, 화살표 문구, E4 조건 누락은 오류", () => {
  ruleError(() => proofLink({ href: "", evidenceId: "AS-E-01", grade: "E2" }), /빈 문자열/);
  ruleError(() => proofLink({ href: "javascript:alert(1)", evidenceId: "AS-E-01", grade: "E2" }), /주소/);
  ruleError(() => proofLink({ href: "/a", evidenceId: "" as never, grade: "E2" }), /증거 ID/);
  ruleError(() => proofLink({ href: "/a", evidenceId: "AS-E-01", grade: "E2", label: "받기 →" }), /화살표/);
  ruleError(() => proofLink({ href: "/a", evidenceId: "AS-E-03", grade: "E4" } as never), /빈 문자열/);
  assert.match(proofLink({ href: "/a", evidenceId: "AS-E-03", grade: "E4", conditions: "5명, 같은 원고, 2026-10" }), /측정 조건: 5명/);
});

test("ProofLink: 증거 링크 필수는 타입에도 걸린다", () => {
  // @ts-expect-error href·evidenceId 없이 쓸 수 없다
  const bad: ProofLinkProps = { grade: "E2" };
  assert.ok(bad);
});

// ---------- AssumptionTable ----------
test("AssumptionTable: table·caption·scope, 사용자/출처 구분, 출처 값은 확인일 포함", () => {
  const out = assumptions({
    caption: "계산에 쓴 가정",
    rows: [
      { label: "월 상담 건수", value: "입력값", by: "user" },
      { label: "크레딧 단가", value: "준비 중", by: "source", source: "01장 4.5절", checkedAt: "2026-10-29" },
    ],
  });
  assert.ok(out.includes("<caption"));
  assert.equal(count(out, /<th scope="col"/g), 4);
  assert.equal(count(out, /<th scope="row"/g), 2);
  assert.ok(out.includes("사용자 입력") && out.includes("출처 값"));
  assert.ok(out.includes('datetime="2026-10-29"') || out.includes('dateTime="2026-10-29"'));
  assert.match(out, /<div role="region"[^>]*tabindex="0"/);
});

test("AssumptionTable: 출처 없는 값·잘못된 확인일·빈 표는 오류", () => {
  ruleError(() => assumptions({ caption: "c", rows: [{ label: "a", value: "1", by: "source", source: "", checkedAt: "2026-10-29" }] }), /빈 문자열/);
  ruleError(() => assumptions({ caption: "c", rows: [{ label: "a", value: "1", by: "source", source: "s", checkedAt: "2026-02-31" }] }), /실제 날짜/);
  ruleError(() => assumptions({ caption: "c", rows: [{ label: "a", value: "1" } as never] }), /출처 없는 기본값/);
  ruleError(() => assumptions({ caption: "c", rows: [] }), /1행 이상/);
});

// ---------- Callout ----------
test("Callout: role=note, 결론 한 문장 + 설명 한 줄", () => {
  const out = callout({ conclusion: "우리 열에도 약한 기준이 있습니다", detail: "지원 범위와 처음 쓰는 수고입니다" });
  assert.match(out, /<div role="note"/);
  assert.equal(count(out, /<p /g), 2);
  assert.ok(out.includes("border-l-4"));
});

test("Callout: 두 문장·여러 줄·빈 결론은 오류", () => {
  ruleError(() => callout({ conclusion: "첫째입니다. 둘째입니다" }), /한 문장/);
  ruleError(() => callout({ conclusion: "한 줄\n두 줄" }), /한 줄/);
  ruleError(() => callout({ conclusion: "" }), /빈 문자열/);
  ruleError(() => callout({ conclusion: "결론", detail: "a\nb" }), /한 줄/);
});

// ---------- SourceNote ----------
test("SourceNote: 출처·확인일 한 줄, 링크 있으면 포커스 링", () => {
  const out = sourceNote({ source: "가격 정책 문서", checkedAt: "2026-10-29" });
  assert.ok(out.includes("출처: ") && out.includes("확인일 ") && out.includes("2026-10-29"));
  const linked = sourceNote({ source: "원문", checkedAt: "2026-10-29", href: "https://example.kr/x" });
  assert.match(linked, /<a href="https:\/\/example\.kr\/x"[^>]*focus-ring/);
});

test("SourceNote: 출처 없음·확인일 형식 오류는 오류", () => {
  ruleError(() => sourceNote({ source: "", checkedAt: "2026-10-29" }), /빈 문자열/);
  ruleError(() => sourceNote({ source: "x", checkedAt: "10/29" }), /YYYY-MM-DD/);
  ruleError(() => sourceNote({ source: "x", checkedAt: "2026-10-29", href: "javascript:1" }), /주소/);
});

// ---------- SampleTag ----------
test("SampleTag: '예시' 표시(기본)와 '샘플', 문구는 바꿀 수 없다", () => {
  assert.match(sampleTag(), /data-sample-tag="example"[^>]*>.*예시/);
  assert.ok(sampleTag({ kind: "sample" }).includes("샘플"));
  assert.ok(!sampleTag().includes("샘플"));
});

// ---------- 공통: 포커스 가능한 요소와 서버 컴포넌트 ----------
test("키보드 포커스 가능 요소는 모두 focus-ring 을 쓰고 상호작용 JS 요소가 없다", () => {
  const out = [
    alternatives(table()),
    assumptions({ caption: "c", rows: [{ label: "a", value: "1", by: "source", source: "s", checkedAt: "2026-10-29", href: "https://example.kr" }] }),
    proofLink({ href: "/a", evidenceId: "AS-E-01", grade: "E1" }),
    sourceNote({ source: "s", checkedAt: "2026-10-29", href: "https://example.kr" }),
  ].join("");
  const focusables = out.match(/<(a|button|input|select|textarea)\b[^>]*>|<div role="region"[^>]*>/g) ?? [];
  assert.ok(focusables.length > 0);
  for (const tag of focusables) assert.ok(tag.includes("focus-ring"), `focus-ring 없음: ${tag}`);
  assert.ok(!/<button|<input|onclick/i.test(out));
});
