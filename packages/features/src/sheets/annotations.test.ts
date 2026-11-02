// 도면 주석 패널(AR-06-086, 03장 9.6절) 서버 렌더: 주석 수·고아 수, 고아 행(앵커 없음·사유·삭제).
// .tsx를 Node가 직접 못 읽어 tsx-hooks.mjs 로더를 쓴다(judgment 패널 테스트와 같은 로더).
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { newSpec } from "./model.ts";

register("../judgment/tsx-hooks.mjs", import.meta.url);
const { AnnotationPanel } = await import("./parts.tsx");

const house = DEMO_PROJECTS[0]!.model;

test("주석 패널: 주석 n · 고아 m, 고아는 앵커 없음 + 사유 + 삭제(편집 권한 없으면 비활성)", () => {
  const spec = {
    ...newSpec("site_plan", [], house, "A3"),
    annotations: [
      { id: "u-a", kind: "text" as const, anchor: { ref: "x", part: "center" as const, snap: [0, 0] as [number, number] }, dx_mm: 0, dy_mm: 0, text: "주출입" },
      { id: "ov-dim:1", kind: "override" as const, target: "dim:1", dx_mm: 1 },
    ],
  };
  const html = renderToStaticMarkup(h(AnnotationPanel, { spec, unapplied: [{ id: "u-a", reason: "orphan_missing" }, { id: "ov-dim:1", reason: "missing_target" }], canEdit: false, onDelete: () => {} }));
  assert.match(html, /주석 2/);
  assert.match(html, /고아 1/);
  assert.match(html, /앵커 없음/);
  assert.match(html, /앵커 대상이 모델에 없습니다/);
  assert.match(html, /적용되지 않은 주석 수정 1건/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="u-a 주석 삭제"|aria-label="u-a 주석 삭제"[^>]*disabled=""/);
  const empty = renderToStaticMarkup(h(AnnotationPanel, { spec: { ...spec, annotations: [] }, unapplied: null, canEdit: true, onDelete: () => {} }));
  assert.match(empty, /주석 0/);
  assert.doesNotMatch(empty, /고아/);
});
