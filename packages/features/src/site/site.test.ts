// 대지 화면 소스 규칙(hex·px 0, innerHTML 0, 금지 문구 0, 키 이름 0)과 서버 렌더(renderToStaticMarkup) 구조·이스케이프(로그 A2·A8).
// .tsx는 tsx-hooks.mjs 로더로 불러온다(JSX 대신 createElement).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SiteCandidateView } from "./model.ts";

register("./tsx-hooks.mjs", import.meta.url);
const parts = await import("./parts.tsx");

const DIR = import.meta.dirname;
const sources = readdirSync(DIR)
  .filter((n) => /\.(ts|tsx)$/.test(n) && !n.endsWith(".test.ts"))
  .map((n) => ({ name: n, text: readFileSync(path.join(DIR, n), "utf8") }));

/** PRD 6.1절 금지 문구(공백 제거 비교). */
const FORBIDDEN = ["허가100%통과", "반려걱정없음", "모든법규자동검토", "법규완벽반영", "건축사없이설계", "국토부인증", "세움터공식연동", "공식파트너", "무료"];

test("소스: hex 색·px 크기·dangerouslySetInnerHTML·innerHTML 없음", () => {
  assert.ok(sources.length >= 6);
  for (const { name, text } of sources) {
    const code = text.replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${name}: hex`);
    assert.doesNotMatch(code, /\d+px\b/, `${name}: px`);
    assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/, `${name}: HTML 주입`);
  }
});

test("소스: 금지 문구 0, VWorld 키·해시 키 이름 0(클라이언트는 키를 모른다), 직접 invoke·fetch 0", () => {
  for (const { name, text } of sources) {
    const squashed = text.replace(/\s+/g, "");
    for (const p of FORBIDDEN) assert.ok(!squashed.includes(p), `${name}: ${p}`);
    assert.doesNotMatch(text, /VWORLD_API_KEY|SITE_LOOKUP_HASH_KEY|api\.vworld\.kr/, name);
    assert.doesNotMatch(text, /\bfetch\(/, `${name}: 조회는 useApi()로만`);
  }
});

test("서버 렌더: 2D 대지 뷰는 SVG(1점 쇄선 경계·변 번호·도로 폭·정북), 접근성 이름", () => {
  const html = renderToStaticMarkup(
    h(parts.SiteCanvas, {
      outer: [
        [0, 0],
        [18000, 0],
        [18000, 22000],
        [0, 22000],
      ],
      roads: { 0: 6000 },
      northAngleDeg: 15,
    }),
  );
  assert.match(html, /^<svg[^>]*role="img"/);
  assert.match(html, /aria-label="대지 경계 2D 보기: 꼭짓점 4개"/);
  assert.match(html, /stroke-site-line \[stroke-dasharray:var\(--line-dash-site\)\]/);
  assert.match(html, /변 1 · 도로 6\.00m/);
  assert.match(html, /변 4</);
  assert.match(html, /rotate\(15 /);
  assert.doesNotMatch(html, /<canvas|three/);
});

test("서버 렌더: 그리기 모드는 group 역할 + 키보드 안내, 열린 선(polyline)", () => {
  const html = renderToStaticMarkup(h(parts.SiteCanvas, { outer: [[0, 0], [1000, 0]], roads: {}, northAngleDeg: 0, drawing: true }));
  assert.match(html, /role="group"/);
  assert.match(html, /좌표 표/);
  assert.match(html, /<polyline/);
});

test("서버 렌더: 후보 목록은 '입력 후보' 표시 + 안내 문구, 주소 문자열은 이스케이프", () => {
  const c: SiteCandidateView = {
    origin: "lookup",
    outer: [
      [0, 0],
      [18000, 0],
      [18000, 22000],
      [0, 22000],
    ],
    area_mm2: 396_000_000,
    perimeter_mm: 80_000,
    label: '<script>alert("x")</script> 운중동 12-4',
    use_district: "제1종일반주거지역",
    notes: ["필지 안쪽 구멍은 가져오지 않았습니다."],
  };
  const html = renderToStaticMarkup(
    h(parts.CandidateList, {
      candidates: [c],
      selected: 0,
      onSelect: () => undefined,
      onApply: () => undefined,
      onDiscard: () => undefined,
      notice: "공공 데이터 값은 입력 후보이며 판정 기준이 아닙니다.",
      warning: "지원하지 않는 요소 2개(SPLINE)를 건너뛰었습니다. 나머지로 계속합니다.",
      disabled: false,
    }),
  );
  assert.match(html, /입력 후보/);
  assert.match(html, /판정 기준이 아닙니다/);
  assert.match(html, /396\.00㎡/);
  assert.match(html, /이 경계 쓰기/);
  assert.match(html, /SPLINE/);
  assert.ok(!html.includes("<script>"), "이스케이프");
  assert.match(html, /&lt;script&gt;/);
});

test("서버 렌더: 면적 표시와 좌표 표(캡션·행 머리·삭제 버튼 이름)", () => {
  const outer: [number, number][] = [
    [0, 0],
    [3000, 0],
    [0, 4000],
  ];
  const m = renderToStaticMarkup(h(parts.MetricsReadout, { outer }));
  assert.match(m, /6\.00㎡/);
  assert.match(m, /12\.00m/);
  const t = renderToStaticMarkup(h(parts.CoordinateTable, { outer, disabled: false, onChange: () => undefined, onRemove: () => undefined, onAdd: () => undefined }));
  assert.match(t, /<caption[^>]*>대지 경계 꼭짓점 좌표\(mm\)<\/caption>/);
  assert.match(t, /aria-label="3번 꼭짓점 삭제"/);
  assert.match(t, /value="3,000"/);
});

test("서버 렌더: 단위 확인 대화상자는 AR053 문구와 단위 버튼(mm·m)을 갖고, 단계가 아니면 닫혀 있다", () => {
  const ask = renderToStaticMarkup(
    h(parts.UnitDialog, {
      flow: {
        step: "ask_unit",
        message: "도면 단위를 판별하지 못했습니다. 이 도면의 단위를 골라 주세요.",
        options: [
          { unit: "mm", plausible: false, reference_extent_mm: 1500, fits_coord_limit: true },
          { unit: "m", plausible: false, reference_extent_mm: 1_500_000, fits_coord_limit: true },
        ],
      },
      onChoose: () => undefined,
      onCancel: () => undefined,
    }),
  );
  assert.match(ask, /<dialog/);
  assert.match(ask, /도면 단위를 판별하지 못했습니다/);
  assert.match(ask, />mm</);
  assert.match(ask, />m</);
  assert.match(ask, /가져오기 취소/);
  const idle = renderToStaticMarkup(h(parts.UnitDialog, { flow: { step: "idle" }, onChoose: () => undefined, onCancel: () => undefined }));
  assert.doesNotMatch(idle, /<button[^>]*>mm/);
});

test("서버 렌더: 후보 단계에 적용 단위와 실제 외접 가로×세로(m)가 항상 보인다", () => {
  const html = renderToStaticMarkup(
    h(parts.CandidateList, {
      candidates: [
        {
          origin: "dxf",
          outer: [
            [0, 0],
            [30000, 0],
            [30000, 20000],
            [0, 20000],
          ],
          area_mm2: 600_000_000,
          perimeter_mm: 100_000,
          label: "1순위 · 레이어 A-SITE-BNDY",
          notes: [],
          extent_mm: [30000, 20000],
          unit_text: "적용 단위: cm(헤더)",
        },
      ],
      selected: 0,
      onSelect: () => undefined,
      onApply: () => undefined,
      onDiscard: () => undefined,
      notice: "DXF에서 찾은 닫힌 선입니다.",
      disabled: false,
    }),
  );
  assert.match(html, /적용 단위: cm\(헤더\)/);
  assert.match(html, /외접 30\.00m × 20\.00m/);
});

test("서버 렌더: 단위 확인 대화상자 선택지는 io options 전체(cm·in·ft 포함)와 환산 크기", async () => {
  const { UnitDialog } = parts;
  const options = ["mm", "cm", "m", "in", "ft"].map((unit, i) => ({ unit, plausible: i < 2, reference_extent_mm: 30000 * [1, 10, 1000, 25.4, 304.8][i]!, fits_coord_limit: true }));
  const flow = { step: "confirm_unit", message: "확인", unit: "cm", options, pending: null } as never;
  const html = renderToStaticMarkup(h(UnitDialog, { flow, onChoose: () => undefined, onCancel: () => undefined }));
  for (const label of ["mm", "cm", ">m<", "inch", "ft"]) assert.ok(html.includes(label), label);
  assert.match(html, /가장 긴 변 300\.00m/);
});
