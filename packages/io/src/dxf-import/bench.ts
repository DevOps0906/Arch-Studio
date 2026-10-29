// 20MB급 합성 DXF 파싱 시간·메모리 측정(AR-06-029). 테스트 밖에서 수동 실행:
//   node --expose-gc packages/io/src/dxf-import/bench.ts <mixed|rects|lines|poly>
// 결과는 tasks/logs/AR-06-029.md에 기기 사양과 함께 기록한다. 입력은 고정 시드 LCG(Park–Miller)라 항상 같다.
// eslint-disable-next-line no-restricted-imports -- 벤치 스크립트는 OS 정보만 읽는다(엔진 코드 아님)
import { cpus } from "node:os";
import { doc, line, lwpoly, rect } from "./fixtures.ts";
import { importDxf } from "./index.ts";

let seed = 20261029;
const rand = (): number => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
const TARGET = 20 * 1024 * 1024 - 4096; // 20MB 상한 바로 아래

function build(kind: string): string {
  const parts: string[] = [rect("A-SITE-BNDY", 0, 0, 200000, 150000)];
  let bytes = parts[0]?.length ?? 0;
  let i = 0;
  while (bytes < TARGET - 8000) {
    const x = Math.floor(rand() * 190000);
    const y = Math.floor(rand() * 140000);
    let s: string;
    if (kind === "rects") s = rect("PLAN", x, y, x + 2000 + (i % 7) * 100, y + 1500);
    else if (kind === "lines") {
      // 4선분으로 이어진 사각형(끝점 이음 그래프)
      s = line("PLAN", x, y, x + 3000, y) + line("PLAN", x + 3000, y, x + 3000, y + 2000) + line("PLAN", x + 3000, y + 2000, x, y + 2000) + line("PLAN", x, y + 2000, x, y);
    } else if (kind === "poly") {
      // 꼭짓점 200개 불룩 폴리라인 다수(호 근사·꼭짓점 상한 경로)
      const pts: Array<[number, number, number]> = [];
      for (let k = 0; k < 200; k++) pts.push([x + k * 10, y + (k % 2) * 5, k % 17 === 0 ? 0.3 : 0]);
      s = lwpoly("PLAN", pts, false);
    } else {
      s = i % 3 === 0 ? rect("PLAN", x, y, x + 2500, y + 1800) : line("PLAN", x, y, x + rand() * 5000, y + rand() * 5000);
    }
    parts.push(s);
    bytes += s.length;
    i++;
  }
  return doc({ insunits: 4, entities: parts });
}

const kind = process.argv[2] ?? "mixed";
const text = build(kind);
const bytes = new Uint8Array(text.length);
for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
(globalThis as { gc?: () => void }).gc?.();
const mem0 = process.memoryUsage();
const t0 = process.hrtime.bigint();
const r = importDxf(bytes);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const mem1 = process.memoryUsage();
const peakKb = process.resourceUsage().maxRSS;
console.log(
  JSON.stringify({
    kind,
    file_mb: +(bytes.length / 1048576).toFixed(2),
    ms: Math.round(ms),
    ok: r.ok,
    status: r.ok ? r.status : r.error.code,
    candidates: r.ok && r.status === "ok" ? r.candidates.length : 0,
    top_area_mm2: r.ok && r.status === "ok" ? r.candidates[0]?.area_mm2 : undefined,
    stats: r.ok ? r.stats : undefined,
    heap_delta_mb: +((mem1.heapUsed - mem0.heapUsed) / 1048576).toFixed(1),
    rss_delta_mb: +((mem1.rss - mem0.rss) / 1048576).toFixed(1),
    max_rss_mb_whole_process: +(peakKb / 1024).toFixed(0),
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    node: process.version,
  }),
);
