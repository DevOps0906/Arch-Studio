// Node worker_threads에서 pdf-direct 실행(DOM 없는 스레드). 브라우저 Web Worker 동작은 web/worker.html로 별도 확인.
import { parentPort, workerData } from 'node:worker_threads';
import { renderPdfDirect } from './pdf-direct.ts';

const { sheets, font } = workerData as { sheets: Parameters<typeof renderPdfDirect>[0]; font: Uint8Array };
const t0 = performance.now();
const bytes = renderPdfDirect(sheets, font);
parentPort!.postMessage({ bytes, ms: Math.round(performance.now() - t0), hasDocument: typeof (globalThis as { document?: unknown }).document !== 'undefined' }, [bytes.buffer as ArrayBuffer]);
