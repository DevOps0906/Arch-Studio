// 판정 패널 소스 검사: 금지 문구(PRD 6.1·9.7), hex·px 직접 값 0, 경계(다른 feature·rules 직접 import 금지), 고정 문구 존재.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DIR = new URL("./", import.meta.url);
const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && f !== "fixtures.engine.ts");
const read = (f: string) => readFileSync(new URL(f, DIR), "utf8");
const squash = (s: string) => s.replace(/\s+/g, "");

// PRD 6.1·9.7 점검표의 금지 표현(띄어쓰기 무시). 공백 없이 비교한다.
const FORBIDDEN = [
  "허가100%통과",
  "허가통과",
  "반려걱정없음",
  "모든법규자동검토",
  "법규완벽반영",
  "건축사없이설계",
  "설계사무소가필요없습니다",
  "국토부인증",
  "세움터공식연동",
  "공식파트너",
  "인허가보장",
  "인허가도면자동작성",
  "허가도서완성",
  "합격보장",
  "무료",
  "할인",
  "얼리버드",
];

test("파일 목록에 구현 파일이 모두 있다", () => {
  for (const f of ["JudgmentPanel.tsx", "useJudgment.ts", "model.ts", "request.ts", "fallback.ts", "messages.ts", "preview.tsx", "index.ts"]) {
    assert.ok(files.includes(f), f);
  }
});

for (const f of files) {
  test(`금지 문구 0: ${f}`, () => {
    const s = squash(read(f));
    for (const phrase of FORBIDDEN) assert.ok(!s.includes(phrase), `금지 문구 "${phrase}" 발견: ${f}`);
  });

  test(`hex·px 직접 값 0, 인라인 style 0: ${f}`, () => {
    const code = read(f)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), "hex 색 금지");
    assert.ok(!/\b\d+(\.\d+)?px\b/.test(code), "px 값 금지");
    assert.ok(!/\b(?:h|w|min-h|max-h|min-w|max-w|size)-px\b/.test(code), "h-px류 금지");
    assert.ok(!/style=\{\{/.test(code), "인라인 style 금지");
    assert.ok(!/dangerouslySetInnerHTML/.test(code));
  });
}

test("경계: 다른 feature 폴더·rules·shell-bridge 런타임 import 없음, 패널은 shell을 import하지 않는다", () => {
  for (const f of files) {
    const imports = [...read(f).matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1] as string);
    for (const spec of imports) {
      assert.ok(!/^\.\.\/(?!shell\/)/.test(spec), `${f}: 다른 feature import ${spec}`);
      assert.ok(!spec.startsWith("@arch-studio/rules"), `${f}: rules 직접 import 금지 ${spec}`);
      assert.ok(!spec.startsWith("@arch-studio/shell-bridge"), `${f}: shell-bridge 런타임 import 금지 ${spec}`);
    }
  }
  const panelImports = [...read("JudgmentPanel.tsx").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
  assert.ok(panelImports.every((s) => !s.includes("shell")), "JudgmentPanel은 표시 전용(shell 훅 없음)");
});

test("고정 문구(03장 3.5절)가 messages.ts에 그대로 있다", () => {
  assert.ok(read("messages.ts").includes("판정은 설계 검토를 돕는 참고 자료입니다. 최종 판단은 건축사와 허가권자가 합니다."));
});

test("판정을 새로 계산하지 않는다: 엔진 판정 함수·기하 함수 import 없음", () => {
  for (const f of files) {
    const code = read(f);
    assert.ok(!/@arch-studio\/(?:rules|geometry|massing|layout)/.test(code), f);
    assert.ok(!/\bjudge\(/.test(code.replace(/\/\/.*$/gm, "")), `${f}: judge() 직접 호출 금지`);
  }
});
