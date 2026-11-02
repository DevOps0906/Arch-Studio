// POST /api/voice/stt 본체(04_API.md 2.2절 `/api/voice/stt` 행, AR-06-053).
// 받아쓰기(multipart): audio ≤60초·5MB + { request_id, mode:'dictation' } → 200 { text, duration_s, credits }.
//   순서: 실패 닫힘(제공자 없음 503, 인증보다 먼저) → 인증 → 레이트 리밋 → member+ → 엔타이틀먼트 → 본문(5MB·형식·매직바이트)
//   → 선차감 1(분, `voice:<org_id>:<request_id>`, 새 원장만 통과·재사용은 409) → 제공자 → 실제 길이 정산(`...:settle` 환불) → 200.
//   제공자 실패·60초 초과는 전액 환불 후 오류. 원본은 저장하지 않는다(메모리에서만 쓰고 버림).
// 상담 녹음(JSON): { request_id, mode:'consult', project_ref, audio_path(consult_audio), duration_s ≤7200, notice_version }
//   → 신고 길이로 선차감 → core.voice_jobs(원본 24시간 보관·고지 기록) + enqueue_job('arch.stt') → 202 { job_id, credits }.
//   실제 길이 정산은 워커(arch.stt)가 한다.
// 차감은 credits.reserve 한 곳에서만 일어나므로 그 앞의 모든 거부는 차감 0이다. 조직·행위자는 세션에서만.
// 응답·로그에 경로·토큰·전사문·예외 원문을 넣지 않는다.
// server-only를 import하지 않는다(node --test 대상).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../../lib/logger.ts";
import { errorResponse, GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { isServerUploadPath, PURPOSE_POLICIES } from "../uploads/policy.ts";
import { AUDIO_HEAD_BYTES, AUDIO_MIME, sniffAudio } from "./audio.ts";
import { CONSULT_MAX_SECONDS, DICTATION_MAX_SECONDS, DURATION_TOLERANCE_S, settleStt, sttCreditsFor } from "./billing.ts";
import type { SttProvider, SttResult } from "./provider.ts";

export interface ReserveInput {
  orgId: string;
  actorId: string;
  requestId: string;
  amount: number;
  mode: "dictation" | "consult";
  /** 이번 호출만의 값(원장 metadata.nonce). 기존 원장이 돌아오면 다르다. */
  nonce: string;
}

/** 돌려받은 원장 행의 사실. amount는 차감 크레딧(양수). 읽지 못한 칸은 null(→ 불일치로 본다). */
export interface ReservedLedger {
  ledgerId: number;
  orgId: string | null;
  actorId: string | null;
  amount: number | null;
  mode: string | null;
  nonce: string | null;
}

/** core.consume_credits·refund_credits(service_role). 멱등 키는 구현이 billing.ts 규칙으로 만든다. */
export interface VoiceCredits {
  /**
   * 선차감(키 `voice:<org_id>:<request_id>`). 같은 키 원장이 이미 있으면 consume_credits는 새로 차감하지 않고 기존 원장을 돌려준다.
   * 돌려받은 원장의 사실(조직·행위자·금액·모드·이번 호출 nonce)을 그대로 돌려준다. 새로 삽입했는지는 nonce 일치로만 판별한다
   * (consume_credits 반환값으로는 구분 불가 → p_metadata.nonce에 이번 호출 값을 넣고 원장 행을 다시 읽는다).
   */
  reserve(input: ReserveInput): Promise<ReservedLedger>;
  /** 정산·실패 환불(키 `voice:<org_id>:<request_id>:settle`, 한 요청에 한 번). */
  refund(input: { ledgerId: number; orgId: string; requestId: string; amount: number; reason: string }): Promise<void>;
}

export interface VoiceOrgRepo {
  orgFeatures(orgId: string): Promise<Record<string, unknown>>;
}

/** consult_audio 객체 읽기(voice-audio 버킷, service_role). 경로는 모양 검사를 통과한 값만. */
export interface ConsultAudioStore {
  size(path: string): Promise<number | null>;
  head(path: string, n: number): Promise<Uint8Array>;
}

export interface ConsultEnqueueInput {
  orgId: string;
  actorId: string;
  requestId: string;
  projectRef: string;
  audioPath: string;
  noticeVersion: string;
  declaredSeconds: number;
  credits: number;
  ledgerId: number;
}

export interface ConsultQueue {
  /** core.voice_jobs 기록(원본 24시간 보관) + enqueue_job('arch.stt'). 같은 request_id면 기존 잡. */
  enqueue(input: ConsultEnqueueInput): Promise<{ jobId: string }>;
}

export interface VoiceDeps {
  /** 받아쓰기 제공자. null = 실패 닫힘(503). 요청마다 읽는다. */
  provider(): SttProvider | null;
  consultEnabled(): boolean;
  /** 서버가 아는 현재 상담 녹음 고지문 버전(ARCH_RECORDING_NOTICE_VERSION). */
  recordingNoticeVersion(): string;
  session: GatewaySessionResolver;
  org(session: GatewaySession): VoiceOrgRepo;
  credits(): VoiceCredits;
  consultAudio(): ConsultAudioStore;
  queue(): ConsultQueue;
  rateLimit: RateLimitStore;
  now(): number;
  /** 제공자 호출 시간 상한(ms). 기본 30초. */
  providerTimeoutMs?: number;
  /** 원장 nonce 생성. 기본 crypto.randomUUID. */
  nonce?: () => string;
}

/** 받아쓰기 오디오 상한(04_API.md "≤60초·5MB, 제안"). */
export const DICTATION_MAX_BYTES = 5 * 1024 * 1024;
const MULTIPART_OVERHEAD = 16 * 1024;
export const CONSULT_MAX_BODY = 4096;
/** 조직 30회/분(제안: 04_API에 값 없음). */
export const VOICE_RATE = { limit: 30, windowS: 60 } as const;
/** 상담 녹음 상한 = 업로드 정책(voice-audio 버킷 50MB). */
export const CONSULT_AUDIO_MAX_BYTES = PURPOSE_POLICIES.consult_audio.maxBytes;
const MAX_TEXT = 4000;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

type VoiceOnlyCode = "voice_disabled" | "voice_unavailable" | "VOICE_TOO_LONG" | "recording_notice_required" | "voice_request_done";

export const VOICE_ERRORS: Readonly<Record<VoiceOnlyCode, { status: number; message: string }>> = {
  voice_disabled: { status: 503, message: "지금은 음성 입력을 쓸 수 없습니다. 텍스트로 입력하세요. 크레딧은 차감되지 않았습니다." },
  voice_unavailable: { status: 503, message: "음성을 글로 바꾸지 못했습니다. 크레딧은 돌려드렸습니다. 텍스트로 입력하세요." },
  VOICE_TOO_LONG: { status: 413, message: "녹음이 너무 깁니다. 받아쓰기는 60초까지입니다." },
  recording_notice_required: { status: 422, message: "녹음 고지를 확인한 뒤 다시 시도하세요." },
  voice_request_done: { status: 409, message: "이미 처리한 요청입니다. 다시 녹음해 주세요." },
};

class VoiceReject extends Error {
  readonly code: VoiceOnlyCode;
  constructor(code: VoiceOnlyCode) {
    super(code);
    this.name = "VoiceReject";
    this.code = code;
  }
}

function voiceReject(code: VoiceOnlyCode): Response {
  const spec = VOICE_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message } }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const consultRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    mode: z.literal("consult"),
    project_ref: z.string().regex(UUID_RE),
    audio_path: z.string().min(1).max(300),
    duration_s: z.number().positive(),
    notice_version: z.string().min(1).max(40).optional(),
  })
  .strict();

function dbCode(error: unknown): string | undefined {
  const raw = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof raw === "string" ? raw : undefined;
}

/**
 * 선차감 + 새 원장인지 확인. 이번 호출이 만든 원장(nonce 일치)이고 조직·행위자·금액·모드가 이번 요청과 같을 때만 통과.
 * 그 밖(재전송·환불된 원장 재사용·받아쓰기 원장으로 상담·다른 사용자)은 제공자·enqueue 전에 409(실패 닫힘, 추가 차감 없음).
 */
async function reserveFresh(credits: VoiceCredits, deps: VoiceDeps, input: Omit<ReserveInput, "nonce">): Promise<number> {
  const nonce = (deps.nonce ?? randomUUID)();
  let got: ReservedLedger;
  try {
    got = await credits.reserve({ ...input, nonce });
  } catch (error) {
    if (dbCode(error) === "CR001") throw new GatewayError("CR001", { required: input.amount });
    throw error;
  }
  const fresh =
    got.nonce === nonce && got.orgId === input.orgId && got.actorId === input.actorId && got.amount === input.amount && got.mode === input.mode;
  if (!fresh) throw new VoiceReject("voice_request_done");
  return got.ledgerId;
}

/** 본문을 maxBytes까지만 읽는다. 넘으면 413. */
async function readBytesLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new GatewayError("payload_too_large");
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GatewayError("payload_too_large");
      }
      chunks.push(value);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

interface DictationInput {
  requestId: string;
  audio: Uint8Array;
  mime: string;
}

async function parseDictation(req: Request): Promise<DictationInput> {
  const raw = await readBytesLimited(req, DICTATION_MAX_BYTES + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await new Request("http://local/", { method: "POST", headers: { "content-type": req.headers.get("content-type") ?? "" }, body: raw as BodyInit }).formData();
  } catch {
    throw new GatewayError("invalid_input");
  }
  for (const key of form.keys()) if (key !== "audio" && key !== "request_id" && key !== "mode") throw new GatewayError("invalid_input");
  const requestId = form.get("request_id");
  const mode = form.get("mode");
  const audio = form.get("audio");
  if (typeof requestId !== "string" || !UUID_V4_RE.test(requestId) || mode !== "dictation" || typeof audio === "string" || audio === null) {
    throw new GatewayError("invalid_input");
  }
  if (audio.size === 0) throw new GatewayError("invalid_input");
  if (audio.size > DICTATION_MAX_BYTES) throw new GatewayError("AR031", { max_bytes: DICTATION_MAX_BYTES });
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const kind = sniffAudio(bytes.subarray(0, AUDIO_HEAD_BYTES));
  if (!kind) throw new GatewayError("unsupported_media_type");
  return { requestId, audio: bytes, mime: AUDIO_MIME[kind] };
}

async function transcribeWithTimeout(provider: SttProvider, req: Omit<Parameters<SttProvider["transcribe"]>[0], "signal">, timeoutMs: number): Promise<SttResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("stt timeout")), timeoutMs);
  try {
    return await provider.transcribe({ ...req, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function handleDictation(req: Request, deps: VoiceDeps, session: GatewaySession, provider: SttProvider): Promise<Response> {
  const input = await parseDictation(req);
  const reserved = sttCreditsFor(DICTATION_MAX_SECONDS);
  const credits = deps.credits();
  const ledgerId = await reserveFresh(credits, deps, {
    orgId: session.orgId,
    actorId: session.userId,
    requestId: input.requestId,
    amount: reserved,
    mode: "dictation",
  });
  const refundArgs = { ledgerId, orgId: session.orgId, requestId: input.requestId };

  let result: SttResult;
  try {
    result = await transcribeWithTimeout(
      provider,
      { audio: input.audio, mime: input.mime, language: "ko", feature: "voice_chat", orgId: session.orgId, userId: session.userId },
      deps.providerTimeoutMs ?? 30_000,
    );
  } catch {
    await credits.refund({ ...refundArgs, amount: reserved, reason: "stt_failed" });
    throw new VoiceReject("voice_unavailable");
  }
  if (result.durationSeconds > DICTATION_MAX_SECONDS + DURATION_TOLERANCE_S) {
    await credits.refund({ ...refundArgs, amount: reserved, reason: "stt_too_long" });
    throw new VoiceReject("VOICE_TOO_LONG");
  }
  const settled = settleStt(reserved, Math.min(result.durationSeconds, DICTATION_MAX_SECONDS));
  if (settled.refund > 0) {
    await credits.refund({ ...refundArgs, amount: settled.refund, reason: "stt_settle" });
  }
  return okResponse({ text: result.text.trim().slice(0, MAX_TEXT), duration_s: round2(result.durationSeconds), credits: settled.charged });
}

async function recheckConsultAudio(store: ConsultAudioStore, orgId: string, path: string): Promise<void> {
  if (!isServerUploadPath(orgId, "consult_audio", path)) throw new GatewayError("23514");
  let head: Uint8Array;
  try {
    const size = await store.size(path);
    if (size === null) throw new GatewayError("23514");
    if (size > CONSULT_AUDIO_MAX_BYTES) throw new GatewayError("AR031", { max_bytes: CONSULT_AUDIO_MAX_BYTES });
    head = await store.head(path, AUDIO_HEAD_BYTES);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError("storage_unavailable");
  }
  if (!sniffAudio(head)) throw new GatewayError("unsupported_media_type");
}

async function handleConsult(req: Request, deps: VoiceDeps, session: GatewaySession): Promise<Response> {
  if (!deps.consultEnabled()) throw new VoiceReject("voice_disabled");
  const parsed = consultRequestSchema.safeParse(await readJsonLimited(req, CONSULT_MAX_BODY));
  if (!parsed.success) throw new GatewayError("invalid_input");
  const input = parsed.data;
  // 제3자 고지: 서버가 아는 현재 버전과 같아야 접수(01_PRD.md 6절).
  if (!input.notice_version || input.notice_version !== deps.recordingNoticeVersion()) throw new VoiceReject("recording_notice_required");
  if (input.duration_s > CONSULT_MAX_SECONDS) throw new VoiceReject("VOICE_TOO_LONG");

  const features = await deps.org(session).orgFeatures(session.orgId);
  if (features.ai_intake !== true) throw new GatewayError("feature_unavailable", { can_download: true });

  await recheckConsultAudio(deps.consultAudio(), session.orgId, input.audio_path);

  const amount = sttCreditsFor(input.duration_s);
  const credits = deps.credits();
  const ledgerId = await reserveFresh(credits, deps, {
    orgId: session.orgId,
    actorId: session.userId,
    requestId: input.request_id,
    amount,
    mode: "consult",
  });
  let jobId: string;
  try {
    ({ jobId } = await deps.queue().enqueue({
      orgId: session.orgId,
      actorId: session.userId,
      requestId: input.request_id,
      projectRef: input.project_ref,
      audioPath: input.audio_path,
      noticeVersion: input.notice_version,
      declaredSeconds: input.duration_s,
      credits: amount,
      ledgerId,
    }));
  } catch {
    await credits.refund({ ledgerId, orgId: session.orgId, requestId: input.request_id, amount, reason: "stt_enqueue_failed" });
    throw new VoiceReject("voice_unavailable");
  }
  return okResponse({ job_id: jobId, credits: amount }, 202);
}

function logReject(code: string): void {
  logger.warn("voice_stt.rejected", { route: "voice_stt", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

export async function handleStt(req: Request, deps: VoiceDeps): Promise<Response> {
  try {
    const provider = deps.provider();
    if (!provider) throw new VoiceReject("voice_disabled");

    const session = await deps.session.resolve(req);
    const hit = await deps.rateLimit.hit(`arch:voice_stt:${session.orgId}`, VOICE_RATE.limit, VOICE_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });

    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("multipart/form-data")) return await handleDictation(req, deps, session, provider);
    if (type.startsWith("application/json")) return await handleConsult(req, deps, session);
    throw new GatewayError("unsupported_media_type");
  } catch (error) {
    if (error instanceof VoiceReject) {
      logReject(error.code);
      return voiceReject(error.code);
    }
    const code = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  }
}
