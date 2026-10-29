// 매스 제안 화면 쪽 테스트(AR-06-028): 응답 검사(신뢰 경계)·상태기계·적용 명령(실행 취소 1단계, 열람 잠금)·패널 서버 렌더(4상태·잠금·오래된 결과).
// 좌표·판정은 엔진(packages/massing·rules) 몫이라 여기서는 만들지 않는다 — 엔진 응답 모양의 예시(preview.ts)를 쓴다.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { designModelV1Schema, type DesignModelV1 } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../../demo/index.ts";
import { createModelerState, modelerReducer } from "../state/store.ts";
import { applySuggestion } from "./apply.ts";
import { suggestPreviewKind } from "./preview-kind.ts";
import { previewState, previewView } from "./preview.ts";
import { defaultTargets, parseSuggestResult, targetsIssue, type SuggestView } from "./protocol.ts";
import { INITIAL_SUGGEST_STATE, suggestInputKey, suggestReducer, type SuggestState } from "./state.ts";

register("../tsx-hooks.mjs", import.meta.url);
const { SuggestPanel, STALE_TEXT, cardStatus } = await import("./SuggestPanel.tsx");

const house = DEMO_PROJECTS[0]?.model as DesignModelV1;

/** 화면 데이터 → 워커 응답 모양(snake_case). */
function raw(view: SuggestView): Record<string, unknown> {
  return {
    candidates: view.candidates.map((c) => ({
      id: c.id,
      strategy: c.id,
      title: c.title,
      reasons: c.reasons,
      masses: c.masses,
      floors: c.floors,
      width_mm: c.widthMm,
      depth_mm: c.depthMm,
      footprint_area_m2: c.footprintAreaM2,
      gfa_m2: c.gfaM2,
      allowed_floors: c.allowedFloors,
      spare_floors: c.spareFloors,
      status: c.status,
      judge: { result: c.judge.result, details: c.judge.details, warnings: c.judge.warnings },
    })),
    max_gfa_m2: view.maxGfaM2,
    target_met: view.targetMet,
    notices: view.notices,
    rule_pack_version: view.rulePackVersion,
    rule_pack_fallback: false,
    targets: { target_gfa_m2: view.targets.target_gfa_m2, floors: null, floor_height_mm: 3000, use: "단독주택" },
  };
}

test("응답 검사: 정상 응답은 통과, FAIL 후보·깨진 매스·4안 이상·모르는 전략은 통째로 거부", () => {
  const view = previewView(house, "ready");
  const ok = parseSuggestResult(raw(view));
  assert.ok(ok);
  assert.equal(ok.candidates.length, 3);
  assert.equal(ok.candidates[0]?.judge.result.items.length, view.candidates[0]?.judge.result.items.length);
  const base = raw(view) as { candidates: Record<string, unknown>[] };
  // FAIL 후보
  const failItems = view.candidates[0]!.judge.result.items.map((i, k) => (k === 0 ? { ...i, verdict: "FAIL" as const } : i));
  const withFail = structuredClone(base);
  (withFail.candidates[0] as { judge: { result: { items: unknown } } }).judge.result.items = failItems;
  assert.equal(parseSuggestResult(withFail), null);
  // 깨진 매스(스키마 위반)
  const brokenMass = structuredClone(base);
  (brokenMass.candidates[1] as { masses: unknown }).masses = [{ id: "m-1" }];
  assert.equal(parseSuggestResult(brokenMass), null);
  // 4안
  assert.equal(parseSuggestResult({ ...base, candidates: [...base.candidates, base.candidates[0]] }), null);
  // 모르는 전략
  const unknown = structuredClone(base);
  (unknown.candidates[0] as { id: string }).id = "other";
  assert.equal(parseSuggestResult(unknown), null);
  assert.equal(parseSuggestResult(null), null);
  assert.equal(parseSuggestResult({ candidates: "x" }), null);
});

test("목표 검사·기본값(면적표 합계, 첫 매스 용도)", () => {
  assert.equal(targetsIssue({ target_gfa_m2: 200, floors: null, floor_height_mm: 3000, use: "단독주택" }), null);
  for (const bad of [{ target_gfa_m2: -5 }, { target_gfa_m2: 2_000_000 }, { floors: 0 }, { floors: 61 }, { floors: 2.5 }, { floor_height_mm: 1000 }, { use: " " }]) {
    assert.ok(targetsIssue({ target_gfa_m2: 200, floors: null, floor_height_mm: 3000, use: "단독주택", ...bad }), JSON.stringify(bad));
  }
  const m = structuredClone(house);
  m.program.targets = [
    { name: "거실", use: "주거", target_area_m2: 30.5 },
    { name: "침실", use: "주거", target_area_m2: 20 },
  ];
  assert.deepEqual(defaultTargets(m), { target_gfa_m2: 50.5, floors: null, floor_height_mm: 3000, use: "주거" });
});

test("상태기계: 마지막 요청의 응답만 받고, 옛 응답·옛 오류·superseded는 버린다", () => {
  const view = previewView(house, "ready");
  let s = suggestReducer(INITIAL_SUGGEST_STATE, { type: "request", reqId: "a", seq: 0, inputKey: "k" });
  assert.equal(s.phase, "loading");
  s = suggestReducer(s, { type: "request", reqId: "b", seq: 1, inputKey: "k" });
  assert.equal(suggestReducer(s, { type: "request", reqId: "old", seq: 0, inputKey: "k" }), s, "더 오래된 seq는 무시");
  assert.equal(suggestReducer(s, { type: "response", response: { req_id: "a", ok: true, seq: 0, result: raw(view) } }), s, "옛 요청의 응답은 버림");
  assert.equal(suggestReducer(s, { type: "response", response: { req_id: "b", status: "superseded" } }), s);
  const ready = suggestReducer(s, { type: "response", response: { req_id: "b", ok: true, seq: 1, result: raw(view) } });
  assert.equal(ready.phase, "ready");
  assert.equal(ready.view?.candidates.length, 3);
  assert.equal(ready.inputKey, "k");
  // 형식이 틀린 성공 응답 → 오류
  const bad = suggestReducer(s, { type: "response", response: { req_id: "b", ok: true, seq: 1, result: { candidates: 5 } } });
  assert.equal(bad.phase, "error");
  assert.equal(bad.view, null);
  // 엔진 오류 → 오류 문구(고정 문구 + 코드)
  const err = suggestReducer(s, { type: "response", response: { req_id: "b", ok: false, seq: 1, code: "AR050", detail: "규칙 팩이 없습니다" } });
  assert.equal(err.phase, "error");
  assert.match(err.error ?? "", /규칙 팩이 없습니다\(AR050\)/);
  // 적용 표시는 결과가 있을 때만, 새 요청이 지운다
  assert.equal(suggestReducer(INITIAL_SUGGEST_STATE, { type: "applied", id: "max_coverage" }).applied, null);
  const applied = suggestReducer(ready, { type: "applied", id: "max_coverage" });
  assert.equal(applied.applied, "max_coverage");
  assert.equal(suggestReducer(applied, { type: "request", reqId: "c", seq: 2, inputKey: "k" }).applied, null);
  assert.equal(suggestReducer(s, { type: "fail", code: "ENGINE_UNAVAILABLE" }).error, "엔진을 쓸 수 없는 환경입니다.");
});

test("적용: 매스 통째 교체 + 평면 정리, 모델러 명령 1개 → 실행 취소 1번으로 원래 모델(참조 동일), 이력 라벨", () => {
  const view = previewView(house, "ready");
  const masses = view.candidates[0]!.masses;
  const r = applySuggestion(house, masses);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(designModelV1Schema.safeParse(r.model).success, true);
  assert.deepEqual(r.model.masses, masses);
  assert.deepEqual(r.model.floor_layouts, []);
  assert.equal(r.select, masses[0]?.id);

  const s0 = createModelerState(house);
  const s1 = modelerReducer(s0, { type: "command", command: { type: "suggest", masses } });
  assert.notEqual(s1.history.present, house);
  assert.equal(s1.history.past.length, s0.history.past.length + 1, "이력 1단계");
  assert.equal(s1.history.past[s1.history.past.length - 1]?.label, "매스 제안 적용");
  const s2 = modelerReducer(s1, { type: "undo" });
  assert.equal(s2.history.present, house, "실행 취소 1번으로 원래 모델 그대로");
  const s3 = modelerReducer(s2, { type: "redo" });
  assert.deepEqual(s3.history.present.masses, masses);
});

test("적용 거부: 열람(편집 잠금)이면 리듀서가 막고 모델 불변, 범위 밖 결과는 명령이 실패", () => {
  const masses = previewView(house, "ready").candidates[0]!.masses;
  const locked = createModelerState(house, { editable: false, reason: "열람 모드: 편집하려면 라이선스나 구독이 필요합니다." });
  const after = modelerReducer(locked, { type: "command", command: { type: "suggest", masses } });
  assert.equal(after.history.present, house);
  assert.equal(after.notice?.tone, "warn");
  const far = structuredClone(masses[0]!);
  far.footprint = { outer: [[0, 0], [1, 0], [1, 1], [0, 1]] }; // 면적 있지만 층 없음 검사와 별개로
  far.floors = [];
  assert.equal(applySuggestion(house, [far]).ok, false);
  assert.equal(applySuggestion(house, []).ok, false);
  const dup = [masses[0]!, masses[0]!];
  assert.equal(applySuggestion(house, dup).ok, false);
  const tall = structuredClone(masses[0]!);
  tall.floors = tall.floors.map((f) => ({ ...f, height_mm: 50 }));
  assert.equal(applySuggestion(house, [tall]).ok, false);
});

test("데모 미리보기 종류: suggest-* 만 인식, 상태 4종이 나온다", () => {
  assert.equal(suggestPreviewKind("suggest-ready"), "ready");
  assert.equal(suggestPreviewKind("suggest-short"), "short");
  assert.equal(suggestPreviewKind("ready"), null);
  assert.equal(suggestPreviewKind("suggest-x"), null);
  assert.equal(suggestPreviewKind(null), null);
  assert.equal(previewState(house, "empty").phase, "idle");
  assert.equal(previewState(house, "loading").phase, "loading");
  assert.equal(previewState(house, "error").phase, "error");
  const ready = previewState(house, "ready");
  assert.equal(ready.phase, "ready");
  assert.equal(ready.inputKey, suggestInputKey(house));
});

const noop = () => undefined;
function render(state: SuggestState, over: { editable?: boolean; lockReason?: string | null; model?: DesignModelV1 } = {}): string {
  return renderToStaticMarkup(
    h(SuggestPanel, { model: over.model ?? house, state, onRequest: () => null, onApply: noop, onClose: noop, editable: over.editable ?? true, lockReason: over.lockReason ?? null }),
  );
}

test("패널 · 빈 상태: 안내 문구와 '제안 받기', 카드 없음", () => {
  const html = render(INITIAL_SUGGEST_STATE);
  assert.match(html, /매스 자동 제안/);
  assert.match(html, /아직 제안이 없습니다/);
  assert.match(html, /제안 받기/);
  assert.doesNotMatch(html, /<article/);
  assert.match(html, /최종 판단은 건축사와 허가권자가 합니다/);
});

test("패널 · 로딩/오류 상태", () => {
  assert.match(render(previewState(house, "loading")), /매스 후보를 찾는 중입니다/);
  const err = render(previewState(house, "error"));
  assert.match(err, /role="alert"/);
  assert.match(err, /매스를 제안하지 못했습니다/);
  assert.match(err, /다시 시도/);
});

test("패널 · 성공: 카드 3장(건폐 최대·일조 여유·정형 평면), 건폐·용적·높이는 판정 행 그대로, 적용 버튼 활성", () => {
  const html = render(previewState(house, "ready"));
  assert.equal(html.match(/<article/g)?.length, 3);
  for (const t of ["건폐 최대", "일조 여유", "정형 평면"]) assert.match(html, new RegExp(t));
  for (const l of ["건폐율", "용적률", "높이"]) assert.match(html, new RegExp(`>${l}<`));
  assert.match(html, /한도 미확인/, "규칙 팩 전 항목 미확인 → PASS를 만들지 않는다");
  assert.doesNotMatch(html, /통과<|aria-label="판정 결과 통과"/);
  assert.match(html, /법규 수치가 확인되지 않았습니다/);
  assert.match(html, /연면적\(제안 산정\)/);
  assert.equal(html.match(/이 안으로 적용/g)?.length, 3);
  assert.doesNotMatch(html, /적용 잠금/);
  assert.match(html, /role="img" aria-label="건폐 최대 바닥 미리보기/);
  assert.match(html, /적용하면 현재 매스 1개가 이 안으로 바뀝니다/);
});

test("패널 · 확정 규칙 예시(PASS 행) · 목표 미달 안내 + 목표 조정", () => {
  const pass = render(previewState(house, "pass"));
  assert.match(pass, /aria-label="판정 결과 통과"/);
  const short = render(previewState(house, "short"));
  assert.match(short, /엔벨로프 안에서 최대 [\d.]+㎡입니다/);
  assert.match(short, /목표 조정/);
});

test("패널 · 열람 잠금: 적용 버튼 비활성 + 이유(aria-describedby), 제안 받기·보기는 가능", () => {
  const reason = "열람 모드: 편집하려면 라이선스나 구독이 필요합니다.";
  const html = render(previewState(house, "ready"), { editable: false, lockReason: reason });
  assert.match(html, /적용 잠금:/);
  assert.ok(html.includes(reason));
  const applyButtons = html.match(/<button[^>]*>(?:(?!<\/button>).)*이 안으로 적용/g) ?? [];
  assert.equal(applyButtons.length, 3);
  assert.ok(applyButtons.every((b) => /disabled=""/.test(b) && /aria-describedby="[^"]+-lock"/.test(b)));
  const submit = /<button type="submit"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(submit !== "" && !submit.includes('disabled=""'), "제안 받기는 열람에서도 된다(로컬 계산, 0 크레딧)");
  assert.equal(html.match(/<article/g)?.length, 3);
});

test("패널 · 오래된 결과(대지·규칙이 바뀜): 적용 잠금 + 안내", () => {
  const other = structuredClone(house);
  other.site.north_angle_deg = house.site.north_angle_deg + 10;
  const html = render(previewState(house, "ready"), { model: other });
  assert.match(html, /결과가 오래되었습니다/);
  assert.ok(html.includes(STALE_TEXT));
  assert.ok((html.match(/disabled=""/g)?.length ?? 0) >= 3);
});

test("적용 직후 표시와 카드 배지: 적용됨 + 실행 취소 안내, 가장 나쁜 행 상태", () => {
  const s = suggestReducer(previewState(house, "ready"), { type: "applied", id: "max_coverage" });
  const html = render(s);
  assert.match(html, /적용됨/);
  assert.match(html, /실행 취소\(Ctrl\+Z\) 한 번으로/);
  assert.equal(cardStatus([]), "pass");
});
