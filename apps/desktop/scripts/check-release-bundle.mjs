#!/usr/bin/env node
// 데스크톱 릴리스 번들 검사(AR-06-004b): Mock(008, scripts/dev/check-bundle-mock.mjs MOCK_MARKERS) + 데모 데이터(features/demo) 문자열 0.
//   node scripts/check-release-bundle.mjs dist                    릴리스 산출물: 표식 0건이어야 통과
//   node scripts/check-release-bundle.mjs --expect-present <dir>  대조군(개발 빌드 + VITE_DEMO_MODE=1): 데모 표식이 있어야 통과(검사 자체가 동작함)
//   node scripts/check-release-bundle.mjs --web <dir>             웹 스튜디오 산출물(check-web-dist.mjs가 부름): 웹 전용 표식은 빼고 검사
//   node scripts/check-release-bundle.mjs --expect-web <dir>      대조군(웹 빌드): 웹 전용 표식이 있어야 통과
// 릴리스 빌드는 NODE_ENV=production으로 만든다(Vite의 import.meta.env.DEV는 NODE_ENV를 따른다, 008 메모).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_MARKERS } from "../../../scripts/dev/check-bundle-mock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/features/src/demo/samples.ts DEMO_MARKER + 샘플 이름(같은 값을 여기 적는다: 데모 모듈을 import하면 TS라 Node가 못 읽는다).
// 셸의 데모 띠 문구는 셸 코드(항상 번들)에 있어 표식으로 쓰지 않는다 — runtime.demo가 거짓이면 렌더되지 않을 뿐이다.
export const DEMO_MARKERS = ["arch-demo-data-v1", "운중동 단독주택", "역삼동 다세대주택"];
// 개발용 규칙 팩 본문(packages/rules/packs/2026.10.0/pack.json의 고유 문장, AR-06-042 P15). 릴리스 판정은 Rust 서명 검증 팩만 쓰므로
// 엔진 번들에 팩 바이트가 0이어야 한다(ADR-001 5장). 데모 빌드(대조군)에는 있어야 한다.
export const RULE_PACK_MARKERS = ["원문 대조 후 확정 규칙으로 바꾼다", "대지안의 공지·이격 기준 수치·조문 근거 문서에 없음"];
// 웹 스튜디오 분기에만 있는 문자열(AR-06-071): 팝업 OAuth 메시지 타입(src/web/oauth-popup.ts OAUTH_MESSAGE_TYPE),
// 웹 어댑터 자격 경로(shell-bridge web/entitlement.ts), Tauri 대체 모듈 오류 문구(src/web/tauri-stub.ts). 설치형 번들에는 0이어야 한다.
export const WEB_ONLY_MARKERS = ["arch-oauth-callback", "/api/entitlement", "웹 빌드에는 설치형 명령이 없다"];
const TEXT = /\.(js|mjs|cjs|css|html|json|map|txt)$/;

function scan(dir, markers) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (TEXT.test(name)) {
        const text = readFileSync(full, "utf8");
        for (const m of markers) if (text.includes(m)) hits.push(`${path.relative(process.cwd(), full)}: ${m}`);
      }
    }
  };
  walk(dir);
  return hits;
}

const args = process.argv.slice(2);
const flag = args[0]?.startsWith("--") ? args[0] : null;
const expectPresent = flag === "--expect-present";
const dir = path.resolve(process.cwd(), flag ? (args[1] ?? "") : (args[0] ?? path.join(HERE, "../dist")));

if (flag === "--expect-web") {
  const hits = scan(dir, WEB_ONLY_MARKERS);
  if (hits.length === 0) {
    console.error(`대조군(웹 빌드)에 웹 전용 표식이 없다(검사 조건이 깨졌다): ${dir}`);
    process.exit(1);
  }
  console.log(`대조군 웹 전용 표식 ${hits.length}건 있음 — 통과`);
} else if (expectPresent) {
  const hits = scan(dir, DEMO_MARKERS);
  const packHits = scan(dir, RULE_PACK_MARKERS);
  if (hits.length === 0 || packHits.length === 0) {
    console.error(`대조군에 데모·개발용 규칙 팩 표식이 없다(검사 조건이 깨졌다): ${dir}`);
    process.exit(1);
  }
  console.log(`대조군 데모 표식 ${hits.length}건·규칙 팩 표식 ${packHits.length}건 있음 — 통과`);
} else {
  // 설치형(기본)은 웹 전용 표식도 0. 웹 산출물(--web)은 웹 전용 표식을 빼고 검사한다.
  const web = flag === "--web";
  const hits = scan(dir, [...MOCK_MARKERS, ...DEMO_MARKERS, ...RULE_PACK_MARKERS, ...(web ? [] : WEB_ONLY_MARKERS)]);
  const what = web ? "Mock·데모·개발용 규칙 팩" : "Mock·데모·개발용 규칙 팩·웹 전용";
  if (hits.length) {
    console.error(`릴리스 번들에 ${what} 문자열:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`릴리스 번들 ${what} 문자열 0건: ${dir}`);
}
