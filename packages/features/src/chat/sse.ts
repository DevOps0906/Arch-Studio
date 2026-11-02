// SSE(text/event-stream) 읽기: fetch POST + ReadableStream(AR-06-055, CLAUDE.md "스트리밍"). EventSource는 POST를 못 하므로 쓰지 않는다.
// 조각 경계가 어디서 끊겨도 같은 이벤트가 나오도록 줄 단위로 모은다. 본문을 로그에 남기지 않는다.
import type { StreamBodyLike } from "../api-client/index.ts";

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

/** 증분 파서: 받은 글 조각을 넣으면 완성된 이벤트만 돌려준다(빈 줄 = 이벤트 끝). */
export function createSseParser(): { feed(chunk: string): SseEvent[]; flush(): SseEvent[] } {
  let buf = "";
  let event = "";
  let data: string[] = [];
  const take = (line: string, out: SseEvent[]): void => {
    if (line === "") {
      if (data.length > 0) out.push({ event: event || "message", data: data.join("\n") });
      event = "";
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const i = line.indexOf(":");
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };
  return {
    feed(chunk) {
      buf += chunk;
      const out: SseEvent[] = [];
      for (;;) {
        const nl = buf.search(/\r\n|\n|\r/);
        if (nl < 0) break;
        const len = buf.startsWith("\r\n", nl) ? 2 : 1;
        // 조각 끝이 \r이면 다음 조각의 \n과 한 줄 끝일 수 있다 → 다음 조각까지 기다린다.
        if (buf[nl] === "\r" && len === 1 && nl === buf.length - 1) break;
        take(buf.slice(0, nl), out);
        buf = buf.slice(nl + len);
      }
      return out;
    },
    flush() {
      const out: SseEvent[] = [];
      if (buf !== "") take(buf, out);
      buf = "";
      take("", out);
      return out;
    },
  };
}

/** 스트림을 끝까지 읽으며 이벤트마다 onEvent. signal이 끊으면 reader를 취소하고 멈춘다. */
export async function readSse(body: StreamBodyLike, onEvent: (e: SseEvent) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      if (value) for (const e of parser.feed(decoder.decode(value, { stream: true }))) onEvent(e);
    }
    for (const e of parser.feed(decoder.decode())) onEvent(e);
    for (const e of parser.flush()) onEvent(e);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
