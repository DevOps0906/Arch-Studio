// 판정 패널 서버 렌더(renderToStaticMarkup): 상태 배지 글자, 근거 없는 행 미표시, 펼치기 접근성, 폴백·개정 확인 배너, 고정 문구, 상태 4종.
// .tsx를 Node가 직접 못 읽어 tsx-hooks.mjs 로더를 쓴다(apps/web marketing 테스트와 같은 방식).
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { JudgmentPanelProps } from "./JudgmentPanel.tsx";
import { ENGINE_OUTPUTS, PREVIEW_TODAY, exampleConfirmed, toData, withMissingBasis } from "./fixtures.ts";
import { DISCLAIMER } from "./messages.ts";

register("./tsx-hooks.mjs", import.meta.url);
const { JudgmentPanel } = await import("./JudgmentPanel.tsx");

const out0 = ENGINE_OUTPUTS[0]!;
const render = (p: Partial<JudgmentPanelProps> & Pick<JudgmentPanelProps, "phase" | "data">) => renderToStaticMarkup(h(JudgmentPanel, p));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("미확인 팩: 모든 행에 미확인 배지 글자와 정직한 문구, PASS 배지 0", () => {
  const html = render({ phase: "ready", data: toData(out0) });
  const t = text(html);
  assert.equal(count(html, /aria-expanded=/g), 10);
  assert.ok(t.includes("미확인 — 규칙 팩에 확정된 수치가 없습니다"));
  assert.ok(count(t, /미확인 — 규칙 팩에 확정된 수치가 없습니다/g) >= 10);
  assert.ok(!t.includes("PASS"));
  assert.ok(!t.includes("통과 1"), "통과 개수 요약은 0");
  assert.match(t, /통과 0/);
  assert.match(t, /미확인 7 /);
  assert.match(t, /규칙 팩 2026\.10\.0/);
});

test("상태 배지는 글자 + 접근성 이름: PASS 통과 / WARN 확인 필요 / FAIL 기준 초과", () => {
  const html = render({ phase: "ready", data: exampleConfirmed(out0, "fail") });
  const t = text(html);
  for (const s of ["PASS", "통과", "WARN", "확인 필요", "FAIL", "기준 초과", "대상 아님", "산정값"]) assert.ok(t.includes(s), s);
  assert.ok(html.includes('aria-label="판정 결과 통과"'));
  assert.ok(html.includes('aria-label="판정 결과 기준 초과"'));
  assert.ok(html.includes('aria-label="판정 결과 확인 필요"'));
  assert.match(t, /초과 450mm/);
  assert.match(t, /측정 .*%/);
});

test("행 펼치기: 버튼 aria-expanded, 닫힘 기본, 펼치면 근거 조항·시행일·규칙 팩 버전", () => {
  const closed = render({ phase: "ready", data: exampleConfirmed(out0, "fail") });
  assert.equal(count(closed, /aria-expanded="true"/g), 0);
  assert.ok(!closed.includes("근거 조항"));
  assert.equal(count(closed, /<button[^>]*aria-expanded="false"[^>]*aria-controls=/g), 10);
  const open = render({ phase: "ready", data: exampleConfirmed(out0, "fail"), defaultExpanded: ["coverage-0"] });
  assert.equal(count(open, /aria-expanded="true"/g), 1);
  const t = text(open);
  assert.ok(t.includes("근거 조항"));
  assert.ok(t.includes("시행일 2026-01-01"));
  assert.ok(t.includes("[예시] 법령명 [예시] 제00조"));
  assert.match(t, /규칙 팩 \[예시\] 2000\.01\.1/);
});

test("미확인 근거를 펼치면 '근거 조문 미확인'을 그대로 보인다(허위 조문 없음)", () => {
  const t = text(render({ phase: "ready", data: toData(out0), defaultExpanded: ["coverage-0"] }));
  assert.ok(t.includes("근거 조문 미확인(법규 원문 대조 전)"));
  assert.ok(t.includes("시행일 미확인"));
});

test("근거 없는 행은 렌더되지 않는다(AR-F-004)", () => {
  const html = render({ phase: "ready", data: withMissingBasis(toData(out0)) });
  assert.equal(count(html, /aria-expanded=/g), 9);
  assert.ok(!text(html).includes("건폐율"));
  assert.ok(text(html).includes("용적률"));
});

test("대상 여부 섹션(AR-F-007)과 예정 규칙(참고) n건", () => {
  const t = text(render({ phase: "ready", data: exampleConfirmed(out0, "warn") }));
  assert.ok(t.includes("대상 여부"));
  for (const s of ["내진설계", "제로에너지건축물", "허가권자 지정감리"]) assert.ok(t.includes(s), s);
  assert.ok(t.includes("예정 규칙(참고) 1건"));
  assert.ok(!text(render({ phase: "ready", data: toData(out0) })).includes("예정 규칙(참고)"));
});

test("고정 문구가 항상 하단에 있다(준비·로딩·오류·빈 상태 모두)", () => {
  for (const p of [
    { phase: "ready" as const, data: toData(out0) },
    { phase: "loading" as const, data: null },
    { phase: "error" as const, data: null },
    { phase: "idle" as const, data: null, hasMass: false },
  ]) assert.ok(text(render(p)).includes(DISCLAIMER), p.phase);
});

test("폴백 배너: 문구 + 개정 목록 보기 + 업데이트 연장(핸들러가 있을 때)", () => {
  const fallback = { packVersion: "2026.10.0", basisDate: "2026-10-14", pendingChanges: 2 };
  const t = text(render({ phase: "ready", data: toData(out0), fallback, onShowRevisions: () => undefined, onExtendUpdates: () => undefined }));
  assert.ok(t.includes("판정 기준: 규칙 팩 2026.10.0(기준일 2026-10-14). 이후 개정 2건."));
  assert.ok(t.includes("개정 목록 보기"));
  assert.ok(t.includes("업데이트 연장"));
  const plain = text(render({ phase: "ready", data: toData(out0) }));
  assert.ok(!plain.includes("판정 기준: 규칙 팩"));
  const offline = text(render({ phase: "ready", data: toData(out0), fallback: { ...fallback, pendingChanges: null } }));
  assert.ok(offline.includes("이후 개정 건수는 온라인에서 확인합니다"));
});

test("개정 확인 필요 배너: 30일 이상일 때만", () => {
  const stale = text(render({ phase: "ready", data: toData(out0), revisionCheck: { lastCheckedAt: "2026-09-20", today: PREVIEW_TODAY } }));
  assert.ok(stale.includes("개정 확인 필요"));
  assert.ok(stale.includes("39일 전"));
  const fresh = text(render({ phase: "ready", data: toData(out0), revisionCheck: { lastCheckedAt: "2026-10-20", today: PREVIEW_TODAY } }));
  assert.ok(!fresh.includes("개정 확인 필요"));
});

test("상태 4종: 로딩·오류(다시 시도)·빈 상태·갱신 중", () => {
  assert.ok(text(render({ phase: "loading", data: null })).includes("판정 계산 중"));
  const err = text(render({ phase: "error", data: null, errorCode: "AR050", onRetry: () => undefined }));
  assert.ok(err.includes("모델에 빠진 정보가 있어 판정할 수 없습니다"));
  assert.ok(err.includes("다시 시도"));
  const empty = text(render({ phase: "idle", data: null, hasMass: false }));
  assert.ok(empty.includes("매스가 없습니다"));
  assert.ok(empty.includes("엔벨로프 안에 매스를 그리면 판정이 시작됩니다."));
  const refreshing = text(render({ phase: "loading", data: toData(out0) }));
  assert.ok(refreshing.includes("판정 갱신 중"));
  assert.ok(refreshing.includes("건폐율"));
});

test("매스 강조 버튼은 onHighlight와 massIds가 있고 기하 항목 행을 펼쳤을 때만", () => {
  const base = { phase: "ready" as const, data: exampleConfirmed(out0, "fail"), defaultExpanded: ["coverage-0", "seismic-7"] };
  const withCb = text(render({ ...base, massIds: ["m-house"], onHighlight: () => undefined }));
  assert.equal(count(withCb, /해당 매스 강조/g), 1, "기하 항목(건폐율)만, 대상 여부 행에는 없다");
  assert.ok(!text(render(base)).includes("해당 매스 강조"));
  assert.ok(!text(render({ ...base, onHighlight: () => undefined })).includes("해당 매스 강조"));
});
