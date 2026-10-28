// 방식 B: 모델 → jsPDF 직접 그리기. DOM 불필요 → Web Worker에서 동작 가능.
import { jsPDF } from 'jspdf';
import { A3, BLOCKS, SCALE, type BlockDef, type Sheet } from './model.ts';
import { aciHex, flatten, layerStyle } from './svg.ts';

export function toBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function makeDoc(fontBytes: Uint8Array): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: false });
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1)));
  doc.setFileId('00000000000000000000000000000000');
  doc.addFileToVFS('NanumGothic-Regular.ttf', toBase64(fontBytes));
  doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
  doc.setFont('NanumGothic', 'normal');
  return doc;
}

export function renderPdfDirect(sheets: Sheet[], fontBytes: Uint8Array, blocks: BlockDef[] = BLOCKS): Uint8Array {
  const doc = makeDoc(fontBytes);
  const k = 1 / SCALE; // 모델 mm → 용지 mm
  sheets.forEach((sheet, idx) => {
    if (idx > 0) doc.addPage('a3', 'landscape');
    const X = (x: number) => (x - sheet.ox) * k;
    const Y = (y: number) => (A3[1] - y) * k;
    for (const e of flatten(sheet.ents, blocks)) {
      const { color, dash } = layerStyle(e.layer);
      doc.setDrawColor(...rgb(color));
      doc.setTextColor(...rgb(color));
      doc.setLineWidth(e.layer === 'A-TTLB' ? 0.35 : 0.2);
      doc.setLineDashPattern(dash ? dash.split(' ').map((v) => Number(v) * k) : [], 0);
      switch (e.t) {
        case 'LINE': doc.line(X(e.a[0]), Y(e.a[1]), X(e.b[0]), Y(e.b[1])); break;
        case 'LWPOLYLINE': {
          const pts = e.closed ? [...e.pts, e.pts[0]] : e.pts;
          for (let i = 0; i < pts.length - 1; i++) doc.line(X(pts[i][0]), Y(pts[i][1]), X(pts[i + 1][0]), Y(pts[i + 1][1]));
          break;
        }
        case 'CIRCLE': doc.circle(X(e.c[0]), Y(e.c[1]), e.r * k, 'S'); break;
        case 'ARC': {
          const n = 24;
          let px = 0, py = 0;
          for (let i = 0; i <= n; i++) {
            const a = ((e.a0 + ((e.a1 - e.a0) * i) / n) * Math.PI) / 180;
            const x = X(e.c[0] + e.r * Math.cos(a)), y = Y(e.c[1] + e.r * Math.sin(a));
            if (i > 0) doc.line(px, py, x, y);
            px = x; py = y;
          }
          break;
        }
        case 'HATCH': {
          doc.setFillColor(...rgb(aciHex(e.color)));
          doc.saveGraphicsState();
          doc.setGState(doc.GState({ opacity: 0.25 }));
          const p = e.pts.map((q) => [X(q[0]), Y(q[1])]);
          const rel = p.slice(1).map((q, i) => [q[0] - p[i][0], q[1] - p[i][1]]);
          doc.lines(rel, p[0][0], p[0][1], [1, 1], 'F', true);
          doc.restoreGraphicsState();
          break;
        }
        case 'TEXT':
          doc.setFontSize((e.h * 1.2 * k) / 0.3528);
          doc.text(e.s, X(e.p[0]), Y(e.p[1]), e.anchor === 'c' ? { align: 'center' } : undefined);
          break;
        case 'MTEXT': {
          const fs = e.h * 1.2 * k;
          doc.setFontSize(fs / 0.3528);
          e.lines.forEach((l, i) => doc.text(l, X(e.p[0]), Y(e.p[1]) + i * fs * 1.4));
          break;
        }
        case 'INSERT': break;
      }
    }
  });
  return new Uint8Array(doc.output('arraybuffer'));
}
