// 샘플 다운로드 익명 이벤트(PRD 9.8 전환 지표). 수집 항목은 sample_id·format 두 가지뿐이다:
// IP·User-Agent·쿠키·헤더·referer는 읽지도 저장하지도 않는다.
// 저장소는 지금은 서버 로그 한 줄. DB 테이블이 생기면 SampleDownloadSink 구현만 바꿔 끼운다(DB는 이 작업 범위 밖).
import { z } from "zod";
import { logger } from "../../lib/logger.ts";
import { SAMPLE_FORMATS, SAMPLE_IDS } from "./catalog.ts";

export const MAX_BODY_BYTES = 256;

export const downloadEventSchema = z
  .object({ sample_id: z.enum(SAMPLE_IDS), format: z.enum(SAMPLE_FORMATS) })
  .strict();
export type SampleDownloadEvent = z.infer<typeof downloadEventSchema>;

/** 추후 DB 연결용 저장 인터페이스. */
export interface SampleDownloadSink {
  record(event: SampleDownloadEvent): Promise<void> | void;
}

export const logSink: SampleDownloadSink = {
  record(event) {
    logger.info("sample_download", { sample_id: event.sample_id, format: event.format });
  },
};

export async function recordSampleDownload(event: SampleDownloadEvent, sink: SampleDownloadSink = logSink): Promise<void> {
  await sink.record(event);
}

const json = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** 본문을 MAX_BODY_BYTES 까지만 읽는다. 넘으면 null. */
async function readLimited(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function handleDownloadEvent(req: Request, sink: SampleDownloadSink = logSink): Promise<Response> {
  const text = await readLimited(req);
  if (text === null) return json(413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, "INVALID_JSON", "JSON 형식이 아닙니다.");
  }
  const parsed = downloadEventSchema.safeParse(raw);
  if (!parsed.success) return json(400, "INVALID_INPUT", "sample_id 또는 format 값이 올바르지 않습니다.");
  try {
    await recordSampleDownload(parsed.data, sink);
  } catch {
    // 측정 실패가 다운로드를 막지 않는다. 호출자는 응답을 기다리지 않는다.
    logger.error("sample_download_record_failed");
    return json(500, "RECORD_FAILED", "기록하지 못했습니다.");
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
