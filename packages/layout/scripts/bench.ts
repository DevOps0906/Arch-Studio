// 경계 이동 후 면적·목표 차이 갱신 벤치(PRD AR-F-032·9.5절 "평면 편집 반영 p95 100ms", layout만).
// 수동 실행(packages/layout에서): node scripts/bench.ts  — 결과는 tasks/logs/AR-06-026.md.
// 입력: 층 외곽 60×20m에 실 200개(20×10 격자, 3000×2000), 문·창 200개, 목표 면적 200행. 시드 고정 LCG로 이동을 고른다.
// eslint-disable-next-line no-restricted-imports -- 벤치 스크립트는 OS 정보만 읽는다(엔진 코드 아님)
import { cpus } from "node:os";
import type { Polygon } from "@arch-studio/domain";
import { union } from "@arch-studio/geometry";
import { createLayoutStateFrom, moveBoundary, validateLayoutResult, type FloorLayout, type LayoutState } from "../src/index.ts";

const rect = (x: number, y: number, w: number, h: number): Polygon => ({ outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
const COLS = 20;
const ROWS = 10;
const W = 3_000;
const H = 2_000;
const rooms: FloorLayout["rooms"] = [];
const openings: FloorLayout["openings"] = [];
for (let i = 0; i < COLS * ROWS; i++) {
  const id = `r${String(i).padStart(3, "0")}`;
  rooms.push({ id, name: `실${i}`, use: "주거", polygon: rect((i % COLS) * W, Math.floor(i / COLS) * H, W, H) });
  openings.push({ id: `d${id}`, kind: i % 2 === 0 ? "door" : "window", host: { room_id: id, edge_index: 0 }, offset_mm: 500, width_mm: 900 });
}
const targets = rooms.map((r, i) => ({ name: r.name, use: "주거", target_area_m2: 5 + (i % 5) }));
const outline = union([rect(0, 0, COLS * W, ROWS * H)]);

let seed = 20261029;
const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;

function time(fn: () => void): number {
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  const t0 = performance.now();
  fn();
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  return performance.now() - t0;
}
const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const pick = (p: number) => (s[Math.min(s.length - 1, Math.floor(p * s.length))] as number).toFixed(2);
  return `median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${s.length})`;
};

let state: LayoutState = createLayoutStateFrom("f1", outline, { rooms, openings }, targets);
const full: number[] = [];
for (let i = 0; i < 30; i++) full.push(time(() => validateLayoutResult(createLayoutStateFrom("f1", outline, { rooms, openings }, targets))));

const moves: number[] = [];
for (let i = 0; i < 520; i++) {
  // 내부 공유 경계를 끈다: 오른쪽 변(1번)과 이웃의 왼쪽 변(3번)을 같은 양만큼(±100mm 격자). 가끔 한쪽만 옮겨 겹침을 만든다.
  const c = Math.floor(rand() * (COLS - 1));
  const r = Math.floor(rand() * ROWS);
  const a = `r${String(r * COLS + c).padStart(3, "0")}`;
  const b = `r${String(r * COLS + c + 1).padStart(3, "0")}`;
  const d = (rand() < 0.5 ? -1 : 1) * 100;
  const pair = rand() < 0.8;
  const t = time(() => {
    state = moveBoundary(state, pair ? [{ room_id: a, edge_index: 1, dx_mm: d, dy_mm: 0 }, { room_id: b, edge_index: 3, dx_mm: d, dy_mm: 0 }] : { room_id: a, edge_index: 1, dx_mm: d, dy_mm: 0 });
    validateLayoutResult(state);
  });
  if (i >= 20) moves.push(t); // 예열 20회 제외
}
console.log(`node ${process.version}, ${cpus()[0]?.model ?? "?"}; 실 ${rooms.length}, 문·창 ${openings.length}, 마지막 위반 ${state.issues.length}건`);
console.log(`경계 이동 → 면적·목표 차이·AR051 갱신(moveBoundary + validateLayoutResult)  ${stat(moves)}`);
console.log(`전체 검사(createLayoutStateFrom + validateLayoutResult)                    ${stat(full)}`);
