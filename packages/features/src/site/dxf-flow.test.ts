// DXF 가져오기 상태기계: 단위가 모호하면(needs_unit) 또는 범위 추정이면(needs_confirmation) 반드시 단위 대화상자(로그 A12).
// 실제 packages/io importDxf로 만든 결과를 넣는다(목 아님).
import assert from "node:assert/strict";
import { test } from "node:test";
import { importDxf, type DxfImportResult } from "@arch-studio/io";
import { DXF_TEXT, candidateFromDxf, confirmUnit, dxfNext, needsUnitDialog, pickCandidate, unitChoices } from "./dxf-flow.ts";

type G = [number, string | number];
const pairs = (list: G[]) => list.map(([c, v]) => `${String(c).padStart(3)}\r\n${v}\r\n`).join("");
function dxf(entities: string[], insunits?: number): string {
  const h: G[] = [[0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1027"]];
  if (insunits !== undefined) h.push([9, "$INSUNITS"], [70, insunits]);
  h.push([0, "ENDSEC"]);
  return pairs(h) + pairs([[0, "SECTION"], [2, "ENTITIES"]]) + entities.join("") + pairs([[0, "ENDSEC"], [0, "EOF"]]);
}
function rect(layer: string, x1: number, y1: number): string {
  return pairs([[0, "LWPOLYLINE"], [8, layer], [90, 4], [70, 1], [10, 0], [20, 0], [10, x1], [20, 0], [10, x1], [20, y1], [10, 0], [20, y1]]);
}
const spline = pairs([[0, "SPLINE"], [8, "0"], [10, 0], [20, 0]]);

test("needs_unit(AR053) → ask_unit 단계, 대화상자 필수, 후보 단계로 건너뛸 수 없다", () => {
  const r = importDxf(dxf([rect("X", 1500, 1000)]));
  assert.equal(r.ok && r.status, "needs_unit");
  const f = dxfNext(r);
  assert.equal(f.step, "ask_unit");
  assert.equal(needsUnitDialog(f), true);
  assert.equal(pickCandidate(f, 1), null);
  assert.ok(unitChoices(f).includes("mm") && unitChoices(f).includes("m"));
  if (f.step === "ask_unit") assert.equal(f.message, DXF_TEXT.AR053);
  // 사용자가 m를 고르면 다시 파싱 → 후보 단계
  const again = dxfNext(importDxf(dxf([rect("X", 1500, 1000)]), { unit: "m" }), true);
  assert.equal(again.step, "choose");
});

test("범위 추정(needs_confirmation) → confirm_unit 단계, 확인 전에는 후보를 보이지 않는다", () => {
  const r = importDxf(dxf([rect("A-SITE-BNDY", 30, 20)]));
  assert.ok(r.ok && r.status === "ok" && r.unit.needs_confirmation);
  const f = dxfNext(r);
  assert.equal(f.step, "confirm_unit");
  assert.equal(needsUnitDialog(f), true);
  assert.equal(pickCandidate(f, 1), null);
  if (f.step !== "confirm_unit") return;
  assert.equal(f.unit, "m");
  assert.deepEqual(unitChoices(f), ["m", "mm"]);
  // 추정 단위 확인 → 후보 단계
  const ok = confirmUnit(f, "m");
  assert.ok("next" in ok && ok.next.step === "choose");
  if ("next" in ok && ok.next.step === "choose") {
    assert.equal(ok.next.candidates[0]?.area_mm2, 600_000_000);
    const view = candidateFromDxf(ok.next.candidates[0]!);
    assert.equal(view.origin, "dxf");
    assert.equal(view.outer.length, 4);
  }
  // 다른 단위를 고르면 그 단위로 다시 파싱하라고 한다(보관한 후보를 쓰지 않음)
  assert.deepEqual(confirmUnit(f, "mm"), { rerun: "mm" });
});

test("헤더 선언이 맞으면 확인 없이 후보 단계, AR054 경고 문구", () => {
  const r = importDxf(dxf([rect("A-SITE-BNDY", 20000, 15000), spline, spline], 4));
  const f = dxfNext(r);
  assert.equal(f.step, "choose");
  assert.equal(needsUnitDialog(f), false);
  if (f.step === "choose") {
    assert.match(f.warning ?? "", /지원하지 않는 요소 2개\(SPLINE\)를 건너뛰었습니다/);
    assert.equal(pickCandidate(f, 1)?.rank, 1);
  }
});

test("오류: AR055는 20MB 문구, 그 밖의 파싱 실패는 '읽지 못했습니다', 닫힌 선 없음 안내", () => {
  const big: DxfImportResult = { ok: false, error: { code: "AR055", message: "x" } } as DxfImportResult;
  assert.deepEqual(dxfNext(big), { step: "error", message: DXF_TEXT.AR055 });
  const bin = importDxf(new Uint8Array([0x41, 0x75, 0x74, 0x6f, 0x43, 0x41, 0x44]));
  assert.equal(dxfNext(bin).step, "error");
  const empty = importDxf(dxf([pairs([[0, "LINE"], [8, "0"], [10, 0], [20, 0], [30, 0], [11, 5000], [21, 0], [31, 0]])], 4));
  const f = dxfNext(empty);
  assert.equal(f.step, "error");
  if (f.step === "error") assert.ok(f.message === DXF_TEXT.noClosed || f.message === DXF_TEXT.unreadable);
});
