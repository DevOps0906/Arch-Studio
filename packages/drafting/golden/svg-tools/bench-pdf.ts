// PDF 묶음 벤치(AR-06-022 완료 조건: 시트 10장 PDF p95 10초, 02_ARCHITECTURE.md 2.3절 성능 예산). 수동 실행(packages/drafting에서):
//   node golden/svg-tools/bench-pdf.ts            — 번들 Noto Sans KR 임베드(기본)
//   ARCH_BENCH_NO_FONT=1 node golden/svg-tools/bench-pdf.ts — 대체 글꼴(helvetica)
// 시트: 매스 50·실 200(DXF 벤치와 같은 규모) + 실마다 해치(짝수 SOLID·홀수 ANSI31)·문 INSERT, 10장. writePdf·writeSvg만 잰다.
// eslint-disable-next-line no-restricted-imports -- 해시
import { createHash } from "node:crypto";
import { buildSheet, validateDraftingInput, type Prim, type SheetModel } from "../../src/index.ts";
import { sampleInput, sampleModel, sampleView } from "../../src/sheet/test-fixtures.ts";
import { writePdf, type PdfOptions } from "../../src/writers/pdf/index.ts";
import { loadBundledFont, loadBundledMetrics } from "../../src/writers/pdf/node.ts";
import { writeSvg } from "../../src/writers/svg/index.ts";

const model = sampleModel({ w: 60_000, h: 40_000, masses: 50, rooms: 200 });
const v = validateDraftingInput(sampleInput(model));
if (!v.ok) throw new Error(v.issues.join("\n"));
const view = sampleView(v.input.model);
const main = view.views[0] as (typeof view.views)[number];
let n = 0;
for (const l of v.input.model.floor_layouts) {
  for (const r of l.rooms) {
    const ring = r.polygon.outer.map(([x, y]) => [x, y] as [number, number]);
    main.prims.push({ layer: "A-AREA", key: `hatch:${r.id}`, t: "hatch", pattern: n++ % 2 === 0 ? "SOLID" : "ANSI31", loops: [ring] } as Prim<number>);
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
const base = buildSheet(v.input, view).sheet;
const sheets: SheetModel[] = Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(base), sheet_id: `s${i + 1}` }));

// eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 환경 변수로 글꼴 사용 여부를 받는다
const useFont = process.env.ARCH_BENCH_NO_FONT === undefined;
const opts: PdfOptions = useFont ? { font: loadBundledFont(), metrics: loadBundledMetrics() } : {};
const sha = (u8: Uint8Array) => createHash("sha256").update(u8).digest("hex").slice(0, 16);

function bench(label: string, runs: number, f: () => number): void {
  f(); // 예열
  const times: number[] = [];
  let size = 0;
  for (let i = 0; i < runs; i++) {
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    const t0 = performance.now();
    size = f();
    // eslint-disable-next-line no-restricted-properties -- 벤치 스크립트(엔진 밖)는 시간을 잰다
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pick = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] as number).toFixed(1);
  console.log(`${label}  median ${pick(0.5)}ms  p95 ${pick(0.95)}ms  max ${pick(1)}ms  (n=${runs}, ${(size / 1024).toFixed(0)}KB)`);
  if (Number(pick(0.95)) > 10_000) {
    console.error("예산 초과: 시트 10장 PDF p95 10초");
    process.exit(1);
  }
}

console.log(`node ${process.version}, 시트 10장 × 뷰 요소 ${main.prims.length}, 글꼴 ${useFont ? "Noto Sans KR 임베드(번들 부분 집합)" : "helvetica(대체)"}`);
for (const compress of [true, false]) {
  bench(`writePdf 10장 compress=${compress}`, 20, () => writePdf(sheets, { ...opts, compress }).bytes.length);
}
bench("writeSvg 1장", 50, () => writeSvg(base).length);
const r = writePdf(sheets, opts);
console.log(`쪽 ${r.page_count}, 경고 ${r.warnings.map((w) => w.code).join(",") || "없음"}, sha256 ${sha(r.bytes)} = ${sha(writePdf(sheets, opts).bytes)}`);
