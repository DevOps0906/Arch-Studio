// 결정적 삼각함수. Math.sin/cos는 엔진마다 마지막 비트가 다를 수 있어(개발서 12.4절) 쓰지 않고
// 사칙연산·floor만으로 계산한다(IEEE 754 사칙연산은 모든 엔진에서 같다). 90도 배수는 정확히 0·±1.

const DEG = 3.141592653589793 / 180;

/** 도(degree) 단위 각도의 [sin, cos]. 유한하지 않은 입력은 호출 쪽이 먼저 거른다. */
export function sinCosDeg(deg: number): [number, number] {
  const d = deg - 360 * Math.floor(deg / 360); // [0, 360)
  const q = Math.floor((d + 45) / 90); // 0..4
  const r = d - 90 * q; // [-45, 45]
  const x = r * DEG;
  const x2 = x * x;
  // 테일러 급수(|x| ≤ 0.7854에서 항 9개면 오차 < 1e-17)
  let s = 0;
  let c = 0;
  let ts = x; // (-1)^k x^(2k+1)/(2k+1)!
  let tc = 1; // (-1)^k x^(2k)/(2k)!
  for (let k = 0; k < 9; k++) {
    s += ts;
    c += tc;
    ts = (-ts * x2) / ((2 * k + 2) * (2 * k + 3));
    tc = (-tc * x2) / ((2 * k + 1) * (2 * k + 2));
  }
  switch (q % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}
