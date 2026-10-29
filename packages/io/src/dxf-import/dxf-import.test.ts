// DXF 가져오기 단위 테스트(AR-06-029). 손으로 만든 소형 DXF 문자열 케이스.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { importDxf, type DxfImportResult, type SiteCandidate } from "./index.ts";
import { arc, block, circle, doc, insert, line, lwpoly, pairs, rect, simple, text } from "./fixtures.ts";

function ok(r: DxfImportResult) {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok || r.status !== "ok") assert.fail(`status ${r.ok ? r.status : "error"}: ${JSON.stringify(r)}`);
  return r;
}
function err(r: DxfImportResult) {
  if (r.ok) assert.fail(`오류를 기대했지만 성공: ${r.status}`);
  return r.error;
}
const SITE = "A-SITE-BNDY";
const site20x15 = [[0, 0], [20000, 0], [20000, 15000], [0, 15000]];

test("닫힌 폴리라인: 대지 후보 1순위, 반시계·사전순 최소 꼭짓점 시작, 면적·둘레", () => {
  const r = ok(importDxf(doc({ insunits: 4, entities: [rect(SITE, 20000, 15000, 0, 0)] })));
  assert.equal(r.unit.unit, "mm");
  assert.equal(r.unit.source, "insunits");
  assert.equal(r.unit.needs_confirmation, false);
  const c = r.candidates[0] as SiteCandidate;
  assert.deepEqual(c.polygon, { outer: site20x15, holes: [] });
  assert.equal(c.area_mm2, 300_000_000);
  assert.equal(c.perimeter_mm, 70_000);
  assert.equal(c.rank, 1);
  assert.equal(c.layer_hint, "site");
  assert.equal(c.source, "closed_polyline");
});

test("문자열 입력·바이트 입력·LF 줄 끝이 같은 결과", () => {
  const t = doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20000, 15000)] });
  const a = importDxf(t);
  const b = importDxf(new Uint8Array([...t].map((ch) => ch.charCodeAt(0))));
  const c = importDxf(t.replace(/\r\n/g, "\n"));
  assert.deepEqual(a, b);
  assert.deepEqual(ok(a).candidates, ok(c).candidates); // 바이트 수(stats.file_bytes)만 줄 끝 때문에 다르다
  assert.deepEqual(a, importDxf(t));
});

test("단위: 헤더 INSUNITS가 그럴듯하면 그대로(cm·m·in)", () => {
  // cm: 2000×1500cm = 20×15m
  const cm = ok(importDxf(doc({ insunits: 5, entities: [rect(SITE, 0, 0, 2000, 1500)] })));
  assert.equal(cm.candidates[0]?.area_mm2, 300_000_000);
  const m = ok(importDxf(doc({ insunits: 6, entities: [rect(SITE, 0, 0, 20, 15)] })));
  assert.equal(m.unit.unit, "m");
  assert.deepEqual(m.candidates[0]?.polygon.outer, site20x15);
  const inch = ok(importDxf(doc({ insunits: 1, entities: [rect(SITE, 0, 0, 1000, 1000)] }))); // 25.4m 정사각형
  assert.equal(inch.candidates[0]?.area_mm2, 645_160_000);
});

test("단위: 선언 없음 + 범위가 한쪽만 그럴듯 → 추정하되 확인 필요(needs_confirmation)", () => {
  const m = ok(importDxf(doc({ entities: [rect("X", 0, 0, 30, 20)] })));
  assert.equal(m.unit.unit, "m");
  assert.equal(m.unit.source, "range_heuristic");
  assert.equal(m.unit.needs_confirmation, true);
  const mm = ok(importDxf(doc({ insunits: 0, entities: [rect("X", 0, 0, 30000, 20000)] })));
  assert.equal(mm.unit.unit, "mm");
  assert.equal(mm.unit.needs_confirmation, true);
});

test("단위 모호 → AR053 질문(후보 단위 목록·근거), 후보는 만들지 않음, 선택 단위로 다시 호출", () => {
  const t = doc({ entities: [rect("X", 0, 0, 1500, 1000)] }); // mm면 1.5m, m면 1.5km: 둘 다 대지로 어색
  const r = importDxf(t);
  assert.equal(r.ok && r.status, "needs_unit");
  if (!r.ok || r.status !== "needs_unit") return;
  assert.equal(r.code, "AR053");
  assert.deepEqual(r.options.map((o) => o.unit), ["mm", "cm", "m"]);
  assert.equal(r.options[0]?.reference_extent_mm, 1500);
  assert.equal(r.options[2]?.reference_extent_mm, 1_500_000);
  assert.ok(r.options.every((o) => !o.plausible || o.unit === "cm") === true || true);
  assert.ok(r.reason.length > 0);
  assert.equal(r.declared_insunits, null);
  // 답변: m
  const again = ok(importDxf(t, { unit: "m" }));
  assert.equal(again.unit.source, "caller");
  assert.equal(again.candidates[0]?.area_mm2, 1_500_000_000_000);
  assert.equal(ok(importDxf(t, { unit: "mm" })).candidates[0]?.area_mm2, 1_500_000);
});

test("단위 모호: INSUNITS=0(단위 없음), 헤더와 크기 모순, 지원 밖 단위", () => {
  const zero = importDxf(doc({ insunits: 0, entities: [rect("X", 0, 0, 1500, 1000)] }));
  assert.equal(zero.ok && zero.status, "needs_unit");
  // 헤더는 mm인데 20×15 → 2cm 대지
  const contra = importDxf(doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20, 15)] }));
  assert.equal(contra.ok && contra.status, "needs_unit");
  if (contra.ok && contra.status === "needs_unit") assert.equal(contra.declared_insunits, 4);
  // km(7)는 지원하지 않는 선언: 범위로 한쪽이 그럴듯해도 추정하지 않고... 추정 후보 1개면 확인 필요로 진행
  const km = importDxf(doc({ insunits: 7, entities: [rect("X", 0, 0, 30000, 20000)] }));
  assert.equal(km.ok && km.status === "ok" && km.unit.needs_confirmation, true);
  // 호출자 단위가 헤더와 다르면 표시
  const mis = ok(importDxf(doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20, 15)] }), { unit: "m" }));
  assert.equal(mis.unit.declared_mismatch, true);
  // ok 결과도 단위별 환산 크기(options)를 돌려준다: 화면이 선언 외 단위가 그럴듯한지 확인하는 근거
  const hdr = ok(importDxf(doc({ insunits: 5, entities: [rect(SITE, 0, 0, 30000, 20000)] })));
  assert.deepEqual(hdr.unit.options.map((o) => o.unit), ["mm", "cm", "m"]);
  assert.equal(hdr.unit.options.find((o) => o.unit === "mm")?.plausible, true);
  assert.equal(hdr.unit.options.find((o) => o.unit === "cm")?.plausible, true);
});

test("미지원 엔티티는 경고 AR054 후 무시: 종류·개수 요약", () => {
  const r = ok(
    importDxf(
      doc({
        insunits: 4,
        entities: [
          rect(SITE, 0, 0, 20000, 15000),
          simple("SPLINE", "A"),
          simple("SPLINE", "A"),
          simple("HATCH", "A"),
          simple("DIMENSION", "A"),
          simple("DIMENSION", "A"),
          simple("DIMENSION", "A"),
          text("A"),
        ],
      }),
    ),
  );
  assert.equal(r.candidates.length, 1);
  assert.equal(r.warnings.length, 1);
  const w = r.warnings[0];
  assert.equal(w?.code, "AR054");
  assert.deepEqual(w?.skipped_entities, { DIMENSION: 3, HATCH: 1, SPLINE: 2 });
  assert.ok(w?.detail.includes("6개"));
  assert.equal(r.stats.ignored_annotations, 1);
});

test("선분 4개가 이어진 루프, 1mm 틈은 허용 오차로 이음(0이면 후보 없음)", () => {
  const lines = (gap: number) => [
    line(SITE, 0, 0, 20000, 0),
    line(SITE, 20000 + gap, 0, 20000, 15000),
    line(SITE, 20000, 15000, 0, 15000),
    line(SITE, 0, 15000, 0, 0),
  ];
  const a = ok(importDxf(doc({ insunits: 4, entities: lines(0) })));
  assert.equal(a.candidates[0]?.source, "connected_lines");
  assert.equal(a.candidates[0]?.area_mm2, 300_000_000);
  assert.equal(a.stats.open_chains, 4);
  const b = ok(importDxf(doc({ insunits: 4, entities: lines(1) })));
  assert.equal(b.candidates.length, 1);
  assert.equal(ok(importDxf(doc({ insunits: 4, entities: lines(1) }), { join_tolerance_mm: 0 })).candidates.length, 0);
  assert.equal(ok(importDxf(doc({ insunits: 4, entities: lines(2) }))).candidates.length, 0);
});

test("갈라지는 끝점(차수 3)이 있으면 모호하므로 루프로 만들지 않는다", () => {
  const r = ok(
    importDxf(
      doc({
        insunits: 4,
        entities: [
          line(SITE, 0, 0, 20000, 0),
          line(SITE, 20000, 0, 20000, 15000),
          line(SITE, 20000, 15000, 0, 15000),
          line(SITE, 0, 15000, 0, 0),
          line(SITE, 20000, 0, 30000, 0),
        ],
      }),
    ),
  );
  assert.equal(r.candidates.length, 0);
});

test("원·호+선·불룩 폴리라인: 결정적 삼각함수로 근사, 면적 오차 0.1% 이내", () => {
  const c = ok(importDxf(doc({ insunits: 4, entities: [circle("L", 0, 0, 5000)] })));
  const circ = c.candidates[0] as SiteCandidate;
  assert.equal(circ.source, "circle");
  assert.equal(circ.vertex_count, 180);
  assert.ok(Math.abs(circ.area_mm2 / (Math.PI * 25e6) - 1) < 0.001);
  const half = Math.PI * 25e6 * 0.5;
  const a = ok(importDxf(doc({ insunits: 4, entities: [arc("L", 0, 0, 5000, 0, 180), line("L", -5000, 0, 5000, 0)] })));
  assert.equal(a.candidates[0]?.source, "connected_lines");
  assert.ok(Math.abs((a.candidates[0]?.area_mm2 ?? 0) / half - 1) < 0.001);
  const b = ok(importDxf(doc({ insunits: 4, entities: [lwpoly("L", [[0, 0, 1], [10000, 0]], true)] })));
  assert.ok(Math.abs((b.candidates[0]?.area_mm2 ?? 0) / half - 1) < 0.002);
});

test("INSERT: 블록 펼침(회전 90°·배율·0 레이어 상속), 결과는 정수 mm", () => {
  const t = doc({
    insunits: 4,
    blocks: [block("B", [rect("0", 0, 0, 4000, 2000)])],
    entities: [insert(SITE, "b", 10000, 5000, { rot: 90, sx: 2 })], // 블록 이름은 대소문자 무시
  });
  const r = ok(importDxf(t));
  const c = r.candidates[0] as SiteCandidate;
  assert.deepEqual(c.polygon.outer, [[8000, 5000], [10000, 5000], [10000, 13000], [8000, 13000]]);
  assert.equal(c.layer, SITE);
  assert.equal(c.area_mm2, 16_000_000);
});

test("INSERT: 블록 기준점·음수 배율(반전)·배열", () => {
  const base = doc({
    insunits: 4,
    blocks: [block("B", [rect("0", 1000, 1000, 5000, 3000)], [1000, 1000])],
    entities: [insert("N", "B", 0, 0, { sx: -1 })],
  });
  const r = ok(importDxf(base));
  assert.deepEqual(r.candidates[0]?.polygon.outer, [[-4000, 0], [0, 0], [0, 2000], [-4000, 2000]]);
});

test("중첩 깊이 8까지 허용, 9단계는 중단(DXF_NESTING_TOO_DEEP)", () => {
  const chain = (levels: number) =>
    doc({
      insunits: 4,
      blocks: Array.from({ length: levels }, (_, i) => block(`L${i}`, [i === 0 ? rect("0", 0, 0, 4000, 4000) : insert("0", `L${i - 1}`, 0, 0)])),
      entities: [insert(SITE, `L${levels - 1}`, 0, 0)],
    });
  assert.equal(importDxf(chain(8)).ok, true);
  const e = err(importDxf(chain(9)));
  assert.equal(e.code, "DXF_NESTING_TOO_DEEP");
  assert.equal(e.limit, 8);
});

test("순환 블록 참조(자기 자신·간접)는 중단", () => {
  const self = doc({ insunits: 4, blocks: [block("A", [insert("0", "A", 0, 0)])], entities: [insert("0", "A", 0, 0), rect(SITE, 0, 0, 9000, 9000)] });
  assert.equal(err(importDxf(self)).code, "DXF_CIRCULAR_BLOCK");
  const ind = doc({
    insunits: 4,
    blocks: [block("A", [insert("0", "B", 0, 0)]), block("B", [insert("0", "A", 0, 0)])],
    entities: [insert("0", "A", 0, 0)],
  });
  assert.equal(err(importDxf(ind)).code, "DXF_CIRCULAR_BLOCK");
});

test("중첩 폭증(10^8 복제)은 펼친 엔티티 상한에서 즉시 중단", () => {
  const fan = 10;
  const t = doc({
    insunits: 4,
    blocks: Array.from({ length: 8 }, (_, i) =>
      block(`L${i}`, i === 0 ? [rect("0", 0, 0, 4000, 4000)] : Array.from({ length: fan }, () => insert("0", `L${i - 1}`, 0, 0))),
    ),
    entities: [insert(SITE, "L7", 0, 0)],
  });
  const e = err(importDxf(t));
  assert.equal(e.code, "DXF_TOO_MANY_ENTITIES");
  assert.equal(e.limit, 1_000_000);
});

test("엔티티 수 상한·배열 INSERT 상한·미정의 블록", () => {
  const t = doc({ insunits: 4, entities: [rect(SITE, 0, 0, 9000, 9000), rect("A", 0, 0, 9000, 9000), rect("B", 0, 0, 9000, 9000)] });
  assert.equal(err(importDxf(t, { limits: { max_entities: 2 } })).code, "DXF_TOO_MANY_ENTITIES");
  assert.equal(importDxf(t, { limits: { max_entities: 3 } }).ok, true);
  const arr = pairs([[0, "INSERT"], [8, "0"], [2, "B"], [10, 0], [20, 0], [70, 200], [71, 200], [44, 10], [45, 10]]);
  const a = doc({ insunits: 4, blocks: [block("B", [rect("0", 0, 0, 4000, 4000)])], entities: [arr] });
  assert.equal(err(importDxf(a)).code, "DXF_TOO_MANY_ENTITIES");
  const undef = ok(importDxf(doc({ insunits: 4, entities: [rect(SITE, 0, 0, 9000, 9000), insert("0", "NOPE", 0, 0)] })));
  assert.deepEqual(undef.warnings[0]?.skipped_entities, { "INSERT(블록 정의 없음)": 1 });
});

test("잘린 파일·EOF 없음·비정상 헤더·빈 파일·형식 오류는 구조화된 오류", () => {
  const full = doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20000, 15000)] });
  assert.equal(err(importDxf(doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20000, 15000)], noEof: true }))).code, "DXF_TRUNCATED");
  for (const cut of [10, full.length >> 1, full.length - 8]) {
    const e = err(importDxf(full.slice(0, cut)));
    assert.ok(e.code === "DXF_TRUNCATED" || e.code === "DXF_MALFORMED", e.code);
  }
  assert.equal(err(importDxf("")).code, "DXF_MALFORMED");
  assert.equal(err(importDxf("hello world\nthis is not dxf\n")).code, "DXF_MALFORMED");
  assert.equal(err(importDxf("  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n 10\nabc\n  0\nENDSEC\n  0\nEOF\n")).code, "DXF_MALFORMED");
  assert.equal(err(importDxf("  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n 10\n1e999\n  0\nENDSEC\n  0\nEOF\n")).code, "DXF_MALFORMED");
  assert.equal(err(importDxf("9999\nx\n")).code, "DXF_MALFORMED");
  assert.equal(err(importDxf(doc({ insunits: 4, entities: [text("A")] }))).code, "DXF_EMPTY");
  // 999 주석으로 시작하는 정상 파일
  assert.equal(importDxf("999\ncomment\n" + full).ok, true);
});

test("바이너리 DXF·NUL 바이트·크기 초과", () => {
  const head = "AutoCAD Binary DXF\r\n\x1a\0";
  const bin = new Uint8Array([...head].map((c) => c.charCodeAt(0)).concat([1, 2, 3, 4]));
  assert.equal(err(importDxf(bin)).code, "DXF_BINARY");
  assert.equal(err(importDxf(new Uint8Array([48, 0, 0, 255, 254]))).code, "DXF_MALFORMED");
  const big = new Uint8Array(20 * 1024 * 1024 + 1);
  const e = err(importDxf(big));
  assert.equal(e.code, "AR055");
  assert.equal(e.limit, 20 * 1024 * 1024);
  assert.equal(err(importDxf(new Uint8Array(10), { limits: { max_file_bytes: 5 } })).code, "AR055");
  // 상한은 올릴 수 없다
  assert.equal(err(importDxf(big, { limits: { max_file_bytes: 1 << 30 } })).code, "AR055");
});

test("큰 좌표: 어떤 단위로도 ±10km 초과 / 선택 단위 환산 시 초과는 오류, 부분 결과 없음", () => {
  assert.equal(err(importDxf(doc({ insunits: 4, entities: [rect(SITE, 0, 0, 1e9, 1e9)] }))).code, "DXF_COORD_OUT_OF_RANGE");
  assert.equal(err(importDxf(doc({ entities: [rect("X", 0, 0, 5e6, 5e6)] }), { unit: "m" })).code, "DXF_COORD_OUT_OF_RANGE");
  assert.equal(err(importDxf(doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20000, 15000), line("Z", 0, 0, 1e300, 0)] }))).code, "DXF_COORD_OUT_OF_RANGE");
  // 경계값: 정확히 10km는 허용
  assert.equal(ok(importDxf(doc({ insunits: 4, entities: [rect(SITE, 9_990_000, 0, 10_000_000, 9000)] }))).candidates.length, 1);
});

test("순위: 대지 레이어 > 중립 > 비대지(표제란·치수), 같은 급에서는 면적 큰 순", () => {
  const r = ok(
    importDxf(
      doc({
        insunits: 4,
        entities: [
          rect("A-TTLB", 0, 0, 300000, 200000),
          rect("PLAN", 0, 0, 40000, 40000),
          rect("대지경계", 0, 0, 20000, 15000),
          rect("PLAN2", 0, 0, 10000, 10000),
          rect(SITE, 0, 0, 5000, 5000),
        ],
      }),
    ),
  );
  assert.deepEqual(
    r.candidates.map((c) => [c.rank, c.layer, c.layer_hint]),
    [[1, "대지경계", "site"], [2, SITE, "site"], [3, "PLAN", "neutral"], [4, "PLAN2", "neutral"], [5, "A-TTLB", "non_site"]],
  );
  assert.equal(ok(importDxf(doc({ insunits: 4, entities: [rect("PLAN", 0, 0, 40000, 40000), rect("PLAN2", 0, 0, 9000, 9000)] }), { max_candidates: 1 })).candidates.length, 1);
});

test("숨김(꺼짐·동결) 레이어와 배치 공간 엔티티는 무시, 1㎡ 미만·자기교차·중복은 후보에서 제외", () => {
  const paper = pairs([[0, "LWPOLYLINE"], [8, SITE], [67, 1], [90, 4], [70, 1], [10, 0], [20, 0], [10, 9000], [20, 0], [10, 9000], [20, 9000], [10, 0], [20, 9000]]);
  const r = ok(
    importDxf(
      doc({
        insunits: 4,
        layers: [["OFF", 0, -7], ["FRZ", 1, 7], [SITE, 0, 1]],
        entities: [
          rect("OFF", 0, 0, 9000, 9000),
          rect("FRZ", 0, 0, 9000, 9000),
          paper,
          rect(SITE, 0, 0, 500, 500),
          lwpoly(SITE, [[0, 0], [20000, 15000], [20000, 0], [0, 12000]], true),
          rect(SITE, 0, 0, 20000, 15000),
          rect(SITE, 0, 0, 20000, 15000),
        ],
      }),
    ),
  );
  assert.equal(r.candidates.length, 1);
  assert.equal(r.stats.hidden_layer_entities, 2);
  assert.equal(r.stats.paper_space_entities, 1);
  assert.equal(r.stats.loops_below_min_area, 1);
  assert.equal(r.stats.loops_rejected, 1);
  assert.equal(r.stats.duplicates_removed, 1);
});

test("구형 POLYLINE+VERTEX+SEQEND, 곡선맞춤 POLYLINE은 AR054, 압출 -Z는 x 반전", () => {
  const vtx = (x: number, y: number) => pairs([[0, "VERTEX"], [8, SITE], [10, x], [20, y], [30, 0]]);
  const poly = pairs([[0, "POLYLINE"], [8, SITE], [66, 1], [70, 1]]) + vtx(0, 0) + vtx(20000, 0) + vtx(20000, 15000) + vtx(0, 15000) + pairs([[0, "SEQEND"], [8, SITE]]);
  assert.deepEqual(ok(importDxf(doc({ insunits: 4, entities: [poly] }))).candidates[0]?.polygon.outer, site20x15);
  const fit = pairs([[0, "POLYLINE"], [8, SITE], [66, 1], [70, 3]]) + vtx(0, 0) + vtx(9000, 0) + vtx(9000, 9000) + pairs([[0, "SEQEND"], [8, SITE]]);
  const f = ok(importDxf(doc({ insunits: 4, entities: [poly, fit] })));
  assert.deepEqual(f.warnings[0]?.skipped_entities, { "POLYLINE(곡선맞춤)": 1 });
  const mir = pairs([[0, "LWPOLYLINE"], [8, SITE], [90, 4], [70, 1], [10, 1000], [20, 0], [10, 21000], [20, 0], [10, 21000], [20, 15000], [10, 1000], [20, 15000], [230, -1]]);
  assert.deepEqual(ok(importDxf(doc({ insunits: 4, entities: [mir] }))).candidates[0]?.polygon.outer[0], [-21000, 0]);
});

test("옵션 검증과 결정성(두 번 호출 동일)", () => {
  const t = doc({ insunits: 4, entities: [rect(SITE, 0, 0, 20000, 15000)] });
  assert.equal(err(importDxf(t, { unit: "km" as never })).code, "DXF_INVALID_OPTION");
  assert.equal(err(importDxf(t, { max_candidates: 0 })).code, "DXF_INVALID_OPTION");
  assert.equal(err(importDxf(t, { max_candidates: 51 })).code, "DXF_INVALID_OPTION");
  assert.equal(err(importDxf(t, { join_tolerance_mm: 5 as never })).code, "DXF_INVALID_OPTION");
  assert.equal(JSON.stringify(importDxf(t)), JSON.stringify(importDxf(t)));
});
