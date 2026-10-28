// node src/gen.ts [--svg2pdf]  → out/ 에 DXF·SVG·PDF 생성
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { SAMPLES } from './model.ts';
import { generate } from './build.ts';
import { renderPdfSvg2pdf } from './pdf-svg.ts';

const out = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(out, { recursive: true });
const FONT = process.env.KR_FONT ?? 'C:/Windows/Fonts/NanumGothic-Regular.ttf';
const font = new Uint8Array(readFileSync(FONT));

function runWorker(sheets: unknown): Promise<{ bytes: Uint8Array; ms: number; hasDocument: boolean }> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./pdf-worker.ts', import.meta.url), { workerData: { sheets, font } });
    w.once('message', res);
    w.once('error', rej);
  });
}

{
  for (const s of SAMPLES) {
    const g = generate(s.id);
    writeFileSync(`${out}${s.id}.dxf`, g.dxf, 'utf8');
    g.svgs.forEach((v, i) => writeFileSync(`${out}${s.id}-${i + 1}.svg`, v, 'utf8'));
    const w = await runWorker(g.sheets);
    writeFileSync(`${out}${s.id}.pdf`, w.bytes);
    console.log(`${s.id}: 대지 ${g.siteArea}㎡ 건축 ${g.bldArea}㎡ 건폐율 ${g.ratio}% | dxf ${g.dxf.length}B | worker pdf ${w.bytes.length}B ${w.ms}ms (worker document=${w.hasDocument})`);
    if (process.argv.includes('--svg2pdf')) {
      try {
        const t0 = performance.now();
        const b = await renderPdfSvg2pdf(g.sheets, font);
        writeFileSync(`${out}${s.id}.svg2pdf.pdf`, b);
        console.log(`  svg2pdf(jsdom): ${b.length}B ${Math.round(performance.now() - t0)}ms`);
      } catch (e) {
        console.log(`  svg2pdf(jsdom) 실패: ${(e as Error).message}`);
      }
    }
  }
}
