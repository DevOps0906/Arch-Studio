// 속성 테스트(fast-check, AR-06-014): 결과 정수·유효(단순·방향·구멍 포함)·같은 입력 같은 출력·half-away,
// 기준 비교 area(A∪B) ≤ area(A)+area(B), ≥ max, 바깥 오프셋 ⊇ 원본, 안쪽 오프셋 ⊆ 원본.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import type { Point, Polygon } from "@arch-studio/domain";
import { area, normalizePolygon, offset, roundHalfAway, union, validatePolygon } from "./index.ts";

const RUNS = { numRuns: 300 };
const LIMIT = 10_000_000;

/** 각도순(정수 반평면 비교)으로 정렬한 별 모양 다각형 — 단순 다각형이 된다. */
function starPolygon(c: Point, offsets: Point[]): Polygon | null {
  const half = ([x, y]: Point) => (y > 0 || (y === 0 && x > 0) ? 0 : 1);
  const dirs = offsets
    .filter(([x, y]) => x !== 0 || y !== 0)
    .sort((a, b) => half(a) - half(b) || b[0] * a[1] - a[0] * b[1] || a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  const kept: Point[] = [];
  for (const d of dirs) {
    const last = kept[kept.length - 1];
    if (last && half(last) === half(d) && last[0] * d[1] - last[1] * d[0] === 0) continue; // 같은 방향은 하나만
    kept.push(d);
  }
  const p: Polygon = { outer: kept.map(([x, y]) => [c[0] + x, c[1] + y]) };
  return validatePolygon(p) === null ? p : null;
}

const coord = (r: number) => fc.integer({ min: -r, max: r });
const starArb = (r: number, centerRange: number) =>
  fc
    .tuple(fc.tuple(coord(centerRange), coord(centerRange)), fc.array(fc.tuple(coord(r), coord(r)), { minLength: 3, maxLength: 14 }))
    .map(([c, offs]) => starPolygon(c as Point, offs as Point[]))
    .filter((p): p is Polygon => p !== null);

const rectArb = fc
  .tuple(coord(5000), coord(5000), fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 1, max: 4000 }))
  .map(([x, y, w, h]): Polygon => ({ outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }));

/** 사각형 + 안쪽 사각형 구멍. */
const holedArb = fc
  .tuple(coord(3000), coord(3000), fc.integer({ min: 30, max: 3000 }), fc.integer({ min: 30, max: 3000 }), fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }))
  .map(([x, y, w, h, a, b]): Polygon => {
    const hx = x + 5 + (a % (w - 20));
    const hy = y + 5 + (b % (h - 20));
    const hw = 1 + ((w - 10 - (hx - x)) >> 1);
    const hh = 1 + ((h - 10 - (hy - y)) >> 1);
    return {
      outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
      holes: [[[hx, hy], [hx + hw, hy], [hx + hw, hy + hh], [hx, hy + hh]]],
    };
  })
  .filter((p) => validatePolygon(p) === null);

// 조밀한 작은 좌표(starArb(4, 3))는 교차점이 격자 모서리·픽셀 경계에 걸리는 퇴화 사례를 많이 만든다.
const anyPolyArb = fc.oneof(starArb(4000, 3000), rectArb, holedArb, starArb(3000, LIMIT - 3000), starArb(4, 3), starArb(30, 20));

function allInts(ps: Polygon[]): boolean {
  return ps.every((p) => [p.outer, ...(p.holes ?? [])].every((r) => r.every(([x, y]) => Number.isSafeInteger(x) && Number.isSafeInteger(y))));
}

/** 결과 유효성: 각 다각형이 검사 통과 + 정규화해도 그대로(외곽 반시계·구멍 시계). */
function assertValid(ps: Polygon[]): void {
  assert.ok(allInts(ps), "결과 좌표는 정수");
  for (const p of ps) {
    assert.equal(validatePolygon(p), null, JSON.stringify(p));
    assert.deepEqual(normalizePolygon(p), p, "방향 정규화 상태");
  }
}

/** 점이 다각형(구멍 제외) 안 또는 경계 위인가 — 테스트 기준용 독립 구현. */
function covers(p: Polygon, [x, y]: Point): boolean {
  const ringSide = (ring: Point[]): number => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Point;
      const [xj, yj] = ring[j] as Point;
      const cr = (xi - xj) * (y - yj) - (yi - yj) * (x - xj);
      if (cr === 0 && Math.min(xi, xj) <= x && x <= Math.max(xi, xj) && Math.min(yi, yj) <= y && y <= Math.max(yi, yj)) return 0;
      if (yi > y !== yj > y && (yi > yj ? cr > 0 : cr < 0)) inside = !inside;
    }
    return inside ? 1 : -1;
  };
  const o = ringSide(p.outer);
  if (o === -1) return false;
  if (o === 0) return true;
  return (p.holes ?? []).every((h) => ringSide(h) !== 1);
}

const totalArea = (ps: Polygon[]) => ps.reduce((s, p) => s + area(p), 0);

function perimeter(p: Polygon): number {
  let s = 0;
  for (const r of [p.outer, ...(p.holes ?? [])]) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i] as Point;
      const b = r[(i + 1) % r.length] as Point;
      s += Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
    }
  }
  return s;
}

test("roundHalfAway: 정수 결과, |오차| ≤ 0.5, .5는 0에서 먼 쪽, 부호 대칭", () => {
  fc.assert(
    fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (x) => {
      const r = roundHalfAway(x);
      assert.ok(Number.isSafeInteger(r));
      assert.ok(Math.abs(r - x) <= 0.5);
      assert.equal(roundHalfAway(-x), -r + 0);
    }),
    { numRuns: 2000 },
  );
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2 ** 40 }), (k) => {
      assert.equal(roundHalfAway(k + 0.5), k + 1);
      assert.equal(roundHalfAway(-(k + 0.5)), -(k + 1));
    }),
    { numRuns: 1000 },
  );
});

test("합집합: 결과 정수·유효, 같은 입력 같은 출력(순서 무관)", () => {
  fc.assert(
    fc.property(anyPolyArb, anyPolyArb, (a, b) => {
      const u = union([a, b]);
      assertValid(u);
      assert.deepEqual(union([a, b]), u);
      assert.deepEqual(union([b, a]), u);
    }),
    RUNS,
  );
});

test("합집합 기준 비교(사각형, 교차점이 격자점): max ≤ area(A∪B) ≤ area(A)+area(B) 정확", () => {
  fc.assert(
    fc.property(fc.oneof(rectArb, holedArb), fc.oneof(rectArb, holedArb), (a, b) => {
      const u = totalArea(union([a, b]));
      assert.ok(u <= area(a) + area(b), `${u} > ${area(a)} + ${area(b)}`);
      assert.ok(u >= Math.max(area(a), area(b)), `${u} < max`);
    }),
    RUNS,
  );
});

test("합집합 기준 비교(일반 다각형): 교차점 반올림 오차(둘레 × 1mm) 안에서 성립", () => {
  fc.assert(
    fc.property(starArb(4000, 3000), starArb(4000, 3000), (a, b) => {
      const u = totalArea(union([a, b]));
      const tol = perimeter(a) + perimeter(b);
      assert.ok(u <= area(a) + area(b) + tol);
      assert.ok(u >= Math.max(area(a), area(b)) - tol);
    }),
    RUNS,
  );
});

test("오프셋: 결과 정수·유효·결정적, 바깥 ⊇ 원본, 안쪽 ⊆ 원본", () => {
  fc.assert(
    fc.property(
      fc.oneof(starArb(4000, 3000), rectArb, holedArb),
      fc.integer({ min: 2, max: 800 }),
      fc.constantFrom("miter" as const, "square" as const),
      (p, d, join) => {
        const out = offset(p, d, { join });
        const inn = offset(p, -d, { join });
        assertValid(out);
        assertValid(inn);
        assert.deepEqual(offset(p, d, { join }), out);
        // 바깥 오프셋은 원본 꼭짓점을 모두 덮는다
        for (const r of [p.outer, ...(p.holes ?? [])]) {
          for (const v of r) assert.ok(out.some((q) => covers(q, v)), `바깥 오프셋이 ${v}를 덮지 않음`);
        }
        // 안쪽 오프셋의 꼭짓점은 모두 원본 안
        for (const q of inn) {
          for (const r of [q.outer, ...(q.holes ?? [])]) for (const v of r) assert.ok(covers(p, v), `안쪽 오프셋 ${v}가 원본 밖`);
        }
        assert.ok(totalArea(out) >= area(p));
        assert.ok(totalArea(inn) <= area(p));
      },
    ),
    RUNS,
  );
});
