import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLES, twiceArea, fmt100, area100, type Pt } from '../src/model.ts';
import { generate } from '../src/build.ts';
import { renderPdfDirect } from '../src/pdf-direct.ts';

type Pair = [number, string];
function pairs(dxf: string): Pair[] {
  const l = dxf.split('\r\n');
  assert.equal(l.pop(), '', '마지막은 CRLF로 끝');
  const r: Pair[] = [];
  for (let i = 0; i < l.length; i += 2) r.push([Number(l[i]), l[i + 1]]);
  return r;
}
interface RawEnt { type: string; layer: string; g: Pair[] }
function entities(dxf: string): RawEnt[] {
  const p = pairs(dxf);
  const s = p.findIndex((x, i) => x[1] === 'ENTITIES' && p[i - 1]?.[1] === 'SECTION');
  const out: RawEnt[] = [];
  for (let i = s + 1; i < p.length && p[i][1] !== 'ENDSEC'; i++) {
    if (p[i][0] === 0) out.push({ type: p[i][1], layer: '', g: [] });
    else { const e = out[out.length - 1]; e.g.push(p[i]); if (p[i][0] === 8) e.layer = p[i][1]; }
  }
  return out;
}
const polyPts = (e: RawEnt): Pt[] => {
  const xs = e.g.filter((x) => x[0] === 10).map((x) => Number(x[1]));
  const ys = e.g.filter((x) => x[0] === 20).map((x) => Number(x[1]));
  return xs.map((x, i) => [x, ys[i]]);
};
const texts = (es: RawEnt[]) => es.filter((e) => e.type === 'TEXT').map((e) => e.g.find((x) => x[0] === 1)![1]);

for (const s of SAMPLES) {
  test(`${s.id}: DXF 읽어 계산한 면적 = 도면 표기`, () => {
    const g = generate(s.id);
    const es = entities(g.dxf);
    const site = es.filter((e) => e.layer === 'A-SITE-BNDY').map(polyPts);
    const mass = es.filter((e) => e.layer === 'A-MASS').map(polyPts);
    const areaPoly = es.filter((e) => e.type === 'LWPOLYLINE' && e.layer === 'A-AREA').map(polyPts);
    assert.equal(site.length, 2); // 시트 2장에 각 1개
    // DXF에서 다시 읽은 좌표로 독립 계산
    const siteM2 = fmt100(area100(twiceArea(site[0])));
    const bldM2 = fmt100(area100(twiceArea(areaPoly[0])));
    assert.equal(siteM2, g.siteArea);
    assert.equal(bldM2, g.bldArea);
    assert.equal(fmt100(area100(twiceArea(mass[0]))), bldM2);
    const t = texts(es);
    assert.ok(t.includes(`대지면적 ${siteM2}㎡`), '면적 산정도 대지면적 라벨');
    assert.ok(t.includes(`건축면적 ${bldM2}㎡`), '면적 산정도 건축면적 라벨');
    assert.ok(t.some((x) => x.includes(`대지면적 ${siteM2}㎡ / 건축면적 ${bldM2}㎡ / 건폐율 ${g.ratio}%`)), '표제란');
    // 건폐율 = 건축/대지 (0.01% 허용오차)
    const ratio = (Number(bldM2) / Number(siteM2)) * 100;
    assert.ok(Math.abs(ratio - Number(g.ratio)) <= 0.011, `${ratio} vs ${g.ratio}`);
    // 분해 치수 문자 = 대지 외곽 bbox
    const xs = site[0].map((p) => p[0]);
    assert.ok(t.includes(String(Math.max(...xs) - Math.min(...xs))), '가로 치수 문자');
  });

  test(`${s.id}: 같은 입력 2회 생성 바이트 동일(DXF·SVG·PDF)`, () => {
    const a = generate(s.id), b = generate(s.id);
    assert.equal(Buffer.compare(Buffer.from(a.dxf, 'utf8'), Buffer.from(b.dxf, 'utf8')), 0);
    assert.deepEqual(a.svgs, b.svgs);
    const font = new Uint8Array(readFileSync('C:/Windows/Fonts/NanumGothic-Regular.ttf'));
    const p1 = renderPdfDirect(a.sheets, font), p2 = renderPdfDirect(b.sheets, font);
    assert.equal(Buffer.compare(Buffer.from(p1), Buffer.from(p2)), 0, 'PDF 결정성');
    assert.equal(Buffer.from(p1.subarray(0, 5)).toString(), '%PDF-');
  });

  test(`${s.id}: DXF 구조·인코딩`, () => {
    const { dxf } = generate(s.id);
    assert.ok(!/(?<!\r)\n/.test(dxf), '줄 끝은 CRLF만');
    assert.ok(dxf.includes('AC1027') && dxf.includes('건축면적'));
    const p = pairs(dxf);
    const hs = p.findIndex((x) => x[1] === '$HANDSEED');
    const handles = p.filter((x, i) => (x[0] === 5 && i !== hs + 1) || x[0] === 105).map((x) => x[1]);
    assert.equal(new Set(handles).size, handles.length, '핸들 유일');
    const seed = parseInt(p[p.findIndex((x) => x[1] === '$HANDSEED') + 1][1], 16);
    assert.ok(handles.every((hh) => parseInt(hh, 16) < seed), '$HANDSEED가 최대 핸들보다 큼');
    const tables = p.filter((x, i) => x[0] === 2 && p[i - 1]?.[1] === 'TABLE').map((x) => x[1]);
    assert.deepEqual(tables, ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']);
    for (const b of ['DIMENSION', 'VIEWPORT']) assert.ok(!p.some((x) => x[0] === 0 && x[1] === b), `${b} 미사용`);
    assert.equal(p.at(-1)![1], 'EOF');
  });
}
