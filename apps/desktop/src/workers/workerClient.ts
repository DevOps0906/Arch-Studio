// 호스트(메인 스레드) 쪽 워커 클라이언트: 요청 추적, 오래된 응답 버리기, 장애 시 재생성과 재전송, 타임아웃 훅.
// 재전송 정책(2.4절 "장애"): 응답을 아직 못 받은 요청만 다시 보낸다. 최신만 유효 레인은 마지막 1건, export·import 는 순서대로 전부
// (사용자가 시작한 출력은 끝까지). 실패를 성공처럼 보이지 않게, 다시 보내지 않는 요청에는 오류 응답을 낸다.
import { isLatestOnly, type EngineRequest, type EngineResponse, type Lane, type LaneRequest, type LocalErrorCode } from "./protocol.ts";

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface WorkerClientOptions {
  createWorker(): WorkerLike;
  onResponse(response: EngineResponse): void;
  /** 레인별 타임아웃(ms). 설정으로 주입하며 없는 레인은 타임아웃 없음. */
  timeoutMs?: Partial<Record<Lane, number>>;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** 응답 없이 연속으로 재생성할 수 있는 횟수. 넘으면 남은 요청을 오류로 끝내고 멈춘다. */
  maxRestarts?: number;
  onRestart?(reason: "error" | "exit" | "timeout"): void;
  onFatal?(): void;
}

interface Pending {
  request: LaneRequest;
  timer: unknown;
}

export class WorkerClient {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<string, Pending>(); // 삽입 순서 = 보낸 순서
  private readonly latestSeq = new Map<Lane, number>();
  private rulePack: Extract<EngineRequest, { op: "load_rule_pack" }> | null = null;
  private restarts = 0;
  private dead = false;

  private readonly opts: WorkerClientOptions;

  constructor(opts: WorkerClientOptions) {
    this.opts = opts;
    this.spawn();
  }

  send(req: EngineRequest): void {
    if (this.dead) return;
    if (req.op === "cancel") {
      this.worker?.postMessage(req);
      return;
    }
    if (req.op === "load_rule_pack") {
      this.rulePack = req;
      this.worker?.postMessage(req);
      return;
    }
    if (isLatestOnly(req.lane) && seqOf(req) !== undefined) this.latestSeq.set(req.lane, seqOf(req) as number);
    this.pending.set(req.req_id, { request: req, timer: this.arm(req) });
    this.worker?.postMessage(req);
  }

  /** 워커 종료를 호스트가 따로 알게 됐을 때(예: 프로세스 감시) 부른다. */
  notifyExit(): void {
    this.restart("exit");
  }

  dispose(): void {
    this.dead = true;
    for (const p of this.pending.values()) this.disarm(p);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private spawn(): void {
    const w = this.opts.createWorker();
    w.onmessage = (e) => this.handle(e.data as EngineResponse);
    w.onerror = () => this.restart("error");
    w.onmessageerror = () => this.restart("error");
    this.worker = w;
  }

  private handle(res: EngineResponse): void {
    this.restarts = 0;
    if ("status" in res && res.status === "progress") {
      this.opts.onResponse(res);
      return;
    }
    if (res.req_id === this.rulePack?.req_id) {
      this.opts.onResponse(res);
      return;
    }
    const p = this.pending.get(res.req_id);
    if (!p) return; // 이미 끝낸(타임아웃 등) 요청의 늦은 응답
    this.disarm(p);
    this.pending.delete(res.req_id);
    // 받은 응답의 seq 가 레인 최신값보다 작으면 결과를 버린다(2.4절). 상태 응답(superseded·canceled)은 그대로 전달한다.
    if ("ok" in res && res.seq !== undefined && res.seq < (this.latestSeq.get(p.request.lane) ?? -1)) return;
    this.opts.onResponse(res);
  }

  private restart(reason: "error" | "exit" | "timeout", timedOut?: string): void {
    if (this.dead) return;
    this.worker?.terminate();
    this.worker = null;
    this.restarts++;
    this.opts.onRestart?.(reason);
    if (timedOut !== undefined) {
      const p = this.pending.get(timedOut);
      if (p) {
        this.disarm(p);
        this.pending.delete(timedOut);
        this.fail(p.request, "시간 초과");
      }
    }
    if (this.restarts > (this.opts.maxRestarts ?? 3)) {
      this.dead = true;
      for (const p of [...this.pending.values()]) {
        this.disarm(p);
        this.fail(p.request, "엔진 워커를 다시 시작할 수 없습니다");
      }
      this.pending.clear();
      this.opts.onFatal?.();
      return;
    }
    this.spawn();
    if (this.rulePack) this.post(this.rulePack); // 새 워커에 규칙 팩부터 다시 싣는다
    const lastByLane = new Map<Lane, string>();
    for (const [id, p] of this.pending) if (isLatestOnly(p.request.lane)) lastByLane.set(p.request.lane, id);
    for (const [id, p] of [...this.pending]) {
      if (isLatestOnly(p.request.lane) && lastByLane.get(p.request.lane) !== id) {
        // 마지막 요청이 아니면 어차피 대체됐을 요청이다: 다시 보내지 않고 superseded 로 끝낸다
        this.disarm(p);
        this.pending.delete(id);
        this.opts.onResponse({ req_id: id, status: "superseded" });
        continue;
      }
      this.disarm(p);
      p.timer = this.arm(p.request);
      this.post(p.request);
    }
  }

  private fail(req: LaneRequest, detail: string): void {
    const code: LocalErrorCode = req.lane === "export" ? "AR052" : "AR050";
    this.opts.onResponse({ req_id: req.req_id, ...(seqOf(req) === undefined ? {} : { seq: seqOf(req) as number }), ok: false, code, detail });
  }

  private post(message: unknown): void {
    this.worker?.postMessage(message);
  }

  private arm(req: LaneRequest): unknown {
    const ms = this.opts.timeoutMs?.[req.lane];
    if (ms === undefined || this.opts.setTimer === undefined) return null;
    return this.opts.setTimer(() => this.restart("timeout", req.req_id), ms);
  }

  private disarm(p: Pending): void {
    if (p.timer !== null) this.opts.clearTimer?.(p.timer);
    p.timer = null;
  }
}

function seqOf(req: LaneRequest): number | undefined {
  return "seq" in req ? req.seq : undefined;
}
