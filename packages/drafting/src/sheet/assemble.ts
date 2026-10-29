// sheet/assemble — 파이프라인 6단계: 정렬·불변식 검사·input_hash → SheetModel(02_ARCHITECTURE.md 2.3절 결정성 규칙).
// 정렬: 레이어 표 순서 → 엔티티 종류 → key(UTF-16 코드 단위 사전순). 뷰는 넘어온 순서, 주석은 anno_id 순.
import { checkValueText } from "../annotate/index.ts";
import { layerOrder } from "../layers/index.ts";
import { assertDisclaimer } from "../titleblock/index.ts";
import { DraftingError } from "./errors.ts";
import type { FitResult } from "./fit.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { paperDims } from "./paper.ts";
import {
  PRIM_KINDS,
  type Annotation,
  type BlockDef,
  type DraftingInput,
  type Mm,
  type PaperUm,
  type Prim,
  type SheetChecks,
  type SheetModel,
  type SheetWarning,
  type TitleBlockValues,
  type Vec,
} from "./types.ts";

export interface AssembleInput {
  input: DraftingInput;
  fit: FitResult;
  views: Array<{ view_id: string; prims: Prim<Mm>[] }>;
  annotations: Annotation[];
  title: { values: TitleBlockValues; prims: Prim<PaperUm>[] };
  /** 뷰 생성기가 만든 용지 요소(면적표·요약표 등). 표제란과 합쳐 정렬한다. */
  paper_prims?: Prim<PaperUm>[];
  blocks?: BlockDef[];
  warnings?: SheetWarning[];
  checks?: SheetChecks;
}

const KIND_ORDER: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(PRIM_KINDS.map((k, i) => [k, i])));

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function comparePrim(a: Prim<number>, b: Prim<number>): number {
  return layerOrder(a.layer) - layerOrder(b.layer) || (KIND_ORDER[a.t] as number) - (KIND_ORDER[b.t] as number) || cmpStr(a.key, b.key);
}

function needInt(v: number, where: string): void {
  if (!Number.isSafeInteger(v)) throw new DraftingError("INVALID_ARGUMENT", `${where}: 정수 좌표가 아닙니다(${v})`);
}

function checkPrim(p: Prim<number>, where: string): void {
  const w = `${where}/${p.key}`;
  if (typeof p.key !== "string" || p.key === "") throw new DraftingError("INVALID_ARGUMENT", `${where}: key가 비었습니다`);
  layerOrder(p.layer);
  const pt = (v: Vec<number>) => {
    needInt(v[0], w);
    needInt(v[1], w);
  };
  switch (p.t) {
    case "line":
      pt(p.a);
      pt(p.b);
      break;
    case "pline":
      p.pts.forEach(pt);
      break;
    case "arc":
      pt(p.c);
      needInt(p.r, w);
      if (!Number.isFinite(p.a0) || !Number.isFinite(p.a1)) throw new DraftingError("INVALID_ARGUMENT", `${w}: 각도가 유한하지 않습니다`);
      break;
    case "circle":
      pt(p.c);
      needInt(p.r, w);
      break;
    case "text":
      pt(p.at);
      needInt(p.h, w);
      break;
    case "mtext":
      pt(p.at);
      needInt(p.h, w);
      needInt(p.width, w);
      break;
    case "hatch":
      p.loops.forEach((loop) => loop.forEach(pt));
      break;
    case "insert":
      pt(p.at);
      break;
  }
}

/** key는 레이어·종류가 달라도 컨테이너 안에서 유일해야 한다. */
function uniqueKeys(prims: readonly Prim<number>[], where: string): void {
  const keys = prims.map((p) => p.key).sort(cmpStr);
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] === keys[i - 1]) throw new DraftingError("DUPLICATE_KEY", `${where}: key 중복 ${keys[i]}`);
  }
}

/** 검사(정수 좌표·표준 레이어·key 유일) + 정렬한 새 배열. */
function sorted<U extends number>(prims: readonly Prim<U>[], where: string): Prim<U>[] {
  prims.forEach((p) => checkPrim(p, where));
  uniqueKeys(prims, where);
  return [...prims].sort(comparePrim);
}

export function assembleSheet(a: AssembleInput): SheetModel {
  const { input, fit } = a;
  const viewIds = a.views.map((v) => v.view_id);
  for (let i = 0; i < viewIds.length; i++) {
    if (viewIds[i] === "" || viewIds.indexOf(viewIds[i] as string) !== i) {
      throw new DraftingError("DUPLICATE_KEY", `view_id가 비었거나 중복입니다: ${viewIds[i]}`);
    }
  }
  const views = a.views.map((v) => {
    const prims = sorted(v.prims, `views/${v.view_id}`);
    return { view_id: v.view_id, origin: [fit.origin[0], fit.origin[1]] as Vec<PaperUm>, prims };
  });

  const paper_prims = sorted([...a.title.prims, ...(a.paper_prims ?? [])], "paper");
  assertDisclaimer(paper_prims);

  const annotations = [...a.annotations]
    .sort((x, y) => cmpStr(x.anno_id, y.anno_id))
    .map((an, i, arr) => {
      if (an.anno_id === "" || (i > 0 && (arr[i - 1] as Annotation).anno_id === an.anno_id)) {
        throw new DraftingError("DUPLICATE_KEY", `anno_id가 비었거나 중복입니다: ${an.anno_id}`);
      }
      if (an.view_id !== undefined && !viewIds.includes(an.view_id)) {
        throw new DraftingError("INVALID_ARGUMENT", `${an.anno_id}: 없는 뷰 ${an.view_id}`);
      }
      const prims = sorted(an.prims, `annotations/${an.anno_id}`);
      checkValueText({ anno_id: an.anno_id, kind: an.kind, prims });
      const out: Annotation = { anno_id: an.anno_id, kind: an.kind, prims, overridable: [...an.overridable].sort() };
      if (an.view_id !== undefined) out.view_id = an.view_id;
      return out;
    });

  const blocks = [...(a.blocks ?? [])]
    .sort((x, y) => cmpStr(x.name, y.name))
    .map((b, i, arr) => {
      if (b.name === "" || (i > 0 && (arr[i - 1] as BlockDef).name === b.name)) {
        throw new DraftingError("DUPLICATE_KEY", `블록 이름이 비었거나 중복입니다: ${b.name}`);
      }
      const entities = sorted(b.entities, `blocks/${b.name}`);
      return { name: b.name, entities };
    });

  const warnings = [...(fit.warning ? [fit.warning] : []), ...(a.warnings ?? [])].sort(
    (x, y) => cmpStr(x.code, y.code) || cmpStr(x.detail, y.detail),
  );
  const { w, h } = paperDims(input.sheet.paper, input.sheet.orientation);

  return {
    sheet_id: input.sheet.id,
    kind: input.sheet.kind,
    engine_version: input.engine_version,
    input_hash: sha256Hex(canonicalJson(input)),
    paper: { size: input.sheet.paper, orientation: input.sheet.orientation, w, h },
    scale: fit.scale,
    views,
    paper_prims,
    annotations,
    blocks,
    title_block: a.title.values,
    warnings,
    checks: a.checks ?? { area_table_m2: {} },
  };
}
