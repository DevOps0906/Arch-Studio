// 시트 1장 생성 벤치(매스 50, 실 200; PRD 9.5절 p95 1초, 개발서 12.8절). 테스트 밖 수동 실행: pnpm --filter @arch-studio/drafting bench
// 뷰 생성기(023~026)가 아직 없어 test-fixtures의 단순 뷰 + 매스 외곽 합집합(geometry)으로 대신한다. 결과는 tasks/logs/AR-06-020.md.
// (쓰기 범위가 src/sheet/**라 scripts/가 아니라 여기 둔다. tsconfig에서 제외, 배포 코드에서 import하지 않는다.)
import { union } from "@arch-studio/geometry";
import { buildSheet, validateDraftingInput } from "../index.ts";
import type { Prim } from "./types.ts";
import { sampleInput, sampleModel, sampleView } from "./test-fixtures.ts";

const model = sampleModel({ w: 60_000, h: 40_000, masses: 50, rooms: 200 });
const raw = sampleInput(model);

function once(): number {
  const v = validateDraftingInput(raw);
  if (!v.ok) throw new Error(v.issues.join("\n"));
  const view = sampleView(v.input.model);
  const outline = union(v.input.model.masses.map((m) => m.footprint));
  outline.forEach((p, i) =>
    view.views[0]?.prims.push({ layer: "A-MASS", key: `outline:${i}`, t: "pline", closed: true, pts: p.outer } as Prim<number>),
  );
  const { sheet } = buildSheet(v.input, view);
  return sheet.views[0]?.prims.length ?? 0;
}

const runs = 50;
once(); // 예열
const times: number[] = [];
let prims = 0;
for (let i = 0; i < runs; i++) {
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  const t0 = performance.now();
  prims = once();
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const pick = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] as number).toFixed(1);
console.log(`node ${process.version}, 매스 ${model.masses.length}, 실 ${model.floor_layouts[0]?.rooms.length}, 뷰 요소 ${prims}`);
console.log(`validate + buildSheet  median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${runs})`);
