// 브라우저 Web Worker: DOM 없는 스레드에서 jsPDF 직접 그리기 + svg2pdf 가능 여부 점검
import { SAMPLES, buildSheets } from '../src/model.ts';
import { renderPdfDirect } from '../src/pdf-direct.ts';

self.onmessage = async (ev: MessageEvent<{ font: ArrayBuffer }>) => {
  const g = self as unknown as Record<string, unknown>;
  const meta: Record<string, unknown> = {
    isWorker: typeof WorkerGlobalScope !== 'undefined',
    hasDocument: typeof g.document !== 'undefined',
    hasWindow: typeof g.window !== 'undefined',
  };
  try {
    const t0 = performance.now();
    const outs: Uint8Array[] = [];
    for (const s of SAMPLES) outs.push(renderPdfDirect(buildSheets(s).sheets, new Uint8Array(ev.data.font)));
    meta.ms = Math.round(performance.now() - t0);
    meta.sizes = outs.map((o) => o.length);
    (self as unknown as Worker).postMessage({ meta, first: outs[0].buffer }, [outs[0].buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ meta, error: String(e), stack: (e as Error).stack });
  }
};
