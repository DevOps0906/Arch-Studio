// 모델러 소스 규칙·패널 서버 렌더·보조 순수 함수 테스트(AR-06-036).
// - 소스: hex·px 0, HTML 주입 0, blob 워커를 만드는 drei Text·Draco 0, EdgesGeometry 0, Manifold import 0(워커 전용), 첫 청크(three 없음) 경계.
// - 패널: 열람이면 편집 도구 숨김, 측정·단면 켜기(AR-06-084), 코어·발코니 비활성 + 이유, 레이어 목록 키보드 선택 경로.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignModelV1 } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../demo/index.ts";
import { ENGINE_OUTPUTS } from "../judgment/fixtures.engine.ts";
import type { EngineSnapshot } from "./engine/client.ts";
import { layoutFor } from "./panels/layout.ts";
import { parseModelJson, sameModelJson } from "./state/load.ts";
import { NARROW_TEXT } from "./state/access.ts";
import { binarizeOutline, captureSize, flipRows } from "./viewport/capture.ts";
import { SCENE_TOKENS, sceneColors } from "./viewport/colors.ts";

register("./tsx-hooks.mjs", import.meta.url);
const { Toolbar } = await import("./panels/Toolbar.tsx");
const { Inspector, CORE_BALCONY_REASON } = await import("./panels/Inspector.tsx");
const { LayerPanel } = await import("./panels/LayerPanel.tsx");
const { statusSummary, verdictSummary } = await import("./panels/StatusBar.tsx");

const house = DEMO_PROJECTS[0]?.model as DesignModelV1;
const DIR = import.meta.dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}
const sources = walk(DIR).map((p) => ({ name: path.relative(DIR, p), text: readFileSync(p, "utf8") }));
const code = (t: string) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("소스: hex 색·px 크기·HTML 주입 없음(03장 6.4절 문구 '768px' 한 곳만 예외)", () => {
  assert.ok(sources.length >= 15);
  for (const { name, text } of sources) {
    const c = code(text).replace(JSON.stringify(NARROW_TEXT), "");
    assert.doesNotMatch(c, /#[0-9a-fA-F]{3,8}\b/, `${name}: hex`);
    assert.doesNotMatch(c, /\d+px\b/, `${name}: px`);
    assert.doesNotMatch(c, /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/, `${name}: HTML 주입`);
  }
});

test("소스: blob 워커(drei Text·troika·Draco·createObjectURL) 0, EdgesGeometry 0, Manifold·rules 직접 import 0, eval 0", () => {
  for (const { name, text } of sources) {
    const c = code(text);
    assert.doesNotMatch(c, /from "@react-three\/drei"/, `${name}: drei 루트 import 금지(사용분만 deep import)`);
    assert.doesNotMatch(c, /drei\/core\/(Text|Text3D|Html)|troika|DRACOLoader|Draco|createObjectURL|new Blob/, `${name}: blob 워커·CSP`);
    assert.doesNotMatch(c, /EdgesGeometry/, `${name}: 윤곽선은 DesignModel 데이터로`);
    assert.doesNotMatch(c, /manifold-3d|loadSolidKernel/, `${name}: Manifold는 엔진 워커에서만`);
    assert.doesNotMatch(c, /@arch-studio\/rules/, `${name}: 판정은 judge 레인으로만`);
    assert.doesNotMatch(c, /\beval\(|new Function\(/, name);
    assert.doesNotMatch(c, /Math\.random|crypto\.randomUUID/, `${name}: 결정적 id`);
  }
});

test("지연 로드 경계: three·R3F는 viewport/Viewport.tsx·prism.ts·capture.ts만, index는 Viewport를 lazy import", () => {
  const allowed = new Set(["viewport/Viewport.tsx", "viewport/prism.ts", "viewport/capture.ts"].map((p) => path.normalize(p)));
  for (const { name, text } of sources) {
    const c = code(text);
    const usesThree = /from "three"|from "@react-three\//.test(c);
    if (usesThree) assert.ok(allowed.has(path.normalize(name)), `${name}: three는 뷰포트 청크에서만`);
    if (!allowed.has(path.normalize(name))) assert.doesNotMatch(c, /^import (?!type )[^;]*from "\.\.?\/(viewport\/)?(Viewport|prism|capture)\.tsx?"/m, `${name}: 뷰포트 청크를 정적 import하지 않는다(타입만 허용)`);
  }
  const index = sources.find((s) => s.name === "index.tsx")?.text ?? "";
  assert.match(index, /lazy\(\(\) => import\("\.\/viewport\/Viewport\.tsx"\)\)/);
  assert.match(index, /import type \{ ViewportHandle \} from "\.\/viewport\/Viewport\.tsx"/);
});

test("배치: 토큰 경계(768·1200)로 좁음·중간·넓음", () => {
  assert.equal(layoutFor(375, 768, 1200), "narrow");
  assert.equal(layoutFor(767, 768, 1200), "narrow");
  assert.equal(layoutFor(768, 768, 1200), "medium");
  assert.equal(layoutFor(1199, 768, 1200), "medium");
  assert.equal(layoutFor(1200, 768, 1200), "wide");
});

test("모델 읽기: zod 통과만, 깨진 JSON·스키마 위반은 실패, 저장 후 같은 모델 판별(키 순서 무관)", () => {
  const text = JSON.stringify(house);
  const p = parseModelJson(text);
  assert.ok(p.ok);
  assert.equal(parseModelJson("{").ok, false);
  assert.equal(parseModelJson(JSON.stringify({ ...house, units: "m" })).ok, false);
  assert.equal(sameModelJson(house, text), true);
  const reordered = JSON.stringify({ meta: house.meta, ...house });
  assert.equal(sameModelJson(house, reordered), true);
  assert.equal(sameModelJson(house, JSON.stringify({ ...house, masses: [] })), false);
});

test("장면 색: 토큰 이름에서 읽고, 비면 이름 있는 CSS 색으로 대신(소스에 색 값 없음)", () => {
  const got = sceneColors((n) => (n === SCENE_TOKENS.mass ? " rgb(1 2 3) " : n === "--envelope-fill-opacity" ? "0.2" : ""));
  assert.equal(got.mass, "rgb(1 2 3)");
  assert.equal(got.envelopeOpacity, 0.2);
  assert.equal(got.viewport, "white");
  assert.equal(sceneColors(() => "abc").envelopeOpacity, 0.16);
});

test("캡처 보조: 행 뒤집기·윤곽 이진화·크기 상한", () => {
  // 2×2, 아래 행(빨강) 위 행(파랑) → 위쪽 행부터
  const src = [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255];
  assert.deepEqual([...flipRows(src, 2, 2)], [0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  const bin = binarizeOutline(new Uint8ClampedArray([250, 250, 250, 255, 10, 10, 10, 128]));
  assert.deepEqual([...bin], [255, 255, 255, 255, 0, 0, 0, 255]);
  assert.throws(() => captureSize({ width: 0, height: 10 }), RangeError);
  assert.throws(() => captureSize({ width: 5000, height: 10 }), RangeError);
  assert.deepEqual(captureSize({ width: 800, height: 600 }), { width: 800, height: 600 });
});

test("상태 바·판정 요약: 엔진 결과를 그대로(모델러는 판정 값을 계산하지 않음), 판정 패널 머리 요약과 같은 수", () => {
  const fx = ENGINE_OUTPUTS[0];
  assert.ok(fx);
  const data = { result: fx.result, details: fx.details, warnings: fx.warnings, modelRev: "r", elapsedMs: 38.4 };
  const s = statusSummary(house, data);
  assert.deepEqual(s, { masses: 1, maxLevel: 2, judgeMs: "38ms", engine: fx.result.engine_version, rulePack: "2026.10.0" });
  const v = verdictSummary(data);
  assert.equal(v.worst, "unverified", "규칙 팩 2026.10.0은 전 항목 미확인");
  assert.equal(v.pass + v.warn + v.fail, 0);
  assert.equal(verdictSummary(null).worst, null);
  assert.equal(statusSummary(house, null).judgeMs, null);
});

const noop = () => undefined;
const toolbar = (editable: boolean) =>
  renderToStaticMarkup(
    h(Toolbar, {
      editable,
      tool: "select",
      hasSelection: true,
      envelopeVisible: true,
      camera: "perspective",
      undoLabel: "매스 이동",
      redoLabel: null,
      onTool: noop,
      onExtrude: noop,
      onToggleEnvelope: noop,
      onCamera: noop,
      onFit: noop,
      onUndo: noop,
      onRedo: noop,
    }),
  );

test("도구 막대: 편집 가능하면 선택·매스·압출·측정 D·단면 S·실행 취소. 열람이면 편집 도구를 숨기고 보기만", () => {
  const on = toolbar(true);
  assert.match(on, /role="toolbar"/);
  assert.match(on, /aria-pressed="true"[^>]*>.*선택/);
  assert.match(on, /aria-keyshortcuts="M"/);
  assert.match(on, /aria-pressed="false"[^>]*aria-keyshortcuts="D"/);
  assert.match(on, /aria-pressed="false"[^>]*aria-keyshortcuts="S"/);
  assert.doesNotMatch(on, /다음 단계에서 제공합니다/);
  assert.match(on, /title="실행 취소: 매스 이동"/);
  const off = toolbar(false);
  assert.doesNotMatch(off, /매스 <kbd|압출|실행 취소|aria-keyshortcuts="M"/);
  assert.match(off, /엔벨로프/);
  assert.match(off, /aria-keyshortcuts="D"/, "측정·단면은 표시 전용이라 열람에서도 보임");
  assert.match(off, /aria-keyshortcuts="S"/);
  assert.match(off, /aria-label="보기 전환"/);
});

test("속성 인스펙터: 층 수·층고·바닥 높이·지붕, 코어·발코니 비활성 + 이유, 열람이면 입력 비활성·삭제 없음", () => {
  const props = { model: house, selection: "m-house", draftFloors: 2, draftFloorHeight: 3000, onCommand: noop, onDraftDefaults: noop };
  const on = renderToStaticMarkup(h(Inspector, { ...props, editable: true }));
  assert.match(on, /120\.00㎡/);
  assert.match(on, /10,000 × 12,000mm/);
  assert.match(on, /id="modeler-floor-height"/);
  assert.match(on, /박공지붕/);
  assert.ok(on.includes(CORE_BALCONY_REASON));
  assert.match(on, /<button[^>]*disabled=""[^>]*>.*코어 추가/);
  assert.match(on, /매스 삭제/);
  const off = renderToStaticMarkup(h(Inspector, { ...props, editable: false }));
  assert.doesNotMatch(off, /매스 삭제/);
  assert.match(off, /id="modeler-floor-height"[^>]*disabled=""|disabled=""[^>]*id="modeler-floor-height"/);
  const none = renderToStaticMarkup(h(Inspector, { ...props, selection: null, editable: true }));
  assert.match(none, /aria-label="직사각형 매스 추가"/);
  const noneRo = renderToStaticMarkup(h(Inspector, { ...props, selection: null, editable: false }));
  assert.doesNotMatch(noneRo, /<form/);
});

test("레이어 패널: 대지·엔벨로프·초과분·매스 토글(aria-pressed), 매스 선택 버튼, 엔벨로프 오류 문구·다시 시도", () => {
  const engine: EngineSnapshot = {
    meshes: new Map(),
    failedKeys: new Set(),
    envelope: null,
    envelopeStatus: "error",
    envelopeError: "규칙 팩이 없습니다(AR050)",
    excess: new Map([["m-house", { positions: new Float32Array(9), index: new Uint32Array([0, 1, 2]) }]]),
    excessBusy: false,
  };
  const html = renderToStaticMarkup(
    h(LayerPanel, { model: house, hidden: ["site"], selection: "m-house", engine, onToggle: noop, onSelect: noop, onRetryEnvelope: noop }),
  );
  assert.match(html, /aria-label="대지 보이기" aria-pressed="false"/);
  assert.match(html, /aria-label="엔벨로프 숨기기" aria-pressed="true"/);
  assert.match(html, /aria-pressed="true"[^>]*><span[^>]*>매스 1/);
  assert.match(html, /초과/);
  assert.match(html, /엔벨로프를 만들지 못했습니다\. 규칙 팩이 없습니다\(AR050\)/);
  assert.match(html, /다시 시도/);
  assert.match(html, /1F 2F · 6\.3m/);
});
