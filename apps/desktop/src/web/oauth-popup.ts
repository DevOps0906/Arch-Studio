// 웹 스튜디오 Google 로그인(AR-06-071 결정 6): 팝업 + PKCE. 리다이렉트 복귀 없음.
// - opener: 클릭 직후 빈 팝업을 연다(차단 회피) → supabase가 만든 인가 URL(PKCE verifier는 opener 메모리 저장소)로 보낸다
//   → 팝업 콜백이 보낸 code를 받아(같은 출처·같은 팝업 창만) opener가 교환한다. 세션은 메모리뿐(새로고침 = 재로그인).
// - 팝업 콜백 페이지(/auth/callback): 앱을 띄우지 않고 code·error만 opener에 같은 출처 postMessage 후 닫는다.
import type { SignInOutcome } from "@arch-studio/features/shell";

/** 팝업 콜백 경로(SPA 폴백으로 index.html → main.tsx가 앱 대신 처리). Supabase Redirect URL에 `<스튜디오 출처>/auth/callback` 등록 필요. */
export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_MESSAGE_TYPE = "arch-oauth-callback";
export const OAUTH_POPUP_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 500;

/** 콜백 → opener 메시지. code는 1회용 인가 코드(verifier 없이는 교환 불가). */
export interface OAuthCallbackMessage {
  readonly type: typeof OAUTH_MESSAGE_TYPE;
  readonly code: string | null;
  readonly error: string | null;
}

/** 테스트 주입용 최소 창 모양. */
export interface PopupWindow {
  closed: boolean;
  location: { href: string };
  close(): void;
}

export interface OpenerWindow {
  readonly location: { readonly origin: string };
  open(url: string, target: string, features: string): PopupWindow | null;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/** supabase-js 중 쓰는 부분(구조적). */
export interface PkceAuth {
  signInWithOAuth(args: {
    provider: "google";
    options: { redirectTo: string; skipBrowserRedirect: true };
  }): Promise<{ data: { url: string | null } | null; error: unknown }>;
  exchangeCodeForSession(code: string): Promise<{ error: unknown }>;
}

function isCallbackMessage(v: unknown): v is OAuthCallbackMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    m.type === OAUTH_MESSAGE_TYPE &&
    (m.code === null || typeof m.code === "string") &&
    (m.error === null || typeof m.error === "string")
  );
}

/** 팝업이 보낸 콜백 하나를 기다린다. 다른 출처·다른 창 메시지는 무시. 닫힘·시간 초과는 null. */
function waitForCallback(win: OpenerWindow, popup: PopupWindow, timeoutMs: number): Promise<OAuthCallbackMessage | null> {
  return new Promise((resolve) => {
    const done = (v: OAuthCallbackMessage | null) => {
      win.removeEventListener("message", onMessage);
      win.clearTimeout(timer);
      win.clearInterval(poll);
      resolve(v);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== win.location.origin || e.source !== (popup as unknown) || !isCallbackMessage(e.data)) return;
      done(e.data);
    };
    win.addEventListener("message", onMessage);
    const timer = win.setTimeout(() => done(null), timeoutMs);
    const poll = win.setInterval(() => {
      if (popup.closed) done(null);
    }, POLL_MS);
  });
}

/** AuthPort.signInWithGoogle(웹). 클릭 처리 안에서 바로 불려야 팝업이 차단되지 않는다(첫 await 전에 창을 연다). */
export function popupGoogleSignIn(
  auth: PkceAuth,
  callbackPath: string,
  win: OpenerWindow = window as unknown as OpenerWindow,
  timeoutMs = OAUTH_POPUP_TIMEOUT_MS,
): () => Promise<SignInOutcome> {
  return async () => {
    const popup = win.open("about:blank", "arch-oauth", "popup,width=480,height=680");
    if (!popup) return { ok: false, code: "callback" };
    try {
      let url: string | null = null;
      try {
        const r = await auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${win.location.origin}${callbackPath}`, skipBrowserRedirect: true },
        });
        url = r.error ? null : (r.data?.url ?? null);
      } catch {
        url = null;
      }
      if (!url) return { ok: false, code: "network" };
      popup.location.href = url;
      const msg = await waitForCallback(win, popup, timeoutMs);
      if (!msg?.code) return { ok: false, code: msg?.error === "access_denied" ? "login_failed" : "callback" };
      try {
        const { error } = await auth.exchangeCodeForSession(msg.code);
        return error ? { ok: false, code: "callback" } : { ok: true };
      } catch {
        return { ok: false, code: "network" };
      }
    } finally {
      if (!popup.closed) popup.close();
    }
  };
}

/** 콜백 쪽 창 모양. */
export interface CallbackWindow {
  readonly location: { readonly origin: string; readonly pathname: string; readonly search: string };
  readonly opener: { postMessage(msg: unknown, targetOrigin: string): void } | null;
  close(): void;
}

/**
 * 팝업 콜백 페이지면 code·error를 opener(같은 출처 지정)에 보내고 창을 닫는다 → true(앱을 띄우지 않는다).
 * 콜백 경로가 아니면 false. opener가 없으면(직접 연 주소) 아무것도 보내지 않고 닫는다.
 */
export function handleOAuthPopupCallback(callbackPath: string, win: CallbackWindow = window as unknown as CallbackWindow): boolean {
  if (win.location.pathname !== callbackPath) return false;
  const q = new URLSearchParams(win.location.search);
  const msg: OAuthCallbackMessage = { type: OAUTH_MESSAGE_TYPE, code: q.get("code"), error: q.get("error") };
  win.opener?.postMessage(msg, win.location.origin);
  win.close();
  return true;
}
