// 엔진 워커 진입점(judge·suggest·layout + 모델러 표시 mesh·preview 레인). 로직은 runtime.ts·engine.handlers.ts·modeler.handlers.ts 에 있다.
// Manifold WASM은 이 워커에서만 초기화한다(AR-06-036 [DECISION]: 메인 스레드 금지). wasm 파일은 Vite가 같은 출처 자산으로 내보낸다(blob: 없음).
import { loadSolidKernel } from "@arch-studio/geometry";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { createEngineHandlers } from "./engine.handlers.ts";
import { createModelerHandlers } from "./modeler.handlers.ts";
import { WorkerRuntime } from "./runtime.ts";
import { RulePackStore } from "./rulePacks.ts";

interface WorkerScope {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

// RulePackProvider 구현은 후속 작업. 지금은 load_rule_pack 메시지로 받은 팩만 쓴다.
const store = new RulePackStore();
const engine = createEngineHandlers(store);
const modeler = createModelerHandlers({ store, loadKernel: () => loadSolidKernel({ locateFile: () => wasmUrl }) });
const runtime = new WorkerRuntime({
  lanes: ["judge", "suggest", "layout", "mesh", "preview"],
  handlers: { ...engine.handlers, ...modeler },
  control: engine.control,
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  now: () => performance.now(),
  yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)),
  log: (entry) => console.debug("[engine.worker]", JSON.stringify(entry)),
});
scope.onmessage = (e) => runtime.receive(e.data);
