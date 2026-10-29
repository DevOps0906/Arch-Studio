// area_plan 면적표 배치. 선(line)·문자(text) 프리미티브만 쓴다(용지 0.01mm 정수). 값 문자열은 호출자가 만든다 — 여기서 계산하지 않는다.
import { roundHalfAway } from "@arch-studio/geometry";
import type { PaperUm, Prim } from "../../sheet/types.ts";

export interface Cell {
  s: string;
  /** 엔진 값(수치)을 담은 칸은 출처 필수. */
  ref?: string;
  align?: "l" | "r";
}

export interface TableRow {
  /** title: 칸 하나로 합친 구역 제목. head/body/total: 3칸. */
  kind: "title" | "head" | "body" | "total";
  cells: Cell[];
}

export interface NoteLine {
  s: string;
  ref?: string;
}

export interface TableLayout {
  prims: Prim<PaperUm>[];
  /** 표 + 주석 맨 아래 y. */
  bottom: PaperUm;
}

const L = "A-AREA-IDEN" as const;
const NOTE_L = "A-ANNO-TEXT" as const;
const PAD: PaperUm = 150;
const COL_W: readonly PaperUm[] = [4_200, 3_600, 3_600];

const pad3 = (n: number) => String(n).padStart(3, "0");

/** 표는 frame 오른쪽 예약 폭 안(x0..x1), 위에서 아래로. compact면 행 높이를 문자 높이 × 1.5로 줄인다. */
export function layoutTable(rows: readonly TableRow[], notes: readonly NoteLine[], area: { x0: PaperUm; x1: PaperUm; top: PaperUm }, h: PaperUm, compact: boolean): TableLayout {
  const rowH = compact ? roundHalfAway(h * 1.5) : h * 2;
  const baseOff = roundHalfAway((rowH - h) / 2);
  const { x0, x1, top } = area;
  const xs: PaperUm[] = [x0];
  for (const w of COL_W) xs.push((xs[xs.length - 1] as number) + w);
  xs[3] = x1; // 마지막 칸은 남는 폭
  const prims: Prim<PaperUm>[] = [];
  const y = (i: number) => top - i * rowH;

  rows.forEach((row, i) => {
    const key = pad3(i);
    prims.push({ layer: L, key: `tbl:h:${key}`, t: "line", a: [x0, y(i)], b: [x1, y(i)] });
    const cells = row.kind === "title" ? [row.cells[0] as Cell] : row.cells;
    cells.forEach((c, j) => {
      if (c.s === "") return;
      const right = c.align === "r";
      const p: Prim<PaperUm> = {
        layer: L,
        key: `tbl:t:${key}:${j}`,
        t: "text",
        at: [right ? (xs[j + 1] as number) - PAD : (xs[j] as number) + PAD, y(i + 1) + baseOff],
        h,
        s: c.s,
        align: right ? "r" : "l",
      };
      if (c.ref !== undefined) p.source_ref = c.ref;
      prims.push(p);
    });
    if (row.kind !== "title") {
      for (const j of [1, 2]) prims.push({ layer: L, key: `tbl:v:${key}:${j}`, t: "line", a: [xs[j] as number, y(i)], b: [xs[j] as number, y(i + 1)] });
    }
  });
  const end = y(rows.length);
  prims.push(
    { layer: L, key: "tbl:h:end", t: "line", a: [x0, end], b: [x1, end] },
    { layer: L, key: "tbl:v:left", t: "line", a: [x0, top], b: [x0, end] },
    { layer: L, key: "tbl:v:right", t: "line", a: [x1, top], b: [x1, end] },
  );

  // 표 아래 주석(규칙 팩 버전·산정 기준).
  const noteStep = roundHalfAway(h * 1.5);
  let ny = end - noteStep;
  notes.forEach((n, i) => {
    const p: Prim<PaperUm> = { layer: NOTE_L, key: `note:${pad3(i)}`, t: "text", at: [x0 + PAD, ny], h, s: n.s, align: "l" };
    if (n.ref !== undefined) p.source_ref = n.ref;
    prims.push(p);
    ny -= noteStep;
  });
  return { prims, bottom: ny + noteStep - h };
}

