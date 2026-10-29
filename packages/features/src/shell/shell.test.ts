// 셸 순수 로직: 라우트 가드(008 상태기계 입력), 메뉴 잠금, capabilities 동치(070), 표시 값 파싱, 배지, 오류 판별.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  BridgeError,
  byCapability,
  CAPABILITY_KEYS,
  hasCapability,
  TAURI_CAPABILITIES,
  WEB_CAPABILITIES,
  type PlatformCapabilities,
} from "@arch-studio/shell-bridge";
import type { AuthState, FinishSession } from "../auth/index.ts";
import { byCap, hasCap } from "./capabilities.ts";
import { licenseBadgeOf } from "./entitlement-state.ts";
import { bridgeErrorCode, bridgeErrorText } from "./errors.ts";
import { decideRoute } from "./guard.ts";
import { lockOf, NAV_ITEMS, PROJECT_TABS, projectIdOf } from "./nav.ts";
import { DEFAULT_PREFS, parsePrefs, resolveDark } from "./prefs.ts";

const session: FinishSession = {
  user_id: "u",
  display_name: null,
  status: "active",
  org: { id: "o", role: "owner" },
  plan_code: "trial",
  entitled: true,
  credit_balance: 30,
};
const S = {
  out: { kind: "signed_out", error: null },
  signing: { kind: "signing_in" },
  finishing: { kind: "finishing" },
  onboarding: { kind: "onboarding", session, progress: { step: "terms", termsAccepted: false, crossBorderAck: null } },
  ready: { kind: "ready", session, next: "/projects" },
  leaving: { kind: "signing_out" },
} satisfies Record<string, AuthState>;

test("가드: 비로그인 → /login, 온보딩 미완료 → /onboarding, ready는 셸 밖 경로에서 홈으로", () => {
  assert.deepEqual(decideRoute(S.out, "/projects", false), { kind: "redirect", to: "/login" });
  assert.deepEqual(decideRoute(S.out, "/projects/x/model", false), { kind: "redirect", to: "/login" });
  assert.deepEqual(decideRoute(S.out, "/login", false), { kind: "render" });
  assert.deepEqual(decideRoute(S.out, "/onboarding", false), { kind: "redirect", to: "/login" });
  assert.deepEqual(decideRoute(S.onboarding, "/projects", false), { kind: "redirect", to: "/onboarding" });
  assert.deepEqual(decideRoute(S.onboarding, "/login", false), { kind: "redirect", to: "/onboarding" });
  assert.deepEqual(decideRoute(S.onboarding, "/onboarding", false), { kind: "render" });
  assert.deepEqual(decideRoute(S.ready, "/login", false), { kind: "redirect", to: "/projects" });
  assert.deepEqual(decideRoute(S.ready, "/onboarding", false), { kind: "redirect", to: "/projects" });
  assert.deepEqual(decideRoute(S.ready, "/chat", false), { kind: "render" });
});

test("가드: 복구·진행 중은 로딩(로그인 화면은 대기 표시를 직접 그린다), next가 셸 밖·외부면 /projects", () => {
  for (const s of Object.values(S)) assert.deepEqual(decideRoute(s, "/projects", true), { kind: "loading" });
  assert.deepEqual(decideRoute(S.signing, "/projects", false), { kind: "loading" });
  assert.deepEqual(decideRoute(S.finishing, "/login", false), { kind: "render" });
  assert.deepEqual(decideRoute(S.leaving, "/login", false), { kind: "loading" });
  assert.deepEqual(decideRoute({ ...S.ready, next: "/onboarding" }, "/login", false), { kind: "redirect", to: "/projects" });
  assert.deepEqual(decideRoute({ ...S.ready, next: "//evil.example" }, "/login", false), { kind: "redirect", to: "/projects" });
  assert.deepEqual(decideRoute({ ...S.ready, next: "/wiki" }, "/login", false), { kind: "redirect", to: "/wiki" });
});

test("GNB: 8.3절 순서, 라이선스는 아래 고정(D-32), 프로젝트 탭 8개 순서(1절 :15)", () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.label), ["프로젝트", "법규 채팅", "법규 위키", "크레딧", "라이선스", "설정"]);
  assert.equal(NAV_ITEMS.find((i) => i.id === "license")?.group, "footer");
  assert.deepEqual(PROJECT_TABS.map((t) => t.label), ["대지", "모델·판정", "프로그램", "평면", "도면", "렌더", "제안서", "검토"]);
  assert.equal(projectIdOf("/projects/abc/model"), "abc");
  assert.equal(projectIdOf("/projects/abc"), "abc");
  assert.equal(projectIdOf("/projects"), null);
});

test("잠금: 숨기지 않고 사유를 준다. 오프라인이 먼저, 판정 전은 열림", () => {
  const chat = NAV_ITEMS.find((i) => i.id === "chat")!;
  assert.deepEqual(lockOf(chat, true, undefined), { kind: "open" });
  assert.deepEqual(lockOf(chat, false, { allowed: true }), { kind: "offline" });
  assert.deepEqual(lockOf(chat, true, { allowed: false, reason: "fallback" }), { kind: "locked", reason: "업데이트 플랜에서 씁니다" });
  assert.deepEqual(lockOf(chat, true, { allowed: false, reason: "unverified" }), { kind: "locked", reason: "권한을 아직 확인하지 못했습니다" });
  const projects = NAV_ITEMS.find((i) => i.id === "projects")!;
  assert.deepEqual(lockOf(projects, false, undefined), { kind: "open" });
});

test("capabilities: 구조적 hasCap·byCap = 070 hasCapability·byCapability(모든 키, 설치형·웹·이상값)", () => {
  const odd = { ...WEB_CAPABILITIES, offline: "true" } as unknown as PlatformCapabilities;
  for (const caps of [TAURI_CAPABILITIES, WEB_CAPABILITIES, odd]) {
    for (const key of CAPABILITY_KEYS) {
      assert.equal(hasCap(caps, key), hasCapability(caps, key), key);
      assert.equal(byCap(caps, key, 1, 2), byCapability(caps, key, 1, 2), key);
    }
  }
});

test("표시 값: 깨진·모르는 값은 기본값(OS 따름), 다크 판정", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("{"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{"theme":"neon","density":"x","gnbCollapsed":"yes"}'), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{"theme":"dark","density":"compact","gnbCollapsed":true}'), { theme: "dark", density: "compact", gnbCollapsed: true });
  assert.equal(resolveDark("system", true), true);
  assert.equal(resolveDark("light", true), false);
  assert.equal(resolveDark("dark", false), true);
});

test("라이선스 배지: 판정 근거 없으면 체험 플랜만 '체험 중', 그 밖은 미확인(null)", () => {
  assert.equal(licenseBadgeOf(undefined, null), null);
  assert.equal(licenseBadgeOf("none", "trial"), "trial");
  assert.equal(licenseBadgeOf("grace", null), "active");
  assert.equal(licenseBadgeOf("revoked", "trial"), "expired");
});

test("오류 판별: 070 BridgeError와 같은 모양만 코드로 읽고, 문구에 값이 없다", () => {
  assert.equal(bridgeErrorCode(new BridgeError("VERSION_CONFLICT")), "VERSION_CONFLICT");
  assert.equal(bridgeErrorCode(new Error("VERSION_CONFLICT")), null);
  assert.equal(bridgeErrorCode({ name: "BridgeError", code: "AR060" }), "AR060");
  assert.match(bridgeErrorText(new BridgeError("NOT_FOUND")), /찾지 못했습니다/);
  assert.match(bridgeErrorText(null), /다시 시도/);
});

/** 화면 작성 규약 기계 검사: 진입점·exports 일치, 화면 폴더는 shell-bridge 런타임 import·직접 invoke·싱글턴 없음. */
const SRC = path.resolve(import.meta.dirname, "..");
const PKG = JSON.parse(readFileSync(path.join(SRC, "../package.json"), "utf8")) as { exports: Record<string, string> };
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}

test("규약: exports의 화면 진입점은 모두 존재하고 `export function Screen`을 낸다", () => {
  const screens = Object.entries(PKG.exports).filter(([, f]) => f.endsWith("/index.tsx"));
  assert.equal(screens.length, 18, "03장 1.1절 데스크톱 경로 17개 + not-found");
  for (const [sub, file] of screens) {
    const text = readFileSync(path.join(SRC, "..", file), "utf8");
    assert.match(text, /export function Screen\(/, sub);
  }
});

test("규약: features 소스는 shell-bridge를 타입으로만 import하고 Tauri·invoke를 직접 쓰지 않는다", () => {
  for (const f of files(SRC)) {
    const text = readFileSync(f, "utf8");
    const rel = path.relative(SRC, f);
    for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"(@arch-studio\/shell-bridge[^"]*)"/gms)) {
      assert.ok(m[1], `${rel}: shell-bridge는 import type만(${m[2]})`);
    }
    assert.doesNotMatch(text, /@tauri-apps\//, rel);
    assert.doesNotMatch(text, /\binvoke\(/, rel);
  }
});
