#!/usr/bin/env node
// 키 모양 비밀 검사(AR-06-058a, 09_SECURITY_PLAN). 새 의존성 없음.
//   node scripts/ci/scan-secrets.mjs repo              추적 파일 전체(허용 목록 적용)
//   node scripts/ci/scan-secrets.mjs dir <경로>...      빌드 산출물(dist 등) — 허용 목록 없음, 전부 검사
// 규칙: JWT(디코딩해 role=service_role) · sb_secret_ · sk- · 결제 키 · GitHub 토큰 · AWS·Google 키 ·
//       PEM 개인키 헤더 · PRIVATE/SIGNING_KEY 변수 값 · .pfx/.p12 추적.
// 출력에는 비밀 값을 싣지 않는다(앞 4자 + sha256 앞 8자). 종료 코드 0 통과, 1 발견.
// 8MB 초과·바이너리(NUL) 파일은 건너뛰되 dir 모드에서 개수와 경로를 출력한다. UTF-16 은 디코딩해 검사한다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const MAX_BYTES = 8 * 1024 * 1024;

// 허용 목록: 가드 코드·스캐너 자신·테스트 픽스처만, 파일 단위. 항목마다 이유 필수.
export const ALLOWLIST = [
  { rule: "*", path: "scripts/ci/scan-secrets.test.mjs", reason: "대조군 테스트(가짜 키는 실행 중에 조립한다)" },
  { rule: "jwt-service-role", path: "workers/arch-jobs/src/core/mask.test.ts", reason: "마스킹 테스트용 가짜 JWT 픽스처" },
];

const b64urlJson = (s) => {
  try {
    return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
};

// 자리표시자·빈 값은 비밀이 아니다(.env.example 등).
const PLACEHOLDER = /^["']?(<|\$|\{|your|change|example|placeholder|dummy|todo|xxx|\.\.\.|\*+)/i;

export const RULES = [
  {
    id: "jwt-service-role",
    re: /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{4,})\.[A-Za-z0-9_-]*/g,
    test: (m) => b64urlJson(m[1])?.role === "service_role",
  },
  { id: "sb-secret", re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { id: "sk-key", re: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g },
  { id: "payment-key", re: /(?<![A-Za-z0-9])(?:(?:live|test)_(?:sk|gsk|ck)_|sk_(?:live|test)_)[A-Za-z0-9_-]{8,}/g },
  { id: "github-token", re: /(?<![A-Za-z0-9_])(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { id: "aws-access-key", re: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g },
  { id: "google-api-key", re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g },
  {
    id: "key-variable",
    re: /\b[A-Z0-9_]*(?:PRIVATE|SIGNING)_KEY\s*[=:]\s*(\S{20,})/g,
    test: (m) => !PLACEHOLDER.test(m[1]),
  },
  { id: "pem-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

const allowed = (rel, rule) => ALLOWLIST.some((a) => (a.rule === "*" || a.rule === rule) && rel === a.path);

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

// 텍스트로 디코딩한다. UTF-16(BOM 또는 NUL 이 홀수 위치에 몰림)은 풀어서 반환, 그 밖의 NUL 파일은 null(바이너리).
export function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  const head = buf.subarray(0, 8192);
  if (!head.includes(0)) return buf.toString("utf8");
  let odd = 0;
  let even = 0;
  for (let i = 0; i < head.length; i++) if (head[i] === 0) {
      if (i % 2) odd++;
      else even++;
    }
  if (odd > head.length / 4 && even === 0) return buf.toString("utf16le");
  if (even > head.length / 4 && odd === 0) return Buffer.from(buf).swap16().toString("utf16le");
  return null;
}

const KEYSTORE = /\.(pfx|p12)$/i;

function scanFile(full, rel, opts, skipped) {
  if (KEYSTORE.test(rel)) return [`${rel}: keystore-file (.pfx/.p12 는 저장소·산출물에 둘 수 없다)`];
  const st = statSync(full);
  if (!st.isFile()) return [];
  if (st.size > MAX_BYTES) {
    skipped.push(`${rel} (8MB 초과)`);
    return [];
  }
  const text = decode(readFileSync(full));
  if (text === null) {
    skipped.push(`${rel} (바이너리)`);
    return [];
  }
  return scanText(text, rel, opts);
}

export function scanRepo(root = ROOT) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString("utf8").split("\0").filter(Boolean);
  const skipped = [];
  const hits = files.flatMap((f) =>
    f.startsWith("spikes/") ? [] : scanFile(path.join(root, f), f.replaceAll("\\", "/"), { useAllowlist: true }, skipped),
  );
  return hits;
}

export function scanDirs(dirs, skipped = []) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else hits.push(...scanFile(full, path.relative(process.cwd(), full).replaceAll("\\", "/"), { useAllowlist: false }, skipped));
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
  const skipped = [];
  const hits = mode === "repo" ? scanRepo() : scanDirs(rest, skipped);
  if (skipped.length) console.log(`검사 못 한 파일 ${skipped.length}개:\n${skipped.join("\n")}`);
  if (hits.length) {
    console.error(`키 모양 비밀 ${hits.length}건:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`키 모양 비밀 0건 (${mode})`);
}
