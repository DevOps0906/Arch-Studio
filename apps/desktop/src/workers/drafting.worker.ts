// 드래프팅 워커 진입점(sheet·export·import 레인). 로직은 runtime.ts·drafting.handlers.ts 에 있다.
import { createDraftingHandlers } from "./drafting.handlers.ts";
import { WorkerRuntime } from "./runtime.ts";

interface WorkerScope {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const runtime = new WorkerRuntime({
  lanes: ["sheet", "export", "import"],
  ...createDraftingHandlers(),
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  now: () => performance.now(),
  yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)),
  log: (entry) => console.debug("[drafting.worker]", JSON.stringify(entry)),
});
scope.onmessage = (e) => runtime.receive(e.data);
