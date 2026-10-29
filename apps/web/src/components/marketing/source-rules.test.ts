// 마케팅 컴포넌트 소스·README 검사: 금지 문구 0, 타사 실명 0, hex·px 직접 값 0, 클라이언트 JS 0, 경계(packages/ui 비수정).
// 패턴은 app/(marketing)/marketing-copy.test.ts 를 따른다(새 파일에서 확장).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { FORBIDDEN_PHRASES } from "../../server/samples/copy.test.ts";

/** 03장 7.7절의 컴포넌트 8종. StepRail 은 7.7절 목록에 없어 제외(로그 참고). */
const COMPONENTS = ["AlternativesTable", "ContrastPair", "DualTimeline", "ProofLink", "AssumptionTable", "Callout", "SourceNote", "SampleTag"];

const EXTRA_FORBIDDEN = [
  "무료", "무제한", "할인", "최저가", "얼리버드", "보장", "100%", "1위", "업계최초",
  "Windows전용", "윈도우전용", "설치형전용", "가입크레딧", "14일체험", "p95", "ms이내",
];

/** 타사 실명(D-27): 범주 이름만 쓴다. 검사 목록이라 이 파일은 소스 검사 대상이 아니다. */
const COMPETITOR_NAMES = [
  "랜드북", "PlanReviewer", "TestFit", "Forma", "Autodesk", "SketchUp", "Rhino", "AutoCAD", "Revit", "ArchiCAD", "Midjourney", "ChatGPT", "Copilot", "Gemini", "Claude",
  "건축HUB", "세움터", "스케치업", "오토캐드", "라이노", "미드저니", "챗GPT", "크몽", "숨고", "Figma", "Notion",
];

const dir = new URL("./", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
const squash = (s: string) => s.replace(/\s+/g, "");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SOURCE_FILES = readdirSync(dir).filter((f) => /\.(tsx?|mjs)$/.test(f) && !f.endsWith(".test.ts"));
const DOC_FILES = ["README.md"];

test("컴포넌트 8종 파일과 index 내보내기", () => {
  const index = read("index.ts");
  for (const c of COMPONENTS) {
    assert.ok(SOURCE_FILES.includes(`${c}.tsx`), `${c}.tsx 없음`);
    assert.ok(new RegExp(`export \\{ ${c} \\}`).test(index), `index 에 ${c} 없음`);
  }
  assert.equal(SOURCE_FILES.filter((f) => f.endsWith(".tsx")).length, COMPONENTS.length, "8종 외 컴포넌트 파일이 있다");
});

for (const rel of [...SOURCE_FILES, ...DOC_FILES]) {
  test(`금지 문구·타사 실명 0: ${rel}`, () => {
    const text = squash(rel.endsWith(".md") ? read(rel) : stripComments(read(rel)));
    for (const phrase of [...FORBIDDEN_PHRASES, ...EXTRA_FORBIDDEN]) {
      assert.ok(!text.includes(squash(phrase)), `금지 문구 "${phrase}" 발견: ${rel}`);
    }
    for (const name of COMPETITOR_NAMES) {
      // 영문 이름은 단어 경계로 찾는다("Forma" 가 "format" 에 걸리지 않게).
      const re = new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, "i");
      assert.ok(!re.test(text), `타사 실명 "${name}" 발견: ${rel}`);
    }
  });
}

for (const rel of SOURCE_FILES.filter((f) => /\.tsx?$/.test(f))) {
  test(`토큰만 사용(hex·px 직접 값 0): ${rel}`, () => {
    const text = stripComments(read(rel));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(text), `hex 색 발견: ${rel}`);
    assert.ok(!/\dpx\b/.test(text), `px 값 발견: ${rel}`);
    assert.ok(!/\b(rgb|rgba|hsl|oklch)\(/.test(text), `색 함수 발견: ${rel}`);
    assert.ok(!/(text|bg|border|ring|fill|stroke|divide)-(\[|white\b|black\b|(red|green|blue|gray|slate|zinc|neutral|rose|emerald)-)/.test(text), `토큰 밖 색 유틸리티: ${rel}`);
    assert.ok(!/style=\{\{/.test(text), `인라인 style 금지: ${rel}`);
  });

  test(`서버 컴포넌트: "use client"·훅·이벤트 핸들러 0: ${rel}`, () => {
    const text = stripComments(read(rel));
    assert.ok(!/["']use client["']/.test(text), `"use client" 발견: ${rel}`);
    assert.ok(!/\buse(State|Effect|Ref|LayoutEffect|Reducer)\b/.test(text), `클라이언트 훅 발견: ${rel}`);
    assert.ok(!/\bon[A-Z][A-Za-z]*=\{/.test(text), `이벤트 핸들러 발견: ${rel}`);
    assert.ok(!/dangerouslySetInnerHTML/.test(text), `dangerouslySetInnerHTML 금지: ${rel}`);
  });

  test(`경계: packages/ui·다른 앱 경로를 import 하지 않는다: ${rel}`, () => {
    const imports = [...stripComments(read(rel)).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] as string);
    for (const spec of imports) {
      assert.ok(!spec.startsWith("@arch-studio/"), `워크스페이스 패키지 import: ${spec} (${rel})`);
      if (spec.startsWith(".")) assert.ok(!spec.startsWith(".."), `상위 경로 import: ${spec} (${rel})`);
    }
  });

  test(`모션: 전환·애니메이션은 motion-safe 안에서만: ${rel}`, () => {
    const text = stripComments(read(rel));
    for (const m of text.matchAll(/(?<![\w:-])(animate-[\w-]+|transition[\w-]*|duration-[\w-]+)/g)) {
      assert.fail(`motion-safe 없이 ${m[1]} 사용: ${rel}`);
    }
  });
}

test("화살표 문구 금지: 링크·버튼 문구 소스에 → 가 없다", () => {
  for (const rel of SOURCE_FILES.filter((f) => f.endsWith(".tsx"))) {
    assert.ok(!/[→↗➜]/.test(stripComments(read(rel))), `화살표 발견: ${rel}`);
  }
});

test("영문 대문자 아이브로·라벨 금지: 화면 문구에 영어 대문자 라벨이 없다", () => {
  for (const rel of SOURCE_FILES.filter((f) => f.endsWith(".tsx"))) {
    const text = stripComments(read(rel));
    assert.ok(!/uppercase|tracking-(wide|widest)/.test(text), `uppercase 클래스: ${rel}`);
  }
});

test("README 에 컴포넌트 8종 표와 사용 규칙이 있다", () => {
  const md = read("README.md");
  for (const c of COMPONENTS) assert.ok(md.includes(`\`${c}\``), `README 에 ${c} 없음`);
  assert.ok(md.includes("StepRail"), "README 에 StepRail 제외 근거가 있다");
});

test("검사기 자체 확인: 위반 문자열을 넣으면 잡힌다", () => {
  assert.ok(/#[0-9a-fA-F]{3,8}\b/.test("bg-[#1e1d1b]"));
  assert.ok(/\dpx\b/.test("w-[12px]"));
  assert.ok(squash("허가 100% 통과").includes("허가100%통과"));
  assert.ok("SketchUp 호환".toLowerCase().includes("sketchup"));
});
