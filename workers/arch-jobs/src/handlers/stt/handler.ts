// arch.stt 핸들러(상담 녹음 전사, AR-06-053). payload(웹 /api/voice/stt 상담 모드가 만든 값, 04_API.md 4장):
//   { voice_ref, audio_path, notice_version, language: 'ko', declared_duration_s }. 잡 원장(credit_ledger_id) = 신고 길이 선차감.
// 순서: payload 검사 → 원본 내려받기·재검사(50MB·매직바이트) → 제공자(오픈소스만, 대체 없음) → 전사본 저장(org-files)
//   → 실제 길이 정산(남는 크레딧 환불, `voice:<voice_ref>:settle`) → jobs.result { transcript_path, duration_s, chunks, provider, model }.
// 실패: 내려받기·제공자 오류는 재시도 가능(잡 max_attempts=2 → 대체 없이 1회). 최종 실패는 fail_job이 남은 금액 전액 환불.
// 원본 삭제는 웹이 남긴 core.voice_jobs(expires_at 24시간) → expire_voice_audio 크론이 한다.
// 10분 단위 분할(04_API.md 4장)은 오디오 디코더(새 의존성) 결정 전이라 하지 않는다: chunks=1, 제공자 요청당 상한은 제공자가 거부.
import type { JobHandler } from "../../core/runner.ts";
import { JobError } from "../../core/errors.ts";
import { settleStt, sttCreditsFor, voiceSettleKey } from "./billing.ts";
import type { ConsultSttProvider, ConsultSttResult } from "./provider.ts";
import type { SttCredits, SttStorage } from "./storage.ts";

export interface SttHandlerDeps {
  provider: ConsultSttProvider;
  storage: SttStorage;
  credits: SttCredits;
}

/** consult_audio 상한(웹 업로드 정책·voice-audio 버킷과 같은 50MB). */
export const CONSULT_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const CONSULT_MAX_SECONDS = 7200;

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PART}$`);
const MIME = { webm: "audio/webm", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" } as const;

interface SttPayload {
  voiceRef: string;
  audioPath: string;
  declaredSeconds: number;
}

function fatal(code: string, message: string): JobError {
  return new JobError(message, { retryable: false, code });
}

function parsePayload(orgId: string, payload: Record<string, unknown>): SttPayload {
  if (!UUID_RE.test(orgId)) throw fatal("bad_payload", "org id invalid");
  const voiceRef = payload["voice_ref"];
  if (typeof voiceRef !== "string" || !UUID_RE.test(voiceRef)) throw fatal("bad_payload", "voice_ref invalid");
  const audioPath = payload["audio_path"];
  if (typeof audioPath !== "string" || !new RegExp(`^${orgId}/arch/consult_audio/${UUID_PART}\\.(m4a|webm|ogg|wav)$`).test(audioPath)) {
    throw fatal("bad_payload", "audio_path invalid");
  }
  // 고지 없는 녹음은 처리하지 않는다(04_API.md 4.5절). DB 직접 enqueue 대비.
  const notice = payload["notice_version"];
  if (typeof notice !== "string" || notice.length === 0) throw fatal("recording_notice_required", "notice_version missing");
  if (payload["language"] !== "ko") throw fatal("bad_payload", "language invalid");
  const declared = payload["declared_duration_s"];
  if (typeof declared !== "number" || !Number.isFinite(declared) || declared <= 0 || declared > CONSULT_MAX_SECONDS) {
    throw fatal("bad_payload", "declared_duration_s invalid");
  }
  return { voiceRef, audioPath, declaredSeconds: declared };
}

function sniffMime(b: Uint8Array): string | null {
  const at = (i: number, s: string) => b.length >= i + s.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return MIME.webm;
  if (at(0, "OggS")) return MIME.ogg;
  if (at(0, "RIFF") && at(8, "WAVE")) return MIME.wav;
  if (at(4, "ftyp")) return MIME.m4a;
  return null;
}

export function createSttHandler(deps: SttHandlerDeps): JobHandler {
  return async (ctx) => {
    const { job, signal } = ctx;
    const p = parsePayload(job.org_id, job.payload ?? {});

    await ctx.heartbeat(10, JSON.stringify({ stage: "split", done: 0, total: 1 }));
    let audio: Uint8Array;
    try {
      audio = await deps.storage.download("voice-audio", p.audioPath);
    } catch (err) {
      throw new JobError("consult audio download failed", { retryable: true, code: "storage", cause: err });
    }
    if (audio.byteLength > CONSULT_AUDIO_MAX_BYTES) throw fatal("AR031", "consult audio too large");
    const mime = sniffMime(audio);
    if (!mime) throw fatal("bad_input", "consult audio format");
    if (signal.aborted) throw signal.reason;

    await ctx.heartbeat(30, JSON.stringify({ stage: "transcribe", done: 0, total: 1 }));
    let out: ConsultSttResult;
    try {
      out = await deps.provider.transcribe({ audio, mime, language: "ko", signal });
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      // 대체 제공자 없음(오픈소스 강제). 1회 재시도 후 최종 실패·전액 환불.
      throw new JobError("stt provider failed", { retryable: true, code: "AI_UNAVAILABLE", cause: err });
    }
    if (signal.aborted) throw signal.reason;
    if (typeof out.text !== "string" || !Number.isFinite(out.durationSeconds) || out.durationSeconds < 0) throw fatal("bad_output", "stt output invalid");

    await ctx.heartbeat(80, JSON.stringify({ stage: "merge", done: 1, total: 1 }));
    const transcriptPath = `${job.org_id}/arch/stt/${job.id}.json`;
    if (!new RegExp(`^${job.org_id}/arch/stt/${UUID_PART}\\.json$`).test(transcriptPath)) throw fatal("bad_output_path", "transcript path invalid");
    const durationS = Math.round(out.durationSeconds * 100) / 100;
    try {
      await deps.storage.uploadJson("org-files", transcriptPath, JSON.stringify({ voice_ref: p.voiceRef, text: out.text, duration_s: durationS }));
    } catch (err) {
      throw new JobError("transcript upload failed", { retryable: true, code: "storage", cause: err });
    }

    // 실제 길이 정산: 신고 길이 선차감 중 남는 몫을 돌려준다. 원장이 없으면(무료 잡) 정산하지 않는다.
    const settled = settleStt(sttCreditsFor(p.declaredSeconds), durationS);
    if (settled.refund > 0 && job.credit_ledger_id !== null) {
      try {
        await deps.credits.refund(job.credit_ledger_id, settled.refund, voiceSettleKey(p.voiceRef));
      } catch (err) {
        throw new JobError("stt settle refund failed", { retryable: true, code: "settle", cause: err });
      }
    }
    return {
      jobResult: {
        transcript_path: transcriptPath,
        duration_s: durationS,
        chunks: 1,
        credits: settled.charged,
        provider: deps.provider.name.slice(0, 40),
        model: deps.provider.model.slice(0, 120),
      },
    };
  };
}
