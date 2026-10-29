// 사용자 세션(Bearer <Supabase access_token>, 04_API.md 1장). 업로드 서명·잡 조회가 쓴다.
// 쿠키 세션(requireSession('arch'), T-C1)은 lib/auth가 생기면 같은 GatewaySession을 돌려주는 구현으로 바꾼다.
// 조직은 core.session_context(p_app='arch')의 개인 조직만(요청으로 조직을 고르는 경로 없음, 040 bearerSessionResolver와 같은 신뢰 경계).
// server-only를 import하지 않는다(node --test 대상).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchemaNames } from "../../licenses/supabase-repo.ts";
import { GatewayError } from "./http.ts";

export interface GatewaySession {
  userId: string;
  orgId: string;
  role: string;
  /** session_context.entitled(엔타이틀먼트 유효). false면 쓰기 경로는 402. */
  entitled: boolean;
  accessToken: string;
}

export interface GatewaySessionResolver {
  resolve(req: Request): Promise<GatewaySession>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/;

export function bearerGatewaySession(makeUserClient: (token: string) => Client, schemas: SchemaNames): GatewaySessionResolver {
  return {
    async resolve(req) {
      const token = BEARER.exec(req.headers.get("authorization") ?? "")?.[1];
      if (!token) throw new GatewayError("unauthorized");
      const client = makeUserClient(token);
      const { data: userData, error: userError } = await client.auth.getUser(token);
      if (userError || !userData?.user) throw new GatewayError("unauthorized");
      const { data, error } = await client.schema(schemas.core).rpc("session_context", { p_app: "arch" });
      if (error) throw new GatewayError("internal");
      const ctx = data as { user_id?: string; status?: string; entitled?: boolean; org?: { id?: string; role?: string } | null } | null;
      if (!ctx?.user_id || ctx.user_id !== userData.user.id) throw new GatewayError("unauthorized");
      if (ctx.status !== "active") throw new GatewayError("account_inactive");
      if (!ctx.org?.id || !ctx.org.role) throw new GatewayError("no_org");
      return { userId: ctx.user_id, orgId: ctx.org.id, role: ctx.org.role, entitled: ctx.entitled === true, accessToken: token };
    },
  };
}
