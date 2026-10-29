// 개발용 로그인 패널(03장 3.1절 A, AR-06-008 Stage A). dev-panel-loader.ts의 DEV 조건 안 동적 import로만 도달한다.
// Mock 모듈은 앱이 넘긴 AuthPort.loadDevMock(shell-bridge loadDevMockAuth: 개발 빌드 + mock 단계 + loopback)만 연다.
// 비밀번호는 저장하지 않는다(키체인 허용 키 밖, 008 메모). 실패 사유는 코드만 보인다(이메일·Auth 원문 없음).
import { Button, Field, Input, Select } from "@arch-studio/ui";
import type { DevMockAuth } from "@arch-studio/shell-bridge/auth";
import { useEffect, useId, useState } from "react";
import { useSession } from "../shell/context.tsx";
import type { DevMockPanelProps } from "./dev-panel-types.ts";

const FAIL_TEXT: Record<string, string> = {
  not_local: "로컬 Supabase(127.0.0.1)에서만 쓸 수 있습니다.",
  invalid_persona: "모르는 페르소나입니다.",
  no_password: "시드 비밀번호를 입력하세요.",
  login_failed: "로그인하지 못했습니다. 로컬 시드(pnpm db:seed-users)를 확인하세요.",
};

export function DevMockPanel({ onAvailable }: DevMockPanelProps) {
  const { auth, state, startSignIn, failSignIn, completeSignIn } = useSession();
  const [mock, setMock] = useState<DevMockAuth | null>(null);
  const [persona, setPersona] = useState("owner");
  const [password, setPassword] = useState("");
  const [fail, setFail] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let alive = true;
    const load = auth.loadDevMock;
    if (!load) return;
    load().then(
      (m) => {
        if (!alive) return;
        setMock(m);
        onAvailable(m !== null);
      },
      () => alive && onAvailable(false),
    );
    return () => {
      alive = false;
    };
  }, [auth, onAvailable]);

  if (!mock) return null;
  const busy = state.kind === "signing_in" || state.kind === "finishing";

  async function submit() {
    if (!mock) return;
    setFail(null);
    startSignIn();
    const r = await mock.signInPersona(persona, password);
    setPassword("");
    if (r.ok) {
      await completeSignIn("email");
    } else {
      setFail(FAIL_TEXT[r.code] ?? FAIL_TEXT.login_failed!);
      failSignIn("login_failed");
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-gap rounded-panel border border-warn bg-surface p-pad">
      <p id={`${id}-title`} role="note" className="rounded-control bg-warn px-3 py-1 text-caption font-semibold text-warn-fg">
        개발용 로그인 · 로컬 전용
      </p>
      <form
        className="flex flex-col gap-gap"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="페르소나" htmlFor={`${id}-persona`}>
          <Select id={`${id}-persona`} value={persona} onChange={(e) => setPersona(e.target.value)}>
            {mock.personas.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="시드 비밀번호" htmlFor={`${id}-pw`} hint="저장하지 않습니다. 매번 입력합니다." error={fail ?? undefined}>
          <Input id={`${id}-pw`} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          이 페르소나로 로그인
        </Button>
      </form>
    </section>
  );
}
