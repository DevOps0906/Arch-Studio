// 정북 방향 단위 벡터(결정적). Math.sin·cos(명세상 근사 함수) 대신 사칙연산 테일러 급수만 쓴다 — 모든 JS 엔진에서 같은 비트.
// 각도 규약(가정, 팀장 확인 필요): north_angle_deg = 모델 +Y축에서 정북까지 시계 방향 각도(0 → 정북 = +Y, 90 → 정북 = +X).

const PI = 3.141592653589793;

/** 0 ≤ x ≤ π/4 에서 sin·cos(테일러 17·16차, 오차 < 1e-17). */
function sinCosSmall(x: number): [number, number] {
  const x2 = x * x;
  let s = 0;
  let c = 0;
  let termS = x; // x^(2k+1)/(2k+1)!
  let termC = 1; // x^(2k)/(2k)!
  for (let k = 0; k < 9; k++) {
    const sign = k % 2 === 0 ? 1 : -1;
    s += sign * termS;
    c += sign * termC;
    termS = (termS * x2) / ((2 * k + 2) * (2 * k + 3));
    termC = (termC * x2) / ((2 * k + 1) * (2 * k + 2));
  }
  return [s, c];
}

/** 도 단위 [sin, cos]. 90의 배수는 정확히 0·±1. */
export function sinCosDeg(deg: number): [number, number] {
  if (!Number.isFinite(deg)) throw new RangeError(`유한한 각도가 아닙니다: ${deg}`);
  const r = deg - 360 * Math.floor(deg / 360); // [0, 360)
  const q = Math.floor(r / 90);
  const rem = r - 90 * q; // [0, 90)
  let s: number;
  let c: number;
  if (rem <= 45) {
    [s, c] = sinCosSmall((rem * PI) / 180);
  } else {
    const [s2, c2] = sinCosSmall(((90 - rem) * PI) / 180);
    s = c2;
    c = s2;
  }
  // 사분면 회전: (s, c) → q×90° 더하기
  const out: [number, number][] = [
    [s, c],
    [c, -s],
    [-s, -c],
    [-c, s],
  ];
  const [os, oc] = out[q % 4] as [number, number];
  return [os + 0, oc + 0];
}

/** 모델 좌표계에서 정북 단위 벡터 [x, y]. */
export function northVector(northAngleDeg: number): [number, number] {
  const [s, c] = sinCosDeg(northAngleDeg);
  return [s, c];
}
