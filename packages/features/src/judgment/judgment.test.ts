// 판정 패널 순수 로직: 행 만들기(근거 없는 행 미표시·상태·값 포맷), 폴백 문구·30일 규칙, 판정 요청 리듀서(superseded 처리).
import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween, fallbackSentence, revisionCheckSentence, revisionCheckStale } from "./fallback.ts";
import { ENGINE_OUTPUTS, exampleConfirmed, toData, withMissingBasis } from "./fixtures.ts";
import { DISCLAIMER, UNVERIFIED_TEXT } from "./messages.ts";
import { buildRows, countStatuses, formatValue, noticeWarnings, scheduledRuleCount } from "./model.ts";
import { INITIAL_JUDGE_STATE, buildJudgeRequest, judgeReducer, parseJudgeResult, type JudgeRequestState } from "./request.ts";

const out0 = ENGINE_OUTPUTS[0]!;

test("픽스처는 실제 엔진 출력 모양: 전 항목 WARN + 근거 1건 이상", () => {
  assert.equal(ENGINE_OUTPUTS.length, 3);
  for (const o of ENGINE_OUTPUTS) {
    assert.equal(o.result.rule_pack_version, "2026.10.0");
    assert.ok(o.result.items.length >= 9);
    for (const it of o.result.items) {
      assert.equal(it.verdict, "WARN");
      assert.ok(it.basis.length >= 1);
    }
    assert.equal(o.details.length, o.result.items.length);
  }
});

test("규칙 팩 수치 미확인: 모든 행이 미확인이고 PASS·FAIL이 하나도 없다", () => {
  for (const o of ENGINE_OUTPUTS) {
    const rows = buildRows(toData(o));
    const all = [...rows.quant, ...rows.target];
    assert.equal(all.length, o.result.items.length);
    for (const r of all) assert.equal(r.status, "unverified", `${r.label}`);
    assert.deepEqual(countStatuses(rows.quant), { pass: 0, warn: 0, fail: 0, unverified: rows.quant.length });
    assert.ok(UNVERIFIED_TEXT.includes("규칙 팩에 확정된 수치가 없습니다"));
  }
});

test("근거(basis)가 없는 행은 만들지 않는다(AR-F-004)", () => {
  const data = withMissingBasis(toData(out0));
  const rows = buildRows(data);
  assert.equal(rows.hidden, 1);
  const all = [...rows.quant, ...rows.target];
  assert.equal(all.length, out0.result.items.length - 1);
  assert.ok(!all.some((r) => r.key === "coverage"));
  // 빈 문자열뿐인 근거도 근거가 아니다.
  const blank = toData(out0);
  const blankData = { ...blank, result: { ...blank.result, items: blank.result.items.map((it, i) => (i === 1 ? { ...it, basis: [{ law: " ", article: "", effective_from: "", ordinance: false }] } : it)) } };
  assert.ok(!buildRows(blankData).quant.some((r) => r.key === "far"));
  // 모든 행에는 근거가 1건 이상 붙는다.
  for (const r of all) assert.ok(r.basis.length >= 1);
});

test("미확인 근거는 verified=false, 확정 근거는 true", () => {
  const rows = buildRows(toData(out0));
  assert.ok(rows.quant.every((r) => r.basis.every((b) => !b.verified)));
  const ex = buildRows(exampleConfirmed(out0, "fail"));
  assert.ok([...ex.quant, ...ex.target].every((r) => r.basis.every((b) => b.verified)));
});

test("상태: PASS/FAIL/WARN/미확인/대상/대상 아님/산정값 구분 + 초과량", () => {
  const fail = buildRows(exampleConfirmed(out0, "fail"));
  const byLabel = (l: string) => [...fail.quant, ...fail.target].find((r) => r.label === l)!;
  assert.equal(byLabel("건폐율").status, "pass");
  assert.equal(byLabel("높이").status, "fail");
  assert.match(byLabel("높이").excessText ?? "", /^초과 450mm$/);
  assert.equal(byLabel("이격(도로)").status, "fail");
  assert.match(byLabel("이격(도로)").excessText ?? "", /^부족 1,200mm$/);
  assert.equal(byLabel("정북 일조사선").status, "warn");
  assert.equal(byLabel("주차").status, "na");
  assert.equal(byLabel("내진설계").status, "target");
  assert.equal(byLabel("제로에너지건축물").status, "not_target");
  assert.equal(fail.target.length, 3);
  assert.deepEqual(countStatuses(fail.quant), { pass: 3, warn: 1, fail: 2, unverified: 0 });
});

test("값 포맷: pct 소수 둘째 자리, mm 정수·천 단위, 대", () => {
  assert.equal(formatValue(30.3, "pct"), "30.30%");
  assert.equal(formatValue(60, "pct"), "60.00%");
  assert.equal(formatValue(6300, "mm"), "6,300mm");
  assert.equal(formatValue(5000.4, "mm"), "5,000mm");
  assert.equal(formatValue(2, "count"), "2대");
  assert.equal(formatValue(12.5, "m2"), "12.50㎡");
  const rows = buildRows(toData(out0));
  const cov = rows.quant.find((r) => r.key === "coverage")!;
  assert.equal(cov.valueText, "측정 30.30%");
  assert.equal(cov.limitText, "한도 미확인");
  const h = rows.quant.find((r) => r.key === "height")!;
  assert.equal(h.valueText, "측정 6,300mm");
});

test("예정 규칙 건수·안내 경고 분리", () => {
  const ex = exampleConfirmed(out0, "warn");
  assert.equal(scheduledRuleCount(ex.warnings), 1);
  assert.equal(noticeWarnings(ex.warnings).length, 0);
  assert.equal(scheduledRuleCount(toData(out0).warnings), 0);
  assert.equal(noticeWarnings(toData(out0).warnings).length, 1); // 조례 미확인 지자체
});

test("폴백 문구(03장 2.7절)", () => {
  assert.equal(fallbackSentence({ packVersion: "2026.10.0", basisDate: "2026-10-14", pendingChanges: 2 }), "판정 기준: 규칙 팩 2026.10.0(기준일 2026-10-14). 이후 개정 2건.");
  assert.equal(fallbackSentence({ packVersion: "2026.10.0", basisDate: "2026-10-14", pendingChanges: 0 }), "판정 기준: 규칙 팩 2026.10.0(기준일 2026-10-14). 이후 개정 0건.");
  assert.match(fallbackSentence({ packVersion: "2026.10.0", basisDate: "2026-10-14", pendingChanges: null }), /이후 개정 건수는 온라인에서 확인합니다/);
});

test("개정 확인 필요: 30일 이상·기록 없음·형식 오류만 참", () => {
  assert.equal(daysBetween("2026-09-29", "2026-10-29"), 30);
  assert.equal(revisionCheckStale("2026-09-30", "2026-10-29"), false); // 29일
  assert.equal(revisionCheckStale("2026-09-29", "2026-10-29"), true); // 30일
  assert.equal(revisionCheckStale(null, "2026-10-29"), true);
  assert.equal(revisionCheckStale("모름", "2026-10-29"), true);
  assert.equal(revisionCheckStale("2026-10-29", "2026-10-29"), false);
  assert.match(revisionCheckSentence("2026-09-20", "2026-10-29"), /39일 전/);
  assert.match(revisionCheckSentence(null, "2026-10-29"), /기록이 없습니다/);
});

test("고정 문구는 03장 3.5절 그대로", () => {
  assert.equal(DISCLAIMER, "판정은 설계 검토를 돕는 참고 자료입니다. 최종 판단은 건축사와 허가권자가 합니다.");
});

// ---- 판정 요청 리듀서 ----
const okResponse = (reqId: string, seq: number, over: Partial<{ model_rev: string }> = {}) => ({
  req_id: reqId,
  seq,
  ok: true as const,
  op: "judge",
  result: { result: out0.result, details: out0.details, warnings: out0.warnings, model_rev: over.model_rev ?? "r", rule_pack_fallback: false },
  engine_version: "rules-0.1.0",
  elapsed_ms: 12,
});

function run(events: Parameters<typeof judgeReducer>[1][], from: JudgeRequestState = INITIAL_JUDGE_STATE) {
  return events.reduce(judgeReducer, from);
}

test("요청 → 로딩, 응답 → 준비(데이터·소요 시간)", () => {
  const s1 = run([{ type: "request", reqId: "a", seq: 0 }]);
  assert.equal(s1.phase, "loading");
  assert.equal(s1.data, null);
  const s2 = judgeReducer(s1, { type: "response", response: okResponse("a", 0) });
  assert.equal(s2.phase, "ready");
  assert.equal(s2.data?.elapsedMs, 12);
  assert.equal(s2.data?.result.rule_pack_version, "2026.10.0");
  assert.equal(s2.pendingReqId, null);
});

test("최신만 유효: 옛 요청의 결과·superseded·오류는 버리고 마지막 요청만 반영", () => {
  let s = run([
    { type: "request", reqId: "a", seq: 0 },
    { type: "request", reqId: "b", seq: 1 },
  ]);
  assert.equal(s.pendingReqId, "b");
  // 옛 요청 a의 superseded·늦은 결과·오류 → 무시
  for (const response of [{ req_id: "a", status: "superseded" }, okResponse("a", 0), { req_id: "a", seq: 0, ok: false, code: "AR050", detail: "x" }]) {
    const next = judgeReducer(s, { type: "response", response });
    assert.equal(next, s, "상태가 바뀌면 안 된다");
  }
  s = judgeReducer(s, { type: "response", response: okResponse("b", 1) });
  assert.equal(s.phase, "ready");
});

test("새 요청 중에도 직전 데이터를 남긴다(갱신 중)", () => {
  const ready = run([{ type: "request", reqId: "a", seq: 0 }, { type: "response", response: okResponse("a", 0) }]);
  const s = judgeReducer(ready, { type: "request", reqId: "b", seq: 1 });
  assert.equal(s.phase, "loading");
  assert.ok(s.data);
});

test("더 오래된 seq의 요청과 seq가 맞지 않는 응답은 무시", () => {
  const s = run([{ type: "request", reqId: "b", seq: 3 }]);
  assert.equal(judgeReducer(s, { type: "request", reqId: "old", seq: 2 }), s);
  assert.equal(judgeReducer(s, { type: "response", response: okResponse("b", 2) }), s);
});

test("오류 응답 → error(코드 보존, 데이터 제거), 진행·취소 처리", () => {
  const s = run([{ type: "request", reqId: "a", seq: 0 }]);
  const err = judgeReducer(s, { type: "response", response: { req_id: "a", seq: 0, ok: false, code: "AR050", detail: "d" } });
  assert.equal(err.phase, "error");
  assert.equal(err.error?.code, "AR050");
  assert.equal(err.data, null);
  assert.equal(judgeReducer(s, { type: "response", response: { req_id: "a", status: "progress", pct: 10 } }), s);
  assert.equal(judgeReducer(s, { type: "response", response: { req_id: "a", status: "canceled" } }).phase, "idle");
});

test("형식이 틀린 결과는 INVALID_RESPONSE, 알 수 없는 응답은 무시", () => {
  const s = run([{ type: "request", reqId: "a", seq: 0 }]);
  const bad = judgeReducer(s, { type: "response", response: { req_id: "a", seq: 0, ok: true, op: "judge", result: { result: { items: "x" } }, engine_version: "e", elapsed_ms: 1 } });
  assert.equal(bad.phase, "error");
  assert.equal(bad.error?.code, "INVALID_RESPONSE");
  assert.equal(judgeReducer(s, { type: "response", response: null }), s);
  assert.equal(judgeReducer(s, { type: "response", response: { nope: 1 } }), s);
  assert.equal(parseJudgeResult(null), null);
});

test("fail·reset 이벤트와 요청 봉투 모양(017 protocol)", () => {
  assert.equal(run([{ type: "fail", code: "ENGINE_UNAVAILABLE" }]).error?.code, "ENGINE_UNAVAILABLE");
  assert.equal(run([{ type: "request", reqId: "a", seq: 0 }, { type: "reset" }]), INITIAL_JUDGE_STATE);
  const req = buildJudgeRequest({ reqId: "r", seq: 4, modelRev: "v2", model: {}, pendingChanges: 2 });
  assert.deepEqual(Object.keys(req).sort(), ["lane", "model", "model_rev", "op", "pending_changes", "req_id", "seq"]);
  assert.equal(req.lane, "judge");
  assert.ok(!("pending_changes" in buildJudgeRequest({ reqId: "r", seq: 4, modelRev: "v2", model: {} })));
});
