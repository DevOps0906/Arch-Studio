// session_context('arch') 응답 해석(CORE_SPEC.md 2.3절). 모양이 틀리면 null(기본 닫힘).

export interface SessionOrg {
  readonly id: string;
  readonly name: string | null;
  readonly slug: string | null;
  readonly role: "owner" | "admin" | "member" | "viewer";
}

export interface SessionContext {
  readonly user_id: string;
  readonly email: string | null;
  readonly display_name: string | null;
  readonly platform_role: string;
  readonly status: string;
  readonly org: SessionOrg | null;
  readonly app_id: string | null;
  readonly plan_code: string | null;
  readonly entitled: boolean;
  readonly credit_balance: number;
}

/** 클라이언트에 주는 형태. 이메일은 빼고(최소 수집, 화면은 표시 이름을 쓴다) entitled·플랜·잔액·조직 역할을 준다. */
export interface ClientSession {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly platform_role: string;
  readonly status: string;
  readonly org: SessionOrg | null;
  readonly plan_code: string | null;
  readonly entitled: boolean;
  readonly credit_balance: number;
}

const ROLES = new Set(["owner", "admin", "member", "viewer"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseSessionContext(raw: unknown): SessionContext | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.user_id !== "string" || !UUID.test(r.user_id)) return null;
  if (typeof r.status !== "string" || typeof r.entitled !== "boolean") return null;
  const balance = r.credit_balance;
  if (typeof balance !== "number" || !Number.isSafeInteger(balance)) return null;
  let org: SessionOrg | null = null;
  if (r.org !== null && r.org !== undefined) {
    const o = r.org as Record<string, unknown>;
    if (typeof o.id !== "string" || !UUID.test(o.id) || typeof o.role !== "string" || !ROLES.has(o.role)) return null;
    org = { id: o.id, name: str(o.name), slug: str(o.slug), role: o.role as SessionOrg["role"] };
  }
  const plan = str(r.plan_code);
  // entitled = plan_code is not null(코어 정의). 어긋나면 해석하지 않는다.
  if (r.entitled !== (plan !== null)) return null;
  return {
    user_id: r.user_id,
    email: str(r.email),
    display_name: str(r.display_name),
    platform_role: str(r.platform_role) ?? "user",
    status: r.status,
    org,
    app_id: str(r.app_id),
    plan_code: plan,
    entitled: r.entitled,
    credit_balance: balance,
  };
}

export function toClientSession(ctx: SessionContext): ClientSession {
  return {
    user_id: ctx.user_id,
    display_name: ctx.display_name,
    platform_role: ctx.platform_role,
    status: ctx.status,
    org: ctx.org,
    plan_code: ctx.plan_code,
    entitled: ctx.entitled,
    credit_balance: ctx.credit_balance,
  };
}
