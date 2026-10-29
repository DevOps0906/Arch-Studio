import { Button } from "@arch-studio/ui";
import { MOCK_PERSONAS } from "../../../lib/auth/personas.ts";
import type { ClientSession } from "../../../lib/auth/session.ts";
import { signOutAction } from "./actions.ts";

// Stage A 개발용 패널(서버 컴포넌트, 클라이언트 JS 없음). 판정이 참일 때만 page.tsx가 렌더한다.
// 폼은 페르소나 키만 보낸다(이메일·비밀번호는 서버 env·서버 코드에만).
export function MockPanel({ session, next }: { session: ClientSession | null; next: string | null }) {
  return (
    <section aria-labelledby="mock-title" className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-pad">
      <div className="flex flex-col gap-1">
        <h2 id="mock-title" className="text-h2 font-semibold">
          개발용 로그인
        </h2>
        <p className="text-body text-fg-2">로컬 Supabase의 시드 계정으로 실제 로그인합니다. 시드는 scripts/dev/seed-users.mjs가 만듭니다.</p>
      </div>
      {session ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-pad">
          <p className="text-body">
            현재: <span className="font-semibold">{session.display_name ?? "이름 없음"}</span>
            <span className="text-fg-2">
              {" "}
              · {session.org?.role ?? "조직 없음"} · {session.plan_code ?? "권한 없음"} · 잔액 {session.credit_balance}
            </span>
          </p>
          <form action={signOutAction}>
            <Button type="submit" size="sm" variant="ghost">
              로그아웃
            </Button>
          </form>
        </div>
      ) : null}
      <form method="post" action="/api/dev/login" className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {MOCK_PERSONAS.map((p) => (
          <Button key={p.key} type="submit" name="persona" value={p.key} className="justify-start">
            <span className="font-mono text-caption text-fg-2">{p.key}</span>
            <span>{p.label}</span>
          </Button>
        ))}
      </form>
    </section>
  );
}
