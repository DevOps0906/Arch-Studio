// 최소 면적 회전 직사각형 골든(새 프로젝트 창 대지 조회의 가로·세로): 직사각형·회전 직사각형·L자·결정성·입력 거부.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import type { Point } from "@arch-studio/domain";
import { GeometryError, minAreaRect } from "./index.ts";

test("직사각형: 가로·세로 그대로, 꼭짓점 반시계", () => {
  const r = minAreaRect({
    outer: [
      [0, 0],
      [18000, 0],
      [18000, 22000],
      [0, 22000],
    ],
  });
  assert.deepEqual(r, {
    widthMm: 18000,
    depthMm: 22000,
    corners: [
      [0, 0],
      [18000, 0],
      [18000, 22000],
      [0, 22000],
    ],
  });
});

test("회전 직사각형(3-4-5): 변 10m(x축 쪽)·15m(y축 쪽), 시계 방향 입력도 같다", () => {
  // u = (3,4)·3000 = 15m, n = (-4,3)·2000 = 10m
  const outer: Point[] = [
    [8000, 0],
    [17000, 12000],
    [9000, 18000],
    [0, 6000],
  ];
  const r = minAreaRect({ outer });
  assert.equal(r.widthMm, 10000);
  assert.equal(r.depthMm, 15000);
  assert.deepEqual(r.corners, [
    [0, 6000],
    [8000, 0],
    [17000, 12000],
    [9000, 18000],
  ]);
  assert.deepEqual(minAreaRect({ outer: [...outer].reverse() }), r);
});

test("L자: 볼록 껍질 기준 축 정렬 외접 직사각형 20×25m(대각 변 방향보다 작다)", () => {
  const r = minAreaRect({
    outer: [
      [0, 0],
      [20000, 0],
      [20000, 10000],
      [10000, 10000],
      [10000, 25000],
      [0, 25000],
    ],
  });
  assert.equal(r.widthMm, 20000);
  assert.equal(r.depthMm, 25000);
  assert.deepEqual(r.corners, [
    [0, 0],
    [20000, 0],
    [20000, 25000],
    [0, 25000],
  ]);
});

test("기울어진 사다리꼴: 정수 결과·결정성(두 번 같은 값)", () => {
  const poly = {
    outer: [
      [1234, 567],
      [19876, 2345],
      [18765, 21987],
      [345, 19876],
    ] as Point[],
  };
  const a = minAreaRect(poly);
  assert.deepEqual(minAreaRect(poly), a);
  for (const v of [a.widthMm, a.depthMm, ...a.corners.flat()]) assert.ok(Number.isSafeInteger(v));
  assert.ok(a.widthMm > 0 && a.depthMm > 0);
});

test("입력 거부: 자기교차는 GeometryError", () => {
  assert.throws(
    () =>
      minAreaRect({
        outer: [
          [0, 0],
          [10, 10],
          [10, 0],
          [0, 10],
        ],
      }),
    GeometryError,
  );
});
