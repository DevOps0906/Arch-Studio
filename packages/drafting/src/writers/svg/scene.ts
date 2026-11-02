// SheetModel → 장면(SVG·PDF 공용, D-23 권고 "같은 flatten·레이어 스타일 표 공유"). 결정적 순수 함수.
// 좌표: "시트 좌표" S = 용지 왼쪽 아래 원점, y 위쪽, 단위 모델 mm(용지 0.01mm × 축척 분모/100).
// DXF 작성기와 같은 규약이다: DXF 모델 좌표 = S − 첫 뷰 원점 × k(평행 이동만 다름). 뷰 형상은 모델 mm 그대로 + 뷰 원점 × k,
// 용지 요소(도곽·표제란·용지 주석)는 × k. 문자 높이는 항상 용지 0.01mm × k. SVG는 y를 뒤집고, PDF는 다시 축척 분모로 나눠 용지 mm로 쓴다.
// INSERT는 블록 정의를 펼친다(SVG <use>는 정화기가 지우는 경우가 많아 쓰지 않는다). 펼친 엔티티는 자기 레이어 그룹에 들어간다(DXF와 같음).
import type { StdLayer } from "@arch-studio/domain";
import { LAYER_TABLE, layerOrder, ON_DEMAND_LAYERS } from "../../layers/index.ts";
import { comparePrim } from "../../sheet/assemble.ts";
import { DraftingError } from "../../sheet/errors.ts";
import { PRIM_KINDS, type BlockDef, type Prim, type SheetModel, type Vec } from "../../sheet/types.ts";
import { advanceOf, type FontMetrics } from "../pdf/metrics.ts";
import { cleanLine, cleanLines } from "./format.ts";
import { TEXT_EM_PER_HEIGHT } from "./style.ts";

export type Pt = readonly [number, number];

export type SceneItem =
  | { t: "line"; a: Pt; b: Pt }
  | { t: "pline"; pts: Pt[]; closed: boolean }
  | { t: "circle"; c: Pt; r: number }
  /** 각도: 도, 반시계(y 위쪽), [0, 360)으로 정규화. a0 → a1 반시계. */
  | { t: "arc"; c: Pt; r: number; a0: number; a1: number }
  /** size: 문자 높이(모델 단위). rot: 반시계 도(블록 회전에서만 0이 아님). */
  | { t: "text"; at: Pt; size: number; s: string; align: "l" | "c" | "r"; rot: number }
  /** at = 왼쪽 위(DXF MTEXT 부착점 1). 줄 간격 = size × MTEXT_LINE_PITCH. lines = 명시 줄바꿈 + 폭(width) 줄바꿈(wrapLine) 결과. */
  | { t: "mtext"; at: Pt; size: number; lines: string[]; rot: number }
  /** loops[0] 바깥, 나머지 구멍(짝홀 규칙). ANSI31은 segs(45° 평행선 조각)를 그리고 채우지 않는다. */
  | { t: "hatch"; pattern: "SOLID"; loops: Pt[][] }
  | { t: "hatch"; pattern: "ANSI31"; loops: Pt[][]; segs: Array<[Pt, Pt]> };

export interface SceneLayer {
  layer: StdLayer;
  items: SceneItem[];
}

export interface Scene {
  /** 용지 크기(모델 단위) = paper × k. */
  w: number;
  h: number;
  /** 축척 분모. 용지 mm = 모델 단위 / scale. */
  scale: number;
  /** 표준 레이어 16개 전부, 레이어 표 순서(빈 레이어 포함). */
  layers: SceneLayer[];
}

/** MTEXT 줄 간격 배율(DXF 줄 간격 계수 1 = 문자 높이의 5/3). */
export const MTEXT_LINE_PITCH = 5 / 3;
/** ANSI31 간격(용지 mm, acadiso.pat). DXF 작성기와 같은 값. */
export const ANSI31_SPACING_MM = 3.175;
/** 해치 한 개의 ANSI31 선 수 상한(잘못된 입력으로 출력이 폭발하지 않게). */
export const MAX_HATCH_LINES = 100_000;

const KIND_ORDER: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(PRIM_KINDS.map((k, i) => [k, i])));
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const norm360 = (a: number) => {
  const v = a % 360;
  return v < 0 ? v + 360 : v + 0;
};

/** 점 변환: S = o + R(rot)·(p × len). rot은 0·90·180·270만(정확한 정수 회전). */
interface Xf {
  ox: number;
  oy: number;
  len: number;
  rot: number;
}

function apply(x: Xf, v: Vec<number>): Pt {
  const px = v[0] * x.len;
  const py = v[1] * x.len;
  const [rx, ry] = x.rot === 0 ? [px, py] : x.rot === 90 ? [-py, px] : x.rot === 180 ? [-px, -py] : [py, -px];
  return [x.ox + rx + 0, x.oy + ry + 0];
}

interface Item {
  p: Prim<number>;
  xf: Xf;
  container: number;
}

export interface SceneOptions {
  /** MTEXT 폭 줄바꿈에 쓰는 글꼴 폭 표. 없으면 근사 폭(approxEm). */
  metrics?: FontMetrics;
}

export function buildScene(sheet: SheetModel, options: SceneOptions = {}): Scene {
  const k = sheet.scale / 100;
  if (!Number.isSafeInteger(k) || k <= 0) throw new DraftingError("INVALID_ARGUMENT", `축척이 올바르지 않습니다: ${sheet.scale}`);
  const paperXf: Xf = { ox: 0, oy: 0, len: k, rot: 0 };
  const viewXf = new Map<string, Xf>();
  for (const v of sheet.views) viewXf.set(v.view_id, { ox: v.origin[0] * k, oy: v.origin[1] * k, len: 1, rot: 0 });
  const ref: Vec<number> = sheet.views[0]?.origin ?? [0, 0];
  const anchor: Pt = [ref[0] * k, ref[1] * k];

  const blockByName = new Map<string, BlockDef>();
  for (const b of sheet.blocks) {
    if (typeof b.name !== "string" || b.name === "") throw new DraftingError("INVALID_ARGUMENT", "블록 이름이 비었습니다");
    blockByName.set(b.name, b);
  }
  const sortedBlock = new Map<string, Prim<number>[]>();
  const blockEntities = (name: string): Prim<number>[] => {
    let s = sortedBlock.get(name);
    if (s === undefined) {
      s = [...(blockByName.get(name) as BlockDef).entities].sort(comparePrim);
      sortedBlock.set(name, s);
    }
    return s;
  };

  // 순서: DXF 작성기와 같다(레이어 표 순서 → 컨테이너(뷰 → 주석 anno_id → 용지) → 엔티티 종류 → key).
  const items: Item[] = [];
  let container = 0;
  for (const v of sheet.views) {
    const xf = viewXf.get(v.view_id) as Xf;
    for (const p of v.prims) items.push({ p, xf, container });
    container++;
  }
  for (const a of [...sheet.annotations].sort((x, y) => cmpStr(x.anno_id, y.anno_id))) {
    let xf = paperXf;
    if (a.view_id !== undefined) {
      const vx = viewXf.get(a.view_id);
      if (vx === undefined) throw new DraftingError("INVALID_ARGUMENT", `${a.anno_id}: 없는 뷰 ${a.view_id}`);
      xf = vx;
    }
    for (const p of a.prims) items.push({ p, xf, container });
    container++;
  }
  for (const p of sheet.paper_prims) items.push({ p, xf: paperXf, container });
  items.sort(
    (a, b) =>
      layerOrder(a.p.layer) - layerOrder(b.p.layer) ||
      a.container - b.container ||
      (KIND_ORDER[a.p.t] as number) - (KIND_ORDER[b.p.t] as number) ||
      cmpStr(a.p.key, b.p.key),
  );

  const buckets = new Map<StdLayer, SceneItem[]>();
  for (const def of LAYER_TABLE) buckets.set(def.name, []);
  const put = (layer: StdLayer, item: SceneItem) => {
    const b = buckets.get(layer);
    if (b === undefined) throw new RangeError(`표준 레이어가 아닙니다: ${layer}`);
    b.push(item);
  };

  const emit = (p: Prim<number>, xf: Xf, stack: readonly string[]): void => {
    // 유한하지 않은 값은 여기서 막는다(jsPDF는 Infinity·NaN을 그대로 써서 깨진 PDF를 만든다).
    const fin = (n: number) => {
      if (!Number.isFinite(n)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 유한하지 않은 값 ${n}`);
      return n;
    };
    const P = (v: Vec<number>): Pt => {
      const q = apply(xf, v);
      fin(q[0]);
      fin(q[1]);
      return q;
    };
    if (p.t === "arc") {
      fin(p.a0);
      fin(p.a1);
    }
    if ((p.t === "arc" || p.t === "circle") && !(fin(p.r) > 0)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 반지름이 양수가 아닙니다`);
    if ((p.t === "text" || p.t === "mtext") && !(fin(p.h) > 0)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 문자 높이가 양수가 아닙니다`);
    if (p.t === "mtext") fin(p.width);
    switch (p.t) {
      case "line":
        put(p.layer, { t: "line", a: P(p.a), b: P(p.b) });
        break;
      case "pline":
        put(p.layer, { t: "pline", pts: p.pts.map(P), closed: p.closed });
        break;
      case "circle":
        put(p.layer, { t: "circle", c: P(p.c), r: p.r * xf.len });
        break;
      case "arc":
        put(p.layer, { t: "arc", c: P(p.c), r: p.r * xf.len, a0: norm360(p.a0 + xf.rot), a1: norm360(p.a1 + xf.rot) });
        break;
      case "text":
        put(p.layer, { t: "text", at: P(p.at), size: p.h * k, s: cleanLine(p.s), align: p.align, rot: xf.rot });
        break;
      case "mtext":
        put(p.layer, {
          t: "mtext",
          at: P(p.at),
          size: p.h * k,
          lines: cleanLines(p.s).flatMap((l) => wrapLine(l, p.width * k, p.h * k * TEXT_EM_PER_HEIGHT, options.metrics)),
          rot: xf.rot,
        });
        break;
      case "hatch": {
        const loops = p.loops.map((l) => l.map(P));
        if (p.pattern === "SOLID") put(p.layer, { t: "hatch", pattern: "SOLID", loops });
        else put(p.layer, { t: "hatch", pattern: "ANSI31", loops, segs: ansi31(loops, anchor, ANSI31_SPACING_MM * sheet.scale, p.key) });
        break;
      }
      case "insert": {
        if (!blockByName.has(p.block)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 없는 블록 ${p.block}`);
        if (stack.includes(p.block)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 블록 순환 ${[...stack, p.block].join(" → ")}`);
        const [ox, oy] = P(p.at);
        const inner: Xf = { ox, oy, len: 1, rot: (xf.rot + p.rot_deg) % 360 };
        for (const e of blockEntities(p.block)) emit(e, inner, [...stack, p.block]);
        break;
      }
    }
  };
  for (const it of items) emit(it.p, it.xf, []);

  return {
    w: sheet.paper.w * k,
    h: sheet.paper.h * k,
    scale: sheet.scale,
    // 쓸 때만 레이어(A-ANNO-USER)는 그릴 것이 있을 때만 그룹을 낸다(주석 없는 시트는 이전과 같은 바이트).
    layers: LAYER_TABLE.map((d) => ({ layer: d.name, items: buckets.get(d.name) as SceneItem[] })).filter(
      (l) => l.items.length > 0 || !ON_DEMAND_LAYERS.includes(l.layer),
    ),
  };
}

const SQRT1_2 = 0.7071067811865476;

/**
 * ANSI31: 45° 평행선(간격 d, 기준점 anchor = DXF 모델 원점)을 경계 루프(짝홀 규칙)로 자른 조각.
 * 선 방향 u = (1,1)/√2, 법선 n = (−1,1)/√2. 선 i는 n·(X − anchor) = i·d. 꼭짓점이 선 위에 있으면 반열린 구간 규칙으로 한 번만 센다.
 */
export function ansi31(loops: readonly Pt[][], anchor: Pt, d: number, key = "hatch"): Array<[Pt, Pt]> {
  const tn = (p: Pt) => (-(p[0] - anchor[0]) + (p[1] - anchor[1])) * SQRT1_2;
  const su = (p: Pt) => (p[0] - anchor[0] + (p[1] - anchor[1])) * SQRT1_2;
  let tmin = Infinity;
  let tmax = -Infinity;
  for (const l of loops) {
    for (const p of l) {
      const t = tn(p);
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
    }
  }
  if (!(tmin <= tmax)) return [];
  const i0 = Math.ceil(tmin / d);
  const i1 = Math.floor(tmax / d);
  if (i1 - i0 + 1 > MAX_HATCH_LINES) throw new DraftingError("INVALID_ARGUMENT", `${key}: ANSI31 선이 너무 많습니다(${i1 - i0 + 1})`);
  const out: Array<[Pt, Pt]> = [];
  for (let i = i0; i <= i1; i++) {
    const t = i * d;
    const ss: number[] = [];
    for (const l of loops) {
      for (let j = 0; j < l.length; j++) {
        const a = l[j] as Pt;
        const b = l[(j + 1) % l.length] as Pt;
        const ta = tn(a);
        const tb = tn(b);
        if ((ta <= t && t < tb) || (tb <= t && t < ta)) {
          const r = (t - ta) / (tb - ta);
          ss.push(su(a) + (su(b) - su(a)) * r);
        }
      }
    }
    ss.sort((x, y) => x - y);
    for (let j = 0; j + 1 < ss.length; j += 2) {
      const s0 = ss[j] as number;
      const s1 = ss[j + 1] as number;
      if (s1 - s0 <= 0) continue;
      // X = anchor + n·t + u·s
      const at = (s: number): Pt => [anchor[0] + (-t + s) * SQRT1_2, anchor[1] + (t + s) * SQRT1_2];
      out.push([at(s0), at(s1)]);
    }
  }
  return out;
}

/**
 * 근사 글자 폭(em): 한글·CJK·전각 1, 공백 0.3, 나머지 0.55. 글꼴 폭 표가 없을 때만 쓴다(결정적이지만 실제 글꼴과 다를 수 있다).
 */
export function approxEm(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7ff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  ) {
    return 1;
  }
  return cp === 0x20 ? 0.3 : 0.55;
}

/**
 * 한 줄을 폭 maxWidth(모델 단위) 안으로 나눈다: 공백 단위 탐욕 줄바꿈, 한 단어가 폭보다 길면 글자 단위로 자른다(줄마다 최소 1자).
 * em = 글꼴 크기(모델 단위). maxWidth ≤ 0이면 나누지 않는다. 줄 끝 공백은 그대로 두지 않는다(나눈 자리의 공백 1개는 버린다).
 */
export function wrapLine(line: string, maxWidth: number, em: number, metrics?: FontMetrics): string[] {
  if (!(maxWidth > 0) || !(em > 0) || line === "") return [line];
  const w = (ch: string): number => {
    const cp = ch.codePointAt(0) as number;
    if (metrics !== undefined) {
      const a = advanceOf(metrics, cp);
      if (a !== null) return (a / metrics.units_per_em) * em;
    }
    return approxEm(cp) * em;
  };
  const width = (s: string) => {
    let t = 0;
    for (const ch of s) t += w(ch);
    return t;
  };
  if (width(line) <= maxWidth) return [line];
  const out: string[] = [];
  let cur = "";
  let curW = 0;
  const pushChars = (word: string) => {
    for (const ch of word) {
      const cw = w(ch);
      if (cur !== "" && curW + cw > maxWidth) {
        out.push(cur);
        cur = "";
        curW = 0;
      }
      cur += ch;
      curW += cw;
    }
  };
  const words = line.split(" ");
  words.forEach((word, i) => {
    const ww = width(word);
    const sep = i === 0 ? "" : " ";
    const sw = i === 0 ? 0 : w(" ");
    if (curW + sw + ww <= maxWidth) {
      cur += sep + word;
      curW += sw + ww;
      return;
    }
    if (i > 0 && cur !== "") {
      out.push(cur);
      cur = "";
      curW = 0;
    }
    if (ww <= maxWidth) {
      cur = word;
      curW = ww;
    } else pushChars(word);
  });
  out.push(cur);
  return out;
}
