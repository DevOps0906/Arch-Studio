// 인증 단계 분기 경계(AUTH_ROADMAP.md 2.4·9장 CI 금지 문자열, 02_ARCHITECTURE.md 9.4절). grep 기반 기계 검사.
// eslint `authMode` 묶음(eslint.config.mjs)이 같은 규칙을 구문 단위로 건다. 이 테스트는 템플릿·주석 우회까지 문자열로 잡는다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", "target", "src-tauri", "golden", ".turbo"]);
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

/** 검사 범위: 앱·패키지 소스, 데스크톱·웹 루트 설정 파일, scripts. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (EXT.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  };
  for (const base of ["apps", "packages", "scripts"]) walk(path.join(ROOT, base));
  return out.sort();
}

const FILES = sourceFiles();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 인증 모듈 경계(02_ARCHITECTURE.md 9장, 07_SOURCE_MIGRATION.md:154). */
const AUTH_PATHS = ["apps/web/src/lib/auth/", "packages/shell-bridge/src/auth/", "packages/features/src/auth/"];

/** 경계 밖이지만 분기가 아닌 "선언"이라 허용하는 파일(이유 명시). 새 항목 추가 = 보안 리뷰. */
const AUTH_MODE_DECLARATIONS: Record<string, string> = {
  "apps/web/src/lib/env/schema.ts": "env 스키마 선언·기동 검증(값 분기는 lib/auth)",
  "apps/web/src/lib/env/schema.test.ts": "env 스키마 테스트",
  "apps/desktop/env-allowlist.ts": "빌드 env 허용 목록·릴리스 mock 차단(위험 #8·#14)",
  "apps/desktop/env-allowlist.test.ts": "같은 파일 테스트",
  "scripts/dev/check-bundle-mock.mjs": "릴리스 번들 Mock 0 검사 도구(최악 가정으로 VITE_AUTH_MODE=mock을 넣어 빌드)",
};

const inAuth = (rel: string) => AUTH_PATHS.some((p) => rel.startsWith(p));

test("검사 범위가 비어 있지 않다(경로 계산 확인)", () => {
  assert.ok(FILES.includes("apps/web/src/lib/auth/config.ts"));
  assert.ok(FILES.length > 100);
});

test("AUTH_MODE·VITE_AUTH_MODE 참조는 인증 경로(+선언 예외) 밖에 0건", () => {
  const offenders = FILES.filter((f) => !inAuth(f) && !(f in AUTH_MODE_DECLARATIONS)).filter((f) => /AUTH_MODE/.test(read(f)));
  assert.deepEqual(offenders, []);
});

test("인증 경로 안에서도 AUTH_MODE를 직접 읽는 파일은 판정 모듈뿐", () => {
  const readers = FILES.filter(inAuth)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => /(process\.env|import\.meta\.env|env)(\.|\[["'`])(VITE_)?AUTH_MODE/.test(read(f)));
  assert.deepEqual(readers.sort(), ["apps/web/src/lib/auth/config.ts", "packages/shell-bridge/src/auth/mode.ts"]);
});

/** Mock 잔존: 시드 이메일·비밀번호 env·Mock 함수 이름은 인증 경로·로그인 화면·시드·선언 밖에 없어야 한다. */
const MOCK_MARKERS = /@dev\.test|DEV_SEED_PASSWORD|signInPersona|MOCK AUTH/;
const MOCK_ALLOWED = [...AUTH_PATHS, "apps/web/src/app/(auth)/", "scripts/dev/"];

test("Mock 문자열(시드 이메일·DEV_SEED_PASSWORD·signInPersona)이 허용 위치 밖에 0건", () => {
  const offenders = FILES.filter((f) => !MOCK_ALLOWED.some((p) => f.startsWith(p)) && !(f in AUTH_MODE_DECLARATIONS)).filter((f) =>
    MOCK_MARKERS.test(read(f)),
  );
  assert.deepEqual(offenders, []);
});

test("인증 경로 안 시드 이메일은 서버 전용 파일·데스크톱 개발 모듈·테스트에만", () => {
  const holders = FILES.filter(inAuth)
    .filter((f) => !/\.test\.tsx?$/.test(f) && !/test-helpers\.ts$/.test(f))
    .filter((f) => /dev\.test/.test(read(f)));
  assert.deepEqual(holders.sort(), ["apps/web/src/lib/auth/personas.ts", "packages/shell-bridge/src/auth/dev-mock.ts"]);
  // personas.ts는 브라우저 번들에 들어가지 않는다: "use client" 파일이 import하지 않는다.
  const clientFiles = FILES.filter((f) => f.startsWith("apps/web/src/") && /^\s*["']use client["']/.test(read(f)));
  for (const f of clientFiles) assert.doesNotMatch(read(f), /lib\/auth\//, f);
});

test("CI 금지 문자열(쿠키·스토리지 역할 Mock) 0건(AUTH_ROADMAP 9장)", () => {
  const banned = /nomad_role|nomad_plan|mock-auth|dev-user/;
  const offenders = FILES.filter((f) => f !== "apps/web/src/lib/auth/boundary.test.ts").filter((f) => banned.test(read(f)));
  assert.deepEqual(offenders, []);
});

/**
 * 인증 단계 판정 함수(isMockAuthAllowed·desktopAuthMode)를 쓸 수 있는 곳(보안 리뷰 M22: 기능 코드가 판정 결과로 `if (mock)` 분기 금지).
 * eslint `authJudge` 묶음(eslint.config.mjs AUTH_JUDGE_*)과 같은 목록. 새 항목 추가 = 보안 리뷰.
 */
const AUTH_JUDGE_ALLOWED = [
  "apps/web/src/lib/auth/",
  "packages/shell-bridge/src/auth/",
  "apps/web/src/app/(auth)/layout.tsx",
  "apps/web/src/app/(auth)/login/page.tsx",
  "apps/web/src/app/api/dev/login/",
];
/** 판정 함수 이름이 나오지만 기능 코드가 아닌 파일(이유 명시). */
const AUTH_JUDGE_TOOLS: Record<string, string> = {
  "scripts/dev/check-bundle-mock.mjs": "릴리스 번들 Mock 0 검사 도구(desktopAuthMode를 넣어 번들한 뒤 산출물을 grep)",
};
const JUDGE_NAMES = /\b(isMockAuthAllowed|desktopAuthMode)\b/;
/** 주석을 지운 코드(주석 속 이름은 위반이 아니다). `http://` 같은 문자열 속 `//`는 앞 글자 `:`로 건너뛴다. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("판정 함수(isMockAuthAllowed·desktopAuthMode)는 허용 목록 밖에서 import·호출 0건", () => {
  const offenders = FILES.filter((f) => !AUTH_JUDGE_ALLOWED.some((p) => f.startsWith(p)) && !(f in AUTH_JUDGE_TOOLS)).filter((f) =>
    JUDGE_NAMES.test(stripComments(read(f))),
  );
  assert.deepEqual(offenders, []);
  // 검사기 자체 확인: 허용 목록 안의 로그인 화면은 실제로 판정 함수를 쓴다(목록·정규식이 비어 통과하는 것 방지).
  assert.match(stripComments(read("apps/web/src/app/(auth)/login/page.tsx")), JUDGE_NAMES);
  assert.doesNotMatch(stripComments("// isMockAuthAllowed()\nconst u = 'http://x'; /* desktopAuthMode */"), JUDGE_NAMES);
  assert.match(stripComments("import { isMockAuthAllowed as ok } from 'x';"), JUDGE_NAMES);
});

test("safeNextPath 두 구현(web·features)과 테스트 벡터가 글자 그대로 같다", () => {
  assert.equal(read("packages/features/src/auth/next-path.ts"), read("apps/web/src/lib/auth/next-path.ts"));
  assert.equal(read("packages/features/src/auth/next-path.test.ts"), read("apps/web/src/lib/auth/next-path.test.ts"));
});

test("웹 dev 서버는 loopback에만 바인딩(`next dev -H 127.0.0.1`)", () => {
  const pkg = JSON.parse(read("apps/web/package.json")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.dev ?? "", /^next dev(\s.*)?\s-H 127\.0\.0\.1(\s|$)/);
});
