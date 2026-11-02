// 웹 Google 로그인 팝업(AR-06-071 결정 6): 같은 출처·같은 팝업 메시지만 받고, opener가 교환한다. 콜백은 opener에만 보내고 닫는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleOAuthPopupCallback,
  OAUTH_CALLBACK_PATH,
  OAUTH_MESSAGE_TYPE,
  popupGoogleSignIn,
  type OpenerWindow,
  type PkceAuth,
  type PopupWindow,
} from "./oauth-popup.ts";

const ORIGIN = "https://app.example.test";

function fakeOpener(openReturnsNull = false) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const popup: PopupWindow & { closeCalls: number } = {
    closed: false,
    location: { href: "about:blank" },
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
      this.closed = true;
    },
  };
  const timers: (() => void)[] = [];
  const win: OpenerWindow = {
    location: { origin: ORIGIN },
    open: () => (openReturnsNull ? null : popup),
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  const emit = (data: unknown, origin = ORIGIN, source: unknown = popup) => {
    for (const fn of [...listeners]) fn({ data, origin, source } as MessageEvent);
  };
  return { win, popup, emit, timers, listeners };
}

function fakeAuth(exchangeError: unknown = null) {
  const calls: { redirectTo?: string; exchanged?: string } = {};
  const auth: PkceAuth = {
    async signInWithOAuth({ options }) {
      calls.redirectTo = options.redirectTo;
      return { data: { url: "https://abc.supabase.example.test/auth/v1/authorize?provider=google" }, error: null };
    },
    async exchangeCodeForSession(code) {
      calls.exchanged = code;
      return { error: exchangeError };
    },
  };
  return { auth, calls };
}

const tick = () => new Promise((r) => setImmediate(r));

test("성공: 팝업을 인가 URL로 보내고, 같은 출처·같은 팝업 메시지의 code만 교환한다", async () => {
  const { win, popup, emit } = fakeOpener();
  const { auth, calls } = fakeAuth();
  const p = popupGoogleSignIn(auth, OAUTH_CALLBACK_PATH, win)();
  await tick();
  assert.equal(calls.redirectTo, `${ORIGIN}/auth/callback`);
  assert.match(popup.location.href, /authorize/);
  emit({ type: OAUTH_MESSAGE_TYPE, code: "evil", error: null }, "https://evil.example.test");
  emit({ type: OAUTH_MESSAGE_TYPE, code: "evil", error: null }, ORIGIN, {});
  emit({ type: "other", code: "evil" });
  emit({ type: OAUTH_MESSAGE_TYPE, code: "good-code", error: null });
  assert.deepEqual(await p, { ok: true });
  assert.equal(calls.exchanged, "good-code");
  assert.ok(popup.closed);
});

test("실패: 팝업 차단·교환 실패·error 응답·시간 초과는 ok:false, 리스너를 남기지 않는다", async () => {
  assert.deepEqual(await popupGoogleSignIn(fakeAuth().auth, OAUTH_CALLBACK_PATH, fakeOpener(true).win)(), { ok: false, code: "callback" });

  const a = fakeOpener();
  const pa = popupGoogleSignIn(fakeAuth({ message: "bad" }).auth, OAUTH_CALLBACK_PATH, a.win)();
  await tick();
  a.emit({ type: OAUTH_MESSAGE_TYPE, code: "c", error: null });
  assert.deepEqual(await pa, { ok: false, code: "callback" });

  const b = fakeOpener();
  const pb = popupGoogleSignIn(fakeAuth().auth, OAUTH_CALLBACK_PATH, b.win)();
  await tick();
  b.emit({ type: OAUTH_MESSAGE_TYPE, code: null, error: "access_denied" });
  assert.deepEqual(await pb, { ok: false, code: "login_failed" });

  const c = fakeOpener();
  const pc = popupGoogleSignIn(fakeAuth().auth, OAUTH_CALLBACK_PATH, c.win)();
  await tick();
  c.timers.forEach((fn) => fn());
  assert.deepEqual(await pc, { ok: false, code: "callback" });
  assert.equal(c.listeners.size, 0);
  assert.ok(c.popup.closed);
});

test("콜백 페이지: 콜백 경로면 opener에 같은 출처로 code·error를 보내고 닫는다, 아니면 false", () => {
  const sent: { msg: unknown; target: string }[] = [];
  let closed = 0;
  const win = (pathname: string, opener = true) => ({
    location: { origin: ORIGIN, pathname, search: "?code=abc&state=x" },
    opener: opener ? { postMessage: (msg: unknown, target: string) => sent.push({ msg, target }) } : null,
    close: () => {
      closed += 1;
    },
  });
  assert.equal(handleOAuthPopupCallback(OAUTH_CALLBACK_PATH, win("/projects")), false);
  assert.equal(closed, 0);
  assert.equal(handleOAuthPopupCallback(OAUTH_CALLBACK_PATH, win(OAUTH_CALLBACK_PATH)), true);
  assert.deepEqual(sent, [{ msg: { type: OAUTH_MESSAGE_TYPE, code: "abc", error: null }, target: ORIGIN }]);
  assert.equal(handleOAuthPopupCallback(OAUTH_CALLBACK_PATH, win(OAUTH_CALLBACK_PATH, false)), true);
  assert.equal(sent.length, 1);
  assert.equal(closed, 2);
});
