// DXF 작성기(D-20 (a), AR-F-038, 02_ARCHITECTURE.md 2.3절 "DXF 작성기"·"결정성 규칙").
// ASCII, $ACADVER=AC1027, UTF-8, 줄 끝 \r\n, $INSUNITS=4(mm). 구조는 AR-06-019 스파이크에서 AutoCAD 열기가 확인된 구성을 따른다.
// 좌표: 모델 공간 1:1(실제 mm). 첫 뷰의 모델 좌표를 그대로 두고, 용지 요소(도곽·표제란·용지 주석)는 축척 분모를 곱해 놓는다.
import { layerOrder, resolveLayerMap, type LayerMapWarning, type Linetype } from "../../layers/index.ts";
import { comparePrim } from "../../sheet/assemble.ts";
import { DraftingError } from "../../sheet/errors.ts";
import { PRIM_KINDS, type BlockDef, type Prim, type SheetModel, type Vec } from "../../sheet/types.ts";
import { assertDisclaimer } from "../../titleblock/index.ts";
import { GroupWriter, Handles, mtextChunks, mtextValue, nameValue, textValue, utf8Length } from "./format.ts";

/** 작성기 출력 형식 버전. 골든(packages/drafting/golden/writer-*)은 이 값을 올릴 때만 갱신한다(골든 테스트가 강제). */
export const DXF_WRITER_VERSION = "dxf-1.0.0";

/** 시트 1장 상한(02_ARCHITECTURE.md "크기"): 넘으면 too_large — 호출자가 저장 전에 막고 해치 단순화를 안내한다. */
export const DXF_MAX_BYTES = 20 * 1024 * 1024;

/** 기본 $TDCREATE·$TDUPDATE(율리우스일, 2000-01-01 12:00 UTC). 엔진은 시각을 읽지 않으므로 실제 값은 호출자가 넣는다. */
export const DXF_DEFAULT_JULIAN = 2451545;

export const TEXT_STYLE = "ARCH-KR";

export interface DxfFont {
  /** STYLE 그룹 3: TTF 파일 이름만(글꼴 파일은 넣지 않는다). */
  file: string;
  /** XDATA ACAD 1000: TrueType 패밀리 이름. */
  family: string;
}

/** AR-06-019 AutoCAD 확인 구성. DraftingProfile.font_family → TTF 대응표는 아직 없다(호출자가 넘긴다). */
export const DEFAULT_DXF_FONT: Readonly<DxfFont> = Object.freeze({ file: "malgun.ttf", family: "Malgun Gothic" });

export interface DxfOptions {
  /** DraftingProfile.layer_map(표준 이름 → 사무소 이름). DXF 작성기에서만 적용한다. */
  layer_map?: Readonly<Record<string, string>>;
  font?: DxfFont;
  /** 생성·갱신 시각(율리우스일). 이 두 값만 시각이고 골든 비교에서 가린다. */
  timestamps?: { created: number; updated: number };
}

export interface DxfResult {
  /** DXF 본문. 파일에는 UTF-8(BOM 없음)로 쓴다. */
  text: string;
  byte_length: number;
  too_large: boolean;
  layer_warnings: LayerMapWarning[];
}

/** 유닉스 시각(ms) → 율리우스일. 호출자가 시각을 읽어 timestamps로 넘길 때 쓴다. */
export function julianDate(epochMs: number): number {
  return epochMs / 86_400_000 + 2_440_587.5;
}

// 선 종류 패턴(용지 mm). $LTSCALE = 축척 분모라 모델에서는 분모배(1/200이면 600·300mm = 스파이크 확인값).
const LINETYPES: ReadonlyArray<[Linetype, string, number[]]> = [
  ["CONTINUOUS", "Solid line", []],
  ["DASHED", "Dashed __ __ __", [3, -1.5]],
  ["DASHDOT", "Dash dot __ . __ .", [3, -1, 0, -1]],
];

const KIND_ORDER: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(PRIM_KINDS.map((k, i) => [k, i])));
const SQRT1_2 = 0.7071067811865476;
/** ANSI31 기본 간격(acadiso.pat, mm). 패턴 배율 = 축척 분모 → 출력 용지에서 3.175mm. */
const ANSI31_SPACING = 3.175;

/** 모델 공간 배치: 점 이동량(mm)과 용지 길이 배율(0.01mm → mm × 분모). */
interface Place {
  dx: number;
  dy: number;
  /** 길이(반지름·좌표)에 곱한다: 뷰 1, 용지 k. */
  len: number;
}

interface Item {
  p: Prim<number>;
  place: Place;
  container: number;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function writeDxf(sheet: SheetModel, options: DxfOptions = {}): DxfResult {
  // 고지 확인은 출력 직전 필수(지우는 경로 0, AR-F-028).
  assertDisclaimer(sheet.paper_prims);

  const k = sheet.scale / 100; // 용지 0.01mm → 모델 mm 배율(분모가 100의 배수라 정수)
  if (!Number.isSafeInteger(k) || k <= 0) throw new DraftingError("INVALID_ARGUMENT", `축척이 올바르지 않습니다: ${sheet.scale}`);
  const ref: Vec<number> = sheet.views[0]?.origin ?? [0, 0];
  const paperPlace: Place = { dx: -ref[0] * k, dy: -ref[1] * k, len: k };
  const viewPlace = new Map<string, Place>();
  for (const v of sheet.views) viewPlace.set(v.view_id, { dx: (v.origin[0] - ref[0]) * k, dy: (v.origin[1] - ref[1]) * k, len: 1 });

  const font = options.font ?? DEFAULT_DXF_FONT;
  nameValue(font.file, "글꼴 파일");
  nameValue(font.family, "글꼴 패밀리");
  const ts = options.timestamps ?? { created: DXF_DEFAULT_JULIAN, updated: DXF_DEFAULT_JULIAN };
  const layers = resolveLayerMap(options.layer_map);
  // CAD는 레이어 이름을 대소문자 구분 없이 다룬다: 출력 표("0" 포함)에 대소문자 무시 중복이 있으면 안 된다(resolveLayerMap 불변식).
  const layerKeys = new Set<string>(["0"]);
  for (const l of layers.table) {
    const key = nameValue(l.name, "레이어").replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
    if (layerKeys.has(key)) throw new DraftingError("INVALID_ARGUMENT", `레이어 이름 중복(대소문자 무시): ${l.name}`);
    layerKeys.add(key);
  }

  // 순서: 레이어 표 순서 → 컨테이너(뷰 순서 → 주석 anno_id 순 → 용지 요소) → 엔티티 종류 → key.
  const items: Item[] = [];
  let container = 0;
  for (const v of sheet.views) {
    const place = viewPlace.get(v.view_id) as Place;
    for (const p of v.prims) items.push({ p, place, container });
    container++;
  }
  for (const a of [...sheet.annotations].sort((x, y) => cmpStr(x.anno_id, y.anno_id))) {
    let place = paperPlace;
    if (a.view_id !== undefined) {
      const vp = viewPlace.get(a.view_id);
      if (vp === undefined) throw new DraftingError("INVALID_ARGUMENT", `${a.anno_id}: 없는 뷰 ${a.view_id}`);
      place = vp;
    }
    for (const p of a.prims) items.push({ p, place, container });
    container++;
  }
  for (const p of sheet.paper_prims) items.push({ p, place: paperPlace, container });
  items.sort(
    (a, b) =>
      layerOrder(a.p.layer) - layerOrder(b.p.layer) ||
      a.container - b.container ||
      (KIND_ORDER[a.p.t] as number) - (KIND_ORDER[b.p.t] as number) ||
      cmpStr(a.p.key, b.p.key),
  );

  const blocks: BlockDef[] = [...sheet.blocks].sort((a, b) => cmpStr(a.name, b.name));
  const blockByName = new Map<string, BlockDef>();
  for (const b of blocks) {
    nameValue(b.name, "블록");
    if (b.name.startsWith("*")) throw new DraftingError("INVALID_ARGUMENT", `블록 이름은 *로 시작할 수 없습니다: ${b.name}`);
    blockByName.set(b.name, b);
  }

  // 범위: 용지 사각형 + 모든 엔티티 점.
  const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x: number, y: number) => {
    if (x < ext.x0) ext.x0 = x;
    if (y < ext.y0) ext.y0 = y;
    if (x > ext.x1) ext.x1 = x;
    if (y > ext.y1) ext.y1 = y;
  };
  const lim = { x0: paperPlace.dx, y0: paperPlace.dy, x1: sheet.paper.w * k + paperPlace.dx, y1: sheet.paper.h * k + paperPlace.dy };
  add(lim.x0, lim.y0);
  add(lim.x1, lim.y1);
  for (const it of items) collect(it.p, it.place, blockByName, add, []);

  const H = new Handles();
  const h = {
    vportT: H.next(),
    ltypeT: H.next(),
    layerT: H.next(),
    styleT: H.next(),
    viewT: H.next(),
    ucsT: H.next(),
    appidT: H.next(),
    dimT: H.next(),
    brT: H.next(),
    vport: H.next(),
    ltByBlock: H.next(),
    ltByLayer: H.next(),
    styStd: H.next(),
    styKr: H.next(),
    appid: H.next(),
    dimStd: H.next(),
    brModel: H.next(),
    brPaper: H.next(),
    rootDict: H.next(),
    dGroup: H.next(),
    dLayout: H.next(),
    dMline: H.next(),
    dPlotSet: H.next(),
    dPlotStyle: H.next(),
    plotNormal: H.next(),
    mlStd: H.next(),
    layModel: H.next(),
    layPaper: H.next(),
  };
  const ltH = new Map<Linetype, string>();
  for (const [name] of LINETYPES) ltH.set(name, H.next());
  const layerH: Array<[string, string]> = [["0", H.next()]];
  for (const l of layers.table) layerH.push([l.name, H.next()]);
  const brH = new Map<string, string>();
  for (const b of blocks) brH.set(b.name, H.next());

  const o = new GroupWriter();
  const sec = (name: string, body: () => void) => {
    o.g(0, "SECTION").g(2, name);
    body();
    o.g(0, "ENDSEC");
  };
  const tableHead = (name: string, handle: string, count: number) =>
    o.g(0, "TABLE").g(2, name).g(5, handle).g(330, "0").g(100, "AcDbSymbolTable").g(70, count);
  const rec = (type: string, handle: string, owner: string, sub: string) =>
    o.g(0, type).g(5, handle).g(330, owner).g(100, "AcDbSymbolTableRecord").g(100, sub);
  const textSize = 250 * k; // 2.5mm(용지)

  // ---------------- HEADER ----------------
  sec("HEADER", () => {
    o.g(9, "$ACADVER").g(1, "AC1027");
    o.g(9, "$ACADMAINTVER").g(70, 105);
    o.g(9, "$DWGCODEPAGE").g(3, "ANSI_949");
    o.g(9, "$INSBASE").g(10, 0).g(20, 0).g(30, 0);
    o.g(9, "$EXTMIN").g(10, ext.x0).g(20, ext.y0).g(30, 0);
    o.g(9, "$EXTMAX").g(10, ext.x1).g(20, ext.y1).g(30, 0);
    o.g(9, "$LIMMIN").g(10, lim.x0).g(20, lim.y0);
    o.g(9, "$LIMMAX").g(10, lim.x1).g(20, lim.y1);
    o.g(9, "$ORTHOMODE").g(70, 0);
    o.g(9, "$LTSCALE").g(40, sheet.scale);
    o.g(9, "$TEXTSIZE").g(40, textSize);
    o.g(9, "$TEXTSTYLE").g(7, TEXT_STYLE);
    o.g(9, "$CLAYER").g(8, "0");
    o.g(9, "$CELTYPE").g(6, "ByLayer");
    o.g(9, "$CECOLOR").g(62, 256);
    o.g(9, "$LUNITS").g(70, 2);
    o.g(9, "$LUPREC").g(70, 2);
    o.g(9, "$AUNITS").g(70, 0);
    o.g(9, "$AUPREC").g(70, 0);
    o.g(9, "$PDMODE").g(70, 0);
    o.g(9, "$PDSIZE").g(40, 0);
    o.g(9, "$TDCREATE").g(40, ts.created);
    o.g(9, "$TDUPDATE").g(40, ts.updated);
    o.g(9, "$MEASUREMENT").g(70, 1);
    o.g(9, "$INSUNITS").g(70, 4);
    o.g(9, "$DIMSTYLE").g(2, "Standard");
    o.g(9, "$HANDSEED").g(5, "@@SEED@@");
  });

  // ---------------- CLASSES (빈) ----------------
  sec("CLASSES", () => {});

  // ---------------- TABLES ----------------
  sec("TABLES", () => {
    tableHead("VPORT", h.vportT, 1);
    rec("VPORT", h.vport, h.vportT, "AcDbViewportTableRecord");
    o.g(2, "*Active").g(70, 0).g(10, 0).g(20, 0).g(11, 1).g(21, 1)
      .g(12, (ext.x0 + ext.x1) / 2).g(22, (ext.y0 + ext.y1) / 2)
      .g(13, 0).g(23, 0).g(14, 10).g(24, 10).g(15, 10).g(25, 10).g(16, 0).g(26, 0).g(36, 1).g(17, 0).g(27, 0).g(37, 0)
      .g(40, ext.y1 - ext.y0).g(41, 1.5).g(42, 50).g(43, 0).g(44, 0).g(50, 0).g(51, 0)
      .g(71, 0).g(72, 1000).g(73, 1).g(74, 3).g(75, 0).g(76, 0).g(77, 0).g(78, 0)
      .g(281, 0).g(65, 1).g(110, 0).g(120, 0).g(130, 0).g(111, 1).g(121, 0).g(131, 0).g(112, 0).g(122, 1).g(132, 0).g(79, 0).g(146, 0);
    o.g(0, "ENDTAB");

    tableHead("LTYPE", h.ltypeT, 2 + LINETYPES.length);
    const lt = (handle: string, name: string, desc: string, elems: number[]) => {
      rec("LTYPE", handle, h.ltypeT, "AcDbLinetypeTableRecord");
      o.g(2, name).g(70, 0).g(3, desc).g(72, 65).g(73, elems.length).g(40, elems.reduce((s, v) => s + Math.abs(v), 0));
      for (const v of elems) o.g(49, v).g(74, 0);
    };
    lt(h.ltByBlock, "ByBlock", "", []);
    lt(h.ltByLayer, "ByLayer", "", []);
    for (const [name, desc, elems] of LINETYPES) lt(ltH.get(name) as string, name, desc, elems);
    o.g(0, "ENDTAB");

    tableHead("LAYER", h.layerT, layerH.length);
    const layerRec = (handle: string, name: string, aci: number, lt: Linetype) => {
      rec("LAYER", handle, h.layerT, "AcDbLayerTableRecord");
      o.g(2, name).g(70, 0).g(62, aci).g(6, lt).g(290, 1).g(370, -3).g(390, h.plotNormal);
    };
    layerRec(layerH[0]?.[1] as string, "0", 7, "CONTINUOUS");
    layers.table.forEach((l, i) => layerRec(layerH[i + 1]?.[1] as string, l.name, l.aci, l.linetype));
    o.g(0, "ENDTAB");

    tableHead("STYLE", h.styleT, 2);
    rec("STYLE", h.styStd, h.styleT, "AcDbTextStyleTableRecord");
    o.g(2, "Standard").g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, textSize).g(3, "txt").g(4, "");
    rec("STYLE", h.styKr, h.styleT, "AcDbTextStyleTableRecord");
    o.g(2, TEXT_STYLE).g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, textSize).g(3, font.file).g(4, "");
    o.g(1001, "ACAD").g(1000, font.family).g(1071, 0);
    o.g(0, "ENDTAB");

    tableHead("VIEW", h.viewT, 0);
    o.g(0, "ENDTAB");
    tableHead("UCS", h.ucsT, 0);
    o.g(0, "ENDTAB");

    tableHead("APPID", h.appidT, 1);
    rec("APPID", h.appid, h.appidT, "AcDbRegAppTableRecord");
    o.g(2, "ACAD").g(70, 0);
    o.g(0, "ENDTAB");

    tableHead("DIMSTYLE", h.dimT, 1).g(100, "AcDbDimStyleTable").g(71, 1);
    o.g(0, "DIMSTYLE").g(105, h.dimStd).g(330, h.dimT).g(100, "AcDbSymbolTableRecord").g(100, "AcDbDimStyleTableRecord")
      .g(2, "Standard").g(70, 0).g(340, h.styKr);
    o.g(0, "ENDTAB");

    tableHead("BLOCK_RECORD", h.brT, 2 + blocks.length);
    const br = (handle: string, name: string, layout?: string) => {
      rec("BLOCK_RECORD", handle, h.brT, "AcDbBlockTableRecord");
      o.g(2, name);
      if (layout) o.g(340, layout);
      o.g(70, 0).g(280, 1).g(281, 0);
    };
    br(h.brModel, "*Model_Space", h.layModel);
    br(h.brPaper, "*Paper_Space", h.layPaper);
    for (const b of blocks) br(brH.get(b.name) as string, b.name);
    o.g(0, "ENDTAB");
  });

  // ---------------- 엔티티 ----------------
  const BLOCK_PLACE: Place = { dx: 0, dy: 0, len: 1 };
  const emit = (p: Prim<number>, place: Place, owner: string) => {
    const X = (v: Vec<number>) => v[0] * place.len + place.dx;
    const Y = (v: Vec<number>) => v[1] * place.len + place.dy;
    const head = (type: string, sub: string) =>
      o.g(0, type).g(5, H.next()).g(330, owner).g(100, "AcDbEntity").g(8, layers.names[p.layer]).g(100, sub);
    switch (p.t) {
      case "line":
        head("LINE", "AcDbLine").g(10, X(p.a)).g(20, Y(p.a)).g(30, 0).g(11, X(p.b)).g(21, Y(p.b)).g(31, 0);
        break;
      case "pline":
        head("LWPOLYLINE", "AcDbPolyline").g(90, p.pts.length).g(70, p.closed ? 1 : 0).g(43, 0);
        for (const v of p.pts) o.g(10, X(v)).g(20, Y(v));
        break;
      case "circle":
        head("CIRCLE", "AcDbCircle").g(10, X(p.c)).g(20, Y(p.c)).g(30, 0).g(40, p.r * place.len);
        break;
      case "arc":
        head("ARC", "AcDbCircle").g(10, X(p.c)).g(20, Y(p.c)).g(30, 0).g(40, p.r * place.len).g(100, "AcDbArc").g(50, p.a0).g(51, p.a1);
        break;
      case "text": {
        // 문자 높이는 항상 용지 0.01mm → 모델 mm(분모배).
        const align = p.align === "c" ? 1 : p.align === "r" ? 2 : 0;
        head("TEXT", "AcDbText").g(10, X(p.at)).g(20, Y(p.at)).g(30, 0).g(40, p.h * k).g(1, textValue(p.s)).g(7, TEXT_STYLE);
        if (align !== 0) o.g(72, align).g(11, X(p.at)).g(21, Y(p.at)).g(31, 0);
        o.g(100, "AcDbText");
        if (align !== 0) o.g(73, 0);
        break;
      }
      case "mtext": {
        head("MTEXT", "AcDbMText").g(10, X(p.at)).g(20, Y(p.at)).g(30, 0).g(40, p.h * k).g(41, p.width * k).g(71, 1).g(72, 5);
        const chunks = mtextChunks(mtextValue(p.s));
        chunks.forEach((c, i) => o.g(i === chunks.length - 1 ? 1 : 3, c));
        o.g(7, TEXT_STYLE);
        break;
      }
      case "hatch": {
        const solid = p.pattern === "SOLID";
        head("HATCH", "AcDbHatch").g(10, 0).g(20, 0).g(30, 0).g(210, 0).g(220, 0).g(230, 1)
          .g(2, p.pattern).g(70, solid ? 1 : 0).g(71, 0).g(91, p.loops.length);
        p.loops.forEach((loop, i) => {
          o.g(92, i === 0 ? 3 : 2).g(72, 0).g(73, 1).g(93, loop.length);
          for (const v of loop) o.g(10, X(v)).g(20, Y(v));
          o.g(97, 0);
        });
        o.g(75, 0).g(76, 1);
        if (!solid) {
          const d = ANSI31_SPACING * sheet.scale * SQRT1_2;
          o.g(52, 0).g(41, sheet.scale).g(77, 0).g(78, 1).g(53, 45).g(43, 0).g(44, 0).g(45, -d).g(46, d).g(79, 0);
        }
        o.g(98, 0);
        break;
      }
      case "insert":
        if (!blockByName.has(p.block)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 없는 블록 ${p.block}`);
        head("INSERT", "AcDbBlockReference").g(2, p.block).g(10, X(p.at)).g(20, Y(p.at)).g(30, 0);
        if (p.rot_deg !== 0) o.g(50, p.rot_deg);
        break;
    }
  };

  // ---------------- BLOCKS ----------------
  sec("BLOCKS", () => {
    const begin = (owner: string, name: string, paper: boolean) => {
      o.g(0, "BLOCK").g(5, H.next()).g(330, owner);
      if (paper) o.g(67, 1);
      o.g(100, "AcDbEntity").g(8, "0").g(100, "AcDbBlockBegin").g(2, name).g(70, 0).g(10, 0).g(20, 0).g(30, 0).g(3, name).g(1, "");
    };
    const end = (owner: string, paper: boolean) => {
      o.g(0, "ENDBLK").g(5, H.next()).g(330, owner);
      if (paper) o.g(67, 1);
      o.g(100, "AcDbEntity").g(8, "0").g(100, "AcDbBlockEnd");
    };
    begin(h.brModel, "*Model_Space", false);
    end(h.brModel, false);
    begin(h.brPaper, "*Paper_Space", true);
    end(h.brPaper, true);
    for (const b of blocks) {
      const owner = brH.get(b.name) as string;
      begin(owner, b.name, false);
      for (const e of [...b.entities].sort(comparePrim)) emit(e, BLOCK_PLACE, owner);
      end(owner, false);
    }
  });

  // ---------------- ENTITIES ----------------
  sec("ENTITIES", () => {
    for (const it of items) emit(it.p, it.place, h.brModel);
  });

  // ---------------- OBJECTS ----------------
  sec("OBJECTS", () => {
    const dict = (handle: string, owner: string, entries: Array<[string, string]>, hard: boolean) => {
      o.g(0, "DICTIONARY").g(5, handle).g(330, owner).g(100, "AcDbDictionary");
      if (hard) o.g(281, 1);
      for (const [key, v] of entries) o.g(3, key).g(350, v);
    };
    dict(
      h.rootDict,
      "0",
      [
        ["ACAD_GROUP", h.dGroup],
        ["ACAD_LAYOUT", h.dLayout],
        ["ACAD_MLINESTYLE", h.dMline],
        ["ACAD_PLOTSETTINGS", h.dPlotSet],
        ["ACAD_PLOTSTYLENAME", h.dPlotStyle],
      ],
      false,
    );
    dict(h.dGroup, h.rootDict, [], true);
    dict(h.dLayout, h.rootDict, [["Layout1", h.layPaper], ["Model", h.layModel]], true);
    dict(h.dMline, h.rootDict, [["Standard", h.mlStd]], true);
    dict(h.dPlotSet, h.rootDict, [], true);
    o.g(0, "ACDBDICTIONARYWDFLT").g(5, h.dPlotStyle).g(330, h.rootDict).g(100, "AcDbDictionary").g(281, 1)
      .g(3, "Normal").g(350, h.plotNormal).g(100, "AcDbDictionaryWithDefault").g(340, h.plotNormal);
    o.g(0, "ACDBPLACEHOLDER").g(5, h.plotNormal).g(330, h.dPlotStyle);
    o.g(0, "MLINESTYLE").g(5, h.mlStd).g(330, h.dMline).g(100, "AcDbMlineStyle").g(2, "Standard").g(70, 0).g(3, "").g(62, 256)
      .g(51, 90).g(52, 90).g(71, 2).g(49, 0.5).g(62, 256).g(6, "BYLAYER").g(49, -0.5).g(62, 256).g(6, "BYLAYER");
    const layout = (handle: string, name: string, tab: number, owner: string, plotFlags: number) => {
      o.g(0, "LAYOUT").g(5, handle).g(102, "{ACAD_REACTORS").g(330, h.dLayout).g(102, "}").g(330, h.dLayout)
        .g(100, "AcDbPlotSettings").g(1, "").g(2, "none_device").g(4, "").g(6, "")
        .g(40, 0).g(41, 0).g(42, 0).g(43, 0).g(44, 0).g(45, 0).g(46, 0).g(47, 0).g(48, 0).g(49, 0)
        .g(140, 0).g(141, 0).g(142, 1).g(143, 1)
        .g(70, plotFlags).g(72, 0).g(73, 0).g(74, 0).g(7, "").g(75, 16).g(147, 1).g(148, 0).g(149, 0)
        .g(100, "AcDbLayout").g(1, name).g(70, 1).g(71, tab)
        .g(10, 0).g(20, 0).g(11, sheet.paper.w / 100).g(21, sheet.paper.h / 100).g(12, 0).g(22, 0).g(32, 0)
        .g(14, ext.x0).g(24, ext.y0).g(34, 0).g(15, ext.x1).g(25, ext.y1).g(35, 0).g(146, 0)
        .g(13, 0).g(23, 0).g(33, 0).g(16, 1).g(26, 0).g(36, 0).g(17, 0).g(27, 1).g(37, 0).g(76, 0).g(330, owner);
    };
    layout(h.layModel, "Model", 0, h.brModel, 1024);
    layout(h.layPaper, "Layout1", 1, h.brPaper, 688);
  });

  o.g(0, "EOF");
  const seedAt = o.lines.indexOf("@@SEED@@");
  o.lines[seedAt] = H.seed();
  const text = o.lines.join("\r\n") + "\r\n";
  const byte_length = utf8Length(text);
  return { text, byte_length, too_large: byte_length > DXF_MAX_BYTES, layer_warnings: layers.warnings };
}

type Add = (x: number, y: number) => void;

/** 범위 계산용 점 수집. INSERT는 블록 정의를 90° 배수 회전·이동해 포함. 호는 원 전체 상자(보수적). */
function collect(p: Prim<number>, place: Place, blocks: ReadonlyMap<string, BlockDef>, add: Add, stack: readonly string[]): void {
  const pt = (v: Vec<number>) => add(v[0] * place.len + place.dx, v[1] * place.len + place.dy);
  switch (p.t) {
    case "line":
      pt(p.a);
      pt(p.b);
      break;
    case "pline":
      p.pts.forEach(pt);
      break;
    case "hatch":
      p.loops.forEach((l) => l.forEach(pt));
      break;
    case "arc":
    case "circle":
      pt([p.c[0] - p.r, p.c[1] - p.r]);
      pt([p.c[0] + p.r, p.c[1] + p.r]);
      break;
    case "text":
    case "mtext":
      pt(p.at);
      break;
    case "insert": {
      const def = blocks.get(p.block);
      if (def === undefined) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 없는 블록 ${p.block}`);
      if (stack.includes(p.block)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 블록 순환 ${[...stack, p.block].join(" → ")}`);
      const ox = p.at[0] * place.len + place.dx;
      const oy = p.at[1] * place.len + place.dy;
      const r = p.rot_deg;
      const inner: Add = (x, y) => {
        const [rx, ry] = r === 0 ? [x, y] : r === 90 ? [-y, x] : r === 180 ? [-x, -y] : [y, -x];
        add(ox + rx, oy + ry);
      };
      for (const e of def.entities) collect(e, { dx: 0, dy: 0, len: 1 }, blocks, inner, [...stack, p.block]);
      break;
    }
  }
}
