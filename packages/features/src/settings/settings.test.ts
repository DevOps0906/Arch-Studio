// 설정 화면 2개: 소스 규칙(금지 문구·hex·px·innerHTML·저장소 위치) + renderToStaticMarkup 구조(권한별 상태).
// 테스트 러너가 .tsx를 직접 못 읽으므로 tsx-hooks.mjs 로더로 불러오고 JSX 대신 createElement를 쓴다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { ProfileForm } from "./drafting/profile.ts";

register("./tsx-hooks.mjs", import.meta.url);
const { AppProviders } = await import("../shell/context.tsx");
const { createDemoRuntime } = await import("../demo/index.ts");
const drafting = await import("./drafting/index.tsx");
const sections = await import("./drafting/sections.tsx");
const general = await import("./general/index.tsx");
const { toForm, DEFAULT_PROFILE } = await import("./drafting/profile.ts");

const DIR = import.meta.dirname;
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}
const FILES = sources(DIR).filter((f) => !f.endsWith("third-party-notices.ts"));
const rel = (f: string) => path.relative(DIR, f);

test("소스: hex 색·px 값·dangerouslySetInnerHTML·innerHTML 0건", () => {
  for (const f of FILES) {
    const s = readFileSync(f, "utf8");
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(s), false, `${rel(f)} hex`);
    assert.equal(/\d+px\b|\bh-px\b|\[\d+(px|rem)\]/.test(s), false, `${rel(f)} px`);
    assert.equal(/dangerouslySetInnerHTML|\.innerHTML\b/.test(s), false, `${rel(f)} innerHTML`);
  }
});

test("소스: 웹 스토리지는 drafting/cache.ts만, SecureStore(secrets)는 쓰지 않는다", () => {
  const storage = FILES.filter((f) => /localStorage|sessionStorage|indexedDB/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(storage, [path.join("drafting", "cache.ts")]);
  assert.deepEqual(FILES.filter((f) => /\.secrets\b|useAdapters/.test(readFileSync(f, "utf8"))).map(rel), []);
});

test("소스: 금지 문구 0건(PRD 6.1·9.7절)", () => {
  const banned = /허가 100%|반려 걱정|모든 법규 자동|법규 완벽|건축사 없이|설계사무소가 필요 없|국토부 인증|세움터 공식|인허가 도면 자동|허가 도서 완성|오토캐드가 필요 없|CAD 대체|도면 그릴 사람이 필요 없|치수 100% 정확/;
  for (const f of FILES) assert.equal(banned.test(readFileSync(f, "utf8")), false, rel(f));
});

const runtime = (search = "") => createDemoRuntime({ search, engine: null });
function render(node: ReactNode, search = ""): string {
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: ["/settings/drafting"] }, h(AppProviders, { runtime: runtime(search), children: node })));
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const form: ProfileForm = { ...toForm({ ...DEFAULT_PROFILE, office_name: "나무건축" }), layer_inputs: { "A-WALL": "W/1", "A-DOOR": "문", "A-GLAZ": "GLAZ", "A-AREA": "glaz", "A-SITE-BNDY": "SITE_BND" } };
const noop = () => {};
const base = { form, setForm: noop, dirty: true, saving: false, errors: undefined, onSave: noop };

test("도면 설정 화면: h1 하나·설정 내비·로딩 상태(세션 확인 전)", () => {
  const html = render(h(drafting.Screen));
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /도면 설정/);
  assert.match(html, /aria-label="설정"/);
  assert.match(html, /role="status"/);
});

test("레이어 매핑 표: 17행 × 2(표·좁은 화면 카드), 경고 문구는 resolveLayerMap 결과, 읽기 전용이면 입력·저장 비활성", () => {
  const ro = render(h(sections.LayerSection, { ...base, editable: false }));
  assert.equal(count(ro, /aria-label="A-[A-Z-]+ 사무소 이름"/g), 34);
  assert.equal(count(ro, /<input[^>]*disabled=""/g), 34);
  assert.match(ro, /<button[^>]*disabled=""[^>]*aria-label="레이어 이름 저장"|<button[^>]*aria-label="레이어 이름 저장"[^>]*disabled=""/);
  assert.match(ro, /DXF 레이어 이름에 쓸 수 없는 문자가 있어/);
  assert.match(ro, /영문·숫자·_ - \$만 저장할 수 있어/);
  assert.match(ro, /대소문자만 다르거나/);
  assert.match(ro, /레이어 3개는 표준 이름으로 내보냅니다/);
  const rw = render(h(sections.LayerSection, { ...base, editable: true }));
  // A-ANNO-USER(표·카드 2칸)만 읽기 전용: 서버 DB가 아직 받지 않는다(AR-06-086).
  assert.equal(count(rw, /<input[^>]*disabled=""/g), 2);
  assert.match(rw, /aria-label="A-ANNO-USER 사무소 이름"[^>]*disabled=""|disabled=""[^>]*aria-label="A-ANNO-USER 사무소 이름"/);
  assert.match(rw, /서버 저장 지원 전까지 표준 이름으로 내보냅니다/);
});

test("표제란 섹션: 고정 고지·날인 없음 안내, member(읽기 전용)는 입력·올리기·저장 비활성", () => {
  const ro = render(h(sections.TitleBlockSection, { ...base, editable: false, orgId: null, onNotice: noop }), "?demo-role=member");
  assert.match(ro, /기획설계 검토용 자료이며 인허가 설계도서가 아닙니다/);
  assert.match(ro, /날인·서명란은 만들지 않습니다/);
  assert.equal(count(ro, /<input[^>]*disabled=""/g), 4); // 사무소·건축사·연락처·파일
  assert.match(ro, /accept="image\/png"/);
  assert.equal(/image\/svg/.test(ro), false);
  const rw = render(h(sections.TitleBlockSection, { ...base, editable: true, orgId: null, onNotice: noop }));
  assert.equal(count(rw, /<input[^>]*disabled=""/g), 0);
});

test("미리보기 섹션: 엔진 없으면 안내(오류 상태), 체험판 안내는 워터마크일 때만, img 외 svg 직접 삽입 없음", () => {
  const html = render(h(sections.PreviewSection, { form, saved: form, watermark: true }));
  assert.match(html, /표제란 미리보기 A3/);
  assert.match(html, /체험판/);
  assert.equal(/<svg[^>]*viewBox="0 0 [0-9]+ [0-9]+"[^>]*>.*나무건축/.test(html), false);
  const plain = render(h(sections.PreviewSection, { form, saved: form, watermark: false }));
  assert.equal(/출력하면 표제란에 "체험판"/.test(plain), false);
});

test("일반 설정: h1 하나, 국외 이전 잠금(세션 전·미지원), 녹음 고지·오픈소스 전문·로그아웃", () => {
  const html = render(h(general.Screen));
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/);
  assert.match(html, /owner·admin만 바꿀 수 있습니다/);
  assert.match(html, /처리 후 24시간 안에 삭제합니다/);
  assert.match(html, /<details/);
  assert.match(html, /Apache License 2\.0/);
  assert.match(html, />로그아웃</);
  assert.match(html, /이 PC에 저장된 프로젝트는 지우지 않습니다/);
});
