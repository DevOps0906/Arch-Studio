// 지오메트리 2D 단위 테스트(AR-06-014): 반올림 규칙, 입력 거부 코드, 합집합·오프셋·면적·최단거리 대표 사례,
// 초월함수 미사용(소스 검사).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 소스 검사용 파일 읽기(테스트 전용)
import { readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import type { Point, Polygon } from "@arch-studio/domain";
import {
  GeometryError,
  area,
  area2,
  compareDistance,
  distance,
  normalizePolygon,
  offset,
  roundHalfAway,
  roundRatioHalfAway,
  union,
  validatePolygon,
} from "./index.ts";
import { hitsPixel } from "./arrangement.ts";

const sq = (x: number, y: number, s: number): Polygon => ({
  outer: [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ],
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof GeometryError) return e.code;
    throw e;
  }
  return "OK";
}

test("roundHalfAway: 0에서 먼 쪽, -0 없음", () => {
  assert.equal(roundHalfAway(2.5), 3);
  assert.equal(roundHalfAway(-2.5), -3);
  assert.equal(roundHalfAway(0.49999999999999994), 0);
  assert.equal(roundHalfAway(-0.49999999999999994), 0);
  assert.equal(Object.is(roundHalfAway(-0.4), 0), true);
  assert.equal(Object.is(roundHalfAway(-0), 0), true);
  assert.equal(roundHalfAway(1.5), 2);
  assert.equal(roundHalfAway(-1.5), -2);
  assert.equal(roundHalfAway(2 ** 53), 2 ** 53);
  assert.throws(() => roundHalfAway(Number.NaN), RangeError);
});

test("roundRatioHalfAway: 정확한 유리수 반올림", () => {
  assert.equal(roundRatioHalfAway(5n, 2n), 3);
  assert.equal(roundRatioHalfAway(-5n, 2n), -3);
  assert.equal(roundRatioHalfAway(5n, -2n), -3);
  assert.equal(roundRatioHalfAway(7n, 3n), 2);
  assert.equal(roundRatioHalfAway(-7n, 3n), -2);
  assert.equal(Object.is(roundRatioHalfAway(-1n, 3n), 0), true);
});

test("입력 거부: 명시적 오류 코드", () => {
  assert.equal(validatePolygon(sq(0, 0, 1000)), null);
  assert.equal(validatePolygon({ outer: [[0, 0], [10, 0]] }), "TOO_FEW_POINTS");
  assert.equal(validatePolygon({ outer: [[0, 0], [10.5, 0], [0, 10]] }), "INVALID_COORDINATE");
  assert.equal(validatePolygon({ outer: [[0, 0], [Number.NaN, 0], [0, 10]] }), "INVALID_COORDINATE");
  assert.equal(validatePolygon({ outer: [[0, 0], [10_000_001, 0], [0, 10]] }), "OUT_OF_RANGE");
  assert.equal(validatePolygon({ outer: [[-10_000_000, -10_000_000], [10_000_000, -10_000_000], [0, 10_000_000]] }), null);
  assert.equal(validatePolygon({ outer: [[0, 0], [10, 0], [10, 10], [0, 0]] }), "DUPLICATE_POINT"); // 닫는 점 중복
  assert.equal(validatePolygon({ outer: [[0, 0], [10, 0], [20, 0]] }), "ZERO_AREA");
  assert.equal(validatePolygon({ outer: [[0, 0], [10, 10], [10, 0], [0, 10], [-5, 5]] }), "SELF_INTERSECTION"); // 나비꼴
  assert.equal(validatePolygon({ outer: [[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]] }), "SELF_INTERSECTION"); // 꼭짓점 접촉
  assert.equal(validatePolygon({ outer: [[0, 0], [10, 0], [5, 0], [5, 10]] }), "SELF_INTERSECTION"); // 되돌아감
  assert.equal(
    validatePolygon({ outer: sq(0, 0, 10).outer, holes: [sq(20, 20, 2).outer] }),
    "HOLE_OUTSIDE",
  );
  assert.equal(
    validatePolygon({ outer: sq(0, 0, 100).outer, holes: [sq(10, 10, 50).outer, sq(20, 20, 5).outer] }),
    "HOLE_OUTSIDE",
  );
  assert.equal(validatePolygon({ outer: sq(0, 0, 10).outer, holes: [sq(5, 5, 10).outer] }), "SELF_INTERSECTION");
});

test("정규화: 외곽 반시계·구멍 시계, 시작점 유지", () => {
  const cw: Point[] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];
  const n = normalizePolygon({ outer: cw, holes: [[[2, 2], [4, 2], [4, 4], [2, 4]]] });
  assert.deepEqual(n.outer, [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);
  assert.deepEqual(n.holes, [
    [
      [2, 2],
      [2, 4],
      [4, 4],
      [4, 2],
    ],
  ]);
});

test("면적: 자기교차·퇴화 입력은 거부", () => {
  assert.equal(code(() => area({ outer: [[0, 0], [10, 0], [5, 0], [5, 10], [0, 10]] })), "SELF_INTERSECTION");
  assert.equal(code(() => area2({ outer: [[0, 0], [10, 10], [10, 0], [0, 10], [-5, 5]] })), "SELF_INTERSECTION");
  assert.equal(code(() => area({ outer: [[0, 0], [10, 0], [20, 0]] })), "ZERO_AREA");
});

test("면적: 정확한 정수, 구멍 차감, half-away", () => {
  assert.equal(area(sq(0, 0, 1000)), 1_000_000);
  assert.equal(area2({ outer: [[0, 0], [3, 0], [0, 3]] }), 9);
  assert.equal(area({ outer: [[0, 0], [3, 0], [0, 3]] }), 5); // 4.5 → 5
  assert.equal(area({ outer: sq(0, 0, 10).outer, holes: [sq(2, 2, 3).outer] }), 91);
  assert.equal(area(sq(-10_000_000, -10_000_000, 20_000_000)), 4e14);
});

test("합집합: 겹침·접촉·분리·구멍 생성·빈 입력", () => {
  assert.deepEqual(union([]), []);
  assert.deepEqual(union([sq(0, 0, 10), sq(5, 5, 10)]), [
    { outer: [[0, 0], [10, 0], [10, 5], [15, 5], [15, 15], [5, 15], [5, 10], [0, 10]], holes: [] },
  ]);
  // 변 공유 → 하나로, 일직선 꼭짓점 제거
  assert.deepEqual(union([sq(0, 0, 10), sq(10, 0, 10)]), [{ outer: [[0, 0], [20, 0], [20, 10], [0, 10]], holes: [] }]);
  // 꼭짓점 접촉 → 둘
  assert.equal(union([sq(0, 0, 10), sq(10, 10, 10)]).length, 2);
  // ㄷ자 + 막대 → 구멍
  const u: Polygon = { outer: [[0, 0], [30, 0], [30, 10], [10, 10], [10, 20], [30, 20], [30, 30], [0, 30]] };
  const r = union([u, sq(20, 0, 10), { outer: [[20, 0], [30, 0], [30, 30], [20, 30]] }]);
  assert.deepEqual(r, [{ outer: [[0, 0], [30, 0], [30, 30], [0, 30]], holes: [[[10, 10], [10, 20], [20, 20], [20, 10]]] }]);
  // 교차점이 격자점이 아니면 half-away 반올림
  // 빗변 x+y=3 과 (0,1)-(3,2)의 교점 (1.5, 1.5) → (2, 2)
  const tri = union([{ outer: [[0, 0], [3, 0], [0, 3]] }, { outer: [[0, 1], [3, 1], [3, 2]] }]);
  assert.deepEqual(tri, [{ outer: [[0, 0], [3, 0], [3, 2], [2, 2], [0, 3]], holes: [] }]);
  assert.equal(area(tri[0] as Polygon), 7);
  assert.throws(() => union([{ outer: [[0, 0], [10, 10], [10, 0], [0, 10]] }]), GeometryError);
});

test("핫 픽셀: 빗변이 픽셀 모서리를 지나도 반열린 규칙 밖이면 꺾이지 않는다(사분면 대칭)", () => {
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const m = (pts: Point[]): Point[] => pts.map(([x, y]) => [x * sx + 0, y * sy + 0]);
    const tri = normalizePolygon({ outer: m([[-1000, 1000], [-1000, -1000], [1000, -1000]]) });
    const box = normalizePolygon({ outer: m([[1, 0], [2, 0], [2, 1], [1, 1]]) });
    const r = union([tri, box]);
    assert.equal(r.length, 2);
    for (const expected of [tri, box]) {
      assert.ok(r.some((p) => area(p) === area(expected) && p.outer.length === expected.outer.length), `사분면 ${sx},${sy}`);
    }
  }
});

test("hitsPixel = 정확한 유리수 판정(좌표 -3..3 전수)", () => {
  // 기준: 선분∩픽셀은 t의 구간이므로, 후보 t(0, 1, 경계 통과점)와 그 사이 중점 중 하나가 픽셀 안이면 만난다.
  // 점의 소속은 roundRatioHalfAway(좌표) === h 로 정의(반올림 규칙 그대로).
  const R = 3;
  const pts: Point[] = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) pts.push([x, y]);
  const reference = (a: Point, b: Point, h: Point): boolean => {
    const ts: [bigint, bigint][] = [[0n, 1n], [1n, 1n]];
    for (const k of [0, 1] as const) {
      const D = BigInt(2 * (b[k] - a[k]));
      if (D === 0n) continue;
      for (const e of [-1n, 1n]) {
        const n = BigInt(2 * h[k]) + e - BigInt(2 * a[k]);
        if ((n >= 0n && n <= D) || (n <= 0n && n >= D)) ts.push(D > 0n ? [n, D] : [-n, -D]);
      }
    }
    ts.sort((p, q) => (p[0] * q[1] < q[0] * p[1] ? -1 : p[0] * q[1] > q[0] * p[1] ? 1 : 0));
    const cand: [bigint, bigint][] = [...ts];
    for (let i = 0; i + 1 < ts.length; i++) {
      const [n1, d1] = ts[i] as [bigint, bigint];
      const [n2, d2] = ts[i + 1] as [bigint, bigint];
      cand.push([n1 * d2 + n2 * d1, 2n * d1 * d2]);
    }
    return cand.some(([n, d]) =>
      ([0, 1] as const).every((k) => roundRatioHalfAway(BigInt(a[k]) * d + n * BigInt(b[k] - a[k]), d) === h[k]),
    );
  };
  let checked = 0;
  for (const a of pts) {
    for (const b of pts) {
      if (a[0] === b[0] && a[1] === b[1]) continue;
      for (const h of pts) {
        assert.equal(hitsPixel({ a, b, w: 1 }, h), reference(a, b, h), `${a}→${b} @ ${h}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 49 * 48 * 49);
});

test("오프셋: miter·square, 안쪽 소멸, 구멍, 갈라짐, 인자 거부", () => {
  assert.deepEqual(offset(sq(0, 0, 100), 10), [{ outer: [[-10, -10], [110, -10], [110, 110], [-10, 110]], holes: [] }]);
  assert.deepEqual(offset(sq(0, 0, 100), 10, { join: "square" }), [
    { outer: [[-10, -4], [-4, -10], [104, -10], [110, -4], [110, 104], [104, 110], [-4, 110], [-10, 104]], holes: [] },
  ]);
  assert.deepEqual(offset(sq(0, 0, 100), -10), [{ outer: [[10, 10], [90, 10], [90, 90], [10, 90]], holes: [] }]);
  assert.deepEqual(offset(sq(0, 0, 100), -50), []);
  assert.deepEqual(offset(sq(0, 0, 100), 0), [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }]);
  assert.deepEqual(offset({ outer: sq(0, 0, 30).outer, holes: [sq(10, 10, 10).outer] }, 2), [
    { outer: [[-2, -2], [32, -2], [32, 32], [-2, 32]], holes: [[[12, 12], [12, 18], [18, 18], [18, 12]]] },
  ]);
  assert.deepEqual(offset({ outer: sq(0, 0, 30).outer, holes: [sq(10, 10, 10).outer] }, 6), [
    { outer: [[-6, -6], [36, -6], [36, 36], [-6, 36]], holes: [] },
  ]);
  // 아령: 안쪽 오프셋이 둘로 갈라진다
  const dumbbell: Polygon = {
    outer: [[0, 0], [40, 0], [40, 18], [60, 18], [60, 0], [100, 0], [100, 40], [60, 40], [60, 22], [40, 22], [40, 40], [0, 40]],
  };
  assert.equal(offset(dumbbell, -5).length, 2);
  // 뾰족한 모서리: miterLimit을 넘으면 square
  const spike: Polygon = { outer: [[0, 0], [1000, 100], [0, 200]] };
  const m = offset(spike, 10, { miterLimit: 100 });
  const s = offset(spike, 10);
  assert.ok((m[0] as Polygon).outer.length < (s[0] as Polygon).outer.length);
  assert.equal(code(() => offset(sq(0, 0, 10), 1.5)), "INVALID_ARGUMENT");
  assert.equal(code(() => offset(sq(0, 0, 10), 1, { join: "round" as never })), "INVALID_ARGUMENT");
  assert.equal(code(() => offset(sq(0, 0, 10), 1, { miterLimit: 0.5 })), "INVALID_ARGUMENT");
  assert.equal(code(() => offset(sq(9_999_000, 0, 500), 1000)), "OUT_OF_RANGE");
});

test("최단거리: 정확한 제곱 거리, 표시 반올림, 겹침 0, 구멍 안", () => {
  const d = distance(sq(0, 0, 10), sq(20, 3, 10));
  assert.equal(d.d2_mm2, 100);
  assert.equal(d.d_mm, 10);
  assert.equal(compareDistance(d, 10), 0);
  assert.deepEqual(d.pair, [[10, 3], [20, 3]]);
  // 대각: 거리 √50 ≈ 7.07
  const diag = distance({ outer: [[0, 0], [10, 0], [0, 10]] }, { outer: [[10, 10], [20, 10], [20, 20]] });
  assert.equal(diag.d2_mm2, 50);
  assert.equal(diag.d_mm, 7);
  assert.deepEqual(diag.pair, [[5, 5], [10, 10]]);
  assert.equal(compareDistance(diag, 7), 1);
  assert.equal(compareDistance(diag, 8), -1);
  // 반올림 거리로 비교하면 틀리는 경우: 정확한 거리 7√2 ≈ 9.899 → 표시 10, 그래도 10mm보다 가깝다
  const near = distance(sq(0, 0, 10), { outer: [[17, 17], [30, 17], [30, 30]] });
  assert.equal(near.d_mm, 10);
  assert.equal(near.d2_mm2, 98);
  assert.equal(compareDistance(near, 10), -1);
  // 겹침·포함은 0
  assert.equal(distance(sq(0, 0, 10), sq(5, 5, 10)).d2_mm2, 0);
  assert.equal(distance(sq(0, 0, 100), sq(10, 10, 5)).d_mm, 0);
  // 구멍 안의 다각형은 구멍 경계까지
  const ring: Polygon = { outer: sq(0, 0, 100).outer, holes: [sq(20, 20, 60).outer] };
  const inHole = distance(ring, sq(40, 40, 10));
  assert.equal(inHole.d_mm, 20);
  assert.equal(compareDistance(inHole, 20), 0);
  assert.equal(code(() => compareDistance(inHole, -1)), "INVALID_ARGUMENT");
});

test("초월함수 미사용: geometry 소스의 Math는 허용 목록만, ** 없음", () => {
  const dir = new URL(".", import.meta.url);
  // sqrt·사칙연산만 허용(사용자 결정 a). Math["sin"]·const { pow } = Math 같은 우회도 Math 식별자에서 걸린다.
  const allowed = new Set(["sqrt", "abs", "trunc", "sign", "min", "max", "floor"]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const lines = readFileSync(new URL(f, dir), "utf8").split("\n");
    lines.forEach((line, i) => {
      const codePart = line.replace(/\/\/.*$/, "").replace(/^\s*\/?\*.*$/, ""); // 주석 줄 제외
      const where = `${f}:${i + 1}: ${line.trim()}`;
      assert.equal(/\*\*/.test(codePart), false, where);
      for (const m of codePart.matchAll(/\bMath\b(\s*\.\s*([A-Za-z_$][\w$]*))?/g)) {
        assert.ok(m[2] !== undefined && allowed.has(m[2]), where);
      }
    });
  }
});
