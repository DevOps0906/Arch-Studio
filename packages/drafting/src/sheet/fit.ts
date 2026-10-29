// sheet/fit — 축척 자동 선택과 뷰 배치(02_ARCHITECTURE.md 2.3절 "축척 자동 선택" 1~5단계). 정수 연산만.
import { ANNO_BAND, usableRect, type Rect } from "./paper.ts";
import type { Mm, Orientation, PaperSize, PaperUm, Scale, SheetKind, SheetWarning, Vec } from "./types.ts";

/** 후보 축척 분모. 오름차순 = 큰 축척 먼저. */
export const SCALES: readonly Scale[] = Object.freeze([100, 200, 300, 500, 600]);

export interface Bounds {
  min: Vec<Mm>;
  max: Vec<Mm>;
}

export interface FitInput {
  /** 뷰 경계 상자(모델 mm). 형상이 없으면 null(원점 한 점으로 본다). */
  bounds: Bounds | null;
  paper: PaperSize;
  orientation: Orientation;
  kind: SheetKind;
  scale: "auto" | Scale;
}

export interface FitResult {
  scale: Scale;
  /** 모델 원점 (0,0)이 놓이는 용지 위치. 용지 좌표 = origin + 모델 mm × 100 / scale. */
  origin: Vec<PaperUm>;
  fits: boolean;
  usable: Rect;
  /** fits=false면 AR058. 자동이면 1/600, 고정 축척이면 그 축척을 그대로 두고 경고만 한다(조용히 바꾸지 않음). */
  warning?: SheetWarning;
}

/** 정수 num/den(den>0)의 floor. 부동소수 나눗셈 결과를 정수 비교로 보정해 정확하다. */
function floorDiv(num: number, den: number): number {
  let q = Math.floor(num / den);
  if (q * den > num) q -= 1;
  else if ((q + 1) * den <= num) q += 1;
  return q + 0;
}

/** 범위/분모 + 주석 띠(양쪽) ≤ 사용 가능 영역(가로·세로 모두). 양변에 분모를 곱한 정수 비교. */
function fitsAt(rangeX: Mm, rangeY: Mm, usable: Rect, d: Scale): boolean {
  const band = 2 * ANNO_BAND * d;
  return rangeX * 100 + band <= (usable.x1 - usable.x0) * d && rangeY * 100 + band <= (usable.y1 - usable.y0) * d;
}

function largerPapers(paper: PaperSize): string {
  return paper === "A3" ? "A2·A1" : paper === "A2" ? "A1" : "";
}

function ar058(input: FitInput, d: Scale): SheetWarning {
  const where = `${input.paper} ${input.orientation === "landscape" ? "가로" : "세로"}`;
  const bigger = largerPapers(input.paper);
  const fix = bigger ? `용지를 ${bigger}로 바꾸거나 방향을 바꾸세요` : "방향을 바꾸세요";
  const detail =
    input.scale === "auto"
      ? `가장 작은 축척 1/${d}로도 ${where}에 맞지 않습니다. ${fix}`
      : `고정 축척 1/${d}로는 ${where}에 맞지 않습니다. 축척을 직접 바꾸거나 ${fix}`;
  return { code: "AR058", detail };
}

export function fitSheet(input: FitInput): FitResult {
  const usable = usableRect(input.paper, input.orientation, input.kind);
  const b = input.bounds ?? { min: [0, 0], max: [0, 0] };
  const rangeX = b.max[0] - b.min[0];
  const rangeY = b.max[1] - b.min[1];
  if (!(rangeX >= 0 && rangeY >= 0)) throw new RangeError("경계 상자 min이 max보다 큽니다");

  let scale: Scale;
  let fits: boolean;
  if (input.scale === "auto") {
    const found = SCALES.find((d) => fitsAt(rangeX, rangeY, usable, d));
    scale = found ?? (SCALES[SCALES.length - 1] as Scale);
    fits = found !== undefined;
  } else {
    if (!SCALES.includes(input.scale)) throw new RangeError(`지원하지 않는 축척: ${String(input.scale)}`);
    scale = input.scale;
    fits = fitsAt(rangeX, rangeY, usable, scale);
  }

  // 사용 가능 영역 중앙에 뷰 경계 상자 중앙을 맞추고 0.01mm 정수로 내림.
  const origin: Vec<PaperUm> = [
    floorDiv((usable.x0 + usable.x1) * scale - (b.min[0] + b.max[0]) * 100, 2 * scale),
    floorDiv((usable.y0 + usable.y1) * scale - (b.min[1] + b.max[1]) * 100, 2 * scale),
  ];
  const result: FitResult = { scale, origin, fits, usable };
  if (!fits) result.warning = ar058(input, scale);
  return result;
}
