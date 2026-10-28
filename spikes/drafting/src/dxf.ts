// 자체 DXF 작성기(D-20 (a)). ASCII DXF, $ACADVER=AC1027, UTF-8, CRLF, 결정적(시각·난수 없음).
import { BLOCKS, LAYERS, type BlockDef, type Ent, type Pt } from './model.ts';

export interface DxfOptions {
  fontFile: string; // STYLE 12: TTF 파일 이름만 (글꼴 파일 미포함)
  fontFamily: string; // XDATA 1000: 글꼴 패밀리
  codepage: string;
}
export const DEFAULT_DXF: DxfOptions = { fontFile: 'malgun.ttf', fontFamily: 'Malgun Gothic', codepage: 'ANSI_949' };

const num = (n: number): string => {
  if (Object.is(n, -0)) n = 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
};
// 제어 문자 제거(탭 포함). TEXT는 한 줄.
const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, ' ');
// MTEXT: 서식 코드 미사용 → \ { } 이스케이프
const mtextEsc = (s: string): string => clean(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');

class Out {
  lines: string[] = [];
  g(code: number, v: string | number): this {
    this.lines.push(String(code).padStart(3, ' '), typeof v === 'number' ? num(v) : v);
    return this;
  }
}

class Handles {
  n = 1;
  next(): string { return (this.n++).toString(16).toUpperCase(); }
  seed(): string { return this.n.toString(16).toUpperCase(); }
}

export function writeDxf(blocks: BlockDef[], ents: Ent[], opt: DxfOptions = DEFAULT_DXF): string {
  const H = new Handles();
  // 구조 핸들 선할당
  const hRootDict = H.next();
  const h = {
    vportT: H.next(), ltypeT: H.next(), layerT: H.next(), styleT: H.next(), viewT: H.next(), ucsT: H.next(), appidT: H.next(), dimT: H.next(), brT: H.next(),
    vport: H.next(), appid: H.next(), dimStd: H.next(),
    ltByBlock: H.next(), ltByLayer: H.next(), ltCont: H.next(), ltDash: H.next(), ltDashDot: H.next(),
    styStd: H.next(), styKr: H.next(),
    brModel: H.next(), brPaper: H.next(),
    dGroup: H.next(), dLayout: H.next(), dMline: H.next(), dPlotSet: H.next(), dPlotStyle: H.next(), plotNormal: H.next(), mlStd: H.next(),
    layModel: H.next(), layPaper: H.next(),
    bModel: H.next(), bModelEnd: H.next(), bPaper: H.next(), bPaperEnd: H.next(),
  };
  const layerH = new Map<string, string>();
  layerH.set('0', H.next());
  for (const l of LAYERS) layerH.set(l.name, H.next());
  const brH = new Map<string, string>();
  for (const b of blocks) brH.set(b.name, H.next());
  const ltH: Record<string, string> = { CONTINUOUS: h.ltCont, DASHED: h.ltDash, DASHDOT: h.ltDashDot };

  // 모델 공간 범위
  const allPts: Pt[] = [];
  for (const e of ents) collect(e, allPts, blocks);
  const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

  const o = new Out();
  const sec = (name: string, f: () => void) => { o.g(0, 'SECTION').g(2, name); f(); o.g(0, 'ENDSEC'); };
  const tableHead = (name: string, handle: string, count: number, extra?: () => void) => {
    o.g(0, 'TABLE').g(2, name).g(5, handle).g(330, '0').g(100, 'AcDbSymbolTable').g(70, count);
    extra?.();
  };
  const rec = (type: string, handle: string, owner: string, sub: string) => {
    o.g(0, type).g(5, handle).g(330, owner).g(100, 'AcDbSymbolTableRecord').g(100, sub);
  };

  // ---------------- HEADER ----------------
  sec('HEADER', () => {
    o.g(9, '$ACADVER').g(1, 'AC1027');
    o.g(9, '$ACADMAINTVER').g(70, 105);
    o.g(9, '$DWGCODEPAGE').g(3, opt.codepage);
    o.g(9, '$INSBASE').g(10, 0).g(20, 0).g(30, 0);
    o.g(9, '$EXTMIN').g(10, minX).g(20, minY).g(30, 0);
    o.g(9, '$EXTMAX').g(10, maxX).g(20, maxY).g(30, 0);
    o.g(9, '$LIMMIN').g(10, 0).g(20, 0);
    o.g(9, '$LIMMAX').g(10, maxX).g(20, maxY);
    o.g(9, '$ORTHOMODE').g(70, 0);
    o.g(9, '$LTSCALE').g(40, 1);
    o.g(9, '$TEXTSIZE').g(40, 600);
    o.g(9, '$TEXTSTYLE').g(7, 'ARCH-KR');
    o.g(9, '$CLAYER').g(8, '0');
    o.g(9, '$CELTYPE').g(6, 'ByLayer');
    o.g(9, '$CECOLOR').g(62, 256);
    o.g(9, '$LUNITS').g(70, 2);
    o.g(9, '$LUPREC').g(70, 2);
    o.g(9, '$AUNITS').g(70, 0);
    o.g(9, '$AUPREC').g(70, 0);
    o.g(9, '$PDMODE').g(70, 0);
    o.g(9, '$PDSIZE').g(40, 0);
    o.g(9, '$MEASUREMENT').g(70, 1);
    o.g(9, '$INSUNITS').g(70, 4);
    o.g(9, '$DIMSTYLE').g(2, 'Standard');
    o.g(9, '$HANDSEED').g(5, '@@SEED@@');
  });

  // ---------------- CLASSES (빈) ----------------
  sec('CLASSES', () => {});

  // ---------------- TABLES ----------------
  sec('TABLES', () => {
    // VPORT
    tableHead('VPORT', h.vportT, 1);
    rec('VPORT', h.vport, h.vportT, 'AcDbViewportTableRecord');
    o.g(2, '*Active').g(70, 0).g(10, 0).g(20, 0).g(11, 1).g(21, 1).g(12, (minX + maxX) / 2).g(22, (minY + maxY) / 2)
      .g(13, 0).g(23, 0).g(14, 10).g(24, 10).g(15, 10).g(25, 10).g(16, 0).g(26, 0).g(36, 1).g(17, 0).g(27, 0).g(37, 0)
      .g(40, maxY - minY).g(41, 1.5).g(42, 50).g(43, 0).g(44, 0).g(50, 0).g(51, 0).g(71, 0).g(72, 1000).g(73, 1).g(74, 3).g(75, 0).g(76, 0).g(77, 0).g(78, 0)
      .g(281, 0).g(65, 1).g(110, 0).g(120, 0).g(130, 0).g(111, 1).g(121, 0).g(131, 0).g(112, 0).g(122, 1).g(132, 0).g(79, 0).g(146, 0);
    o.g(0, 'ENDTAB');

    // LTYPE
    tableHead('LTYPE', h.ltypeT, 5);
    const lt = (handle: string, name: string, desc: string, elems: number[]) => {
      rec('LTYPE', handle, h.ltypeT, 'AcDbLinetypeTableRecord');
      o.g(2, name).g(70, 0).g(3, desc).g(72, 65).g(73, elems.length).g(40, elems.reduce((s, v) => s + Math.abs(v), 0));
      for (const v of elems) o.g(49, v).g(74, 0);
    };
    lt(h.ltByBlock, 'ByBlock', '', []);
    lt(h.ltByLayer, 'ByLayer', '', []);
    lt(h.ltCont, 'CONTINUOUS', 'Solid line', []);
    lt(h.ltDash, 'DASHED', 'Dashed __ __ __', [600, -300]);
    lt(h.ltDashDot, 'DASHDOT', 'Dash dot __ . __ .', [600, -200, 0, -200]);
    o.g(0, 'ENDTAB');

    // LAYER
    tableHead('LAYER', h.layerT, LAYERS.length + 1);
    const layerRec = (name: string, aci: number, ltName: string) => {
      rec('LAYER', layerH.get(name)!, h.layerT, 'AcDbLayerTableRecord');
      o.g(2, name).g(70, 0).g(62, aci).g(6, ltName).g(290, 1).g(370, -3).g(390, h.plotNormal);
    };
    layerRec('0', 7, 'CONTINUOUS');
    for (const l of LAYERS) layerRec(l.name, l.aci, l.lt);
    o.g(0, 'ENDTAB');

    // STYLE: Standard + ARCH-KR(한글 TTF 이름만 참조)
    tableHead('STYLE', h.styleT, 2);
    rec('STYLE', h.styStd, h.styleT, 'AcDbTextStyleTableRecord');
    o.g(2, 'Standard').g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, 600).g(3, 'txt').g(4, '');
    rec('STYLE', h.styKr, h.styleT, 'AcDbTextStyleTableRecord');
    o.g(2, 'ARCH-KR').g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, 600).g(3, opt.fontFile).g(4, '');
    o.g(1001, 'ACAD').g(1000, opt.fontFamily).g(1071, 0);
    o.g(0, 'ENDTAB');

    // VIEW, UCS (빈)
    tableHead('VIEW', h.viewT, 0); o.g(0, 'ENDTAB');
    tableHead('UCS', h.ucsT, 0); o.g(0, 'ENDTAB');

    // APPID
    tableHead('APPID', h.appidT, 1);
    rec('APPID', h.appid, h.appidT, 'AcDbRegAppTableRecord');
    o.g(2, 'ACAD').g(70, 0);
    o.g(0, 'ENDTAB');

    // DIMSTYLE (최소)
    tableHead('DIMSTYLE', h.dimT, 1, () => o.g(100, 'AcDbDimStyleTable').g(71, 1));
    o.g(0, 'DIMSTYLE').g(105, h.dimStd).g(330, h.dimT).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbDimStyleTableRecord')
      .g(2, 'Standard').g(70, 0).g(340, h.styKr);
    o.g(0, 'ENDTAB');

    // BLOCK_RECORD
    tableHead('BLOCK_RECORD', h.brT, 2 + blocks.length);
    const br = (handle: string, name: string, layout?: string) => {
      rec('BLOCK_RECORD', handle, h.brT, 'AcDbBlockTableRecord');
      o.g(2, name);
      if (layout) o.g(340, layout);
      o.g(70, 0).g(280, 1).g(281, 0);
    };
    br(h.brModel, '*Model_Space', h.layModel);
    br(h.brPaper, '*Paper_Space', h.layPaper);
    for (const b of blocks) br(brH.get(b.name)!, b.name);
    o.g(0, 'ENDTAB');
  });

  // ---------------- 엔티티 출력 ----------------
  const emit = (e: Ent, owner: string, paper = false) => {
    const head = (type: string, sub: string) => {
      o.g(0, type).g(5, H.next()).g(330, owner);
      if (paper) o.g(67, 1);
      o.g(100, 'AcDbEntity').g(8, e.layer);
      if (e.t === 'HATCH') o.g(62, e.color);
      o.g(100, sub);
    };
    switch (e.t) {
      case 'LINE':
        head('LINE', 'AcDbLine'); o.g(10, e.a[0]).g(20, e.a[1]).g(30, 0).g(11, e.b[0]).g(21, e.b[1]).g(31, 0); break;
      case 'LWPOLYLINE':
        head('LWPOLYLINE', 'AcDbPolyline'); o.g(90, e.pts.length).g(70, e.closed ? 1 : 0).g(43, 0);
        for (const p of e.pts) o.g(10, p[0]).g(20, p[1]);
        break;
      case 'CIRCLE':
        head('CIRCLE', 'AcDbCircle'); o.g(10, e.c[0]).g(20, e.c[1]).g(30, 0).g(40, e.r); break;
      case 'ARC':
        head('ARC', 'AcDbCircle'); o.g(10, e.c[0]).g(20, e.c[1]).g(30, 0).g(40, e.r).g(100, 'AcDbArc').g(50, e.a0).g(51, e.a1); break;
      case 'TEXT': {
        head('TEXT', 'AcDbText');
        o.g(10, e.p[0]).g(20, e.p[1]).g(30, 0).g(40, e.h).g(1, clean(e.s)).g(7, 'ARCH-KR');
        if (e.anchor === 'c') o.g(72, 1).g(11, e.p[0]).g(21, e.p[1]).g(31, 0);
        o.g(100, 'AcDbText');
        if (e.anchor === 'c') o.g(73, 0);
        break;
      }
      case 'MTEXT':
        head('MTEXT', 'AcDbMText');
        o.g(10, e.p[0]).g(20, e.p[1]).g(30, 0).g(40, e.h).g(41, e.w).g(71, 1).g(72, 5)
          .g(1, e.lines.map(mtextEsc).join('\\P')).g(7, 'ARCH-KR');
        break;
      case 'HATCH':
        head('HATCH', 'AcDbHatch');
        o.g(10, 0).g(20, 0).g(30, 0).g(210, 0).g(220, 0).g(230, 1).g(2, 'SOLID').g(70, 1).g(71, 0).g(91, 1)
          .g(92, 3).g(72, 0).g(73, 1).g(93, e.pts.length);
        for (const p of e.pts) o.g(10, p[0]).g(20, p[1]);
        o.g(97, 0).g(75, 0).g(76, 1).g(98, 0);
        break;
      case 'INSERT':
        head('INSERT', 'AcDbBlockReference'); o.g(2, e.block).g(10, e.p[0]).g(20, e.p[1]).g(30, 0); break;
    }
  };

  // ---------------- BLOCKS ----------------
  sec('BLOCKS', () => {
    const begin = (handle: string, owner: string, name: string, paper: boolean) => {
      o.g(0, 'BLOCK').g(5, handle).g(330, owner);
      if (paper) o.g(67, 1);
      o.g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockBegin').g(2, name).g(70, 0).g(10, 0).g(20, 0).g(30, 0).g(3, name).g(1, '');
    };
    const end = (handle: string, owner: string, paper: boolean) => {
      o.g(0, 'ENDBLK').g(5, handle).g(330, owner);
      if (paper) o.g(67, 1);
      o.g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockEnd');
    };
    begin(h.bModel, h.brModel, '*Model_Space', false);
    end(h.bModelEnd, h.brModel, false);
    begin(h.bPaper, h.brPaper, '*Paper_Space', true);
    end(h.bPaperEnd, h.brPaper, true);
    for (const b of blocks) {
      const owner = brH.get(b.name)!;
      begin(H.next(), owner, b.name, false);
      for (const e of b.ents) emit(e, owner);
      end(H.next(), owner, false);
    }
  });

  // ---------------- ENTITIES ----------------
  sec('ENTITIES', () => { for (const e of ents) emit(e, h.brModel); });

  // ---------------- OBJECTS (루트 사전 최소 + 레이아웃) ----------------
  sec('OBJECTS', () => {
    const dict = (handle: string, owner: string, entries: [string, string][], hard = false) => {
      o.g(0, 'DICTIONARY').g(5, handle).g(330, owner).g(100, 'AcDbDictionary');
      if (hard) o.g(281, 1);
      for (const [k, v] of entries) o.g(3, k).g(350, v);
    };
    dict(hRootDict, '0', [['ACAD_GROUP', h.dGroup], ['ACAD_LAYOUT', h.dLayout], ['ACAD_MLINESTYLE', h.dMline], ['ACAD_PLOTSETTINGS', h.dPlotSet], ['ACAD_PLOTSTYLENAME', h.dPlotStyle]]);
    dict(h.dGroup, hRootDict, [], true);
    dict(h.dLayout, hRootDict, [['Layout1', h.layPaper], ['Model', h.layModel]], true);
    dict(h.dMline, hRootDict, [['Standard', h.mlStd]], true);
    dict(h.dPlotSet, hRootDict, [], true);
    o.g(0, 'ACDBDICTIONARYWDFLT').g(5, h.dPlotStyle).g(330, hRootDict).g(100, 'AcDbDictionary').g(281, 1).g(3, 'Normal').g(350, h.plotNormal)
      .g(100, 'AcDbDictionaryWithDefault').g(340, h.plotNormal);
    o.g(0, 'ACDBPLACEHOLDER').g(5, h.plotNormal).g(330, h.dPlotStyle);
    o.g(0, 'MLINESTYLE').g(5, h.mlStd).g(330, h.dMline).g(100, 'AcDbMlineStyle').g(2, 'Standard').g(70, 0).g(3, '').g(62, 256)
      .g(51, 90).g(52, 90).g(71, 2).g(49, 0.5).g(62, 256).g(6, 'BYLAYER').g(49, -0.5).g(62, 256).g(6, 'BYLAYER');
    const layout = (handle: string, name: string, tab: number, br: string, plotFlags: number) => {
      o.g(0, 'LAYOUT').g(5, handle).g(102, '{ACAD_REACTORS').g(330, h.dLayout).g(102, '}').g(330, h.dLayout)
        .g(100, 'AcDbPlotSettings').g(1, '').g(2, 'none_device').g(4, '').g(6, '')
        .g(40, 0).g(41, 0).g(42, 0).g(43, 0).g(44, 0).g(45, 0).g(46, 0).g(47, 0).g(48, 0).g(49, 0).g(140, 0).g(141, 0).g(142, 1).g(143, 1)
        .g(70, plotFlags).g(72, 0).g(73, 0).g(74, 0).g(7, '').g(75, 16).g(147, 1).g(148, 0).g(149, 0)
        .g(100, 'AcDbLayout').g(1, name).g(70, 1).g(71, tab)
        .g(10, 0).g(20, 0).g(11, 420).g(21, 297).g(12, 0).g(22, 0).g(32, 0)
        .g(14, minX).g(24, minY).g(34, 0).g(15, maxX).g(25, maxY).g(35, 0).g(146, 0)
        .g(13, 0).g(23, 0).g(33, 0).g(16, 1).g(26, 0).g(36, 0).g(17, 0).g(27, 1).g(37, 0).g(76, 0).g(330, br);
    };
    layout(h.layModel, 'Model', 0, h.brModel, 1024);
    layout(h.layPaper, 'Layout1', 1, h.brPaper, 688);
  });

  o.g(0, 'EOF');
  return o.lines.join('\r\n').replace('@@SEED@@', H.seed()) + '\r\n';
}

function collect(e: Ent, out: Pt[], blocks: BlockDef[]): void {
  switch (e.t) {
    case 'LINE': out.push(e.a, e.b); break;
    case 'LWPOLYLINE': case 'HATCH': out.push(...e.pts); break;
    case 'CIRCLE': case 'ARC': out.push([e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]); break;
    case 'TEXT': case 'MTEXT': out.push(e.p); break;
    case 'INSERT': {
      const b = blocks.find((x) => x.name === e.block);
      if (!b) throw new Error(`블록 없음: ${e.block}`);
      const tmp: Pt[] = [];
      for (const be of b.ents) collect(be, tmp, blocks);
      for (const p of tmp) out.push([p[0] + e.p[0], p[1] + e.p[1]]);
      break;
    }
  }
}
export { BLOCKS };
