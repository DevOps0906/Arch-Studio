// LicenseDeps의 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// 스키마: SUPABASE_DB_SCHEMA='public'(모놀리스, 모든 함수 public.*) / 'core'(모듈러: 코어 core.*, 제품 arch.*).
// DB 오류는 SQLSTATE만 남기고(DbCallError) 메시지 원문은 버린다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCallError, LicenseApiError } from "./errors.ts";
import type { OrgFeaturesView } from "./payload.ts";
import type {
  ActivateLicenseResult,
  ActivationRow,
  LicenseRow,
  LicenseSession,
  PrivilegedLicenseRepo,
  RefreshActivation,
  SessionResolver,
  UserLicenseRepo,
} from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

export interface SchemaNames {
  core: string;
  arch: string;
}

export function schemaNames(dbSchema: "core" | "public"): SchemaNames {
  return dbSchema === "public" ? { core: "public", arch: "public" } : { core: "core", arch: "arch" };
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw new DbCallError(result.error);
  if (result.data === null || result.data === undefined) throw new DbCallError({ code: "internal" });
  return result.data;
}

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/;

/** Authorization: Bearer <Supabase access_token> 검증(04_API.md 1장, 데스크톱 D). 쿠키 세션은 lib/auth(requireSession, T-C1)가 붙인다. */
export function bearerSessionResolver(makeUserClient: (token: string) => Client, schemas: SchemaNames): SessionResolver {
  return {
    async resolve(req) {
      const match = BEARER.exec(req.headers.get("authorization") ?? "");
      const token = match?.[1];
      if (!token) throw new LicenseApiError("unauthorized");
      const client = makeUserClient(token);
      const { data: userData, error: userError } = await client.auth.getUser(token);
      if (userError || !userData?.user) throw new LicenseApiError("unauthorized");
      const { data, error } = await client.schema(schemas.core).rpc("session_context", { p_app: "arch" });
      if (error) throw new DbCallError(error);
      const ctx = data as { user_id?: string; status?: string; org?: { id?: string; role?: string } | null } | null;
      if (!ctx?.user_id || ctx.user_id !== userData.user.id) throw new LicenseApiError("unauthorized");
      if (ctx.status !== "active") throw new LicenseApiError("account_inactive");
      if (!ctx.org?.id || !ctx.org.role) throw new LicenseApiError("no_org");
      return { userId: ctx.user_id, orgId: ctx.org.id, role: ctx.org.role, accessToken: token } satisfies LicenseSession;
    },
  };
}

/** 사용자 JWT 클라이언트(RLS·authenticated RPC). */
export function supabaseUserRepo(client: Client, schemas: SchemaNames): UserLicenseRepo {
  const arch = () => client.schema(schemas.arch);
  return {
    async orgFeatures(orgId) {
      return unwrap(await arch().rpc("org_features", { p_org: orgId })) as OrgFeaturesView;
    },
    async deactivateActivation(activationId) {
      const row = unwrap(await arch().rpc("deactivate_activation", { p_activation_id: activationId })) as {
        id: string;
        org_id: string;
        deactivated_at: string;
      };
      return { id: row.id, org_id: row.org_id, deactivated_at: row.deactivated_at };
    },
    async countSelfDeactivations(orgId, sinceIso) {
      const { count, error } = await arch()
        .from("license_activations")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("deactivation_kind", "self")
        .gt("deactivated_at", sinceIso);
      if (error) throw new DbCallError(error);
      return count ?? 0;
    },
    async getLicense(licenseId) {
      const { data, error } = await arch()
        .from("licenses")
        .select("id, org_id, sku_code, status, updates_until, serial_last5")
        .eq("id", licenseId)
        .maybeSingle();
      if (error) throw new DbCallError(error);
      return (data as Awaited<ReturnType<UserLicenseRepo["getLicense"]>>) ?? null;
    },
    async listLicenses(orgId) {
      const data = unwrap(
        await arch()
          .from("licenses")
          .select("id, org_id, sku_code, serial_last5, status, purchased_at, updates_until")
          .eq("org_id", orgId)
          .order("purchased_at", { ascending: true }),
      );
      return data as LicenseRow[];
    },
    async listActiveActivations(orgId) {
      const data = unwrap(
        await arch()
          .from("license_activations")
          .select("id, license_id, source, device_label, activated_at, last_seen_at")
          .eq("org_id", orgId)
          .is("deactivated_at", null)
          .order("activated_at", { ascending: true }),
      );
      return data as ActivationRow[];
    },
  };
}

/** service_role 클라이언트. 이 세 메서드 밖에서 service_role을 쓰지 않는다. */
export function supabasePrivilegedRepo(client: Client, schemas: SchemaNames): PrivilegedLicenseRepo {
  const arch = () => client.schema(schemas.arch);
  return {
    async activateLicense({ serialHash, deviceHash, userId }) {
      return unwrap(
        await arch().rpc("activate_license", { p_serial_hash: serialHash, p_device_hash: deviceHash, p_user: userId }),
      ) as ActivateLicenseResult;
    },
    async activatePlanDevice({ orgId, userId, deviceHash }) {
      const row = unwrap(await arch().rpc("activate_plan_device", { p_org: orgId, p_user: userId, p_device_hash: deviceHash })) as {
        id: string;
        activated_at: string;
      };
      return { id: row.id, activated_at: row.activated_at };
    },
    async getActivationForRefresh(activationId) {
      // device_hash는 authenticated에 GRANT되지 않아(2400 10절) service_role로만 읽는다. 필요한 열만.
      const { data, error } = await arch()
        .from("license_activations")
        .select("id, org_id, license_id, source, device_hash, deactivated_at")
        .eq("id", activationId)
        .maybeSingle();
      if (error) throw new DbCallError(error);
      return (data as RefreshActivation | null) ?? null;
    },
  };
}
