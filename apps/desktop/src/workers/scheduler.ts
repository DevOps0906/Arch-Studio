// 레인 스케줄러 코어. Worker·DOM·시간·난수와 무관한 순수 상태 기계: 입력(submit·cancel·finish)마다 효과(start·reply) 배열을 돌려준다.
// 규칙(02_ARCHITECTURE.md 2.4절): 최신만 유효 레인은 새 요청이 오면 이전 요청을 superseded 로 답한다(실행 중이면 협조적 취소 표시 후 끝날 때 답).
// export 레인은 덮어쓰지도 취소하지도 않고 끝까지 실행한다. 레인끼리는 독립이다(레인마다 동시에 하나만 실행).
import { LANES, isLatestOnly, type EngineResponse, type Lane, type LocalErrorCode, type TerminalStatus } from "./protocol.ts";

export interface SchedulableRequest {
  req_id: string;
  lane: Lane;
  seq?: number;
}

export type Outcome =
  | { ok: true; op: string; result: unknown; engine_version: string; elapsed_ms: number }
  | { ok: false; code: LocalErrorCode; detail: string };

export type Effect<R extends SchedulableRequest> = { kind: "start"; request: R } | { kind: "reply"; response: EngineResponse };

interface Running<R> {
  request: R;
  flag: TerminalStatus | null;
}

interface LaneState<R> {
  queue: R[];
  running: Running<R> | null;
  /** 지금까지 받은 가장 큰 seq(최신만 유효 레인). */
  highestSeq: number;
}

export class LaneScheduler<R extends SchedulableRequest> {
  private readonly lanes = new Map<Lane, LaneState<R>>();
  private readonly known = new Set<string>();

  constructor() {
    for (const lane of LANES) this.lanes.set(lane, { queue: [], running: null, highestSeq: -1 });
  }

  submit(request: R): Effect<R>[] {
    const out: Effect<R>[] = [];
    if (this.known.has(request.req_id)) {
      out.push(errorReply(request, "AR050", "이미 처리 중인 req_id 입니다"));
      return out;
    }
    const st = this.state(request.lane);
    if (isLatestOnly(request.lane)) {
      const seq = request.seq ?? 0;
      if (seq < st.highestSeq) {
        out.push(statusReply(request, "superseded")); // 이미 더 새 요청을 받았다: 늦게 도착한 옛 요청
        return out;
      }
      st.highestSeq = seq;
      for (const old of st.queue) {
        this.known.delete(old.req_id);
        out.push(statusReply(old, "superseded"));
      }
      st.queue = [];
      if (st.running && st.running.flag === null) st.running.flag = "superseded";
    }
    this.known.add(request.req_id);
    st.queue.push(request);
    out.push(...this.pump());
    return out;
  }

  /** 취소 요청. 대기 중이면 바로 canceled, 실행 중이면 취소 표시(끝날 때 canceled). export 레인은 취소하지 않는다. */
  cancel(req_id: string): Effect<R>[] {
    for (const [lane, st] of this.lanes) {
      if (lane === "export") continue;
      const idx = st.queue.findIndex((q) => q.req_id === req_id);
      if (idx >= 0) {
        const [req] = st.queue.splice(idx, 1) as [R];
        this.known.delete(req_id);
        return [statusReply(req, "canceled")];
      }
      if (st.running?.request.req_id === req_id) {
        if (st.running.flag === null) st.running.flag = "canceled";
        return [];
      }
    }
    return [];
  }

  /** 핸들러가 단계 경계에서 확인한다. true 면 일을 멈추고 finish 를 부른다. */
  isCanceled(req_id: string): boolean {
    for (const st of this.lanes.values()) {
      if (st.running?.request.req_id === req_id) return st.running.flag !== null;
    }
    return false;
  }

  /** 실행이 끝났다. 취소·대체 표시가 있으면 결과를 버리고 그 상태로 답한다. */
  finish(req_id: string, outcome: Outcome): Effect<R>[] {
    for (const st of this.lanes.values()) {
      const run = st.running;
      if (run?.request.req_id !== req_id) continue;
      st.running = null;
      this.known.delete(req_id);
      const out: Effect<R>[] = [];
      if (run.flag !== null) out.push(statusReply(run.request, run.flag));
      else out.push({ kind: "reply", response: withSeq(run.request, outcome) });
      out.push(...this.pump());
      return out;
    }
    return [];
  }

  /** 실행 중이거나 대기 중인 요청 수(테스트·진단용). */
  inFlight(): number {
    return this.known.size;
  }

  private state(lane: Lane): LaneState<R> {
    return this.lanes.get(lane) as LaneState<R>;
  }

  private pump(): Effect<R>[] {
    const out: Effect<R>[] = [];
    for (const lane of LANES) {
      const st = this.state(lane);
      if (st.running || st.queue.length === 0) continue;
      const request = st.queue.shift() as R;
      st.running = { request, flag: null };
      out.push({ kind: "start", request });
    }
    return out;
  }
}

function withSeq(req: SchedulableRequest, outcome: Outcome): EngineResponse {
  const seq = req.seq === undefined ? {} : { seq: req.seq };
  return { req_id: req.req_id, ...seq, ...outcome };
}

function statusReply<R extends SchedulableRequest>(req: R, status: TerminalStatus): Effect<R> {
  return { kind: "reply", response: { req_id: req.req_id, status } };
}

function errorReply<R extends SchedulableRequest>(req: R, code: LocalErrorCode, detail: string): Effect<R> {
  return { kind: "reply", response: { req_id: req.req_id, ok: false, code, detail } };
}
