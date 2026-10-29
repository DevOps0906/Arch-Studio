// 스파이크(버리는 코드): Node worker_threads로 메시 버퍼 왕복 비용(Transferable vs 구조적 복제). 브라우저 값은 하니스가 잰다.
import { mkdirSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { stats } from "../src/geom/scene.ts";

const w = new Worker(`const { parentPort } = require("node:worker_threads"); parentPort.on("message", (m) => parentPort.postMessage(m, m.transfer ? [m.p.buffer, m.i.buffer] : []));`, { eval: true });
const out: Record<string, unknown> = {};
for (const tris of [7000, 38200, 203800]) {
  const row: Record<string, unknown> = { tris, bytes: tris * 3 * 4 + tris * 3 * 4 };
  for (const transfer of [true, false]) {
    const ts: number[] = [];
    for (let k = 0; k < 31; k++) {
      // 공유 꼭짓점 메시 근사: 꼭짓점 ≈ 삼각형/2 × 3 좌표, 인덱스 = 삼각형 × 3
      const p = new Float32Array(Math.round(tris / 2) * 3 * 2);
      const i = new Uint32Array(tris * 3);
      const t0 = performance.now();
      await new Promise<void>((res) => {
        w.once("message", () => res());
        w.postMessage({ p, i, transfer }, transfer ? [p.buffer, i.buffer] : []);
      });
      if (k > 0) ts.push(performance.now() - t0);
    }
    row[transfer ? "transferable_roundtrip_ms" : "clone_roundtrip_ms"] = stats(ts);
  }
  console.log(row);
  out[`t${tris}`] = row;
}
await w.terminate();
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/transfer-node.json", import.meta.url), JSON.stringify(out, null, 2));
