// 렌더 화면 순수 로직(AR-06-056): 프리셋·품질 선택지, 요청 본문, 응답 검사, 잡 상태 → 화면 상태, 오류 코드 → 문구.
// 서버 계약: POST /api/uploads/sign(render_input) → PUT 서명 URL → POST /api/ai/render(202 {run_id, job_id, credits}) → GET /api/jobs/{id}.
// 자유 문장 프롬프트는 받지 않는다(프리셋 단어만, 서버 ^[a-z0-9_]{1,32}$).
import { isApiError } from "../api-client/index.ts";

/** 표준 렌더 크레딧(03장 3.9절, 서버가 실제 차감액을 정한다). 화면 표시용. */
export const RENDER_STD_CREDITS = 3;
export const RENDER_HQ_CREDITS = 5;
export const UPSCALE_CREDITS = 2;
/** 잡 상태 폴링: 첫 간격·최대 간격(ms, 점증), 전체 상한(ms) = 서버 3분 초과 환불 + 여유 1분. Realtime 구독 전 대체 경로(03장 5.1절). */
export const JOB_POLL_MS = 2000;
export const JOB_POLL_MAX_MS = 10_000;
export const JOB_POLL_DEADLINE_MS = 4 * 60_000;

/** n번째(0부터) 폴링 뒤 대기: 2초에서 1.5배씩, 10초 상한. */
export function nextPollDelay(attempt: number): number {
  return Math.min(JOB_POLL_MAX_MS, Math.round(JOB_POLL_MS * 1.5 ** Math.max(0, attempt)));
}

export interface PresetOption {
  readonly value: string;
  readonly label: string;
}

// [제안값] 04_API에 preset 목록이 없어(AR-06-056 로그 3장 6번) 단어 후보만 둔다. 확정되면 이 표만 바꾼다.
export const MATERIAL_OPTIONS: readonly PresetOption[] = [
  { value: "concrete", label: "노출 콘크리트" },
  { value: "brick", label: "벽돌" },
  { value: "stone", label: "석재" },
  { value: "wood", label: "목재" },
  { value: "white_render", label: "흰색 미장" },
];
export const TIME_OPTIONS: readonly PresetOption[] = [
  { value: "day", label: "낮" },
  { value: "dusk", label: "해 질 녘" },
  { value: "night", label: "밤" },
];
export const SEASON_OPTIONS: readonly PresetOption[] = [
  { value: "spring", label: "봄" },
  { value: "summer", label: "여름" },
  { value: "autumn", label: "가을" },
  { value: "winter", label: "겨울" },
];

export type Preset = {
  readonly material: string;
  readonly time_of_day: string;
  readonly season: string;
};
export const DEFAULT_PRESET: Preset = { material: "concrete", time_of_day: "day", season: "spring" };

const PRESET_WORD = /^[a-z0-9_]{1,32}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

export function isPreset(p: Preset): boolean {
  const known = (list: readonly PresetOption[], v: string) => PRESET_WORD.test(v) && list.some((o) => o.value === v);
  return known(MATERIAL_OPTIONS, p.material) && known(TIME_OPTIONS, p.time_of_day) && known(SEASON_OPTIONS, p.season);
}

export type RenderBody = {
  readonly request_id: string;
  readonly project_ref: string;
  readonly quality: "standard";
  readonly preset: Preset;
  readonly inputs: { readonly depth_path: string; readonly edge_path: string };
};

/** 업로드 서명 본문(04_API 2.1절 uploads/sign). 경로·파일명은 서버가 만든다. */
export async function uploadSignBody(png: Uint8Array): Promise<{ purpose: "render_input"; ext: "png"; bytes: number; sha256: string }> {
  const digest = await crypto.subtle.digest("SHA-256", png as unknown as ArrayBuffer);
  return { purpose: "render_input", ext: "png", bytes: png.byteLength, sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

/** 표준 품질만 보낸다(고품질·업스케일은 준비 중, 서버도 22023). */
export function renderBody(requestId: string, projectRef: string, preset: Preset, depthPath: string, edgePath: string): RenderBody {
  return { request_id: requestId, project_ref: projectRef, quality: "standard", preset: { ...preset }, inputs: { depth_path: depthPath, edge_path: edgePath } };
}

export interface UploadTicket {
  readonly signed_upload_url: string;
  readonly path: string;
}

/** 업로드 서명 응답 검사: 경로는 render_input PNG, URL은 https(로컬 개발만 http 루프백). */
export function parseTicket(data: unknown): UploadTicket {
  const d = (data ?? {}) as Record<string, unknown>;
  const path = d["path"];
  const url = d["signed_upload_url"];
  if (typeof path !== "string" || !new RegExp(`^${UUID}/arch/render_input/${UUID}\\.png$`).test(path)) throw new Error("invalid");
  if (typeof url !== "string" || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(url)) throw new Error("invalid");
  return { signed_upload_url: url, path };
}

export interface RunStarted {
  readonly run_id: string;
  readonly job_id: string;
  readonly credits: number;
}

export function parseRun(data: unknown): RunStarted {
  const d = (data ?? {}) as Record<string, unknown>;
  const { run_id, job_id, credits } = d;
  if (typeof run_id !== "string" || !UUID_RE.test(run_id) || typeof job_id !== "string" || !UUID_RE.test(job_id)) throw new Error("invalid");
  if (typeof credits !== "number" || !Number.isSafeInteger(credits) || credits < 0) throw new Error("invalid");
  return { run_id, job_id, credits };
}

export interface RenderResult {
  readonly output_url: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly expires_at: string | null;
}

export interface JobView {
  readonly status: string;
  readonly progress: number;
  readonly stage?: string;
  readonly result?: RenderResult | { readonly expired: true };
  readonly errorCode?: string;
  readonly refunded: boolean;
}

const intOrNull = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

export function parseJob(data: unknown): JobView {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d["status"] !== "string") throw new Error("invalid");
  const progress = typeof d["progress"] === "number" && d["progress"] >= 0 && d["progress"] <= 100 ? Math.round(d["progress"]) : 0;
  const out: { -readonly [K in keyof JobView]: JobView[K] } = { status: d["status"], progress, refunded: d["refunded"] === true };
  if (typeof d["stage"] === "string") out.stage = d["stage"];
  const r = d["result"];
  if (r && typeof r === "object") {
    const rr = r as Record<string, unknown>;
    if (rr["expired"] === true) out.result = { expired: true };
    else if (typeof rr["output_url"] === "string" && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(rr["output_url"])) {
      out.result = {
        output_url: rr["output_url"],
        width: intOrNull(rr["width"]),
        height: intOrNull(rr["height"]),
        expires_at: typeof rr["expires_at"] === "string" ? rr["expires_at"] : null,
      };
    }
  }
  const e = d["error"];
  if (e && typeof e === "object" && typeof (e as Record<string, unknown>)["code"] === "string") out.errorCode = (e as Record<string, string>)["code"];
  return out;
}

const STAGE_TEXT: Readonly<Record<string, string>> = { submit: "AI에 보내는 중", generate: "이미지를 만드는 중", persist: "결과를 저장하는 중" };

export type JobPhase =
  | { readonly kind: "running"; readonly label: string; readonly progress: number }
  | { readonly kind: "refunding"; readonly label: string; readonly progress: number }
  | { readonly kind: "succeeded"; readonly result: RenderResult }
  | { readonly kind: "expired" }
  | { readonly kind: "refunded"; readonly text: string };

export const EXPIRED_TEXT = "클라우드 보관 기간이 끝났습니다. 이 PC에 저장한 이미지만 남습니다.";

/** 숫자 뒤 목적격 조사(을/를): 마지막 읽는 음절의 받침으로 고른다(영·일·삼·육·칠·팔·십·백·천·만 = 을). */
export function eulReul(n: number): "을" | "를" {
  const d = Math.abs(Math.trunc(n)) % 10;
  if (d === 0) return "을";
  return d === 2 || d === 4 || d === 5 || d === 9 ? "를" : "을";
}

/** 환불 확정 문구(03장 5.1절 AI 실패·환불). 차감액은 서버 응답 값. */
export function refundText(credits: number): string {
  return `렌더를 만들지 못했습니다. 크레딧 ${credits}${eulReul(credits)} 돌려드렸습니다. 시점이나 프리셋을 바꿔 다시 시도하세요.`;
}

/**
 * 잡 상태 → 화면 단계.
 * - 실행 행 refunded=true일 때만 "돌려드렸습니다"(끝). 잡이 failed·canceled이거나 오류 코드가 있어도 refunded=false면 "환불 처리 중"(폴링 계속).
 * - succeeded인데 result가 아직 없으면 running(결과 확인 중). 끝나지 않는 상태는 화면 폴링 상한이 끊는다.
 */
export function jobPhase(job: JobView, credits: number): JobPhase {
  if (job.refunded) return { kind: "refunded", text: refundText(credits) };
  if (job.status === "failed" || job.status === "canceled" || job.errorCode) return { kind: "refunding", label: "렌더 실패 · 환불 처리 중", progress: job.progress };
  if (job.status === "succeeded") {
    if (!job.result) return { kind: "running", label: "결과를 확인하는 중", progress: job.progress };
    return "expired" in job.result ? { kind: "expired" } : { kind: "succeeded", result: job.result };
  }
  if (job.status === "queued") return { kind: "running", label: "대기 중", progress: job.progress };
  return { kind: "running", label: (job.stage && STAGE_TEXT[job.stage]) ?? "만드는 중", progress: job.progress };
}

export function isTerminal(phase: JobPhase): boolean {
  return phase.kind !== "running" && phase.kind !== "refunding";
}

/** 한 번의 렌더 시도(같은 캡처·프리셋). 재시도는 같은 request_id·업로드 경로를 다시 쓴다(이중 차감·upsert=false 충돌 방지). */
export interface Attempt {
  readonly key: string;
  readonly requestId: string;
  readonly depthPath?: string;
  readonly edgePath?: string;
}

/** 캡처 번호·프리셋 → 시도 키. 캡처를 다시 찍거나 프리셋을 바꾸면 새 시도. */
export function attemptKey(captureSeq: number, preset: Preset): string {
  return `${captureSeq}|${preset.material}|${preset.time_of_day}|${preset.season}`;
}

export function attemptFor(prev: Attempt | null, key: string, newId: () => string): Attempt {
  return prev && prev.key === key ? prev : { key, requestId: newId() };
}

/**
 * 실패 뒤 시도를 유지할까? 서버가 처리했는지 모를 때(네트워크·5xx·429·업로드 실패·2xx 응답 해석 실패)는 유지,
 * 확정 거절(4xx·알려진 비재시도 코드: AR030·AI002·ai_render_disabled 등)이면 버린다. 성공하면 호출자가 버린다.
 */
export function keepAttempt(e: unknown): boolean {
  if (!isApiError(e)) return true;
  return e.retryable || e.code === "invalid_response";
}

/** 렌더 요청 단계 오류 코드 → 화면 문구. 서버 message 원문은 쓰지 않는다. 모르는 코드는 fallback(api-client 공용 문구). */
const RENDER_ERROR_TEXT: Readonly<Record<string, string>> = {
  ai_render_disabled: "지금은 AI 렌더를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다. 로컬 모델·판정·도면은 그대로 됩니다.",
  AI002: "국외 AI 사용 동의가 없어 렌더를 보내지 않았습니다. 조직 관리자가 설정 > 일반에서 동의한 뒤 다시 시도하세요. 크레딧은 차감되지 않았습니다.",
  AR030: "렌더가 3건 진행 중입니다. 하나가 끝나면 시작하세요.",
  AR031: "보내는 이미지가 너무 큽니다. 다시 캡처하거나 해상도를 낮추세요.",
  "22023": "고품질·업스케일은 아직 준비 중입니다. 표준 품질로 다시 시도하세요.",
  "23514": "캡처 이미지를 확인하지 못했습니다. 현재 시점을 다시 캡처한 뒤 시도하세요.",
  unsupported_media_type: "캡처 이미지를 확인하지 못했습니다. 현재 시점을 다시 캡처한 뒤 시도하세요.",
  upload_failed: "캡처 이미지를 올리지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요. 크레딧은 차감되지 않았습니다.",
  capture_size: "이 시점은 캡처할 수 없습니다. 뷰포트를 다시 연 뒤 시도하세요.",
  capture_too_large: "캡처 이미지가 10MB를 넘습니다. 시점을 바꿔 다시 캡처하세요.",
};

export function renderErrorText(code: string, fallback: string): string {
  return Object.prototype.hasOwnProperty.call(RENDER_ERROR_TEXT, code) ? (RENDER_ERROR_TEXT[code] as string) : fallback;
}

/** 설치형: 서명 URL 직접 PUT·결과 이미지 받기가 CSP(connect-src ipc만)로 막히고, 업로드·바이너리 받기 어댑터가 아직 없다 → 실패 닫힘. */
export const UNSUPPORTED_HERE_TEXT = "이 환경에서는 아직 AI 렌더를 지원하지 않습니다. 크레딧은 차감되지 않습니다.";
