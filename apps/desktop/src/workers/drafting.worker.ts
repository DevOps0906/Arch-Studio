// 드래프팅 워커 진입점(sheet·export·import 레인). 로직은 runtime.ts·drafting.handlers.ts 에 있다.
import { createDraftingHandlers, type DraftingAssets } from "./drafting.handlers.ts";
import { WorkerRuntime } from "./runtime.ts";

interface WorkerScope {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

// 번들 한글 글꼴(Noto Sans KR 부분 집합, OFL)과 폭 표: 저장소의 정본 파일을 앱 자산으로 낸다(Vite가 URL로 바꾼다).
// 같은 출처 fetch라 CSP connect-src 'self'로 충분하다.
const FONT_URL = new URL("../../../../packages/drafting/fonts/NotoSansKR-Regular.subset.ttf", import.meta.url);
const METRICS_URL = new URL("../../../../packages/drafting/fonts/NotoSansKR.metrics.json", import.meta.url);

async function loadAssets(): Promise<DraftingAssets> {
  const [font, metrics] = await Promise.all([fetch(FONT_URL), fetch(METRICS_URL)]);
  if (!font.ok || !metrics.ok) throw new Error("assets");
  return {
    font: { family: "NotoSansKR", ttf: new Uint8Array(await font.arrayBuffer()) },
    metrics: (await metrics.json()) as DraftingAssets["metrics"],
  };
}

const runtime = new WorkerRuntime({
  lanes: ["sheet", "export", "import"],
  ...createDraftingHandlers({ loadAssets }),
  post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  now: () => performance.now(),
  yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)),
  log: (entry) => console.debug("[drafting.worker]", JSON.stringify(entry)),
});
scope.onmessage = (e) => runtime.receive(e.data);
