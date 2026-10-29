// 실제 모듈 워커 생성(Vite가 new URL(..., import.meta.url) 글자를 보고 워커 청크를 만든다 — 경로는 이 파일 기준 상대 경로 고정).
// CSP: 빌드 산출물의 워커는 같은 출처 파일이라 worker-src 'self'로 충분하다(tauri.conf.json 변경 없음, blob: 불필요).
import type { EngineHost } from "@arch-studio/features/shell";
import type { WorkerLike } from "../workers/workerClient.ts";
import { createEngineHost } from "./engine-host.ts";

// 브라우저 Worker의 onmessage(MessageEvent)는 WorkerLike({data})보다 넓어 구조 변환만 한다.
const asWorkerLike = (w: Worker): WorkerLike => w as unknown as WorkerLike;

export function createBrowserEngineHost(): EngineHost | null {
  if (typeof Worker === "undefined") return null;
  return createEngineHost({
    createEngineWorker: () => asWorkerLike(new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" })),
    createDraftingWorker: () => asWorkerLike(new Worker(new URL("../workers/drafting.worker.ts", import.meta.url), { type: "module" })),
  });
}
