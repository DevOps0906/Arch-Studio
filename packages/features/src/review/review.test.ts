// 클라우드 검토 순수 로직 테스트(AR-06-055): AI 문장에 숫자 0(판정 수치는 결과 칸만), 출처 없는 문장 제거,
// 잡 단계 → 화면 단계(실패 = 환불), 요청 본문(rule_context, 데스크톱 판정 미포함), request_id 유지 규칙.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api-client/index.ts";
import {
  hasDigit,
  isLockError,
  keepsReviewRequestId,
  parseJob,
  parseReviewResult,
  parseRun,
  reviewBody,
  reviewPhase,
  reviewView,
  startErrorText,
} from "./model.ts";

const SOURCES = [
  { id: "s1", law: "건축법", article: "제55조", effective_from: "2026-01-01", kind: "law" },
  { id: "s2", law: "서울특별시 도시계획 조례", article: "제54조", effective_from: "2025-07-01", kind: "ordinance" },
];
const RESULT = {
  review: {
    schema_version: "review.v1",
    rule_pack_version: "2026.10.0",
    items: [
      {
        key: "coverage",
        verdict: "PASS",
        engine_value: { value: 58.123, limit: 60, unit: "%" },
        sentences: [
          { text: "산정값이 한도값 안에 있습니다.", source_ids: ["s1"], nature: "interpretation" },
          { text: "건폐율은 60퍼센트입니다 (숫자 섞임)", source_ids: ["s1"], nature: "interpretation" },
          { text: "출처 없는 문장", source_ids: ["nope"], nature: "interpretation" },
        ],
      },
      { key: "district_plan", verdict: "CHECK", sentences: [{ text: "지구단위계획 결정 고시를 확인하세요.", source_ids: ["s2"], nature: "interpretation" }] },
    ],
    needs_check: [
      { text: "조례 개정 여부를 허가권자에게 확인하세요.", source_ids: ["s2"], nature: "interpretation" },
      { text: "제３항 적용 여부", source_ids: ["s2"], nature: "interpretation" },
    ],
    sources: SOURCES,
    disclaimer_version: "d1",
  },
  refs: { "coverage.value": 58.123 },
};

test("AI 문장에 숫자 표시 0: 숫자 든 문장은 버리고, 판정 수치는 결과 칸(value)에서만", () => {
  const r = parseReviewResult(RESULT);
  assert.ok(r);
  const v = reviewView(r);
  const texts = [...v.items.flatMap((i) => i.sentences.map((s) => s.text)), ...v.needsCheck.map((n) => n.text)];
  assert.ok(texts.length > 0);
  for (const t of texts) assert.equal(hasDigit(t), false, `AI 문장에 숫자: ${t}`);
  assert.equal(v.hidden, 3, "숫자 문장 2 + 출처 없는 문장 1");
  const cov = v.items.find((i) => i.key === "coverage")!;
  assert.deepEqual(cov.value, { actual: "58.12", limit: "60", unit: "%" });
  assert.equal(cov.label, "건폐율");
  assert.equal(v.items.find((i) => i.key === "district_plan")!.value, null);
  assert.equal(cov.sentences[0]!.sources[0]!.article, "제55조");
});

test("hasDigit: 아라비아·전각·원문자 숫자를 잡고 한글 문장은 통과", () => {
  for (const s of ["1", "제３항", "①", "Ⅱ"]) assert.equal(hasDigit(s), true, s);
  assert.equal(hasDigit("한도값을 넘지 않습니다."), false);
});

test("결과 모양이 다르면 null(그리지 않음), 잘못된 verdict·출처 종류는 버림", () => {
  assert.equal(parseReviewResult({ review: { schema_version: "review.v2" } }), null);
  assert.equal(parseReviewResult(RESULT.review), null, "잡 결과는 { review, refs } 봉투");
  const r = parseReviewResult({ review: { ...RESULT.review, items: [{ key: "x", verdict: "MAYBE", sentences: [] }], sources: [{ ...SOURCES[0], kind: "blog" }] } });
  assert.ok(r);
  assert.equal(r.items.length, 0);
  assert.equal(r.sources.length, 0);
});

test("잡 상태 → 단계: 서버 stage만, 실패는 환불 문구, AR033 차단", () => {
  assert.deepEqual(reviewPhase(parseJob({ status: "running", stage: "retrieve", refunded: false })), { kind: "running", step: 1 });
  assert.deepEqual(reviewPhase(parseJob({ status: "running", stage: "compliance", refunded: false })), { kind: "running", step: 2 });
  assert.deepEqual(reviewPhase(parseJob({ status: "queued", refunded: false })), { kind: "running", step: 0 });
  const ok = reviewPhase(parseJob({ status: "succeeded", result: RESULT, refunded: false }));
  assert.equal(ok.kind, "succeeded");
  const blocked = reviewPhase(parseJob({ status: "failed", error: { code: "AR033", message: "" }, refunded: true }));
  assert.equal(blocked.kind, "failed");
  assert.match(blocked.kind === "failed" ? blocked.message : "", /출처.*환불되었습니다/);
  for (const [code, re] of [["JOB_TIMEOUT", /시간이 초과/], ["AR032", /형식 검사/], ["AI_UNAVAILABLE", /AI 제공자/], ["JOB_FAILED", /마치지 못했습니다/]] as const) {
    const p = reviewPhase(parseJob({ status: "failed", error: { code, message: "서버 문구" }, refunded: true }));
    assert.match(p.kind === "failed" ? p.message : "", re, code);
  }
  const unknown = reviewPhase(parseJob({ status: "failed", error: { code: "NEW_CODE", message: "새 실패 사유입니다." }, refunded: true }));
  assert.equal(unknown.kind === "failed" ? unknown.message : "", "새 실패 사유입니다. 크레딧은 환불되었습니다.", "모르는 코드는 서버 문구");
  const dup = reviewPhase(parseJob({ status: "failed", error: { code: "X_CODE", message: "중단됐습니다. 크레딧은 환불됩니다." }, refunded: true }));
  assert.equal(dup.kind === "failed" ? dup.message : "", "중단됐습니다. 크레딧은 환불됩니다.", "환불 문구 중복 없음");
  const pending = reviewPhase(parseJob({ status: "failed", refunded: false }));
  assert.match(pending.kind === "failed" ? pending.message : "", /환불을 처리하고/);
});

test("요청 본문: rule_context에서 버전·신청일·지자체, 데스크톱 판정 없음, 깨진 모델은 null", () => {
  const model = { schema_version: 1, rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-11-01", municipality_code: "11000", ordinance_applied: true }, masses: [] };
  const b = reviewBody(JSON.stringify(model), "p-1", "rid");
  assert.ok(b);
  assert.deepEqual(Object.keys(b).sort(), ["application_date", "model", "municipality_code", "project_ref", "request_id", "rule_pack_version"]);
  assert.equal(b.rule_pack_version, "2026.10.0");
  assert.equal("judgment" in b, false);
  assert.equal(reviewBody("{", "p", "r"), null);
  assert.equal(reviewBody(JSON.stringify({ rule_context: { rule_pack_version: "v", application_date: "11/01", municipality_code: "1" } }), "p", "r"), null);
  assert.deepEqual(parseRun({ run_id: "a", job_id: "b", credits: 15 }), { run_id: "a", job_id: "b", credits: 15 });
});

test("요청 오류: 결과 모름만 같은 request_id 유지, AR012·만료는 잠금", () => {
  const e = (code: string, status: number | null) => new ApiError({ code, httpStatus: status, retryable: false });
  assert.equal(keepsReviewRequestId(e("network_offline", null)), true);
  assert.equal(keepsReviewRequestId(e("CR001", 402)), false);
  assert.equal(isLockError(e("AR012", 403)), true);
  assert.equal(isLockError(e("CR001", 402)), false);
  assert.match(startErrorText(e("ai_review_disabled", 503)), /차감되지 않았습니다/);
});
