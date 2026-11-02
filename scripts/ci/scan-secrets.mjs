#!/usr/bin/env node
// 키 모양 비밀 검사(AR-06-058a, 09_SECURITY_PLAN). 새 의존성 없음.
//   node scripts/ci/scan-secrets.mjs repo              추적 파일 전체(허용 목록 적용)
//   node scripts/ci/scan-secrets.mjs dir <경로>...      빌드 산출물(dist 등) — 허용 목록 없음, 전부 검사
// 규칙: JWT(디코딩해 role=service_role) · sb_secret_ · sk- · PEM 개인키 헤더.
// 출력에는 비밀 값을 싣지 않는다(앞 4자 + sha256 앞 8자). 종료 코드 0 통과, 1 발견.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const MAX_BYTES = 8 * 1024 * 1024;

// 허용 목록: 가드 코드·스캐너 자신·테스트 픽스처만. 항목마다 이유 필수. path 가 "/"로 끝나면 접두 일치.
export const ALLOWLIST = [
  { rule: "*", path: "scripts/ci/", reason: "스캐너와 대조군 테스트(가짜 키는 실행 중에 조립한다)" },
  { rule: "jwt-service-role", path: "workers/arch-jobs/src/core/mask.test.ts", reason: "마스킹 테스트용 가짜 JWT 픽스처" },
];

const b64urlJson = (s) => {
  try {
    return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
};

export const RULES = [
  {
    id: "jwt-service-role",
    re: /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{4,})\.[A-Za-z0-9_-]*/g,
    test: (m) => b64urlJson(m[1])?.role === "service_role",
  },
  { id: "sb-secret", re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { id: "sk-key", re: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g },
  { id: "pem-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

const allowed = (rel, rule) =>
  ALLOWLIST.some((a) => (a.rule === "*" || a.rule === rule) && (a.path.endsWith("/") ? rel.startsWith(a.path) : rel === a.path));

export function scanText(text, rel, { useAllowlist }) {
  const hits = [];
  for (const r of RULES) {
    if (useAllowlist && allowed(rel, r.id)) continue;
    for (const m of text.matchAll(r.re)) {
      if (r.test && !r.test(m)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const sha = createHash("sha256").update(m[0]).digest("hex").slice(0, 8);
      hits.push(`${rel}:${line}: ${r.id} (${m[0].slice(0, 4)}..., sha256:${sha})`);
    }
  }
  return hits;
}

function scanFile(full, rel, opts) {
  const st = statSync(full);
  if (!st.isFile() || st.size > MAX_BYTES) return [];
  const buf = readFileSync(full);
  if (buf.subarray(0, 8192).includes(0)) return []; // 바이너리
  return scanText(buf.toString("utf8"), rel, opts);
}

export function scanRepo(root = ROOT) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString("utf8").split("\0").filter(Boolean);
  return files.flatMap((f) => (f.startsWith("spikes/") ? [] : scanFile(path.join(root, f), f.replaceAll("\\", "/"), { useAllowlist: true })));
}

export function scanDirs(dirs) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else hits.push(...scanFile(full, path.relative(process.cwd(), full).replaceAll("\\", "/"), { useAllowlist: false }));
    }
  };
  for (const d of dirs) walk(path.resolve(d));
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "repo" && !(mode === "dir" && rest.length)) {
    console.error("사용: scan-secrets.mjs repo | dir <경로>...");
    process.exit(2);
  }
  const hits = mode === "repo" ? scanRepo() : scanDirs(rest);
  if (hits.length) {
    console.error(`키 모양 비밀 ${hits.length}건:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`키 모양 비밀 0건 (${mode})`);
}
