// 무로그인 거부 열거(AR-06-071 결정 10): 스튜디오가 부르는 모든 API 라우트가 Authorization 없이 401.
// 실제 Route Handler 모듈을 자식 프로세스(`--conditions=react-server` + `@/` 해석 훅)에서 불러 부른다. 실패 닫힘 스위치는 모두 켠 상태.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STUDIO_ROUTES } from "./studio-routes.ts";

const HERE = import.meta.dirname;
const APP_DIR = path.resolve(HERE, "../../app");

/** 스튜디오 401 열거 밖의 라우트(메서드 + src/app 아래 route.ts). 새 항목 = 이유 필수(보안 리뷰). */
const NON_STUDIO_ROUTES: Readonly<Record<string, string>> = {
  "POST api/dev/login/route.ts": "개발 Mock 로그인: 원격·배포 환경 404(routes.test.ts)",
  "GET api/dev/login/route.ts": "같은 dev 라우트: 다른 메서드 404",
  "PUT api/dev/login/route.ts": "같은 dev 라우트: 다른 메서드 404",
  "PATCH api/dev/login/route.ts": "같은 dev 라우트: 다른 메서드 404",
  "DELETE api/dev/login/route.ts": "같은 dev 라우트: 다른 메서드 404",
  "OPTIONS api/dev/login/route.ts": "같은 dev 라우트: 다른 메서드 404",
  "HEAD api/dev/login/route.ts": "같은 dev 라우트: 다른 메서드 404",
  "POST api/internal/ai-token/route.ts": "워커 전용(ARCH_WORKER_INTERNAL_KEY Bearer), 스튜디오가 부르지 않음",
  "POST api/internal/ai-settle/route.ts": "워커 전용(ARCH_WORKER_INTERNAL_KEY Bearer), 스튜디오가 부르지 않음",
  "POST api/samples/download-event/route.ts": "마케팅 공개 샘플 다운로드 집계(무로그인 공개)",
  "GET api/updates/[target]/[arch]/[current_version]/route.ts": "Tauri 업데이터 매니페스트(설치형 Rust가 호출, 스튜디오 api-client 아님)",
  "GET api/site/search/route.ts": "주소는 본문으로만 — GET은 항상 405(POST만 스튜디오 호출)",
};

/** 자식 프로세스 실행. 실패면 stderr를 붙여 던진다. */
function runChild(args: string[]): string {
  const r = spawnSync(process.execPath, args, { cwd: HERE, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`자식 프로세스 실패(${r.status ?? r.signal}):\n${r.stderr}\n${r.error?.message ?? ""}`);
  return r.stdout;
}

test("스튜디오 API 라우트: Bearer 없이 모두 401(실제 Route Handler)", () => {
  const stdout = runChild(["--conditions=react-server", "--import", "./route-loader.mjs", "./studio-routes-unauth.run.ts"]);
  const rows = JSON.parse(stdout.trim().split("\n").at(-1) ?? "[]") as { method: string; path: string; status: number }[];
  const expected = STUDIO_ROUTES.filter((r) => r.file).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(rows.map((r) => `${r.method} ${r.path}`), expected);
  const not401 = rows.filter((r) => r.status !== 401).map((r) => `${r.method} ${r.path} → ${r.status}`);
  assert.deepEqual(not401, []);
});

test("목록의 route.ts가 실제로 있고, 미구현 표시(file: null)는 정말 없다(생기면 401 열거로 옮긴다)", () => {
  for (const r of STUDIO_ROUTES) {
    if (r.file) assert.ok(existsSync(path.join(APP_DIR, r.file)), r.file);
  }
  const missing = STUDIO_ROUTES.filter((r) => !r.file).map((r) => r.path.split("?")[0] ?? "");
  for (const p of missing) {
    const dir = p.replace(/^\/api\//, "api/").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "[id]");
    assert.ok(!existsSync(path.join(APP_DIR, dir, "route.ts")), `${p}: 라우트가 생겼다 — file을 채워 401 열거에 넣는다`);
  }
});

/** src/app/api/**\/route.ts의 export 메서드 → "METHOD api/.../route.ts". */
function serverRouteMethods(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const rel = path.relative(APP_DIR, full).split(path.sep).join("/");
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)) {
          out.push(`${m[1]} ${rel}`);
        }
      }
    }
  };
  walk(path.join(APP_DIR, "api"));
  return out.sort();
}

test("서버 API 라우트(메서드 단위) = 스튜디오 401 열거 ∪ 이유 있는 비스튜디오 목록(정확 대조, 새 라우트 누락 방지)", () => {
  const actual = serverRouteMethods();
  assert.ok(actual.includes("GET api/cloud-projects/route.ts"), "스캔 경로 확인");
  const studio = STUDIO_ROUTES.filter((r) => r.file).map((r) => `${r.method} ${r.file}`);
  assert.equal(new Set(studio).size, studio.length, "열거 중복");
  for (const key of studio) assert.ok(!(key in NON_STUDIO_ROUTES), `${key}: 두 목록에 모두 있다`);
  const expected = [...studio, ...Object.keys(NON_STUDIO_ROUTES)].sort();
  assert.deepEqual(actual, expected);
});
