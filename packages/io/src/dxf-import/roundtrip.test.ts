// 라운드트립(AR-06-029): DXF 작성기(AR-06-021)가 만든 골든을 읽기 전용으로 가져와 가져오기 파서로 되읽는다.
// 대지 경계(A-SITE-BNDY) 폴리곤이 후보 1순위로 복원되어야 한다. 골든 경로는 읽기만 하고 packages/drafting 코드는 import하지 않는다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { existsSync, readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { importDxf } from "./index.ts";

const GOLDEN = new URL("../../../drafting/golden/", import.meta.url);

interface Prim {
  t: string;
  layer: string;
  closed?: boolean;
  pts?: Array<[number, number]>;
}
interface Input {
  sheet: { views: Array<{ origin: [number, number]; prims: Prim[] }> };
}

/** (x, y) 사전순 최소 꼭짓점에서 시작하는 반시계 고리. */
function canon(pts: Array<[number, number]>): Array<[number, number]> {
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as [number, number];
    const q = pts[(i + 1) % pts.length] as [number, number];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  const ring = a2 < 0 ? [pts[0] as [number, number], ...pts.slice(1).reverse()] : [...pts];
  let b = 0;
  ring.forEach((p, i) => {
    const q = ring[b] as [number, number];
    if (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) b = i;
  });
  return [...ring.slice(b), ...ring.slice(0, b)];
}

const dirs = readdirSync(GOLDEN)
  .filter((d) => d.startsWith("writer-") && existsSync(new URL(`${d}/input.json`, GOLDEN)))
  .sort();

test("골든 디렉터리 20건 이상", () => {
  assert.ok(dirs.length >= 20, `${dirs.length}건`);
});

let withSite = 0;
for (const d of dirs) {
  const input = JSON.parse(readFileSync(new URL(`${d}/input.json`, GOLDEN), "utf8")) as Input;
  const files = readdirSync(new URL(`${d}/`, GOLDEN)).filter((f) => f.endsWith(".dxf"));
  const ref = input.sheet.views[0]?.origin ?? [0, 0];
  // 작성기는 뷰 원점 차이(축척 k=1일 때 mm)만큼 옮겨 쓴다 — 축척이 다른 시트는 대지가 뷰 좌표(mm) 그대로다.
  const expected: Array<Array<[number, number]>> = [];
  for (const v of input.sheet.views) {
    for (const p of v.prims) {
      if (p.t === "pline" && p.closed && p.layer === "A-SITE-BNDY" && p.pts) {
        expected.push(canon(p.pts.map(([x, y]) => [x + (v.origin[0] - ref[0]), y + (v.origin[1] - ref[1])] as [number, number])));
      }
    }
  }
  for (const f of files) {
    test(`라운드트립 ${d}/${f}`, () => {
      const bytes = readFileSync(new URL(`${d}/${f}`, GOLDEN));
      const r = importDxf(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      assert.equal(r.ok, true, JSON.stringify(r));
      if (!r.ok || r.status !== "ok") return;
      assert.equal(r.unit.unit, "mm");
      assert.equal(r.unit.source, "insunits"); // 작성기는 $INSUNITS=4를 쓴다
      assert.equal(r.unit.needs_confirmation, false);
      if (expected.length === 0) return;
      withSite++;
      const top = r.candidates[0];
      assert.ok(top, "후보 없음");
      assert.equal(top.layer_hint, "site");
      // 사무소 레이어 매핑으로 이름이 바뀐 골든(대지경계 등)도 한글 힌트로 site가 된다
      assert.ok(top.layer === "A-SITE-BNDY" || d.includes("layer-map"), top.layer);
      assert.ok(
        expected.some((e) => JSON.stringify(e) === JSON.stringify(top.polygon.outer)),
        `1순위가 작성 대지와 다름: ${JSON.stringify(top.polygon.outer)} ∉ ${JSON.stringify(expected)}`,
      );
      assert.deepEqual(top.polygon.holes, []);
      // 같은 입력은 같은 출력
      assert.deepEqual(importDxf(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)), r);
    });
  }
}

test("대지 경계가 있는 골든이 충분히 많다(라운드트립이 실제로 검증됨)", () => {
  assert.ok(withSite >= 10, `대지 있는 골든 ${withSite}건`);
});
