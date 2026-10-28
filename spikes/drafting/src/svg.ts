// 모델 → SVG (시트 1장). y축 반전. INSERT는 블록을 펼쳐 그린다(svg2pdf <use> 의존 회피).
import { A3, BLOCKS, LAYERS, SCALE, type BlockDef, type Ent, type Sheet } from './model.ts';

const ACI: Record<number, string> = { 1: '#ff0000', 2: '#c8a000', 3: '#00a000', 4: '#00a0c8', 5: '#0000ff', 6: '#c000c0', 7: '#000000', 8: '#808080', 9: '#b0b0b0' };
export const aciHex = (n: number): string => ACI[n] ?? '#000000';
const DASH: Record<string, string> = { CONTINUOUS: '', DASHED: '600 300', DASHDOT: '600 200 50 200' };
const f = (n: number): string => String(Math.round(n * 1000) / 1000);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const SVG_FONT_FAMILY = 'NanumGothic';

export function layerStyle(layer: string): { color: string; dash: string } {
  const l = LAYERS.find((x) => x.name === layer);
  return { color: aciHex(l?.aci ?? 7), dash: DASH[l?.lt ?? 'CONTINUOUS'] };
}

function expand(e: Ent, blocks: BlockDef[]): Ent[] {
  if (e.t !== 'INSERT') return [e];
  const b = blocks.find((x) => x.name === e.block)!;
  const [dx, dy] = e.p;
  return b.ents.flatMap((be) => expand(be, blocks)).map((be): Ent => {
    const P = (p: [number, number]): [number, number] => [p[0] + dx, p[1] + dy];
    switch (be.t) {
      case 'LINE': return { ...be, a: P(be.a), b: P(be.b) };
      case 'LWPOLYLINE': case 'HATCH': return { ...be, pts: be.pts.map(P) };
      case 'ARC': case 'CIRCLE': return { ...be, c: P(be.c) };
      case 'TEXT': case 'MTEXT': case 'INSERT': return { ...be, p: P(be.p) };
    }
  });
}

export function flatten(ents: Ent[], blocks: BlockDef[] = BLOCKS): Ent[] {
  return ents.flatMap((e) => expand(e, blocks));
}

export function sheetToSvg(sheet: Sheet, blocks: BlockDef[] = BLOCKS): string {
  const H = A3[1];
  const X = (x: number) => f(x - sheet.ox);
  const Y = (y: number) => f(H - y);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${A3[0] / SCALE}mm" height="${A3[1] / SCALE}mm" viewBox="0 0 ${A3[0]} ${A3[1]}">`);
  out.push(`<rect x="0" y="0" width="${A3[0]}" height="${A3[1]}" fill="#ffffff"/>`);
  for (const e of flatten(sheet.ents, blocks)) {
    const { color, dash } = layerStyle(e.layer);
    const sw = e.layer === 'A-TTLB' ? 70 : 40;
    const stroke = `fill="none" stroke="${color}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}`;
    const id = `data-layer="${e.layer}"`;
    switch (e.t) {
      case 'LINE':
        out.push(`<line ${id} x1="${X(e.a[0])}" y1="${Y(e.a[1])}" x2="${X(e.b[0])}" y2="${Y(e.b[1])}" ${stroke}/>`); break;
      case 'LWPOLYLINE':
        out.push(`<${e.closed ? 'polygon' : 'polyline'} ${id} points="${e.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}" ${stroke}/>`); break;
      case 'CIRCLE':
        out.push(`<circle ${id} cx="${X(e.c[0])}" cy="${Y(e.c[1])}" r="${e.r}" ${stroke}/>`); break;
      case 'ARC': {
        const rad = (d: number) => (d * Math.PI) / 180;
        const sx = e.c[0] + e.r * Math.cos(rad(e.a0)), sy = e.c[1] + e.r * Math.sin(rad(e.a0));
        const ex = e.c[0] + e.r * Math.cos(rad(e.a1)), ey = e.c[1] + e.r * Math.sin(rad(e.a1));
        const span = (((e.a1 - e.a0) % 360) + 360) % 360;
        out.push(`<path ${id} d="M ${X(sx)} ${Y(sy)} A ${e.r} ${e.r} 0 ${span > 180 ? 1 : 0} 0 ${X(ex)} ${Y(ey)}" ${stroke}/>`);
        break;
      }
      case 'HATCH':
        out.push(`<polygon ${id} points="${e.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="${aciHex(e.color)}" fill-opacity="0.25" stroke="none"/>`); break;
      case 'TEXT':
        out.push(`<text ${id} x="${X(e.p[0])}" y="${Y(e.p[1])}" font-family="${SVG_FONT_FAMILY}" font-size="${f(e.h * 1.2)}" fill="${color}"${e.anchor === 'c' ? ' text-anchor="middle"' : ''}>${esc(e.s)}</text>`); break;
      case 'MTEXT': {
        const fs = e.h * 1.2;
        const tspans = e.lines.map((l, i) => `<tspan x="${X(e.p[0])}" dy="${i === 0 ? 0 : f(fs * 1.4)}">${esc(l)}</tspan>`).join('');
        out.push(`<text ${id} x="${X(e.p[0])}" y="${Y(e.p[1])}" font-family="${SVG_FONT_FAMILY}" font-size="${f(fs)}" fill="${color}">${tspans}</text>`);
        break;
      }
      case 'INSERT': break;
    }
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}
