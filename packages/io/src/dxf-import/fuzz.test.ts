// 퍼징(AR-06-029): 시드 고정 의사 난수로 수천 건의 손상 입력을 만들어 "예외가 아니라 구조화된 오류만" 나오는지 확인한다.
// 난수는 mulberry32(Math.random 금지) — 같은 시드면 같은 입력이라 실패를 재현할 수 있다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽는다
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { validatePolygon } from "@arch-studio/geometry";
import { block, circle, doc, insert, line, lwpoly, pairs, rect, simple, text } from "./fixtures.ts";
import { importDxf, type DxfImportResult } from "./index.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const counts = { total: 0, ok: 0, needs_unit: 0, error: 0 } as Record<string, number>;
const codes = new Map<string, number>();

function check(input: Uint8Array | string, label: string): void {
  let r: DxfImportResult;
  try {
    r = importDxf(input);
  } catch (e) {
    assert.fail(`${label}: 예외가 새어 나옴 ${(e as Error).message}`);
  }
  counts.total = (counts.total ?? 0) + 1;
  assert.equal(typeof r, "object", label);
  if (!r.ok) {
    assert.notEqual(r.error.code, "DXF_INTERNAL", `${label}: 내부 오류 ${JSON.stringify(r.error)}`);
    assert.ok(r.error.message.length > 0, label);
    counts.error = (counts.error ?? 0) + 1;
    codes.set(r.error.code, (codes.get(r.error.code) ?? 0) + 1);
    return;
  }
  if (r.status === "needs_unit") {
    counts.needs_unit = (counts.needs_unit ?? 0) + 1;
    assert.equal(r.code, "AR053");
    return;
  }
  counts.ok = (counts.ok ?? 0) + 1;
  for (const c of r.candidates) {
    assert.equal(validatePolygon(c.polygon), null, `${label}: 검증 실패 후보`);
    assert.ok(c.area_mm2 > 0, label);
  }
}

const BASE = doc({
  insunits: 4,
  layers: [["A-SITE-BNDY"], ["A-TTLB"], ["FRZ", 1]],
  blocks: [block("B1", [rect("0", 0, 0, 4000, 2000), line("0", 0, 0, 100, 100)]), block("B2", [insert("0", "B1", 100, 100, { rot: 45 })])],
  entities: [
    rect("A-SITE-BNDY", 0, 0, 20000, 15000),
    lwpoly("A-TTLB", [[0, 0, 0.5], [30000, 0], [30000, 20000], [0, 20000]], true),
    line("L", 0, 0, 1000, 0),
    line("L", 1000, 0, 1000, 1000),
    circle("L", 5000, 5000, 3000),
    insert("L", "B2", 2000, 2000, { rot: 30, sx: 2 }),
    simple("SPLINE", "A"),
    simple("HATCH", "A"),
    text("A"),
    pairs([[0, "POLYLINE"], [8, "P"], [66, 1], [70, 1], [0, "VERTEX"], [8, "P"], [10, 0], [20, 0], [0, "VERTEX"], [8, "P"], [10, 9000], [20, 0], [0, "VERTEX"], [8, "P"], [10, 9000], [20, 9000], [0, "SEQEND"]]),
  ],
});

const VOCAB = ["", "0", "-1", "1e999", "NaN", "  ", "SECTION", "ENDSEC", "EOF", "BLOCK", "ENDBLK", "INSERT", "LWPOLYLINE", "POLYLINE", "VERTEX", "SEQEND", "99999999999999999999", "-0", "1.5.5", "10", "20", "70", "2", "8", "0\n0\n0", "\u0000", "\\U+ZZZZ", "ARC", "CIRCLE", "TABLE", "LAYER", "1071", "1072", "-5", "-6", "4294967296"];

function rbytes(rnd: () => number, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256);
  return b;
}

test("퍼징 A: 임의 바이트 2000건 (일부는 DXF 머리말을 붙여 파서 깊이 진입)", () => {
  const rnd = mulberry32(20261029);
  const head = new TextEncoder().encode("  0\r\nSECTION\r\n  2\r\nENTITIES\r\n");
  for (let i = 0; i < 2000; i++) {
    const body = rbytes(rnd, Math.floor(rnd() * 600));
    const input = i % 2 === 0 ? body : new Uint8Array([...head, ...body]);
    check(input, `A#${i}`);
  }
});

test("퍼징 B: 유효 DXF 바이트 변조 2500건 (비트 뒤집기·구간 삭제·복제·잘라내기·무작위 삽입)", () => {
  const rnd = mulberry32(7);
  const enc = new TextEncoder().encode(BASE);
  for (let i = 0; i < 2500; i++) {
    let b = [...enc];
    const ops = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < ops; k++) {
      const p = Math.floor(rnd() * b.length);
      const kind = Math.floor(rnd() * 5);
      if (kind === 0) b[p] = Math.floor(rnd() * 256);
      else if (kind === 1) b.splice(p, Math.floor(rnd() * 40));
      else if (kind === 2) b.splice(p, 0, ...b.slice(p, p + Math.floor(rnd() * 80)));
      else if (kind === 3) b = b.slice(0, p);
      else b.splice(p, 0, ...rbytes(rnd, Math.floor(rnd() * 12)));
      if (b.length === 0) b = [48];
    }
    check(new Uint8Array(b), `B#${i}`);
  }
});

test("퍼징 C: 줄 단위 변조 1500건 (줄 삭제·복제·교환·위험 토큰으로 교체)", () => {
  const rnd = mulberry32(99);
  const base = BASE.split("\r\n");
  for (let i = 0; i < 1500; i++) {
    const lines = [...base];
    const ops = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < ops; k++) {
      const p = Math.floor(rnd() * lines.length);
      const kind = Math.floor(rnd() * 4);
      if (kind === 0) lines.splice(p, 1 + Math.floor(rnd() * 3));
      else if (kind === 1) lines.splice(p, 0, lines[p] as string);
      else if (kind === 2) {
        const q = Math.floor(rnd() * lines.length);
        const t = lines[p] as string;
        lines[p] = lines[q] as string;
        lines[q] = t;
      } else lines[p] = VOCAB[Math.floor(rnd() * VOCAB.length)] as string;
    }
    check(lines.join(i % 3 === 0 ? "\n" : "\r\n"), `C#${i}`);
  }
});

test("퍼징 D: 작성기 골든(수십 KB) 변조 300건", () => {
  const rnd = mulberry32(31337);
  const raw = readFileSync(new URL("../../../drafting/golden/writer-site-a3-basic/sheet-site_plan.dxf", import.meta.url));
  const base = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < 300; i++) {
    const b = new Uint8Array(base);
    const ops = 1 + Math.floor(rnd() * 20);
    for (let k = 0; k < ops; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    check(i % 5 === 0 ? b.slice(0, Math.floor(rnd() * b.length)) : b, `D#${i}`);
  }
});

test("퍼징 E: 숫자 자리만 바꾸기 1500건 (파싱은 통과하고 기하·단위·블록 단계로 깊이 들어감)", () => {
  const rnd = mulberry32(424242);
  const enc = new TextEncoder().encode(BASE);
  const digitPos: number[] = [];
  enc.forEach((c, i) => {
    if (c >= 48 && c <= 57) digitPos.push(i);
  });
  for (let i = 0; i < 1500; i++) {
    const b = new Uint8Array(enc);
    const ops = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < ops; k++) b[digitPos[Math.floor(rnd() * digitPos.length)] as number] = 48 + Math.floor(rnd() * 10);
    check(b, `E#${i}`);
  }
});

test("퍼징 요약: 총 6000건 이상, 성공·질문·오류가 모두 관찰됨, 내부 오류 0", () => {
  assert.ok((counts.total ?? 0) >= 6000, String(counts.total));
  assert.ok((counts.ok ?? 0) > 0 && (counts.error ?? 0) > 0, JSON.stringify(counts));
  assert.equal(codes.get("DXF_INTERNAL") ?? 0, 0);
  console.log(JSON.stringify({ fuzz_counts: counts, error_codes: [...codes] }));
});
