// area_plan 뷰 생성기(AR-06-024, 02_ARCHITECTURE.md 2.3절 "뷰 생성기" 표).
// 층별 바닥면적 구획(매스 외곽 = 외벽 중심선 가정) + 해치 + 면적표(건축면적·연면적·용적률 산정 연면적·층별·용도별).
// 법규 값(건폐율·용적률)은 JudgmentResult 값을 그대로 옮기고, 면적은 판정 엔진 값(area_breakdown) 또는 판정과 같은 정의의 geometry 집계를 정수로만 다룬다.
import type { JudgmentResult, Polygon } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import { label, paperToModel, type AnnotateContext } from "../../annotate/index.ts";
import { RESERVED_RIGHT, frameRect, TITLE_BAND_H } from "../../sheet/paper.ts";
import type { ViewModel } from "../../sheet/build.ts";
import { DraftingError } from "../../sheet/errors.ts";
import type { Annotation, DraftingInput, Mm, PaperUm, Prim, SheetWarning, Vec } from "../../sheet/types.ts";
import { checkBreakdown, deriveAreas, floorName, footprintsByLevel, formatH100, m2OfH100, unionOf, type AreaBreakdown } from "./areas.ts";
import { layoutTable, type NoteLine, type TableRow } from "./table.ts";

export type { AreaBreakdown } from "./areas.ts";

/** DraftingInput + (선택) 판정 엔진이 계산한 면적. 없으면 DesignModel에서 같은 정의로 집계한다. */
export type AreaPlanInput = DraftingInput & { area_breakdown?: AreaBreakdown };

const VIEW_ID = "main";
/** 층 구획 사이 간격(모델 mm). 라벨 두 줄이 들어갈 만큼(1/600에서 문자 높이 5줄 ≈ 7.5m). */
const GAP: Mm = 12_000;

type Item = JudgmentResult["items"][number];

const KEY_LABEL: Readonly<Record<Item["key"], string>> = Object.freeze({
  coverage: "건폐율",
  far: "용적률",
  height: "높이",
  sunlight: "일조",
  setback: "이격",
  parking: "주차",
  seismic: "내진",
  zero_energy: "제로에너지",
  supervision: "감리",
});

const VERDICT_LABEL: Readonly<Record<Item["verdict"], string>> = Object.freeze({
  PASS: "적합",
  FAIL: "부적합",
  WARN: "참고(미확인)",
  NA: "해당 없음",
});

/** 판정 값(실수, 소수 둘째 자리) → ㎡/% × 100 정수. */
const h100Of = (v: number): number => roundHalfAway(v * 100);

const sortedLevelFor = (input: DraftingInput): number | undefined => {
  const id = input.sheet.floor_id;
  if (id === undefined) return undefined;
  for (const m of input.model.masses) for (const f of m.floors) if (f.id === id) return f.level;
  throw new DraftingError("INVALID_ARGUMENT", `sheet.floor_id: 모델에 없는 층입니다(${id})`);
};

function judgmentRows(items: readonly Item[]): { rows: TableRow[]; unverified: boolean } {
  const rows: TableRow[] = [];
  let unverified = false;
  items.forEach((it, idx) => {
    if (it.basis.length === 0 || it.value === undefined) return; // 근거 없는 행은 표시하지 않는다(AR-F-004)
    const isPct = it.unit === "pct";
    if (!isPct && it.unit !== "m2") return;
    if (it.verdict === "WARN") unverified = true;
    const ref = `judgment.items[${idx}]`;
    const verdict = VERDICT_LABEL[it.verdict];
    const note: { s: string; ref?: string } =
      it.limit !== undefined ? { s: `한도 ${formatH100(h100Of(it.limit))}${isPct ? "%" : ""} ${verdict}`, ref: `${ref}.limit` } : { s: verdict };
    const value = `${formatH100(h100Of(it.value))}${isPct ? "%" : ""}`;
    rows.push({
      kind: "body",
      cells: [{ s: KEY_LABEL[it.key] }, note, { s: value, ref: `${ref}.value`, align: "r" }],
    });
  });
  return { rows, unverified };
}

export function buildAreaPlanView(input: AreaPlanInput): ViewModel {
  const { model, judgment, profile } = input;
  const given = input.area_breakdown;
  if (given !== undefined) checkBreakdown(given);
  const areas = given ?? deriveAreas(model);
  const prefix = given !== undefined ? "area_breakdown" : "geometry.area";

  const onlyLevel = sortedLevelFor(input);
  const plans = footprintsByLevel(model).filter((p) => onlyLevel === undefined || p.level === onlyLevel);
  const floorRows = areas.floors.filter((f) => onlyLevel === undefined || f.level === onlyLevel);
  for (const p of plans) {
    if (!floorRows.some((f) => f.level === p.level)) throw new DraftingError("INVALID_ARGUMENT", `area_breakdown: ${p.level}층 면적이 없습니다`);
  }

  // ---- 도형: 층별 구획을 격자로 늘어놓는다(층 번호 순, 왼쪽 위부터). 모두 정수 mm.
  const unions = plans.map((p) => ({ level: p.level, polys: unionOf(p.footprints) }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const u of unions) {
    for (const poly of u.polys) {
      for (const [x, y] of poly.outer) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) throw new DraftingError("INVALID_ARGUMENT", "면적 산정도를 그릴 층 외곽이 없습니다");
  const cw = maxX - minX;
  const ch = maxY - minY;
  const cols = Math.ceil(Math.sqrt(unions.length));
  const prims: Prim<Mm>[] = [];
  const cells: Array<{ level: number; cx: Mm; bottom: Mm }> = [];
  unions.forEach((u, i) => {
    const dx = (i % cols) * (cw + GAP) - minX;
    const dy = -Math.floor(i / cols) * (ch + GAP) - minY;
    const shift = (pt: readonly [number, number]): Vec<Mm> => [pt[0] + dx, pt[1] + dy];
    u.polys.forEach((poly: Polygon, k) => {
      const key = `floor:${String(u.level)}:${k}`;
      const loops = [poly.outer, ...(poly.holes ?? [])].map((ring) => ring.map(shift));
      loops.forEach((pts, j) => prims.push({ layer: "A-AREA", key: `${key}:${j === 0 ? "o" : `h${j}`}`, t: "pline", closed: true, pts }));
      prims.push({ layer: "A-AREA", key: `${key}:hatch`, t: "hatch", pattern: "ANSI31", loops });
    });
    cells.push({ level: u.level, cx: (i % cols) * (cw + GAP) + Math.floor(cw / 2), bottom: dy + minY });
  });

  // ---- 표
  const rows: TableRow[] = [];
  const num = (n: number, ref: string): { s: string; ref: string; align: "r" } => ({ s: formatH100(n), ref, align: "r" });
  rows.push({ kind: "title", cells: [{ s: "면적표" }] });
  rows.push({ kind: "head", cells: [{ s: "구분" }, { s: "용도·비고" }, { s: "면적(㎡)", align: "r" }] });
  rows.push({ kind: "body", cells: [{ s: "건축면적" }, { s: "지상층 외곽 합" }, num(areas.building_h100, `${prefix}.building`)] });
  rows.push({ kind: "body", cells: [{ s: "연면적" }, { s: "지하층 포함" }, num(areas.gross_h100, `${prefix}.gross`)] });
  rows.push({ kind: "body", cells: [{ s: "용적률 산정 연면적" }, { s: "지하층 제외 가정" }, num(areas.far_gross_h100, `${prefix}.far_gross`)] });
  const jr = judgmentRows(judgment.items);
  rows.push(...jr.rows);

  rows.push({ kind: "title", cells: [{ s: "층별 면적" }] });
  for (const f of floorRows) {
    const name = floorName(f.level);
    if (f.uses.length <= 1) {
      rows.push({ kind: "body", cells: [{ s: name }, { s: f.uses[0]?.use ?? "" }, num(f.area_h100, `${prefix}.floor:${f.level}`)] });
    } else {
      f.uses.forEach((u, i) => {
        rows.push({ kind: "body", cells: [{ s: i === 0 ? name : "" }, { s: u.use }, num(u.area_h100, `${prefix}.floor:${f.level}.use:${u.use}`)] });
      });
      rows.push({ kind: "body", cells: [{ s: `${name} 계` }, { s: "" }, num(f.area_h100, `${prefix}.floor:${f.level}`)] });
    }
  }
  rows.push({ kind: "title", cells: [{ s: "용도별 면적" }] });
  for (const u of areas.uses) rows.push({ kind: "body", cells: [{ s: u.use }, { s: "" }, num(u.area_h100, `${prefix}.use:${u.use}`)] });
  rows.push({ kind: "total", cells: [{ s: "합계(연면적)" }, { s: "" }, num(areas.gross_h100, `${prefix}.gross`)] });

  const notes: NoteLine[] = [
    { s: `규칙 팩 버전 ${judgment.rule_pack_version}`, ref: "judgment.rule_pack_version" },
    { s: "산정 기준: 매스 외곽 = 외벽 중심선 가정" },
    { s: "면적 ㎡ 소수 둘째 자리(0에서 먼 쪽 반올림)" },
    { s: given !== undefined ? "면적 값: 판정 엔진 값" : "면적 값: 판정과 같은 정의의 도형 집계" },
  ];
  if (jr.unverified) notes.push({ s: "미확인 항목은 참고값이며 판정이 아닙니다" });
  if (judgment.pending_changes > 0) notes.push({ s: `이후 개정 ${judgment.pending_changes}건`, ref: "judgment.pending_changes" });

  // ---- 용지 배치: 오른쪽 예약 폭 안. 안 들어가면 행을 줄이고, 그래도 안 되면 AR058.
  const h = roundHalfAway(profile.default_text_height_mm * 100);
  const f = frameRect(input.sheet.paper, input.sheet.orientation);
  const area = { x0: f.x1 - RESERVED_RIGHT.area_plan + 300, x1: f.x1 - 300, top: f.y1 - 300 };
  const floorY = f.y0 + TITLE_BAND_H;
  const noteStep = roundHalfAway(h * 1.5);
  const need = (rowH: PaperUm) => rows.length * rowH + notes.length * noteStep + h;
  const room = area.top - floorY;
  const warnings: SheetWarning[] = [];
  const compact = need(h * 2) > room;
  if (need(roundHalfAway(h * 1.5)) > room) {
    warnings.push({ code: "AR058", detail: "면적표가 용지에 맞지 않습니다. 용지를 A2·A1로 바꾸거나 방향을 바꾸세요" });
  }
  const table = layoutTable(rows, notes, area, h, compact);

  const area_table_m2: Record<string, number> = {
    building_area: m2OfH100(areas.building_h100),
    gross_area: m2OfH100(areas.gross_h100),
    far_gross_area: m2OfH100(areas.far_gross_h100),
  };
  for (const fl of floorRows) area_table_m2[`floor:${fl.level}`] = m2OfH100(fl.area_h100);
  for (const u of areas.uses) area_table_m2[`use:${u.use}`] = m2OfH100(u.area_h100);

  const annotate = (ctx: AnnotateContext): Annotation[] =>
    cells.map((c) => {
      const fl = floorRows.find((r) => r.level === c.level) as AreaBreakdown["floors"][number];
      return label(
        {
          anno_id: `label:floor:${c.level}`,
          kind: "label",
          view_id: VIEW_ID,
          at: [c.cx, c.bottom - paperToModel(ctx.text_h * 2, ctx.scale)],
          lines: [{ s: floorName(c.level) }, { kind: "value", s: `${formatH100(fl.area_h100)}㎡`, source_ref: `${prefix}.floor:${c.level}` }],
        },
        ctx,
      );
    });

  return {
    views: [{ view_id: VIEW_ID, prims }],
    paper_prims: table.prims,
    checks: { area_table_m2 },
    ...(warnings.length > 0 ? { warnings } : {}),
    annotate,
  };
}
