#!/usr/bin/env node
// 로컬 Supabase에 Stage A Mock 로그인용 페르소나 계정을 만든다(AUTH_ROADMAP.md 2.3절).
// 사용: `supabase db reset` 뒤 `node scripts/dev/seed-users.mjs --app arch`
// env: SUPABASE_URL(또는 NEXT_PUBLIC_SUPABASE_URL, loopback만), NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SEED_PASSWORD,
//      SUPABASE_DB_SCHEMA(기본 public = 모놀리스). 값은 출력하지 않는다.
import { formatReport, runSeed } from "./seed-lib.mjs";

function parseArgs(argv) {
  const apps = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--app") apps.push(argv[(i += 1)]);
    else if (argv[i]?.startsWith("--app=")) apps.push(argv[i].slice(6));
    else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  return apps;
}

try {
  const apps = parseArgs(process.argv.slice(2));
  if (apps.length !== 1 || apps[0] !== "arch") throw new Error("--app arch 하나만 지원한다(모놀리스 단일 앱)");
  const report = await runSeed({ env: process.env, log: (line) => console.log(line) });
  console.log(formatReport(report));
  if (report.some((r) => !r.ok)) {
    console.error("기대값과 다른 페르소나가 있다(위 표의 불일치 열).");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "시드 실패");
  process.exit(1);
}
