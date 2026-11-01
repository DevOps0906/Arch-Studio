// 렌더 화면 순수 로직 테스트(AR-06-056): 오류 코드별 문구, 응답 검사, 잡 상태 → 화면 단계(실패 = 환불됨), 요청 본문(표준·프리셋만).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ApiError } from "../api-client/index.ts";
import { isAutoRetryable } from "../api-client/api-error.ts";
import {
  DEFAULT_PRESET,
  EXPIRED_TEXT,
  JOB_POLL_DEADLINE_MS,
  attemptFor,
  attemptKey,
  eulReul,
  isPreset,
  isTerminal,
  keepAttempt,
  nextPollDelay,
  jobPhase,
  parseJob,
  parseRun,
  parseTicket,
  refundText,
  renderBody,
  renderErrorText,
  uploadSignBody,
} from "./model.ts";

const ORG = "0192f0a0-1c00-7a01-8a01-0000000000aa";
const OBJ = "0192f0a0-1c00-7a01-8a01-0000000000bb";
const JOB = "0192f0a0-1c00-4a01-8a01-0000000000cc";
const RUN = "0192f0a0-1c00-4a01-8a01-0000000000dd";
const FALLBACK = "기본 문구";

test("오류 코드별 문구: 스위치 off·동의 없음·AR030·AR031·22023·입력 재검사·업로드·캡처", () => {
  assert.match(renderErrorText("ai_render_disabled", FALLBACK), /지금은 AI 렌더를 사용할 수 없습니다.*차감되지 않았습니다/);
  assert.match(renderErrorText("AI002", FALLBACK), /국외 AI 사용 동의.*설정 > 일반/);
  assert.equal(renderErrorText("AR030", FALLBACK), "렌더가 3건 진행 중입니다. 하나가 끝나면 시작하세요.");
  assert.match(renderErrorText("AR031", FALLBACK), /너무 큽니다/);
  assert.match(renderErrorText("22023", FALLBACK), /준비 중/);
  assert.match(renderErrorText("23514", FALLBACK), /다시 캡처/);
  assert.match(renderErrorText("unsupported_media_type", FALLBACK), /다시 캡처/);
  assert.match(renderErrorText("upload_failed", FALLBACK), /올리지 못했습니다/);
  assert.match(renderErrorText("capture_too_large", FALLBACK), /10MB/);
  assert.equal(renderErrorText("CR001", FALLBACK), FALLBACK);
  assert.equal(renderErrorText("__proto__", FALLBACK), FALLBACK);
});

test("요청 본문: quality=standard 고정, 프리셋 단어만, 자유 문장 필드 없음", () => {
  const b = renderBody(RUN, OBJ, DEFAULT_PRESET, `${ORG}/arch/render_input/${OBJ}.png`, `${ORG}/arch/render_input/${JOB}.png`);
  assert.equal(b.quality, "standard");
  assert.deepEqual(Object.keys(b).sort(), ["inputs", "preset", "project_ref", "quality", "request_id"]);
  assert.deepEqual(Object.keys(b.preset).sort(), ["material", "season", "time_of_day"]);
  assert.ok(isPreset(DEFAULT_PRESET));
  assert.equal(isPreset({ ...DEFAULT_PRESET, material: "a nice house" }), false);
  assert.equal(isPreset({ ...DEFAULT_PRESET, season: "monsoon" }), false);
});

test("업로드 서명 본문: render_input·png·바이트 수·sha256", async () => {
  const body = await uploadSignBody(new TextEncoder().encode("abc"));
  assert.deepEqual(body, { purpose: "render_input", ext: "png", bytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
});

test("parseTicket: render_input PNG 경로·https만", () => {
  const ok = parseTicket({ path: `${ORG}/arch/render_input/${OBJ}.png`, signed_upload_url: "https://x.supabase.co/storage/v1/upload/sign/a" });
  assert.equal(ok.path, `${ORG}/arch/render_input/${OBJ}.png`);
  assert.throws(() => parseTicket({ path: `${ORG}/arch/proposal_sheet/${OBJ}.svg`, signed_upload_url: "https://x" }));
  assert.throws(() => parseTicket({ path: `${ORG}/arch/render_input/${OBJ}.png`, signed_upload_url: "http://evil.example/" }));
});

test("parseRun: run_id·job_id UUID, credits 정수", () => {
  assert.deepEqual(parseRun({ run_id: RUN, job_id: JOB, credits: 3 }), { run_id: RUN, job_id: JOB, credits: 3 });
  assert.throws(() => parseRun({ run_id: RUN, job_id: "x", credits: 3 }));
  assert.throws(() => parseRun({ run_id: RUN, job_id: JOB, credits: 1.5 }));
});

test("잡 상태 → 화면: 대기·단계·성공·만료·실패(reconcile 포함) = 환불됨", () => {
  assert.deepEqual(jobPhase(parseJob({ status: "queued", progress: 0, refunded: false }), 3), { kind: "running", label: "대기 중", progress: 0 });
  assert.deepEqual(jobPhase(parseJob({ status: "running", progress: 40, stage: "generate", refunded: false }), 3), { kind: "running", label: "이미지를 만드는 중", progress: 40 });
  assert.deepEqual(jobPhase(parseJob({ status: "running", progress: 999, stage: "모름", refunded: false }), 3), { kind: "running", label: "만드는 중", progress: 0 });
  const ok = jobPhase(parseJob({ status: "succeeded", progress: 100, refunded: false, result: { output_url: "https://s/x.png", width: 1024, height: 768, expires_at: "2027-01-30T00:00:00Z", ai_label: true } }), 3);
  assert.equal(ok.kind, "succeeded");
  assert.equal(ok.kind === "succeeded" && ok.result.width, 1024);
  assert.deepEqual(jobPhase(parseJob({ status: "succeeded", progress: 100, refunded: false, result: { expired: true } }), 3), { kind: "expired" });
  assert.match(EXPIRED_TEXT, /보관 기간이 끝났습니다/);
  // 실패했어도 refunded=false면 환불 처리 중(폴링 계속), true일 때만 돌려드렸다고 말한다(reconcile 3분 초과 포함).
  const timeout = jobPhase(parseJob({ status: "failed", progress: 10, refunded: false, error: { code: "JOB_TIMEOUT", message: "x" } }), 3);
  assert.equal(timeout.kind, "refunding");
  assert.equal(isTerminal(timeout), false);
  assert.equal(jobPhase(parseJob({ status: "canceled", progress: 0, refunded: false }), 5).kind, "refunding");
  const refunded = jobPhase(parseJob({ status: "failed", progress: 10, refunded: true }), 3);
  assert.deepEqual(refunded, { kind: "refunded", text: refundText(3) });
  assert.equal(isTerminal(refunded), true);
  // succeeded인데 결과가 아직 없으면 계속 확인한다.
  const noResult = jobPhase(parseJob({ status: "succeeded", progress: 100, refunded: false }), 3);
  assert.equal(noResult.kind, "running");
  assert.equal(isTerminal(noResult), false);
  assert.equal(refundText(3), "렌더를 만들지 못했습니다. 크레딧 3을 돌려드렸습니다. 시점이나 프리셋을 바꿔 다시 시도하세요.");
  assert.match(refundText(5), /크레딧 5를 돌려드렸습니다/);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map(eulReul).join(""), "을을를을를를을을을를을를를");
  // 허용되지 않은 결과 URL은 버린다.
  assert.equal(parseJob({ status: "succeeded", progress: 100, result: { output_url: "javascript:alert(1)" } }).result, undefined);
});

test("화면 소스: 자유 문장 입력란(textarea·prompt) 없음, hex·px 없음, 고품질·업스케일 비활성", () => {
  const src = readFileSync(path.join(import.meta.dirname, "index.tsx"), "utf8");
  assert.doesNotMatch(src, /<textarea|<Input\b|\bprompt\b/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /#[0-9a-fA-F]{3,8}\b/);
  for (const m of src.matchAll(/className="([^"]*)"/g)) assert.doesNotMatch(m[1] as string, /\d+px|\[/, `토큰 유틸리티만: ${m[1]}`);
  assert.match(src, /value="high" disabled/);
  assert.match(src, /업스케일 \{UPSCALE_CREDITS\} 크레딧\(준비 중\)/);
  assert.doesNotMatch(src, /designModel[^=]*body|body:[^\n]*designModel/);
});

test("폴링: 간격 점증(2초→최대 10초), 전체 상한은 서버 3분 환불 + 여유", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map(nextPollDelay), [2000, 3000, 4500, 6750, 10000, 10000, 10000]);
  assert.ok(JOB_POLL_DEADLINE_MS > 3 * 60_000);
  let total = 0;
  let n = 0;
  while (total + nextPollDelay(n) <= JOB_POLL_DEADLINE_MS) total += nextPollDelay(n++);
  assert.ok(n < 40, `상한 안 폴링 ${n}회`);
});

test("재시도: 같은 캡처·프리셋은 같은 request_id·업로드 경로, 바꾸면 새 시도", () => {
  let i = 0;
  const id = () => `id-${++i}`;
  const k = attemptKey(1, DEFAULT_PRESET);
  const first = attemptFor(null, k, id);
  const uploaded = { ...first, depthPath: "d", edgePath: "e" };
  assert.equal(attemptFor(uploaded, k, id), uploaded);
  assert.notEqual(attemptFor(uploaded, attemptKey(2, DEFAULT_PRESET), id).requestId, first.requestId);
  assert.notEqual(attemptFor(uploaded, attemptKey(1, { ...DEFAULT_PRESET, season: "winter" }), id).requestId, first.requestId);
});

test("재시도: 처리 여부를 모르면 유지, 확정 거절이면 버림", () => {
  // 클라이언트와 같은 판정: 서버 본문 코드(raw)가 없으면 상태만으로(네트워크·5xx는 재시도 가능).
  const err = (code: string, status: number | null, raw: string | null = code) => new ApiError({ code, httpStatus: status, retryable: isAutoRetryable(status, raw) });
  assert.equal(keepAttempt(err("network_offline", null, null)), true);
  assert.equal(keepAttempt(err("server_error", 502, null)), true);
  assert.equal(keepAttempt(err("rate_limited", 429)), true);
  assert.equal(keepAttempt(new ApiError({ code: "invalid_response", httpStatus: 202, retryable: false })), true);
  assert.equal(keepAttempt(new Error("upload")), true);
  assert.equal(keepAttempt(err("ai_render_disabled", 503)), false);
  assert.equal(keepAttempt(err("AR030", 409)), false);
  assert.equal(keepAttempt(err("AI002", 403)), false);
  assert.equal(keepAttempt(err("CR001", 402)), false);
  assert.equal(keepAttempt(err("http_400", 400, null)), false);
});

test("ai_render_disabled는 문구 표에 있어 자동 재시도하지 않는다", () => {
  assert.equal(isAutoRetryable(503, "ai_render_disabled"), false);
});
