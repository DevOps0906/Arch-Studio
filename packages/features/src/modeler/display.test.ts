// 표시 값 테스트(AR-06-085): 조명·그림자·재질·층 라벨·층 숨김·분해도는 표시 상태 — 모델 저장값·판정 입력·이력 변화 0,
// 이 PC 보관(깨진 값은 기본값, 층 숨김은 저장 안 함), 층 판(정수 mm·분해도 간격·그 층만), 삼각형 상한(MAX_TRIANGLES) 유지.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../demo/index.ts";
import { nextJudgeInput } from "./engine/coalesce.ts";
import { MAX_TRIANGLES, buildMassExcessRequest } from "./engine/protocol.ts";
import {
  DEFAULT_DISPLAY,
  EXPLODE_MEASURE_TEXT,
  effectiveFloorOnly,
  explodeActive,
  floorSlabs,
  floorTabLevels,
  levelLabel,
  loadDisplay,
  parseDisplay,
  saveDisplay,
  serializeDisplay,
  slabTriangles,
  splitAllowed,
  splitOverLimit,
  splitTriangles,
  type DisplaySettings,
} from "./display/settings.ts";
import { rectOuter, type Mass, type Model } from "./state/commands.ts";
import { createModelerState, isDirty, modelerReducer, previewModel, type Action, type ModelerState } from "./state/store.ts";
import { slabMesh } from "./viewport/prism.ts";

const house = DEMO_PROJECTS[0]?.model as DesignModelV1;
const run = (s: ModelerState, ...as: Action[]) => as.reduce(modelerReducer, s);
const patch = (p: Partial<DisplaySettings>): Action => ({ type: "display", patch: p });

test("표시 토글 전후: 모델 저장값(JSON 바이트)·판정 입력·초과분 요청·이력 동일, 실행 취소 대상 아님", () => {
  for (const editable of [true, false]) {
    const s0 = createModelerState(house, { editable, reason: null });
    const saved0 = JSON.stringify(s0.history.present);
    const judge0 = previewModel(s0);
    const s1 = run(
      s0,
      patch({ lighting: "evening" }),
      patch({ shadows: true }),
      patch({ material: "translucent" }),
      patch({ floorLabels: true }),
      patch({ explodeMm: 3000 }),
      patch({ floorOnly: 1 }),
    );
    assert.equal(s1.display.shadows, true, "열람 모드에서도 표시 값은 바뀐다");
    assert.equal(s1.display.floorOnly, 1);
    assert.equal(s1.history, s0.history, "이력 그대로");
    assert.equal(s1.saved, s0.saved);
    assert.equal(isDirty(s1), false, "저장할 변경 없음");
    assert.equal(JSON.stringify(s1.history.present), saved0, "저장 바이트 동일");
    assert.ok(!/lighting|shadows|explode|floorLabels/.test(JSON.stringify(s1.history.present)), "모델에 표시 값 없음");
    // 판정 입력: 같은 참조 → 판정 레인이 새 요청을 만들지 않는다(같은 결과)
    const judge1 = previewModel(s1);
    assert.equal(judge1, judge0);
    assert.equal(nextJudgeInput(judge1, judge0, false), judge0);
    assert.deepEqual(buildMassExcessRequest("r", 1, judge1, null, true), buildMassExcessRequest("r", 1, judge0, null, true));
    // 실행 취소·다시 실행은 표시 값을 건드리지 않는다
    const s2 = run(s1, { type: "undo" }, { type: "redo" });
    assert.deepEqual(s2.display, s1.display);
    // 같은 값이면 같은 상태(불필요한 렌더 없음)
    assert.equal(run(s1, patch({ shadows: true })), s1);
  }
});

test("모델 편집은 표시 값과 무관하게 이력에 쌓이고, reset은 표시 값을 유지", () => {
  const s0 = run(createModelerState(house), patch({ explodeMm: 1000, floorLabels: true }));
  const id = house.masses[0]?.id as string;
  const s1 = run(s0, { type: "command", command: { type: "move", id, dx: 100, dy: 0 } });
  assert.equal(s1.history.past.length, s0.history.past.length + 1);
  assert.deepEqual(s1.display, s0.display);
  assert.deepEqual(run(s1, { type: "reset", model: house }).display, s0.display);
});

test("보관: 깨진 값·모르는 값은 기본값, 층 숨김은 저장하지 않음, 왕복 동일", () => {
  assert.deepEqual(parseDisplay(null), DEFAULT_DISPLAY);
  assert.deepEqual(parseDisplay("{깨짐"), DEFAULT_DISPLAY);
  assert.deepEqual(parseDisplay(JSON.stringify({ lighting: "neon", material: 3, explodeMm: 777, shadows: "yes", floorOnly: 2 })), DEFAULT_DISPLAY);
  const d: DisplaySettings = { lighting: "noon", shadows: true, material: "model", floorLabels: true, explodeMm: 1000, floorOnly: 3 };
  const raw = serializeDisplay(d);
  assert.ok(!raw.includes("floorOnly"));
  assert.deepEqual(parseDisplay(raw), { ...d, floorOnly: null });
});

test("층 판: 아래부터 정수 mm, 분해도는 i × 간격, 층 숨김은 그 층만, 라벨 1F·B1", () => {
  const m = house.masses[0] as Mass;
  const plain = floorSlabs(m, 0, null);
  assert.equal(plain.length, m.floors.length);
  assert.equal(plain[0]?.z0, m.base_level_mm);
  for (let i = 1; i < plain.length; i++) assert.equal(plain[i]?.z0, plain[i - 1]?.z1, "틈 없음");
  const ex = floorSlabs(m, 1000, null);
  ex.forEach((sl, i) => {
    assert.equal(sl.z0, (plain[i]?.z0 as number) + i * 1000);
    assert.equal(sl.z1 - sl.z0, (plain[i]?.z1 as number) - (plain[i]?.z0 as number));
    assert.ok(Number.isInteger(sl.z0) && Number.isInteger(sl.z1));
  });
  const only = floorSlabs(m, 1000, 2);
  assert.equal(only.length, 1);
  assert.equal(only[0]?.label, "2F");
  assert.equal(only[0]?.z0, ex[1]?.z0);
  assert.equal(levelLabel(0), "B1");
  assert.equal(levelLabel(-1), "B2");
  assert.deepEqual(floorTabLevels(house), [...new Set(house.masses.flatMap((x) => x.floors.map((f) => f.level)))].sort((a, b) => a - b));
  assert.equal(effectiveFloorOnly(house, 99), null, "없는 층은 전체");
  assert.equal(effectiveFloorOnly(house, 1), 1);
});

test("삼각형 상한: 층 판 삼각형 수 = 실제 메시, 상한을 넘으면 층별 표시를 하지 않는다", () => {
  const m = house.masses[0] as Mass;
  const mesh = slabMesh(m, 0, 3000);
  assert.ok(mesh);
  assert.equal(mesh.index.length / 3, slabTriangles(m));
  const holed: Mass = { ...m, footprint: { outer: rectOuter(0, 0, 10_000, 10_000), holes: [rectOuter(3000, 3000, 2000, 2000).reverse()] } };
  assert.equal((slabMesh(holed, 0, 3000)?.index.length ?? 0) / 3, slabTriangles(holed));
  assert.ok(splitAllowed(house, 3000, null));
  // 꼭짓점 400개 × 60층 × 200매스 → 상한 초과
  const ring = Array.from({ length: 400 }, (_, i) => [Math.round(10_000 * Math.cos((2 * Math.PI * i) / 400)), Math.round(10_000 * Math.sin((2 * Math.PI * i) / 400))] as [number, number]);
  const big: Mass = { ...m, footprint: { outer: ring }, floors: Array.from({ length: 60 }, (_, i) => ({ ...(m.floors[0] as Mass["floors"][number]), id: `f${i}`, level: i + 1 })) };
  const huge: Model = { ...house, masses: Array.from({ length: 200 }, (_, i) => ({ ...big, id: `m-${i + 1}` })) };
  assert.ok(splitTriangles(huge, 1000, null) > MAX_TRIANGLES);
  assert.equal(splitAllowed(huge, 1000, null), false);
  // 그 층만이면 1/60 → 상한 안
  assert.ok(splitTriangles(huge, 0, 1) <= MAX_TRIANGLES);
  assert.equal(splitAllowed(huge, 0, 1), true);
});

test("분해도 중 측정 막음: 도구 전환·점 찍기 거부 + 안내, 측정 중 분해도를 켜면 선택 도구로, 층 숨김만이면 허용", () => {
  const s0 = createModelerState(house);
  const ex = run(s0, patch({ explodeMm: 1000 }));
  assert.equal(explodeActive(house, ex.display), true);
  const t = run(ex, { type: "tool", tool: "measure" });
  assert.equal(t.tool, "select", "측정 도구로 바뀌지 않음");
  assert.equal(t.notice?.text, EXPLODE_MEASURE_TEXT);
  assert.equal(t.notice?.tone, "warn");
  // 측정 중 분해도 켜기 → 선택 도구, 기존 측정은 유지
  const m = run(s0, { type: "tool", tool: "measure" }, { type: "measurePoint", point: [0, 0, 0] }, { type: "measurePoint", point: [1000, 0, 0] }, { type: "measurePoint", point: [5, 5, 0] });
  const m2 = run(m, patch({ explodeMm: 3000 }));
  assert.equal(m2.tool, "select");
  assert.equal(m2.measureStart, null);
  assert.equal(m2.measures.length, 1);
  assert.equal(m2.notice?.text, EXPLODE_MEASURE_TEXT);
  // 리듀서 이중 차단: 측정 도구 상태에서 분해도가 켜져 있으면 점을 받지 않는다
  const forced: ModelerState = { ...m, display: { ...m.display, explodeMm: 1000 } };
  const f2 = run(forced, { type: "measurePoint", point: [2000, 0, 0] });
  assert.equal(f2.measures.length, 1);
  assert.equal(f2.notice?.text, EXPLODE_MEASURE_TEXT);
  // 층 숨김만이면 측정 허용
  const only = run(s0, patch({ floorOnly: 1 }), { type: "tool", tool: "measure" });
  assert.equal(only.tool, "measure");
  assert.equal(explodeActive(house, only.display), false);
});

test("삼각형 상한 초과: 분해도는 그리지 않으므로 측정 허용, 층 탭·표시 절은 같은 판정(splitOverLimit)", () => {
  const m = house.masses[0] as Mass;
  const ring = Array.from({ length: 400 }, (_, i) => [Math.round(10_000 * Math.cos((2 * Math.PI * i) / 400)), Math.round(10_000 * Math.sin((2 * Math.PI * i) / 400))] as [number, number]);
  const big: Mass = { ...m, footprint: { outer: ring }, floors: Array.from({ length: 60 }, (_, i) => ({ ...(m.floors[0] as Mass["floors"][number]), id: `f${i}`, level: i + 1 })) };
  const huge: Model = { ...house, masses: Array.from({ length: 200 }, (_, i) => ({ ...big, id: `m-${i + 1}` })) };
  const d: DisplaySettings = { ...DEFAULT_DISPLAY, explodeMm: 1000 };
  assert.equal(splitOverLimit(huge, d), true);
  assert.equal(explodeActive(huge, d), false);
  assert.equal(splitOverLimit(house, d), false);
  assert.equal(splitOverLimit(huge, DEFAULT_DISPLAY), false, "아무것도 안 켜면 안내 없음");
});

test("보관: localStorage 접근이 예외를 던져도 loadDisplay는 기본값, saveDisplay는 조용히 무시", () => {
  const g = globalThis as { localStorage?: unknown };
  const had = Object.getOwnPropertyDescriptor(g, "localStorage");
  const boom = () => {
    throw new Error("SecurityError");
  };
  try {
    // 1) getItem·setItem이 던짐
    Object.defineProperty(g, "localStorage", { configurable: true, value: { getItem: boom, setItem: boom } });
    assert.deepEqual(loadDisplay(), DEFAULT_DISPLAY);
    assert.doesNotThrow(() => saveDisplay({ ...DEFAULT_DISPLAY, shadows: true }));
    // 2) localStorage 접근 자체가 던짐
    Object.defineProperty(g, "localStorage", { configurable: true, get: boom });
    assert.deepEqual(loadDisplay(), DEFAULT_DISPLAY);
    assert.doesNotThrow(() => saveDisplay(DEFAULT_DISPLAY));
    // 3) 정상 저장소: 왕복(층 숨김 제외)
    const mem = new Map<string, string>();
    Object.defineProperty(g, "localStorage", { configurable: true, value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } });
    saveDisplay({ ...DEFAULT_DISPLAY, lighting: "noon", floorOnly: 2 });
    assert.deepEqual(loadDisplay(), { ...DEFAULT_DISPLAY, lighting: "noon" });
  } finally {
    if (had) Object.defineProperty(g, "localStorage", had);
    else delete g.localStorage;
  }
});
