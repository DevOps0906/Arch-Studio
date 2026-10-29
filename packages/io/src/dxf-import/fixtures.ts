// 테스트·벤치용 소형 DXF 문자열 조립기. 프로덕션 경로에서 import하지 않는다.

type G = [number, string | number];

/** 그룹 코드/값 쌍 목록 → DXF 텍스트(CRLF). */
export function pairs(list: G[], eol = "\r\n"): string {
  return list.map(([c, v]) => `${String(c).padStart(3)}${eol}${v}${eol}`).join("");
}

export interface DocParts {
  insunits?: number;
  measurement?: number;
  /** [이름, 70 플래그, 62 색] */
  layers?: Array<[string, number?, number?]>;
  /** 이미 조립된 BLOCK … ENDBLK 텍스트 */
  blocks?: string[];
  entities?: string[];
  /** EOF 표지 생략(잘린 파일 흉내) */
  noEof?: boolean;
}

export function doc(p: DocParts): string {
  const h: G[] = [[0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1027"]];
  if (p.insunits !== undefined) h.push([9, "$INSUNITS"], [70, p.insunits]);
  if (p.measurement !== undefined) h.push([9, "$MEASUREMENT"], [70, p.measurement]);
  h.push([0, "ENDSEC"]);
  let out = pairs(h);
  if (p.layers) {
    const t: G[] = [[0, "SECTION"], [2, "TABLES"], [0, "TABLE"], [2, "LAYER"], [70, p.layers.length]];
    for (const [n, f, c] of p.layers) t.push([0, "LAYER"], [2, n], [70, f ?? 0], [62, c ?? 7], [6, "CONTINUOUS"]);
    t.push([0, "ENDTAB"], [0, "ENDSEC"]);
    out += pairs(t);
  }
  if (p.blocks) out += pairs([[0, "SECTION"], [2, "BLOCKS"]]) + p.blocks.join("") + pairs([[0, "ENDSEC"]]);
  out += pairs([[0, "SECTION"], [2, "ENTITIES"]]) + (p.entities ?? []).join("") + pairs([[0, "ENDSEC"]]);
  if (!p.noEof) out += pairs([[0, "EOF"]]);
  return out;
}

export const line = (layer: string, x1: number, y1: number, x2: number, y2: number): string =>
  pairs([[0, "LINE"], [8, layer], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]]);

export function lwpoly(layer: string, pts: Array<[number, number] | [number, number, number]>, closed: boolean): string {
  const g: G[] = [[0, "LWPOLYLINE"], [8, layer], [90, pts.length], [70, closed ? 1 : 0]];
  for (const p of pts) {
    g.push([10, p[0]], [20, p[1]]);
    if (p[2] !== undefined) g.push([42, p[2]]);
  }
  return pairs(g);
}

export const rect = (layer: string, x0: number, y0: number, x1: number, y1: number): string =>
  lwpoly(layer, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);

export const circle = (layer: string, cx: number, cy: number, r: number): string =>
  pairs([[0, "CIRCLE"], [8, layer], [10, cx], [20, cy], [30, 0], [40, r]]);

export const arc = (layer: string, cx: number, cy: number, r: number, a0: number, a1: number): string =>
  pairs([[0, "ARC"], [8, layer], [10, cx], [20, cy], [30, 0], [40, r], [50, a0], [51, a1]]);

export const insert = (layer: string, block: string, x: number, y: number, opt: { sx?: number; sy?: number; rot?: number } = {}): string =>
  pairs([[0, "INSERT"], [8, layer], [2, block], [10, x], [20, y], [41, opt.sx ?? 1], [42, opt.sy ?? 1], [50, opt.rot ?? 0]]);

export const simple = (type: string, layer: string): string => pairs([[0, type], [8, layer], [10, 0], [20, 0]]);

export const text = (layer: string): string => pairs([[0, "TEXT"], [8, layer], [10, 0], [20, 0], [40, 250], [1, "label"]]);

export function block(name: string, entities: string[], base: [number, number] = [0, 0]): string {
  return (
    pairs([[0, "BLOCK"], [8, "0"], [2, name], [70, 0], [10, base[0]], [20, base[1]], [30, 0], [3, name]]) +
    entities.join("") +
    pairs([[0, "ENDBLK"], [8, "0"]])
  );
}
