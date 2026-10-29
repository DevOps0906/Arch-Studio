// 엔진 워커 진입점(judge·suggest·layout 레인). 로직은 runtime.ts·engine.handlers.ts 에 있다.
import { createEngineHandlers } from "./engine.handlers.ts";
import { WorkerRuntime } from "./runtime.ts";
import { RulePackStore } from "./rulePacks.ts";

interface WorkerScope {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

// RulePackProvider 구현은 후속 작업. 지금은 load_rule_pack 메시지로 받은 팩만 쓴다.
const store = new RulePackStore();
const runtime = new WorkerRuntime({
  lanes: ["judge", "suggest", "layout"],
  ...createEngineHandlers(store),
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  now: () => performance.now(),
  yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)),
  log: (entry) => console.debug("[engine.worker]", JSON.stringify(entry)),
});
scope.onmessage = (e) => runtime.receive(e.data);
