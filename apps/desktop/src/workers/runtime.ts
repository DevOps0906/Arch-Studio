// 스케줄러 코어를 핸들러에 연결하는 워커 런타임. Worker 전역(self)을 직접 쓰지 않고 post·now·yieldFn·log 를 주입받는다.
// 로그에는 op·레인·req_id·상태·소요 시간·오류 코드만 남긴다(메시지 본문 금지, 01_PRD.md 9.5절).
import { parseRequest, type EngineRequest, type EngineResponse, type Lane, type LaneRequest, type LocalErrorCode } from "./protocol.ts";
import { LaneScheduler, type Effect, type Outcome } from "./scheduler.ts";

export interface LogEntry {
  op: string;
  lane?: Lane;
  req_id?: string;
  status?: string;
  elapsed_ms?: number;
  code?: string;
}

export class Canceled extends Error {
  constructor() {
    super("canceled");
    this.name = "Canceled";
  }
}

/** 핸들러가 실패를 돌려줄 때 던진다. detail 은 화면에 보이는 문구라 본문 값을 넣지 않는다. */
export class HandlerError extends Error {
  readonly code: LocalErrorCode;
  constructor(code: LocalErrorCode, detail: string) {
    super(detail);
    this.name = "HandlerError";
    this.code = code;
  }
}

export interface HandlerContext {
  /** 단계 경계에서 부른다: 이벤트 루프에 양보하고, 취소됐으면 Canceled 를 던진다. */
  checkpoint(): Promise<void>;
  progress(stage: string, pct: number): void;
}

export interface HandlerResult {
  result: unknown;
  engine_version: string;
  transfer?: ArrayBuffer[];
}

export type Handler = (req: LaneRequest, ctx: HandlerContext) => Promise<HandlerResult> | HandlerResult;

export interface RuntimeOptions {
  /** 이 워커가 맡는 레인. 밖의 레인 요청은 AR050 으로 거절한다. */
  lanes: readonly Lane[];
  handlers: Partial<Record<LaneRequest["op"], Handler>>;
  /** 제어 메시지(load_rule_pack). 레인 없이 즉시 처리한다. */
  control?: (req: Extract<EngineRequest, { op: "load_rule_pack" }>) => { engine_version: string; result: unknown } | Promise<{ engine_version: string; result: unknown }>;
  post(message: EngineResponse, transfer?: ArrayBuffer[]): void;
  now(): number;
  yieldFn(): Promise<void>;
  log(entry: LogEntry): void;
}

export class WorkerRuntime {
  private readonly scheduler = new LaneScheduler<LaneRequest>();
  private readonly transfers = new Map<string, ArrayBuffer[]>();

  private readonly opts: RuntimeOptions;

  constructor(opts: RuntimeOptions) {
    this.opts = opts;
  }

  receive(raw: unknown): void {
    const parsed = parseRequest(raw);
    if (!parsed.ok) {
      this.opts.log({ op: "invalid", status: "error", code: "AR050" });
      if (parsed.req_id !== null) this.opts.post({ req_id: parsed.req_id, ok: false, code: "AR050", detail: parsed.detail });
      return;
    }
    const req = parsed.request;
    if (req.op === "cancel") {
      this.opts.log({ op: "cancel", req_id: req.req_id });
      this.apply(this.scheduler.cancel(req.req_id));
      return;
    }
    if (req.op === "load_rule_pack") {
      void this.runControl(req);
      return;
    }
    if (!this.opts.lanes.includes(req.lane) || this.opts.handlers[req.op] === undefined) {
      this.opts.log({ op: req.op, lane: req.lane, req_id: req.req_id, status: "error", code: "AR050" });
      this.opts.post({ req_id: req.req_id, ok: false, code: "AR050", detail: "이 워커가 처리하는 요청이 아닙니다" });
      return;
    }
    this.apply(this.scheduler.submit(req));
  }

  private apply(effects: Effect<LaneRequest>[]): void {
    for (const e of effects) {
      if (e.kind === "start") {
        void this.run(e.request);
      } else {
        const transfer = this.transfers.get(e.response.req_id);
        this.transfers.delete(e.response.req_id);
        const terminal = "ok" in e.response && e.response.ok ? transfer : undefined;
        this.opts.post(e.response, terminal);
      }
    }
  }

  private async runControl(req: Extract<EngineRequest, { op: "load_rule_pack" }>): Promise<void> {
    const t0 = this.opts.now();
    try {
      const r = await this.opts.control?.(req);
      if (r === undefined) throw new HandlerError("AR050", "규칙 팩을 받지 않는 워커입니다");
      const elapsed_ms = this.opts.now() - t0;
      this.opts.log({ op: "load_rule_pack", req_id: req.req_id, status: "ok", elapsed_ms });
      this.opts.post({ req_id: req.req_id, ok: true, op: "load_rule_pack", result: r.result, engine_version: r.engine_version, elapsed_ms });
    } catch (err) {
      const f = toFailure(err);
      this.opts.log({ op: "load_rule_pack", req_id: req.req_id, status: "error", code: f.code });
      this.opts.post({ req_id: req.req_id, ok: false, code: f.code, detail: f.detail });
    }
  }

  private async run(req: LaneRequest): Promise<void> {
    const { opts, scheduler } = this;
    const t0 = opts.now();
    const ctx: HandlerContext = {
      checkpoint: async () => {
        await opts.yieldFn();
        if (scheduler.isCanceled(req.req_id)) throw new Canceled();
      },
      progress: (stage, pct) => {
        void stage;
        if (!scheduler.isCanceled(req.req_id)) opts.post({ req_id: req.req_id, status: "progress", pct });
      },
    };
    let outcome: Outcome;
    try {
      await opts.yieldFn(); // 같은 틱에 연달아 온 요청이 먼저 대체 표시를 달 수 있게 한다
      if (scheduler.isCanceled(req.req_id)) throw new Canceled();
      const handler = opts.handlers[req.op] as Handler;
      const r = await handler(req, ctx);
      if (r.transfer) this.transfers.set(req.req_id, r.transfer);
      outcome = { ok: true, op: req.op, result: r.result, engine_version: r.engine_version, elapsed_ms: opts.now() - t0 };
    } catch (err) {
      if (err instanceof Canceled) outcome = { ok: false, code: "AR050", detail: "취소됨" };
      else {
        const f = toFailure(err);
        outcome = { ok: false, code: f.code, detail: f.detail };
      }
    }
    const effects = scheduler.finish(req.req_id, outcome);
    const reply = effects.find((e) => e.kind === "reply");
    const response = reply?.kind === "reply" ? reply.response : null;
    opts.log(logOf(req, response, outcome));
    if (response === null || !("ok" in response && response.ok)) this.transfers.delete(req.req_id);
    this.apply(effects);
  }
}

function logOf(req: LaneRequest, response: EngineResponse | null, outcome: Outcome): LogEntry {
  const base: LogEntry = { op: req.op, lane: req.lane, req_id: req.req_id };
  if (response && "status" in response) return { ...base, status: response.status };
  if (outcome.ok) return { ...base, status: "ok", elapsed_ms: outcome.elapsed_ms };
  return { ...base, status: "error", code: outcome.code };
}

/** 오류 → 사용자 코드. 알 수 없는 예외는 내용을 싣지 않고 일반 문구만 낸다. */
function toFailure(err: unknown): { code: LocalErrorCode; detail: string } {
  if (err instanceof HandlerError) return { code: err.code, detail: err.message };
  if (err instanceof Error && err.name === "RulesError") return { code: "AR050", detail: err.message };
  return { code: "AR050", detail: "엔진 내부 오류" };
}
