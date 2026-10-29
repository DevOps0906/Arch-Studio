// 랜딩·가격·내려받기·법적 고지 소스 검사: 금지 문구 0, 가격 숫자 0, 고정 고지 일치, hex/px 직접 사용 0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FORBIDDEN_PHRASES } from "../../server/samples/copy.test.ts";
import { DISCLAIMER, LEGAL_DOCS } from "../../content/legal/legal.ts";

/** /samples 목록(PRD 6.1·9.7절)에 이 작업에서 더한 것: 무료 단정, 실명 비교 금지(10.2절). */
const EXTRA_FORBIDDEN = [
  "무료", "무제한", "할인", "최저가", "얼리버드",
  // 타사 실명(D-27): 범주 이름만 쓴다.
  "랜드북", "PlanReviewer", "TestFit", "Forma", "Autodesk", "SketchUp", "Rhino보다",
  // 사실 오류(ADR-001, D-7, D-H2)
  "Windows전용", "윈도우전용", "설치형전용", "온라인확인이필요없", "온라인연결없이", "가입크레딧", "14일체험",
  // 성능 목표값을 측정값처럼 쓰지 않는다
  "p95", "ms이내",
];

const SOURCES = [
  "./page.tsx",
  "./error.tsx",
  "./_components/Shell.tsx",
  "./_components/contact.tsx",
  "./pricing/page.tsx",
  "./download/page.tsx",
  "./download/release.ts",
  "../legal/page.tsx",
  "../legal/layout.tsx",
  "../legal/[doc]/page.tsx",
  "../../content/legal/legal.ts",
  "../../components/hero/HeroVisual.tsx",
  "../../components/hero/HeroStatic.tsx",
];

const squash = (s: string) => s.replace(/\s+/g, "");
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
// 주석은 개발자용이라 화면 문구 검사에서 뺀다(주석 안 설명이 금지어를 인용할 수 있다).
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

for (const rel of SOURCES) {
  test(`금지 문구 0: ${rel}`, () => {
    const text = squash(stripComments(read(rel)));
    for (const phrase of [...FORBIDDEN_PHRASES, ...EXTRA_FORBIDDEN]) {
      assert.ok(!text.includes(squash(phrase)), `금지 문구 "${phrase}" 발견: ${rel}`);
    }
  });

  test(`토큰만 사용(hex·px 직접 값 0): ${rel}`, () => {
    const text = stripComments(read(rel));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(text), `hex 색 발견: ${rel}`);
    assert.ok(!/\dpx\b/.test(text), `px 값 발견: ${rel}`);
  });
}

test("가격 숫자 0: 요금·내려받기·랜딩 화면에 금액 표기가 없다", () => {
  for (const rel of ["./page.tsx", "./pricing/page.tsx", "./download/page.tsx"]) {
    const text = stripComments(read(rel));
    assert.ok(!/\d[\d,]*\s*(원|만원|달러|USD|KRW)/.test(text), `금액 표기 발견: ${rel}`);
    assert.ok(!/[₩$]\s?\d/.test(text), `통화 기호 발견: ${rel}`);
    assert.ok(!/\d\s*%/.test(text), `퍼센트 표기 발견: ${rel}`);
  }
});

test("랜딩은 단일 페이지 7섹션", () => {
  const page = read("./page.tsx");
  assert.equal((page.match(/<section /g) ?? []).length, 7);
});

test("영구 라이선스 필수 고지: 설치형 영구, 웹은 업데이트 기간, 30일 재확인", () => {
  const text = squash(read("./pricing/page.tsx"));
  for (const must of ["영구=설치형영구사용,웹은업데이트기간동안", "30일마다온라인"]) assert.ok(text.includes(must), must);
});

test("푸터 회사명은 자리표시", () => {
  assert.ok(read("./_components/Shell.tsx").includes("[회사명 미정]"));
});

test("가격 페이지는 준비 중 상태를 표시한다", () => {
  assert.ok(read("./pricing/page.tsx").includes("가격 안내 준비 중"));
  assert.ok(read("./download/page.tsx").includes("설치 파일 준비 중"));
});

test("고지문이 도면 표제란 고지문과 같다", () => {
  assert.equal(DISCLAIMER, "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다");
  const drafting = readFileSync(new URL("../../../../../packages/drafting/src/titleblock/index.ts", import.meta.url), "utf8");
  assert.ok(drafting.includes(`DISCLAIMER = "${DISCLAIMER}"`));
});

test("법적 문서 3종, 초안 배너, [확정 필요] 표기", () => {
  assert.deepEqual(LEGAL_DOCS.map((d) => d.slug), ["terms", "privacy", "disclaimer"]);
  const page = read("../legal/[doc]/page.tsx");
  assert.ok(page.includes("DRAFT_BANNER_TITLE"));
  assert.ok(read("../../content/legal/legal.ts").includes('DRAFT_BANNER_TITLE = "초안 — 법무 검토 전"'));
  for (const d of LEGAL_DOCS) {
    const json = JSON.stringify(d);
    assert.ok(json.includes("[확정 필요]"), d.slug);
  }
  const disclaimer = LEGAL_DOCS.find((d) => d.slug === "disclaimer");
  assert.ok(JSON.stringify(disclaimer).includes(DISCLAIMER));
});

test("법적 문서에 임의 확정 수치(기간·금액·일수)가 없다", () => {
  const privacy = LEGAL_DOCS.find((d) => d.slug === "privacy");
  const terms = LEGAL_DOCS.find((d) => d.slug === "terms");
  assert.ok(!/\d+\s*(일|개월|년)\s*(간|동안)?\s*보유/.test(JSON.stringify(privacy)));
  assert.ok(!/\d[\d,]*\s*원/.test(JSON.stringify(terms)));
});

test("getLatestRelease 는 릴리스가 없어 null 이다", async () => {
  const { getLatestRelease } = await import("./download/release.ts");
  assert.equal(await getLatestRelease(), null);
});

test("히어로 렌더러는 svg, 킬 스위치는 공개 env 플래그를 읽는다", async () => {
  const { HERO_RENDERER } = await import("../../components/hero/hero-mode.ts");
  assert.equal(HERO_RENDERER, "svg");
  const visual = read("../../components/hero/HeroVisual.tsx");
  assert.ok(visual.includes("process.env.NEXT_PUBLIC_HERO3D_ENABLED"));
  assert.ok(!visual.includes("NEXT_PUBLIC_HERO_VIDEO_ENABLED"));
});

test("히어로 연출은 모션 줄이기 미디어 쿼리 안에서만 켜지고 시작 상태를 숨기지 않는다", () => {
  const hero = read("../../components/hero/HeroStatic.tsx");
  assert.ok(hero.includes("prefers-reduced-motion: no-preference"));
  assert.ok(!/(^|[^-])opacity:\s*0\s*;/.test(hero.replace(/@keyframes[^\n]*/g, "")), "초기 숨김 CSS 금지");
});
