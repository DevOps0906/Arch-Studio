// 다각형 오프셋(계약 ③, 사용자 결정 b): 모서리는 miter·square만(round 없음).
// 고리마다 원시 오프셋 경로를 실수로 만들고(sqrt·사칙연산만) 꼭짓점마다 roundHalfAway 1회,
// 그 다음 감김수 > 0 정수 배치로 자기교차·뒤집힌 고리를 정리한다(Clipper2와 같은 구조, 코드는 자체 구현).
import type { Point, Polygon } from "@arch-studio/domain";
import { fillPositive, type Seg } from "./arrangement.ts";
import { assertResultRange, pushRing } from "./boolean.ts";
import { GeometryError } from "./errors.ts";
import { orient } from "./predicates.ts";
import { roundHalfAway } from "./round.ts";
import { COORD_LIMIT, normalizePolygon } from "./validate.ts";

export type OffsetJoin = "miter" | "square";

export interface OffsetOptions {
  /** 볼록 모서리 처리. 기본 "miter". */
  join?: OffsetJoin;
  /** miter 길이 한도(오프셋 거리의 배수, ≥ 1). 넘으면 square. 기본 2. */
  miterLimit?: number;
}

/** 거의 일직선(cos > 0.999)은 join과 무관하게 miter. */
const STRAIGHT_COS = 0.999;

// 정당성: 원시 경로(1-사슬) = ∂P + Σ(sign δ)·∂(변 띠) + Σ(sign δ)·∂(벌어지는 쪽 모서리 조각).
// 그래서 감김수 = [P 안] ± (덮는 조각 수)가 되어 감김수 > 0 이 정확히 "P ∪ 조각"(δ>0) / "P \ 조각"(δ<0)이다.
// 이 등식은 겹치는 쪽 꼭짓점에서 반드시 세 점(꼭짓점 포함)을 넣을 때만 성립한다. 예전에는 Clipper2처럼
// cos ≤ -0.999(바늘처럼 뾰족한 꼭짓점)를 오목에서 빼 square/miter 마개를 붙였는데, 안쪽 오프셋에서 그 마개가
// 원본 밖으로 뻗은 양의 영역을 만들었다(AR-06-014 결함). 오목 판정은 정수 외적 부호로 정확히 한다.

function offsetRing(ring: readonly Point[], delta: number, join: OffsetJoin, miterLimit: number): Point[] {
  const n = ring.length;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % n] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    nx.push(dy / len); // 오른쪽 법선 = 재료 바깥(외곽 반시계·구멍 시계). 변 방향 = (-ny, nx)
    ny.push(-dx / len);
  }
  const miterCos = 2 / (miterLimit * miterLimit) - 1;
  const raw: Point[] = [];
  const emit = (x: number, y: number): void => {
    const p: Point = [roundHalfAway(x), roundHalfAway(y)];
    const last = raw[raw.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) raw.push(p);
  };
  for (let j = 0; j < n; j++) {
    const k = (j + n - 1) % n;
    const [px, py] = ring[j] as Point;
    const n1x = nx[k] as number;
    const n1y = ny[k] as number;
    const n2x = nx[j] as number;
    const n2y = ny[j] as number;
    // n1 × n2 의 부호 = 변 방향 외적의 부호 = orient(이전, 현재, 다음) — 정수라 정확.
    const turn = Math.sign(orient(ring[k] as Point, ring[j] as Point, ring[(j + 1) % n] as Point));
    const cosA = n1x * n2x + n1y * n2y;
    if (turn * Math.sign(delta) < 0) {
      // 오목(오프셋 방향 기준): 세 점을 넣고, 생기는 음의 영역은 정리 단계가 지운다.
      emit(px + n1x * delta, py + n1y * delta);
      emit(px, py);
      emit(px + n2x * delta, py + n2y * delta);
    } else if (cosA > STRAIGHT_COS || (join === "miter" && cosA > miterCos)) {
      const f = delta / (1 + cosA);
      emit(px + (n1x + n2x) * f, py + (n1y + n2y) * f);
    } else {
      // square: 꼭짓점에서 이등분선 방향으로 |delta| 떨어진 직선에서 두 오프셋 변을 자른다.
      const t1x = -n1y;
      const t1y = n1x;
      const t2x = -n2y;
      const t2y = n2x;
      const v1x = n1x * delta;
      const v1y = n1y * delta;
      const v2x = n2x * delta;
      const v2y = n2y * delta;
      const bl = Math.sqrt((v1x + v2x) * (v1x + v2x) + (v1y + v2y) * (v1y + v2y));
      const bx = (v1x + v2x) / bl;
      const by = (v1y + v2y) / bl;
      const ad = Math.abs(delta);
      const s1 = (ad - (v1x * bx + v1y * by)) / (t1x * bx + t1y * by);
      const s2 = (ad - (v2x * bx + v2y * by)) / (t2x * bx + t2y * by);
      emit(px + v1x + s1 * t1x, py + v1y + s1 * t1y);
      emit(px + v2x + s2 * t2x, py + v2y + s2 * t2y);
    }
  }
  while (raw.length > 1) {
    const first = raw[0] as Point;
    const last = raw[raw.length - 1] as Point;
    if (first[0] !== last[0] || first[1] !== last[1]) break;
    raw.pop();
  }
  return raw;
}

/**
 * 다각형 오프셋. delta_mm > 0 바깥(구멍은 줄어듦), < 0 안쪽, 0이면 정리만.
 * 결과는 Polygon[](안쪽으로 사라지면 빈 배열, 갈라지면 여러 개). 결과 좌표가 ±10km를 넘으면 OUT_OF_RANGE.
 */
export function offset(polygon: Polygon, delta_mm: number, options: OffsetOptions = {}): Polygon[] {
  if (!Number.isSafeInteger(delta_mm) || Math.abs(delta_mm) > COORD_LIMIT) {
    throw new GeometryError("INVALID_ARGUMENT", `오프셋 거리는 ±${COORD_LIMIT} 안의 mm 정수여야 합니다 (${delta_mm})`);
  }
  const join = options.join ?? "miter";
  if (join !== "miter" && join !== "square") {
    throw new GeometryError("INVALID_ARGUMENT", `모서리는 miter·square만 지원합니다 (${String(join)})`);
  }
  const miterLimit = options.miterLimit ?? 2;
  if (!Number.isFinite(miterLimit) || miterLimit < 1) {
    throw new GeometryError("INVALID_ARGUMENT", `miterLimit은 1 이상의 유한한 수여야 합니다 (${miterLimit})`);
  }
  const p = normalizePolygon(polygon);
  const segs: Seg[] = [];
  for (const ring of [p.outer, ...(p.holes ?? [])]) {
    pushRing(segs, delta_mm === 0 ? ring : offsetRing(ring, delta_mm, join, miterLimit));
  }
  return assertResultRange(fillPositive(segs));
}
