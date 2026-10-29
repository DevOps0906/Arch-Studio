// 인증 테스트 공용 목(*.test.ts에서만 import). DB 없이 session_context·bootstrap·원장 멱등을 흉내 낸다.
import type { AuthConfig } from "./config.ts";
import type { TermsConsentStore } from "./consent.ts";
import type { FinishLoginDeps, VerifiedUser } from "./finish-login.ts";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const ORG_ID = "22222222-2222-4222-8222-222222222222";
export const TOKEN = "eyJhbGciOiJIUzI1NiJ9.SECRET-ACCESS-TOKEN-VALUE.sig";
export const PASSWORD = "DEV-SEED-PASSWORD-VALUE";

export const MOCK_CONFIG: AuthConfig = { mode: "mock", providers: ["email"] };

export interface FakeDb {
  status: string;
  entitled: boolean;
  /** 가입 크레딧 원장(멱등 키 → 금액). bootstrap이 `signup:<org>:arch` 키로만 쓴다. */
  ledger: Map<string, number>;
  bootstrapCalls: number;
  audits: { orgId: string; userId: string; meta: unknown }[];
  profile: boolean;
}

export function fakeDb(over: Partial<FakeDb> = {}): FakeDb {
  return { status: "active", entitled: true, ledger: new Map([[`signup:${ORG_ID}:arch`, 30]]), bootstrapCalls: 0, audits: [], profile: true, ...over };
}

/** DB 함수 동작 흉내: session_context → jsonb, bootstrap_app_for_org → 엔타이틀먼트 + 원장(on conflict do nothing). */
export function fakeFinishDeps(
  db: FakeDb,
  opts: { user?: VerifiedUser | null; config?: AuthConfig; terms?: TermsConsentStore; auditThrows?: boolean } = {},
): FinishLoginDeps {
  return {
    config: opts.config ?? MOCK_CONFIG,
    async getUser() {
      return opts.user === undefined ? { id: USER_ID, provider: "email" } : opts.user;
    },
    async sessionContext() {
      if (!db.profile) return null;
      const balance = [...db.ledger.values()].reduce((a, b) => a + b, 0);
      return {
        user_id: USER_ID,
        email: "owner@dev.test",
        display_name: "소유자(체험 중)",
        platform_role: "user",
        status: db.status,
        org: { id: ORG_ID, name: "owner", slug: "u1", role: "owner" },
        app_id: "arch",
        plan_code: db.entitled ? "trial" : null,
        entitled: db.entitled,
        credit_balance: balance,
      };
    },
    async bootstrapApp() {
      db.bootstrapCalls += 1;
      db.entitled = true;
      const key = `signup:${ORG_ID}:arch`;
      if (!db.ledger.has(key)) db.ledger.set(key, 30);
    },
    async audit(orgId, userId, meta) {
      if (opts.auditThrows) throw Object.assign(new Error(`write_audit failed for ${TOKEN}`), { code: "42501" });
      db.audits.push({ orgId, userId, meta });
    },
    terms: opts.terms ?? { hasAcceptedCurrent: async () => false, record: async () => false },
    onboardingPath: "/onboarding",
  };
}

export interface ConsoleSpy {
  text(): string;
  restore(): void;
}

export function spyConsole(): ConsoleSpy {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const saved = methods.map((m) => [m, console[m]] as const);
  for (const m of methods) console[m] = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  return {
    text: () => lines.join("\n"),
    restore: () => {
      for (const [m, f] of saved) console[m] = f;
    },
  };
}
