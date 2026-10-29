// DXF 쓰기 벤치(AR-06-021 완료 조건: 시트 1장 쓰기 p95 2초·20MB 이하). 수동 실행: pnpm --filter @arch-studio/drafting bench:dxf
// 시트: 매스 50·실 200(020 벤치와 같은 규모) + 실마다 SOLID 해치·문 INSERT. 쓰기(writeDxf)만 잰다. 결과는 tasks/logs/AR-06-021.md.
import { buildSheet, validateDraftingInput, type Prim } from "../../src/index.ts";
import { sampleInput, sampleModel, sampleView } from "../../src/sheet/test-fixtures.ts";
import { DXF_MAX_BYTES, writeDxf } from "../../src/writers/dxf/index.ts";

const model = sampleModel({ w: 60_000, h: 40_000, masses: 50, rooms: 200 });
const v = validateDraftingInput(sampleInput(model));
if (!v.ok) throw new Error(v.issues.join("\n"));
const view = sampleView(v.input.model);
const main = view.views[0] as (typeof view.views)[number];
for (const l of v.input.model.floor_layouts) {
  for (const r of l.rooms) {
    const ring = r.polygon.outer.map(([x, y]) => [x, y] as [number, number]);
    main.prims.push({ layer: "A-AREA", key: `hatch:${r.id}`, t: "hatch", pattern: "SOLID", loops: [ring] } as Prim<number>);
    main.prims.push({ layer: "A-DOOR", key: `door:${r.id}`, t: "insert", block: "DOOR-900", at: ring[0] as [number, number], rot_deg: 0 } as Prim<number>);
  }
}
view.blocks = [
  {
    name: "DOOR-900",
    entities: [
      { layer: "A-DOOR", key: "leaf", t: "line", a: [0, 0], b: [0, 900] },
      { layer: "A-DOOR", key: "swing", t: "arc", c: [0, 0], r: 900, a0: 0, a1: 90 },
    ],
  },
];
const { sheet } = buildSheet(v.input, view);

const runs = 50;
writeDxf(sheet); // 예열
const times: number[] = [];
let bytes = 0;
for (let i = 0; i < runs; i++) {
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  const t0 = performance.now();
  bytes = writeDxf(sheet).byte_length;
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const pick = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] as number).toFixed(1);
const p95 = Number(pick(0.95));
console.log(`node ${process.version}, 뷰 요소 ${main.prims.length}, DXF ${(bytes / 1024 / 1024).toFixed(2)}MB`);
console.log(`writeDxf  median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${runs})`);
if (p95 > 2000 || bytes > DXF_MAX_BYTES) {
  console.error("예산 초과: p95 2초 또는 20MB");
  process.exit(1);
}

// 상한 근처 시트: 뷰에 LWPOLYLINE 4만 개(각 5점) — 크기·시간이 선형인지 본다.
const heavy = structuredClone(sheet);
const hv = heavy.views[0] as (typeof heavy.views)[number];
for (let i = 0; i < 40_000; i++) {
  const x = (i % 200) * 300;
  const y = Math.floor(i / 200) * 200;
  hv.prims.push({ layer: "A-WALL", key: `w:${String(i).padStart(6, "0")}`, t: "pline", closed: true, pts: [[x, y], [x + 250, y], [x + 250, y + 150], [x, y + 150], [x + 10, y + 10]] });
}
const ht: number[] = [];
let hb = 0;
for (let i = 0; i < 5; i++) {
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  const t0 = performance.now();
  const r = writeDxf(heavy);
  // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
  ht.push(performance.now() - t0);
  hb = r.byte_length;
}
ht.sort((a, b) => a - b);
console.log(`큰 시트: 뷰 요소 ${hv.prims.length}, DXF ${(hb / 1024 / 1024).toFixed(2)}MB, writeDxf max ${(ht[ht.length - 1] as number).toFixed(1)}ms (n=5)`);
