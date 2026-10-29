// 반올림 규칙의 단일 정본(개발서 12.4절): half-away-from-zero. 엔진의 다른 곳은 이 함수만 쓴다.
// 사칙연산·Math.trunc만 쓴다(초월함수 금지, 모든 JS 엔진에서 같은 결과).

/** 실수 → 정수, 0에서 먼 쪽 반올림. -0은 0으로. 유한하지 않으면 RangeError. */
export function roundHalfAway(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`유한한 수가 아닙니다: ${x}`);
  let r = Math.trunc(x);
  const frac = x - r; // |x| < 2^52 에서 정확, 그 이상은 x가 이미 정수라 0
  if (frac >= 0.5) r += 1;
  else if (frac <= -0.5) r -= 1;
  return r + 0; // -0 → 0
}

/** 유리수 num/den → 정수, 0에서 먼 쪽 반올림(정확한 정수 연산). 결과가 safe int가 아니면 RangeError. */
export function roundRatioHalfAway(num: bigint, den: bigint): number {
  if (den === 0n) throw new RangeError("분모가 0입니다");
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  let q = num / den; // 0 쪽으로 자름
  const rem = num - q * den;
  const twice = rem < 0n ? -2n * rem : 2n * rem;
  if (twice >= den) q += num < 0n ? -1n : 1n;
  const out = Number(q);
  if (!Number.isSafeInteger(out)) throw new RangeError(`safe int 범위를 넘습니다: ${q}`);
  return out + 0;
}

/** 음이 아닌 정수의 정수 제곱근 floor(sqrt(n)). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("음수의 제곱근");
  if (n < 2n) return n;
  let x = BigInt(Math.trunc(Math.sqrt(Number(n)))); // 근사 시작값(정확성은 아래 보정이 보장)
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}
