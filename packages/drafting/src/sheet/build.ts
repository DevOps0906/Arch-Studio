// 시트 1장 생성(파이프라인 3~6단계): fit → annotate(+덮어쓰기·사람 주석) → titleblock → assemble.
// 1단계 validate는 호출자가 먼저 부르고, 2단계 뷰 생성기(views/<kind>, 023~026)는 ViewModel로 넘긴다.
import { applyOverrides, cmpStr, type AnnotateContext, type AnnotationOverride, type UnappliedAnnotation } from "../annotate/index.ts";
import { applyUserAnnotations } from "../annotate/user.ts";
import { buildTitleBlock, textHeightUm } from "../titleblock/index.ts";
import { roundHalfAway } from "@arch-studio/geometry";
import { assembleSheet } from "./assemble.ts";
import { DraftingError } from "./errors.ts";
import { fitSheet, type Bounds, type FitResult } from "./fit.ts";
import type { Annotation, BlockDef, DraftingInput, Mm, PaperUm, Prim, SheetChecks, SheetModel, SheetWarning, Vec } from "./types.ts";

export interface ViewModel {
  views: Array<{ view_id: string; prims: Prim<Mm>[] }>;
  paper_prims?: Prim<PaperUm>[];
  blocks?: BlockDef[];
  checks?: SheetChecks;
  warnings?: SheetWarning[];
  /** 축척이 정해진 뒤 주석을 만든다(치수 모양·문자 간격이 축척에 따른다). */
  annotate?: (ctx: AnnotateContext & { fit: FitResult }) => Annotation[];
}

export interface BuildResult {
  sheet: SheetModel;
  /**
   * 출력에서 빠진 주석(id 순): 대상이 없거나 허용되지 않은 덮어쓰기, 고아 주석(orphan_*) 등.
   * 화면 "적용되지 않은 주석 n건"·"고아 주석 n개는 출력에서 빠집니다".
   */
  unapplied: UnappliedAnnotation[];
}

const PI = 3.141592653589793;

/** x∈[0, π/4]의 cos·sin. 고정 계수 테일러 다항식(사칙연산만, Math 초월함수 없음 → 엔진 무관 같은 결과). 오차 < 1e-16. */
function cosSinSmall(x: number): [number, number] {
  const x2 = x * x;
  let c = 1;
  let sn = 1;
  let tc = 1;
  let ts = 1;
  for (let k = 1; k <= 10; k++) {
    tc *= -x2 / ((2 * k - 1) * (2 * k));
    ts *= -x2 / ((2 * k) * (2 * k + 1));
    c += tc;
    sn += ts;
  }
  return [c, sn * x];
}

/** 각도(도) → [cos, sin]. 90° 배수는 정확한 정수. */
export function cosSinDeg(deg: number): [number, number] {
  if (!Number.isFinite(deg)) throw new DraftingError("INVALID_ARGUMENT", `각도가 유한하지 않습니다: ${deg}`);
  const d = ((deg % 360) + 360) % 360;
  const q = Math.floor(d / 90);
  const rem = d - q * 90;
  let c: number;
  let sn: number;
  if (rem === 0) [c, sn] = [1, 0];
  else if (rem <= 45) [c, sn] = cosSinSmall((rem * PI) / 180);
  else {
    const [c2, s2] = cosSinSmall(((90 - rem) * PI) / 180);
    [c, sn] = [s2, c2];
  }
  const rot: Array<[number, number]> = [
    [c, sn],
    [-sn, c],
    [-c, -sn],
    [sn, -c],
  ];
  const [x, y] = rot[q % 4] as [number, number];
  return [x + 0, y + 0];
}

/** DXF 호(a0 → a1 반시계, 도)가 각도 t를 지나는지. a0 = a1이면 원 전체로 본다. */
function arcContains(a0: number, a1: number, t: number): boolean {
  const n = (v: number) => ((v % 360) + 360) % 360;
  const sweep = n(a1 - a0);
  return sweep === 0 || n(t - a0) <= sweep;
}

type Add = (x: number, y: number) => void;

/** prims의 점을 add로 넘긴다. INSERT는 블록 정의를 회전(90° 배수)·이동해 포함한다(배율은 계약에 없어 1). */
function addPrims(prims: readonly Prim<Mm>[], blocks: Readonly<Record<string, BlockDef>>, add: Add, stack: readonly string[]): void {
  const pt = (v: Vec<Mm>) => add(v[0], v[1]);
  for (const p of prims) {
    switch (p.t) {
      case "line":
        pt(p.a);
        pt(p.b);
        break;
      case "pline":
        p.pts.forEach(pt);
        break;
      case "circle":
        add(p.c[0] - p.r, p.c[1] - p.r);
        add(p.c[0] + p.r, p.c[1] + p.r);
        break;
      case "arc": {
        // 시작·끝점 + 호가 지나는 사분면 극점(0·90·180·270°). 정수 mm로 반올림.
        for (const deg of [p.a0, p.a1]) {
          const [c, sn] = cosSinDeg(deg);
          add(roundHalfAway(p.c[0] + p.r * c), roundHalfAway(p.c[1] + p.r * sn));
        }
        for (const [deg, dx, dy] of [[0, 1, 0], [90, 0, 1], [180, -1, 0], [270, 0, -1]] as const) {
          if (arcContains(p.a0, p.a1, deg)) add(p.c[0] + dx * p.r, p.c[1] + dy * p.r);
        }
        break;
      }
      case "hatch":
        p.loops.forEach((loop) => loop.forEach(pt));
        break;
      case "text":
      case "mtext":
        pt(p.at);
        break;
      case "insert": {
        const def = Object.prototype.hasOwnProperty.call(blocks, p.block) ? blocks[p.block] : undefined;
        if (def === undefined) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 없는 블록 ${p.block}`);
        if (stack.includes(p.block)) throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 블록 순환 ${[...stack, p.block].join(" → ")}`);
        const rot = p.rot_deg as number;
        if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) {
          throw new DraftingError("INVALID_ARGUMENT", `${p.key}: 블록 회전은 90° 배수만(${rot})`);
        }
        const [ox, oy] = p.at;
        const place: Add = (x, y) => {
          const [rx, ry] = rot === 0 ? [x, y] : rot === 90 ? [-y, x] : rot === 180 ? [-x, -y] : [y, -x];
          add(ox + rx, oy + ry);
        };
        addPrims(def.entities, blocks, place, [...stack, p.block]);
        break;
      }
    }
  }
}

/** 뷰 형상의 경계 상자(모델 mm). 형상이 없으면 null. INSERT가 가리키는 블록이 blocks에 없으면 INVALID_ARGUMENT. */
export function viewBounds(views: ViewModel["views"], blocks: readonly BlockDef[] = []): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add: Add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const byName: Record<string, BlockDef> = Object.create(null);
  for (const b of blocks) byName[b.name] = b;
  for (const v of views) addPrims(v.prims, byName, add, []);
  return minX === Infinity ? null : { min: [minX, minY], max: [maxX, maxY] };
}

export function buildSheet(input: DraftingInput, view: ViewModel): BuildResult {
  const { sheet, profile } = input;
  const fit = fitSheet({
    bounds: viewBounds(view.views, view.blocks),
    paper: sheet.paper,
    orientation: sheet.orientation,
    kind: sheet.kind,
    scale: sheet.scale,
  });
  const ctx: AnnotateContext = { scale: fit.scale, text_h: textHeightUm(profile.default_text_height_mm) };
  const raw = view.annotate ? view.annotate({ ...ctx, fit }) : [];
  const overrides = sheet.annotations.filter((a): a is AnnotationOverride => a.kind === "override");
  const auto = applyOverrides(raw, overrides, ctx);
  const user = applyUserAnnotations(input, view.views[0]?.view_id, ctx);
  const annotations = [...auto.annotations, ...user.annotations];
  const unapplied = [...auto.unapplied, ...user.unapplied].sort((x, y) => cmpStr(x.id, y.id));
  const title = buildTitleBlock({
    profile,
    kind: sheet.kind,
    paper: sheet.paper,
    orientation: sheet.orientation,
    scale: fit.scale,
    project_name: input.project_name,
    date: input.date,
    rule_pack_version: input.judgment.rule_pack_version,
    license: input.license,
  });
  const out = assembleSheet({
    input,
    fit,
    views: view.views,
    annotations,
    title,
    ...(view.paper_prims ? { paper_prims: view.paper_prims } : {}),
    ...(view.blocks ? { blocks: view.blocks } : {}),
    ...(view.warnings ? { warnings: view.warnings } : {}),
    ...(view.checks ? { checks: view.checks } : {}),
  });
  return { sheet: out, unapplied };
}
