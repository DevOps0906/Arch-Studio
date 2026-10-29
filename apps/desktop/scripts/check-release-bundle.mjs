#!/usr/bin/env node
// 데스크톱 릴리스 번들 검사(AR-06-004b): Mock(008, scripts/dev/check-bundle-mock.mjs MOCK_MARKERS) + 데모 데이터(features/demo) 문자열 0.
//   node scripts/check-release-bundle.mjs dist                    릴리스 산출물: 표식 0건이어야 통과
//   node scripts/check-release-bundle.mjs --expect-present <dir>  대조군(개발 빌드 + VITE_DEMO_MODE=1): 데모 표식이 있어야 통과(검사 자체가 동작함)
// 릴리스 빌드는 NODE_ENV=production으로 만든다(Vite의 import.meta.env.DEV는 NODE_ENV를 따른다, 008 메모).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_MARKERS } from "../../../scripts/dev/check-bundle-mock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/features/src/demo/samples.ts DEMO_MARKER + 샘플 이름(같은 값을 여기 적는다: 데모 모듈을 import하면 TS라 Node가 못 읽는다).
// 셸의 데모 띠 문구는 셸 코드(항상 번들)에 있어 표식으로 쓰지 않는다 — runtime.demo가 거짓이면 렌더되지 않을 뿐이다.
export const DEMO_MARKERS = ["arch-demo-data-v1", "운중동 단독주택", "역삼동 다세대주택"];
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
const expectPresent = args[0] === "--expect-present";
const dir = path.resolve(process.cwd(), expectPresent ? (args[1] ?? "") : (args[0] ?? path.join(HERE, "../dist")));

if (expectPresent) {
  const hits = scan(dir, DEMO_MARKERS);
  if (hits.length === 0) {
    console.error(`대조군에 데모 표식이 없다(검사 조건이 깨졌다): ${dir}`);
    process.exit(1);
  }
  console.log(`대조군 데모 표식 ${hits.length}건 있음 — 통과`);
} else {
  const hits = scan(dir, [...MOCK_MARKERS, ...DEMO_MARKERS]);
  if (hits.length) {
    console.error(`릴리스 번들에 Mock·데모 문자열:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`릴리스 번들 Mock·데모 문자열 0건: ${dir}`);
}
