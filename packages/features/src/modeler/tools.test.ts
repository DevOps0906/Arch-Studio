// 측정·단면 도구 테스트(AR-06-084): 거리(mm 정수·결정적)·스냅(꼭짓점·변·바닥 100mm), 단면 평면(정수)·월드 클리핑 평면·정북 프리셋,
// 리듀서(실행 취소 대상 아님·모델 저장 바이트 변화 0·여러 측정 유지·삭제·Esc), 시트 단면선과 상태 공유 0.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../demo/index.ts";
import { createModelerState, isDirty, modelerReducer, type Action, type ModelerState } from "./state/store.ts";
import { formatMm, measureDistance, measureSegments, measureText, snapMeasurePoint, snapTargets } from "./tools/measure.ts";
import { keepsPoint, northSection, sectionPlane, worldClipPlane } from "./tools/section.ts";
import { sectionViewPose } from "./viewport/geometry.ts";

const house = DEMO_PROJECTS[0]?.model as DesignModelV1;
const run = (s: ModelerState, ...as: Action[]) => as.reduce(modelerReducer, s);

test("측정 거리: 3·4·12 → 13, 수평·높이차, mm 정수, 같은 입력 같은 값", () => {
  const r = measureDistance([0, 0, 0], [3000, 4000, 12000]);
  assert.deepEqual(r, { dx: 3000, dy: 4000, dz: 12000, horizontal: 5000, vertical: 12000, distance: 13000 });
  const q = measureDistance([100, 200, 3000], [1100, 1200, 0]);
  assert.equal(q.horizontal, 1414, "√2,000,000 = 1414.2… → 1414");
  assert.equal(q.vertical, 3000);
  assert.equal(q.distance, 3317, "√11,000,000 = 3316.6… → 3317");
  assert.ok(Number.isInteger(q.horizontal) && Number.isInteger(q.distance));
  assert.deepEqual(measureDistance([100, 200, 3000], [1100, 1200, 0]), q);
  assert.equal(measureText(r), "거리 13,000mm · 수평 5,000mm · 높이차 12,000mm");
  assert.equal(formatMm(0), "0mm");
});

test("측정 스냅: 꼭짓점 > 변(시작점에서 100mm 단위) > 바닥 격자 100mm(z 0)·면 격자", () => {
  const t = snapTargets(house);
  const m = house.masses[0];
  assert.ok(m);
  const [vx, vy] = m.footprint.outer[0] as readonly [number, number];
  // 꼭짓점: 허용 안 → 정확히 꼭짓점
  assert.deepEqual(snapMeasurePoint([vx + 120, vy - 90, 30], t, 300), { point: [vx, vy, m.base_level_mm], kind: "vertex" });
  // 변: 첫 변 중간 근처 → 변 위, 시작점에서 100mm 단위
  const [wx, wy] = m.footprint.outer[1] as readonly [number, number];
  const mid: [number, number, number] = [(vx + wx) / 2 + 37, (vy + wy) / 2 + 41, m.base_level_mm + 20];
  const e = snapMeasurePoint(mid, t, 300);
  assert.equal(e.kind, "edge");
  const along = Math.hypot(e.point[0] - vx, e.point[1] - vy);
  assert.equal(Math.round(along) % 100, 0);
  assert.ok(e.point.every(Number.isInteger));
  // 바닥: 아무 것도 가깝지 않으면 x·y 100mm, z 0
  const g = snapMeasurePoint([-50_049, -70_151, 40], t, 300);
  assert.deepEqual(g, { point: [-50_000, -70_200, 0], kind: "grid" });
  // 면 위(바닥 아님): 격자 없이 mm 정수 반올림만(벽면 x = 12,345 유지)
  assert.deepEqual(snapMeasurePoint([12_345.4, -70_151.6, 4_449.5], t, 300).point, [12_345, -70_152, 4_450]);
  // 결정적
  assert.deepEqual(snapMeasurePoint(mid, snapTargets(house), 300), e);
});

test("측정 스냅 + 단면: 잘라 낸 쪽 꼭짓점 제외, 변은 남는 쪽만(평면 교점 mm 정수)", () => {
  const plane = sectionPlane({ a: [5000, 0], b: [5000, 10_000] }); // 남 → 북, x ≤ 5000 남김
  assert.ok(plane);
  const all = snapTargets(house);
  const cut = snapTargets(house, plane);
  assert.ok(cut.vertices.length < all.vertices.length);
  assert.ok(cut.vertices.every(([x, y]) => keepsPoint(plane, x, y)));
  assert.ok(cut.edges.every(([a, b]) => keepsPoint(plane, a[0], a[1]) && keepsPoint(plane, b[0], b[1])));
  assert.ok(cut.edges.flat().every((q) => q.every(Number.isInteger)));
  assert.deepEqual(snapTargets(house, plane), cut);
});

test("측정 선분 버퍼: 측정마다 6개 수, 시작점+hover 미리보기 추가", () => {
  const ms = [{ id: 1, a: [0, 0, 0] as const, b: [1000, 0, 0] as const }];
  assert.equal(measureSegments(ms, null, null).length, 6);
  assert.equal(measureSegments(ms, [0, 0, 0], [0, 100, 0]).length, 12);
  assert.equal(measureSegments([], [0, 0, 0], null).length, 0);
});

test("단면 평면: 정수 법선(a→b 왼쪽), 남는 쪽 판정, 같은 점이면 null, 월드 평면 정규화", () => {
  const p = sectionPlane({ a: [0, 0], b: [0, 10_000] }); // 남 → 북, 왼쪽 = 서쪽(−X)
  assert.deepEqual(p, { nx: -10_000, ny: 0, c: 0 });
  assert.ok(p);
  assert.equal(keepsPoint(p, -1, 5000), true);
  assert.equal(keepsPoint(p, 1, 5000), false);
  assert.equal(keepsPoint(p, 0, 5000), true, "평면 위는 남김");
  assert.equal(sectionPlane({ a: [100, 100], b: [100, 100] }), null);
  const q = sectionPlane({ a: [1000, 2000], b: [4000, 2000] }); // 서 → 동, 왼쪽 = 북(+Y)
  assert.deepEqual(q, { nx: 0, ny: 3000, c: -6_000_000 });
  assert.ok(q);
  // 월드: 모델 +Y = 월드 −Z, 상수는 m. 월드 점 (x, 0, −y/1000)에서 n·p + c ≥ 0 이 모델 판정과 같다.
  const [nx, ny, nz, c] = worldClipPlane(q);
  assert.deepEqual([nx, ny, nz, c], [0, 0, -1, -2]);
  const wDist = (x: number, y: number) => nx * (x / 1000) + nz * (-y / 1000) + c;
  assert.ok(wDist(2000, 2500) > 0 && keepsPoint(q, 2000, 2500));
  assert.ok(wDist(2000, 1500) < 0 && !keepsPoint(q, 2000, 1500));
});

test("정북 단면 프리셋: 장면 중심을 지나는 남→북 선(100mm 격자), 정북 각도 반영, 결정적", () => {
  const n = northSection(house);
  assert.equal(n.a[0], n.b[0], "정북 0°면 x가 같다");
  assert.ok(n.b[1] > n.a[1]);
  assert.ok([...n.a, ...n.b].every((v) => v % 100 === 0));
  assert.deepEqual(northSection(house), n);
  const rotated = northSection({ ...house, site: { ...house.site, north_angle_deg: 90 } });
  assert.equal(rotated.a[1], rotated.b[1], "정북 90°(모델 +X)면 y가 같다");
  assert.ok(rotated.b[0] > rotated.a[0]);
  // 단면 보기 카메라는 오른쪽(잘라 낸 쪽 = 동쪽, 월드 +X)에 선다
  const pose = sectionViewPose(n.a, n.b, { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }, 6000);
  assert.ok(pose && pose.position[0] > pose.target[0]);
  assert.equal(sectionViewPose([0, 0], [0, 0], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0), null);
});

test("리듀서: 측정·단면은 표시 상태 — 이력·모델(저장 바이트) 변화 0, 실행 취소 대상 아님, 여러 측정 유지·삭제, Esc 단계", () => {
  const s0 = createModelerState(house);
  const before = JSON.stringify(s0.history.present);
  const s1 = run(
    s0,
    { type: "tool", tool: "measure" },
    { type: "measurePoint", point: [0, 0, 0] },
    { type: "measurePoint", point: [3000, 4000, 0] },
    { type: "measurePoint", point: [0, 0, 0] },
    { type: "measurePoint", point: [0, 0, 3000] },
  );
  assert.equal(s1.measures.length, 2);
  assert.deepEqual(
    s1.measures.map((m) => m.id),
    [1, 2],
  );
  assert.match(s1.notice?.text ?? "", /측정 2: 거리 3,000mm/);
  assert.equal(s1.history, s0.history, "이력 그대로");
  assert.equal(isDirty(s1), false);
  // 실행 취소는 측정을 건드리지 않는다
  const s2 = run(s1, { type: "undo" });
  assert.equal(s2.measures.length, 2);
  // 첫 점만 찍고 Esc(measureCancel) → 측정 유지, 첫 점만 취소
  const s3 = run(s2, { type: "measurePoint", point: [100, 100, 0] }, { type: "measureCancel" });
  assert.equal(s3.measureStart, null);
  assert.equal(s3.measures.length, 2);
  // 삭제·마지막 지우기·모두 지우기
  assert.deepEqual(
    run(s3, { type: "measureDelete", id: 1 }).measures.map((m) => m.id),
    [2],
  );
  assert.equal(run(s3, { type: "measurePop" }).measures.length, 1);
  assert.equal(run(s3, { type: "measureClear" }).measures.length, 0);
  // 도구를 바꿔도 측정은 유지(첫 점은 버림)
  const s4 = run(s3, { type: "measurePoint", point: [100, 100, 0] }, { type: "tool", tool: "select" });
  assert.equal(s4.measures.length, 2);
  assert.equal(s4.measureStart, null);
  // 단면: 두 점 → 단면선, 정북 프리셋 → 단면 보기, 해제
  const s5 = run(s4, { type: "tool", tool: "section" }, { type: "sectionPoint", point: [0, 0] }, { type: "sectionPoint", point: [0, 0] });
  assert.equal(s5.section, null, "같은 점이면 단면선 없음");
  const s6 = run(s5, { type: "sectionPoint", point: [0, 5000] });
  assert.deepEqual(s6.section, { a: [0, 0], b: [0, 5000] });
  const s7 = run(s6, { type: "sectionPreset" });
  assert.equal(s7.sectionView, true);
  assert.deepEqual(s7.section, northSection(house));
  assert.equal(run(s7, { type: "camera", mode: "plan" }).sectionView, false, "보기 전환하면 단면 보기 끔(단면은 유지)");
  assert.equal(run(s7, { type: "camera", mode: "plan" }).section !== null, true);
  const s8 = run(s7, { type: "sectionClear" });
  assert.equal(s8.section, null);
  assert.equal(s8.sectionView, false);
  // 전 과정에서 모델 바이트 변화 0
  for (const s of [s1, s3, s4, s6, s7, s8]) {
    assert.equal(JSON.stringify(s.history.present), before);
    assert.equal(s.history.past.length, 0);
  }
  // 열람 모드: 측정·단면은 표시 전용이라 허용, 매스 그리기는 잠금
  const locked = createModelerState(house, { editable: false, reason: null });
  const lm = run(locked, { type: "tool", tool: "measure" }, { type: "measurePoint", point: [0, 0, 0] }, { type: "measurePoint", point: [0, 1000, 0] });
  assert.equal(lm.measures.length, 1);
  assert.equal(run(locked, { type: "tool", tool: "section" }).tool, "section");
  assert.equal(run(locked, { type: "tool", tool: "draw" }).tool, "select");
  assert.equal(JSON.stringify(lm.history.present), before);
  // 단면 보기 중 새 단면선을 정하면 카메라를 다시 맞춘다
  const sv = run(s7, { type: "tool", tool: "section" }, { type: "sectionPoint", point: [0, 0] }, { type: "sectionPoint", point: [1000, 0] });
  assert.equal(sv.fitN, run(s7, { type: "tool", tool: "section" }).fitN + 1);
});

test("시트 단면선(AR-F-031)과 상태 공유 0: 모델러 밖에서 measure·section 도구를 import하지 않는다", () => {
  const root = path.join(import.meta.dirname, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  for (const f of walk(root)) {
    if (path.relative(root, f).startsWith("modeler")) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /modeler\/tools\/(section|measure)/, f);
  }
});
