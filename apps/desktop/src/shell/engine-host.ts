// 엔진 호스트(features/shell EngineHost 구현, AR-06-004b): 017 WorkerClient 두 개(engine.worker: judge·suggest·layout,
// drafting.worker: sheet·export·import)를 레인으로 나눠 묶고, 응답을 구독자 모두에게 나눈다.
// 워커는 첫 요청 때 만든다(앱 시작 비용 0). dispose 뒤 다음 요청이 오면 다시 만든다(React StrictMode의 effect 재실행 대비).
import type { EngineHost, EngineRequestLike, EngineResponseLike } from "@arch-studio/features/shell";
import { DRAFTING_LANES, ENGINE_LANES, parseRequest, type EngineRequest, type EngineResponse, type Lane } from "../workers/protocol.ts";
import { WorkerClient, type WorkerClientOptions, type WorkerLike } from "../workers/workerClient.ts";

export interface EngineHostOptions {
  createEngineWorker(): WorkerLike;
  createDraftingWorker(): WorkerLike;
  timeoutMs?: WorkerClientOptions["timeoutMs"];
  /** 재생성 한도 초과 등(진단용, 값 없음). */
  onFatal?(kind: "engine" | "drafting"): void;
}

type Kind = "engine" | "drafting";

export function createEngineHost(opts: EngineHostOptions): EngineHost {
  const listeners = new Set<(r: EngineResponseLike) => void>();
  const clients: Partial<Record<Kind, WorkerClient>> = {};
  let rulePack: Extract<EngineRequest, { op: "load_rule_pack" }> | null = null;
  const emit = (r: EngineResponse) => {
    for (const l of [...listeners]) l(r);
  };
  const client = (kind: Kind): WorkerClient => {
    let c = clients[kind];
    if (!c) {
      c = new WorkerClient({
        createWorker: kind === "engine" ? opts.createEngineWorker : opts.createDraftingWorker,
        onResponse: emit,
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        onFatal: () => opts.onFatal?.(kind),
      });
      clients[kind] = c;
      // dispose 뒤 다시 만든 판정 워커에도 마지막 규칙 팩을 먼저 넣는다(WorkerClient는 자기 재생성 때만 재전송한다).
      if (kind === "engine" && rulePack) c.send(rulePack);
    }
    return c;
  };
  const kindOf = (lane: Lane): Kind => (ENGINE_LANES.includes(lane) ? "engine" : DRAFTING_LANES.includes(lane) ? "drafting" : "engine");

  return {
    send(raw: EngineRequestLike) {
      const parsed = parseRequest(raw);
      if (!parsed.ok) throw new Error(`엔진 요청 봉투 오류: ${parsed.detail}`);
      const req = parsed.request;
      if (req.op === "cancel") {
        clients.engine?.send(req);
        clients.drafting?.send(req);
        return;
      }
      // 규칙 팩은 판정 워커만 쓴다(drafting 워커에는 control 처리기가 없다).
      if (req.op === "load_rule_pack") {
        const fresh = !clients.engine;
        rulePack = req;
        const c = client("engine");
        if (!fresh) c.send(req);
        return;
      }
      client(kindOf(req.lane)).send(req);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const k of ["engine", "drafting"] as const) {
        clients[k]?.dispose();
        delete clients[k];
      }
    },
  };
}
