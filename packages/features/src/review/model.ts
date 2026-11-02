// 클라우드 법규 검토 순수 로직(AR-06-055, 03장 3.11절). 계약: POST /api/ai/review → 202 {run_id, job_id, credits}
// → GET /api/jobs/{id}(stage load·retrieve·interpret·compliance) → result.review = ReviewResultV1(04_API.md 4.2절, AR-06-051).
// 숫자 규칙: 판정 수치는 engine_value·verdict 칸에서만 보인다. AI 문장(nature 'interpretation' = 해석, 수치 아님)에 숫자가 있으면
// 그 문장을 그리지 않는다(서버 validate_free_text의 이중 방어). 출처 없는 문장도 그리지 않는다(03장 3.11절).
import type { ApiError, JsonObject } from "../api-client/index.ts";

export const REVIEW_PATH = "/api/ai/review";
/** 검토 1회 15크레딧(서버 상수, 표시용). 차감액은 서버가 정한다. */
export const REVIEW_CREDITS = 15;
const POLL_MS = 2000;
const POLL_MAX_MS = 5000;
/** 서버 10분 초과 실패·환불 + 여유. 넘으면 폴링을 멈추고 '상태 확인 실패'로 보인다. */
export const REVIEW_POLL_DEADLINE_MS = 11 * 60_000;

export function nextPollDelay(attempt: number): number {
  return Math.min(POLL_MAX_MS, Math.round(POLL_MS * 1.5 ** Math.max(0, attempt)));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/* ---------- 요청 ---------- */
export type ReviewBody = {
  request_id: string;
  project_ref: string;
  rule_pack_version: string;
  application_date: string;
  municipality_code: string;
  /** DesignModelV1(서버가 같은 packages/rules로 재계산, 데스크톱 판정은 보내지 않는다). */
  model: JsonObject;
};

/** 보내는 것(03장 3.11절 요청 영역): 화면에 그대로 적는다. 도면·3D 원본은 보내지 않는다. */
export const REVIEW_SENDS: readonly string[] = ["대지 속성(용도지역·면적·지자체)", "설계 모델의 매스 요약(서버가 판정을 다시 계산)", "규칙 팩 버전·신청일"];

/** 프로젝트 DesignModel(JSON 글) → 요청 본문. rule_context가 없거나 깨졌으면 null(요청하지 않는다). */
export function reviewBody(designModel: string, projectId: string, requestId: string): ReviewBody | null {
  let model: unknown;
  try {
    model = JSON.parse(designModel);
  } catch {
    return null;
  }
  if (!isObj(model) || !isObj(model["rule_context"])) return null;
  const ctx = model["rule_context"];
  const v = ctx["rule_pack_version"];
  const d = ctx["application_date"];
  const m = ctx["municipality_code"];
  if (!isStr(v) || !isStr(d) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !isStr(m) || m === "") return null;
  return {
    request_id: requestId,
    project_ref: projectId,
    rule_pack_version: v,
    application_date: d,
    municipality_code: m,
    model: model as JsonObject,
  };
}

export interface RunStarted {
  readonly run_id: string;
  readonly job_id: string;
  readonly credits: number;
}
export function parseRun(data: unknown): RunStarted {
  if (!isObj(data) || !isStr(data["run_id"]) || !isStr(data["job_id"])) throw new Error("invalid");
  const c = data["credits"];
  return { run_id: data["run_id"], job_id: data["job_id"], credits: typeof c === "number" && Number.isInteger(c) ? c : REVIEW_CREDITS };
}

/* ---------- 결과(ReviewResultV1) ---------- */
export type Verdict = "PASS" | "FAIL" | "WARN" | "CHECK";
export interface ReviewSource {
  readonly id: string;
  readonly law: string;
  readonly article: string;
  readonly effective_from: string;
  readonly kind: "law" | "ordinance" | "interpretation" | "district_plan";
}
interface ReviewSentence {
  readonly text: string;
  readonly source_ids: readonly string[];
  readonly nature: "interpretation";
}
export interface ReviewResultV1 {
  readonly schema_version: "review.v1";
  readonly rule_pack_version: string;
  readonly items: ReadonlyArray<{
    readonly key: string;
    readonly verdict: Verdict;
    readonly engine_value?: { readonly value: number; readonly limit: number; readonly unit: string } | null;
    readonly sentences: readonly ReviewSentence[];
  }>;
  readonly needs_check: readonly ReviewSentence[];
  readonly sources: readonly ReviewSource[];
  readonly disclaimer_version: string;
}

const VERDICTS: ReadonlySet<string> = new Set(["PASS", "FAIL", "WARN", "CHECK"]);
const KINDS: ReadonlySet<string> = new Set(["law", "ordinance", "interpretation", "district_plan"]);

function parseSentences(v: unknown): ReviewSentence[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s): ReviewSentence[] =>
    isObj(s) && isStr(s["text"]) && Array.isArray(s["source_ids"]) ? [{ text: s["text"], source_ids: s["source_ids"].filter(isStr), nature: "interpretation" }] : [],
  );
}

/** 잡 결과 { review, refs } 에서 ReviewResultV1만 꺼낸다. 모양이 다르면 null(결과를 그리지 않는다). */
export function parseReviewResult(result: unknown): ReviewResultV1 | null {
  const r = isObj(result) && isObj(result["review"]) ? result["review"] : null;
  if (!r || r["schema_version"] !== "review.v1" || !Array.isArray(r["items"]) || !Array.isArray(r["sources"])) return null;
  const items = r["items"].flatMap((it): ReviewResultV1["items"][number][] => {
    if (!isObj(it) || !isStr(it["key"]) || !isStr(it["verdict"]) || !VERDICTS.has(it["verdict"])) return [];
    const ev = it["engine_value"];
    const engine =
      isObj(ev) && typeof ev["value"] === "number" && typeof ev["limit"] === "number" && isStr(ev["unit"])
        ? { value: ev["value"], limit: ev["limit"], unit: ev["unit"] }
        : null;
    return [{ key: it["key"], verdict: it["verdict"] as Verdict, engine_value: engine, sentences: parseSentences(it["sentences"]) }];
  });
  const sources = r["sources"].flatMap((s): ReviewSource[] =>
    isObj(s) && isStr(s["id"]) && isStr(s["law"]) && isStr(s["article"]) && isStr(s["effective_from"]) && isStr(s["kind"]) && KINDS.has(s["kind"])
      ? [{ id: s["id"], law: s["law"], article: s["article"], effective_from: s["effective_from"], kind: s["kind"] as ReviewSource["kind"] }]
      : [],
  );
  return {
    schema_version: "review.v1",
    rule_pack_version: isStr(r["rule_pack_version"]) ? r["rule_pack_version"] : "",
    items,
    needs_check: parseSentences(r["needs_check"]),
    sources,
    disclaimer_version: isStr(r["disclaimer_version"]) ? r["disclaimer_version"] : "",
  };
}

/** AI 문장에 숫자(아라비아·전각·로마 숫자)가 있는가. 있으면 그 문장은 그리지 않는다. */
export function hasDigit(text: string): boolean {
  return /[0-9０-９Ⅰ-ⅿ①-⓿]/.test(text);
}

export const ITEM_LABEL: Readonly<Record<string, string>> = {
  coverage: "건폐율",
  far: "용적률",
  height: "높이",
  sunlight: "일조 사선",
  setback: "건축선·이격",
  parking: "주차",
  seismic: "내진",
  zero_energy: "제로에너지",
  supervision: "공사감리",
  district_plan: "지구단위계획",
};

export const VERDICT_VIEW: Readonly<Record<Verdict, { tone: "ok" | "warn" | "danger" | "info"; icon: "circle-check" | "triangle-alert" | "circle-x" | "info"; label: string }>> = {
  PASS: { tone: "ok", icon: "circle-check", label: "통과" },
  WARN: { tone: "warn", icon: "triangle-alert", label: "주의" },
  FAIL: { tone: "danger", icon: "circle-x", label: "기준 초과" },
  CHECK: { tone: "info", icon: "info", label: "확인 필요" },
};

/** 판정 수치 표시(엔진 값 그대로, 소수 둘째 자리까지). 결과 칸 전용. */
export function formatEngineNumber(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

export interface SentenceView {
  readonly text: string;
  readonly sources: readonly ReviewSource[];
}
export interface ItemView {
  readonly key: string;
  readonly label: string;
  readonly verdict: Verdict;
  /** 결과 칸(수치). engine_value가 없으면 null. */
  readonly value: { readonly actual: string; readonly limit: string; readonly unit: string } | null;
  readonly sentences: readonly SentenceView[];
}
export interface ReviewView {
  readonly items: readonly ItemView[];
  readonly needsCheck: readonly (SentenceView & { readonly id: string })[];
  readonly rulePackVersion: string;
  /** 숫자·출처 규칙으로 숨긴 문장 수(있으면 안내). */
  readonly hidden: number;
}

/** 결과 → 화면 모델. 출처가 하나도 풀리지 않는 문장, 숫자가 든 문장은 버린다. */
export function reviewView(r: ReviewResultV1): ReviewView {
  const byId = new Map(r.sources.map((s) => [s.id, s]));
  let hidden = 0;
  const keep = (s: ReviewSentence): SentenceView | null => {
    const sources = s.source_ids.map((id) => byId.get(id)).filter((x): x is ReviewSource => x !== undefined);
    if (sources.length === 0 || s.text.trim() === "" || hasDigit(s.text)) {
      hidden += 1;
      return null;
    }
    return { text: s.text, sources };
  };
  const items = r.items.map((it) => ({
    key: it.key,
    label: ITEM_LABEL[it.key] ?? it.key,
    verdict: it.verdict,
    value: it.engine_value ? { actual: formatEngineNumber(it.engine_value.value), limit: formatEngineNumber(it.engine_value.limit), unit: it.engine_value.unit } : null,
    sentences: it.sentences.map(keep).filter((x): x is SentenceView => x !== null),
  }));
  const needsCheck = r.needs_check.flatMap((n, i) => {
    const v = keep(n);
    return v ? [{ ...v, id: `n${i}` }] : [];
  });
  return { items, needsCheck, rulePackVersion: r.rule_pack_version, hidden };
}

/* ---------- 잡 상태 ---------- */
export interface JobView {
  readonly status: string;
  readonly stage?: string;
  readonly result?: unknown;
  readonly errorCode?: string;
  /** 서버 공개 실패 문구(jobs/service.ts PUBLIC_FAILURES). 모르는 코드일 때 이 문구를 쓴다. */
  readonly errorMessage?: string;
  readonly refunded: boolean;
}
export function parseJob(data: unknown): JobView {
  if (!isObj(data) || !isStr(data["status"])) throw new Error("invalid");
  const e = data["error"];
  return {
    status: data["status"],
    refunded: data["refunded"] === true,
    ...(isStr(data["stage"]) ? { stage: data["stage"] } : {}),
    ...(data["result"] !== undefined ? { result: data["result"] } : {}),
    ...(isObj(e) && isStr(e["code"]) ? { errorCode: e["code"] } : {}),
    ...(isObj(e) && isStr(e["message"]) && e["message"].trim() !== "" ? { errorMessage: e["message"].slice(0, 300) } : {}),
  };
}

/** 진행 단계(03장 3.11절: 규칙 확인 → 해석 조항 검색 → 출처 확인). 서버가 보고한 단계만 쓴다(가짜 진행률 없음). */
export const REVIEW_STEPS: readonly string[] = ["규칙 확인", "해석 조항 검색", "출처 확인"];
const STAGE_STEP: Readonly<Record<string, number>> = { load: 0, retrieve: 1, interpret: 1, compliance: 2 };

export type ReviewPhase =
  | { readonly kind: "running"; readonly step: number }
  | { readonly kind: "succeeded"; readonly review: ReviewResultV1 }
  | { readonly kind: "failed"; readonly message: string; readonly refunded: boolean };

/** 잡 실패 코드 → 문구(서버 jobs/service.ts PUBLIC_FAILURES의 코드와 같다). 환불 여부는 refunded로 따로 붙인다. */
const FAIL_TEXT: Readonly<Record<string, string>> = {
  AR033: "근거 출처를 확인하지 못해 검토 결과를 보여 드리지 않습니다.",
  AR032: "AI 결과가 형식 검사를 통과하지 못했습니다.",
  JOB_TIMEOUT: "검토 시간이 초과되었습니다(10분).",
  AI_UNAVAILABLE: "AI 제공자를 지금 사용할 수 없습니다. 잠시 뒤 다시 요청하세요.",
  JOB_FAILED: "검토를 마치지 못했습니다.",
  JOB_CANCELED: "검토가 취소되었습니다.",
};

export function reviewPhase(job: JobView): ReviewPhase {
  const done = job.status === "succeeded";
  const failed = job.status === "failed" || job.status === "canceled" || job.refunded;
  if (done && !failed) {
    const review = parseReviewResult(job.result);
    if (review) return { kind: "succeeded", review };
    return { kind: "failed", message: "검토 결과 형식을 읽지 못했습니다. 고객지원에 문의하세요.", refunded: false };
  }
  if (failed) {
    const known = job.errorCode !== undefined ? FAIL_TEXT[job.errorCode] : undefined;
    const base = known ?? job.errorMessage ?? FAIL_TEXT.JOB_FAILED!;
    // 서버 문구가 이미 환불을 말하면 덧붙이지 않는다(모르는 코드의 서버 문구).
    const refund = !known && base.includes("환불") ? "" : job.refunded ? " 크레딧은 환불되었습니다." : " 크레딧 환불을 처리하고 있습니다.";
    return { kind: "failed", message: `${base}${refund}`, refunded: job.refunded };
  }
  return { kind: "running", step: job.stage !== undefined ? (STAGE_STEP[job.stage] ?? 0) : 0 };
}

/* ---------- 요청 오류 ---------- */
const START_TEXT: Readonly<Record<string, string>> = {
  ai_review_disabled: "지금은 클라우드 법규 검토를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다.",
  rule_pack_unavailable: "규칙 팩을 확인하지 못했습니다. 크레딧은 차감되지 않았습니다. 규칙 팩 업데이트 뒤 다시 시도하세요.",
  invalid_input: "현재 모델로 검토를 요청할 수 없습니다. 대지·규칙 팩 설정을 확인하세요. 크레딧은 차감되지 않았습니다.",
  AR031: "모델이 너무 커서 보낼 수 없습니다. 크레딧은 차감되지 않았습니다.",
};
/** 같은 request_id로 다시 보내도 되는(결과를 모르는) 오류. start_ai_run은 같은 id 재호출에 기존 실행을 돌려준다. */
const UNKNOWN: ReadonlySet<string> = new Set(["network_offline", "queue_expired", "server_error", "invalid_response", "aborted"]);

export function startErrorText(e: ApiError): string {
  return START_TEXT[e.code] ?? e.userMessage;
}
export function keepsReviewRequestId(e: ApiError): boolean {
  return UNKNOWN.has(e.code);
}
/** 이용권 잠금으로 보일 오류(폴백 AR012·만료). */
export function isLockError(e: ApiError): boolean {
  return e.code === "AR012" || e.code === "entitlement_expired" || e.code === "entitled_false";
}
