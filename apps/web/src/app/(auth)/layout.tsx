import type { ReactNode } from "react";
import { isMockAuthAllowed } from "../../lib/auth/config.ts";

// 인증 화면 틀(셸 밖 전체 화면, 03장 8절). Mock 허용일 때만 상단 고정 띠(AUTH_ROADMAP 2.1).
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const mock = isMockAuthAllowed();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      {mock ? (
        <p role="status" className="sticky top-0 z-10 bg-warn px-4 py-1 text-center text-caption font-semibold text-warn-fg">
          MOCK AUTH · 개발용 로그인 · 로컬 전용
        </p>
      ) : null}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 md:px-8 xl:py-16">{children}</div>
    </div>
  );
}
