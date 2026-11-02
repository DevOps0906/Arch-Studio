// POST /api/voice/stt 본체(04_API.md:14 STT 예외 · :87 상한 60초·5MB, AR-06-053 서버). 동기 받아쓰기, 요청당 1크레딧 정액. 순서:
// 실패 닫힘 스위치(503, 인증 전·차감 0) → 인증 → 역할 member+(403) → 엔타이틀먼트(402) → 형식(415) → request_id(422)
// → 레이트 리밋(429, 본문 버퍼링 전) → 본문 읽기(5MB 초과 AR031 413) → 매직바이트(415) → 멱등 확인(중복이면 제공자 미호출 409)
// → 선차감(consume_credits, 부족 402) → 제공자 호출 → 길이>60초·빈 전사·제공자 실패는 전액 환불.
// 결과 텍스트·오디오는 저장하지 않는다. 응답·로그에 본문·토큰·예외 원문을 넣지 않는다. server-only를 import하지 않는다(node --test 대상).
import { logger } from "../../lib/logger.ts";
import { errorResponse, GatewayError, okResponse, toErrorResponse, UUID_V4_RE, type GatewayErrorCode } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { matchesMagic, parseVoiceMime } from "./magic.ts";
import { STT_MAX_SECONDS, type SttProvider, type SttTokenSupplier } from "./provider.ts";

/** 받아쓰기 정액(≤60초 = 분당 1 올림 1, [DECISION] 3). */
export const STT_CREDITS = 1;
/** 04_API.md:87. */
export const STT_MAX_BYTES = 5 * 1024 * 1024;
/** 조직·사용자별 12회/분. */
export const STT_RATE = { limit: 12, windowS: 60 } as const;

export interface VoiceLedger {
  /** 이 멱등 키의 원장 행이 이미 있는가(중복 판별). */
  exists(key: string): Promise<boolean>;
  /** 코어 차감 RPC(구현은 supabase-repo.ts). 부족이면 { code: "CR001" } throw. 원장 id 반환. */
  consume(args: { orgId: string; actorId: string; amount: number; key: string; requestId: string }): Promise<string>;
  /** 코어 환불 RPC 전액. */
  refund(args: { ledgerId: string; reason: string; key: string; actorId: string }): Promise<void>;
}

export interface VoiceDeps {
  enabled(): boolean;
  session: GatewaySessionResolver;
  ledger: VoiceLedger;
  provider: SttProvider;
  token: SttTokenSupplier;
  rateLimit: RateLimitStore;
  now(): number;
}

type VoiceCode = "stt_disabled" | "IDEMPOTENT_REPLAY" | "stt_failed" | "stt_too_long" | "stt_empty";

// 503은 stt_disabled 하나만 쓴다(스위치 off). 클라이언트는 모든 503을 "사용 불가"로 단순 취급한다.
const VOICE_ERRORS: Readonly<Record<VoiceCode, { status: number; message: string }>> = {
  stt_disabled: { status: 503, message: "지금은 음성 받아쓰기를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다." },
  IDEMPOTENT_REPLAY: {
    status: 409,
    message: "이미 처리된 요청입니다. 결과를 받지 못했다면 다시 녹음해 주세요. 크레딧 1이 사용되었을 수 있습니다.",
  },
  stt_failed: { status: 502, message: "받아쓰기에 실패했습니다. 크레딧은 환불되었습니다." },
  stt_too_long: { status: 422, message: "녹음이 60초를 넘습니다. 짧게 나누어 다시 시도하세요. 크레딧은 환불되었습니다." },
  stt_empty: { status: 422, message: "인식된 내용이 없습니다. 크레딧은 환불되었습니다." },
};

class VoiceReject extends Error {
  readonly code: VoiceCode;
  /** 차감 뒤 실패에서만 값이 있다: 환불이 확정됐는가. 클라이언트는 true일 때만 새 request_id로 다시 보낸다. */
  readonly refunded: boolean | undefined;
  constructor(code: VoiceCode, refunded?: boolean) {
    super(code);
    this.name = "VoiceReject";
    this.code = code;
    this.refunded = refunded;
  }
}

function voiceReject(code: VoiceCode, refunded?: boolean): Response {
  const spec = VOICE_ERRORS[code];
  // 환불 확정 실패는 "환불 처리됩니다"(정산 대기)로 정직하게 안내한다.
  const message = refunded === false ? spec.message.replace("환불되었습니다", "환불 처리됩니다") : spec.message;
  const error: Record<string, unknown> = { code, message };
  if (refunded !== undefined) error["details"] = { refunded };
  return new Response(JSON.stringify({ ok: false, error }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function logReject(code: string): void {
  logger.warn("voice_stt.rejected", { route: "voice_stt", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

// 같은 프로세스 안의 동시 중복(원장 확인과 차감 사이의 틈)을 막는다. has·add는 await 없이 동기로 처리한다.
// 한계(운영 전 보강 후보): 프로세스·인스턴스 사이 경합은 DB 멱등 키가 추가 차감만 막을 뿐 제공자 이중 호출은 막지 못한다
// (consume이 "신규 여부"를 돌려주도록 DB 쪽을 보강하면 해결).
const inflight = new Set<string>();

async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new GatewayError("AR031", { max_bytes: maxBytes });
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
        throw new GatewayError("AR031", { max_bytes: maxBytes });
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

function requestIdOf(req: Request): string {
  const id = req.headers.get("x-request-id") ?? new URL(req.url).searchParams.get("request_id") ?? "";
  if (!UUID_V4_RE.test(id)) throw new GatewayError("invalid_input");
  return id;
}

/** 환불이 확정됐으면 true. 실패하면 수동 정산 대상으로 원장 id·조직을 구조화 로그에 남긴다(전사 텍스트 금지). */
async function refundSafe(deps: VoiceDeps, session: GatewaySession, ledgerId: string, key: string, reason: string): Promise<boolean> {
  try {
    await deps.ledger.refund({ ledgerId, reason, key: `${key}:refund`, actorId: session.userId });
    return true;
  } catch {
    logger.error("voice_stt.refund_failed", { route: "voice_stt", reason, ledger_id: ledgerId, org_id: session.orgId });
    return false;
  }
}

export async function handleVoiceStt(req: Request, deps: VoiceDeps): Promise<Response> {
  let claimed: string | undefined;
  try {
    if (!deps.enabled()) throw new VoiceReject("stt_disabled");

    const session = await deps.session.resolve(req);
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });

    const mime = parseVoiceMime(req.headers.get("content-type"));
    if (!mime) throw new GatewayError("unsupported_media_type");
    const requestId = requestIdOf(req);

    const hit = await deps.rateLimit.hit(`arch:voice_stt:${session.orgId}:${session.userId}`, STT_RATE.limit, STT_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }

    const audio = await readBodyLimited(req, STT_MAX_BYTES);
    if (audio.byteLength === 0) throw new GatewayError("invalid_input");
    if (!matchesMagic(mime, audio)) throw new GatewayError("unsupported_media_type");

    const key = `voice:${session.orgId}:${requestId}`;
    if (inflight.has(key)) throw new VoiceReject("IDEMPOTENT_REPLAY");
    inflight.add(key); // has와 add 사이에 await 없음
    claimed = key;
    if (await deps.ledger.exists(key)) throw new VoiceReject("IDEMPOTENT_REPLAY");

    let ledgerId: string;
    try {
      ledgerId = await deps.ledger.consume({ orgId: session.orgId, actorId: session.userId, amount: STT_CREDITS, key, requestId });
    } catch (error) {
      const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
      throw new GatewayError(code === "CR001" ? "CR001" : "internal");
    }

    let result;
    try {
      const token = await deps.token({ orgId: session.orgId, userId: session.userId });
      result = await deps.provider.transcribe({ audio, mime, maxSeconds: STT_MAX_SECONDS, token });
    } catch {
      throw new VoiceReject("stt_failed", await refundSafe(deps, session, ledgerId, key, "stt_provider_failed"));
    }
    if (!Number.isFinite(result.durationS) || result.durationS > STT_MAX_SECONDS) {
      throw new VoiceReject("stt_too_long", await refundSafe(deps, session, ledgerId, key, "stt_too_long"));
    }
    if (result.durationS <= 0 || result.text.trim() === "") {
      throw new VoiceReject("stt_empty", await refundSafe(deps, session, ledgerId, key, "stt_empty"));
    }
    return okResponse({ text: result.text, duration_s: result.durationS, credits: STT_CREDITS });
  } catch (error) {
    if (error instanceof VoiceReject) {
      logReject(error.code);
      return voiceReject(error.code, error.refunded);
    }
    const code: GatewayErrorCode = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  } finally {
    if (claimed) inflight.delete(claimed);
  }
}
