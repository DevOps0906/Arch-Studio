// 방식 A: SVG → svg2pdf.js → jsPDF. svg2pdf.js는 브라우저 DOM이 필요 → Node에서는 jsdom으로 시험.
import { JSDOM } from 'jsdom';
import type { Sheet } from './model.ts';
import { sheetToSvg } from './svg.ts';
import { makeDoc } from './pdf-direct.ts';

export async function renderPdfSvg2pdf(sheets: Sheet[], fontBytes: Uint8Array): Promise<Uint8Array> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.SVGElement = dom.window.SVGElement;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  (dom.window.SVGElement.prototype as unknown as { getBBox: () => object }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }); // jsdom 미구현 → 스텁
  const { svg2pdf } = await import('svg2pdf.js/dist/svg2pdf.es.min.js');
  const doc = makeDoc(fontBytes);
  for (let i = 0; i < sheets.length; i++) {
    if (i > 0) doc.addPage('a3', 'landscape');
    const svgDoc = new dom.window.DOMParser().parseFromString(sheetToSvg(sheets[i]), 'image/svg+xml');
    await svg2pdf(svgDoc.documentElement as unknown as Element, doc, { x: 0, y: 0, width: 420, height: 297 });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
