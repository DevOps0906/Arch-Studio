// 엔진 워커 진입점(judge·suggest·layout + 모델러 표시 mesh·preview 레인). 로직은 runtime.ts·engine.handlers.ts·modeler.handlers.ts 에 있다.
// Manifold WASM은 이 워커에서만 초기화한다(AR-06-036 [DECISION]: 메인 스레드 금지). wasm 파일은 Vite가 같은 출처 자산으로 내보낸다(blob: 없음).
import { loadSolidKernel } from "@arch-studio/geometry";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { createEngineHandlers } from "./engine.handlers.ts";
import { createModelerHandlers } from "./modeler.handlers.ts";
import { WorkerRuntime } from "./runtime.ts";
import { RulePackStore } from "./rulePacks.ts";
import { createSuggestHandlers } from "./suggest.handlers.ts";

interface WorkerScope {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

// 팩은 셸 RulePackProvider(src/shell/rule-packs.ts)가 load_rule_pack 메시지로 넣는다(서명·자격 확인은 Rust, AR-06-042).
const store = new RulePackStore();
const engine = createEngineHandlers(store);
// 모델러 표시 핸들러와 매스 제안(AR-06-028)이 Manifold 인스턴스 하나를 나눠 쓴다(WASM 두 번 올리지 않음).
let kernelOnce: ReturnType<typeof loadSolidKernel> | null = null;
const loadKernel = () => (kernelOnce ??= loadSolidKernel({ locateFile: () => wasmUrl }));
const modeler = createModelerHandlers({ store, loadKernel });
const suggest = createSuggestHandlers({ store, loadKernel });
const runtime = new WorkerRuntime({
  lanes: ["judge", "suggest", "layout", "mesh", "preview"],
  handlers: { ...engine.handlers, ...modeler, ...suggest },
  control: engine.control,
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  now: () => performance.now(),
  yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)),
  log: (entry) => console.debug("[engine.worker]", JSON.stringify(entry)),
});
scope.onmessage = (e) => runtime.receive(e.data);
