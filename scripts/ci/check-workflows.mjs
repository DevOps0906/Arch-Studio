#!/usr/bin/env node
// 워크플로 강화 규칙 검사(AR-06-058a [DECISION] 2·4). 새 의존성 없음.
//   node scripts/ci/check-workflows.mjs [워크플로 디렉터리]
// 규칙: secrets.* 참조 0 · pull_request_target·workflow_run 금지 · 최상위 permissions 선언 ·
//       외부 액션은 40자리 SHA 고정 · actions/checkout 은 persist-credentials: false.
// 예외: 서명 워크플로(desktop-release.yml, 058b)만 secrets 참조 허용 — 지금은 파일이 없다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SECRETS_ALLOWED_FILES = new Set(["desktop-release.yml"]);

export function checkWorkflow(name, text) {
  const errs = [];
  const lines = text.split(/\r?\n/);
  const code = lines.map((l) => l.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""));
  code.forEach((l, i) => {
    if (/\$\{\{[^}]*\bsecrets\b/.test(l) && !SECRETS_ALLOWED_FILES.has(name)) errs.push(`${name}:${i + 1}: secrets 참조 금지`);
    if (/\b(pull_request_target|workflow_run)\b/.test(l)) errs.push(`${name}:${i + 1}: pull_request_target·workflow_run 금지`);
    const u = l.match(/^\s*-?\s*uses:\s*(\S+)/);
    if (u && !u[1].startsWith("./") && !/@[0-9a-f]{40}$/.test(u[1])) errs.push(`${name}:${i + 1}: 액션 SHA 고정 필요 (${u[1]})`);
    if (u && u[1].startsWith("actions/checkout@")) {
      const block = code.slice(i + 1, i + 6).join("\n");
      if (!/persist-credentials:\s*false/.test(block)) errs.push(`${name}:${i + 1}: checkout 은 persist-credentials: false`);
    }
  });
  if (!code.some((l) => /^permissions:/.test(l))) errs.push(`${name}: 최상위 permissions 선언 필요`);
  return errs;
}

export function checkDir(dir) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => checkWorkflow(f, readFileSync(path.join(dir, f), "utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(ROOT, ".github/workflows"));
  const errs = checkDir(dir);
  if (errs.length) {
    console.error(errs.join("\n"));
    process.exit(1);
  }
  console.log(`워크플로 규칙 위반 0건 (${dir})`);
}
