// 데스크톱 `/login`(03장 3.1절, 2.1절 3~4단계). 셸 밖 전체 화면. 소유: AR-06-004b(최소 동작) → AR-06-062(Stage B 제공자·대기·재설정).
// A: 개발 빌드 Mock 패널(auth/dev-panel-loader, 릴리스 번들 0). B: Google·이메일 — 이 빌드에 없으면(AuthPort 메서드 null) 비활성 + 이유.
// 토큰·code는 화면·로그에 남기지 않는다. 오류 문구는 008 LOGIN_ERROR_TEXT(3.1절 표) 그대로.
import { Banner, Button, Field, Input, Spinner } from "@arch-studio/ui";
import { useCallback, useEffect, useId, useState, type ComponentType } from "react";
import { LOGIN_ERROR_TEXT } from "../auth/index.ts";
import { loadDevPanel } from "../auth/dev-panel-loader.ts";
import type { DevMockPanelProps } from "../auth/dev-panel-types.ts";
import { useSession } from "../shell/index.ts";

function useDevPanel(): ComponentType<DevMockPanelProps> | null {
  const [Panel, setPanel] = useState<ComponentType<DevMockPanelProps> | null>(null);
  useEffect(() => {
    let alive = true;
    loadDevPanel().then(
      (p) => alive && p && setPanel(() => p),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return Panel;
}

function EmailForm() {
  const { auth, state, startSignIn, failSignIn, completeSignIn } = useSession();
  const id = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = auth.signInWithPassword;
  const busy = state.kind === "signing_in" || state.kind === "finishing";

  async function submit() {
    if (!signIn) return;
    startSignIn();
    const r = await signIn(email.trim(), password);
    setPassword("");
    if (r.ok) await completeSignIn("email");
    else failSignIn(r.code);
  }

  return (
    <form
      className="flex flex-col gap-gap"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="이메일" htmlFor={`${id}-email`}>
        <Input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!signIn} />
      </Field>
      <Field label="비밀번호" htmlFor={`${id}-pw`} hint={signIn ? undefined : "이메일 로그인은 준비 중입니다(AR-06-062)."}>
        <Input id={`${id}-pw`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={!signIn} />
      </Field>
      <Button type="submit" variant="primary" loading={busy} disabled={!signIn}>
        이메일로 로그인
      </Button>
    </form>
  );
}

function ProviderButtons() {
  const { auth, state, startSignIn, failSignIn, completeSignIn } = useSession();
  const google = auth.signInWithGoogle;
  const waiting = state.kind === "signing_in";
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="w-full"
        disabled={!google || waiting}
        onClick={async () => {
          if (!google) return;
          startSignIn();
          const r = await google();
          if (r.ok) await completeSignIn("google");
          else failSignIn(r.code);
        }}
      >
        Google로 계속하기
      </Button>
      {!google ? <p className="text-caption text-fg-3">Google 로그인은 준비 중입니다(시스템 브라우저 + 딥링크, AR-06-062).</p> : null}
    </div>
  );
}

export function Screen() {
  const { state } = useSession();
  const Panel = useDevPanel();
  const [mockOn, setMockOn] = useState(false);
  const onAvailable = useCallback((v: boolean) => setMockOn(v), []);
  const error = state.kind === "signed_out" ? state.error : null;
  const busy = state.kind === "signing_in" || state.kind === "finishing";

  return (
    <main className="flex min-h-dvh items-start justify-center bg-bg px-4 py-10 text-fg md:items-center">
      <div className="flex w-full max-w-md flex-col gap-gap">
        <header className="flex flex-col gap-1">
          <p className="text-caption font-medium text-fg-3">Arch Studio</p>
          <h1 className="text-display font-semibold">로그인</h1>
          <p className="text-body text-fg-2">대지를 넣으면 법규 볼륨과 판정, 도면까지 이어집니다.</p>
        </header>

        {error ? <Banner tone="danger" title={LOGIN_ERROR_TEXT[error]} /> : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-body text-fg-2">
            <Spinner />
            {state.kind === "finishing" ? "계정 정보를 확인하는 중" : "로그인하는 중"}
          </p>
        ) : null}

        {Panel ? <Panel onAvailable={onAvailable} /> : null}

        {/* A단계(Mock)에서는 실제 제공자 버튼을 렌더하지 않는다(03장 3.1절, AUTH_ROADMAP :41) */}
        {!mockOn ? (
          <section aria-label="로그인 방법" className="flex flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
            <ProviderButtons />
            <div aria-hidden="true" className="flex items-center gap-2 text-caption text-fg-3">
              <span className="flex-1 border-t border-line" />
              또는
              <span className="flex-1 border-t border-line" />
            </div>
            <EmailForm />
          </section>
        ) : null}

        <p className="text-caption text-fg-3">세션은 이 PC의 OS 자격 증명 저장소에만 보관합니다.</p>
      </div>
    </main>
  );
}
