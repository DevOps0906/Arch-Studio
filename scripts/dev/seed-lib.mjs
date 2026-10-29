// AR-06-008 시드 라이브러리(의존성 없음: fetch만). CLI는 seed-users.mjs. 계약: AUTH_ROADMAP.md 2.3절.
// - 대상이 loopback이 아니면 요청 0건으로 중단한다(원격에 개발 계정을 만들지 않는다).
// - 비밀(service_role·DEV_SEED_PASSWORD)은 env로만 받고, 출력·오류 메시지에 값을 넣지 않는다.
// - 멱등: 이미 있는 이메일은 만들지 않고 역할·상태만 맞춘다. 가입 크레딧은 DB 멱등 키 signup:<org>:<app>가 막는다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const STEP_OPS = ["create_user", "join_org", "set_profile", "age_entitlement", "set_plan", "grant_license"];
export const ROLES = ["owner", "admin", "member", "viewer"];
export const FEATURE_STATES = ["trial", "trial_expired", "licensed", "licensed_fallback", "subscribed", "subscription_expired"];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const KEY = /^[a-z][a-z0-9_]{1,30}$/;

export function loadPersonaData(file = new URL("./personas.arch.json", import.meta.url)) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** 구조 검사. 문제 목록(문자열)을 돌려준다. 빈 배열 = 통과. */
export function validatePersonaData(data) {
  const errors = [];
  if (data?.app !== "arch") errors.push("app은 arch");
  if (data?.emailDomain !== "dev.test") errors.push("emailDomain은 예약 TLD dev.test");
  const personas = Array.isArray(data?.personas) ? data.personas : [];
  if (personas.length === 0) errors.push("personas 비어 있음");
  const keys = new Set();
  for (const p of personas) {
    const where = `persona ${String(p?.key)}`;
    if (!KEY.test(p?.key ?? "")) errors.push(`${where}: key 형식`);
    if (keys.has(p.key)) errors.push(`${where}: key 중복`);
    keys.add(p.key);
    if (typeof p.label !== "string" || p.label.length === 0) errors.push(`${where}: label`);
    if (JSON.stringify(p).toLowerCase().includes("password")) errors.push(`${where}: 비밀번호 필드 금지`);
    const steps = Array.isArray(p.steps) ? p.steps : [];
    if (steps[0]?.op !== "create_user") errors.push(`${where}: 첫 단계는 create_user`);
    for (const s of steps) {
      if (!STEP_OPS.includes(s?.op)) errors.push(`${where}: 알 수 없는 단계 ${String(s?.op)}`);
      if (s.op === "join_org" && (!ROLES.slice(1).includes(s.role) || typeof s.of !== "string")) errors.push(`${where}: join_org 인자`);
    }
    const e = p.expect ?? {};
    if (!ROLES.includes(e.role)) errors.push(`${where}: expect.role`);
    if (typeof e.entitled !== "boolean") errors.push(`${where}: expect.entitled`);
    if (e.features_state !== undefined && !FEATURE_STATES.includes(e.features_state)) errors.push(`${where}: expect.features_state`);
    if (e.credit_balance !== undefined && !Number.isSafeInteger(e.credit_balance)) errors.push(`${where}: credit_balance는 정수`);
  }
  for (const p of personas) {
    for (const s of p.steps ?? []) {
      if (s.op === "join_org" && !keys.has(s.of)) errors.push(`persona ${p.key}: join_org 대상 ${s.of} 없음`);
      if (s.op === "join_org" && personas.findIndex((q) => q.key === s.of) > personas.indexOf(p)) {
        errors.push(`persona ${p.key}: join_org 대상이 뒤에 있음`);
      }
    }
  }
  return errors;
}

export function personaEmail(data, key) {
  return `${key}@${data.emailDomain}`;
}

/** loopback 대상인지. 아니면 throw(값은 메시지에 넣지 않는다). */
export function assertLocalTarget(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("SUPABASE_URL 형식이 아니다");
  }
  if (!LOOPBACK.has(host)) throw new Error("SUPABASE_URL이 로컬(127.0.0.1·localhost)이 아니다. 원격에는 시드하지 않는다");
}

/** 필요한 env 이름 확인(값 미노출). */
export function readSeedEnv(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.DEV_SEED_PASSWORD) missing.push("DEV_SEED_PASSWORD");
  if (missing.length) throw new Error(`환경 변수 없음: ${missing.join(", ")}`);
  assertLocalTarget(url);
  const schema = env.SUPABASE_DB_SCHEMA === "core" ? { core: "core", arch: "arch" } : { core: "public", arch: "public" };
  return { url: url.replace(/\/$/, ""), anonKey, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, password: env.DEV_SEED_PASSWORD, schema };
}

/** 시드용 시리얼 해시·끝 5자(결정적, 실제 시리얼 아님). */
export function devSerial(key) {
  return { serial_hash: createHash("sha256").update(`arch-dev-seed:${key}`).digest("hex"), serial_last5: "DEV00" };
}

function isoDaysFromNow(days, now) {
  return new Date(now + days * 86_400_000).toISOString();
}

/** REST 호출기. 오류 메시지에는 단계 이름과 HTTP 상태만(응답 본문은 토큰·이메일이 섞일 수 있어 버린다). */
function restClient({ url, anonKey, serviceKey }, fetchImpl) {
  async function call(label, path, { method = "GET", token, apikey = anonKey, body, profile, prefer } = {}) {
    const headers = { apikey, Authorization: `Bearer ${token ?? apikey}`, "content-type": "application/json" };
    if (profile) {
      headers["Accept-Profile"] = profile;
      headers["Content-Profile"] = profile;
    }
    if (prefer) headers.Prefer = prefer;
    const res = await fetchImpl(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${label} 실패(HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
  const svc = (label, path, opts = {}) => call(label, path, { ...opts, apikey: serviceKey, token: serviceKey });
  return { call, svc };
}

/**
 * 시드 실행. 반환: 페르소나별 결과 표(비밀번호·토큰 미포함).
 * @param {{ env: Record<string,string|undefined>, fetch?: typeof fetch, data?: object, now?: number, log?: (line: string) => void }} opts
 */
export async function runSeed(opts) {
  const data = opts.data ?? loadPersonaData();
  const problems = validatePersonaData(data);
  if (problems.length) throw new Error(`페르소나 데이터 오류: ${problems.join("; ")}`);
  const cfg = readSeedEnv(opts.env); // loopback 검사가 여기서 먼저 끝난다(요청 전)
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const { call, svc } = restClient(cfg, fetchImpl);
  const S = cfg.schema;

  const listed = await svc("사용자 목록", "/auth/v1/admin/users?page=1&per_page=1000");
  const existing = new Map((listed?.users ?? []).map((u) => [String(u.email).toLowerCase(), u.id]));
  const users = new Map(); // key → { id, token, orgId }

  async function signIn(key) {
    const out = await call(`${key} 로그인`, "/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: personaEmail(data, key), password: cfg.password },
    });
    return out.access_token;
  }
  async function personalOrg(userId) {
    const rows = await svc("개인 조직 조회", `/rest/v1/organizations?owner_id=eq.${userId}&is_personal=eq.true&select=id`, { profile: S.core });
    if (!rows?.[0]?.id) throw new Error("개인 조직 없음(가입 트리거 확인)");
    return rows[0].id;
  }
  async function planId(code) {
    const rows = await svc("플랜 조회", `/rest/v1/plans?app_id=eq.arch&code=eq.${code}&select=id`, { profile: S.core });
    if (!rows?.[0]?.id) throw new Error(`플랜 ${code} 없음(seed.sql 확인)`);
    return rows[0].id;
  }

  for (const p of data.personas) {
    const email = personaEmail(data, p.key);
    for (const step of p.steps) {
      switch (step.op) {
        case "create_user": {
          let id = existing.get(email);
          if (!id) {
            const meta = { full_name: p.label };
            if (step.signup_app) meta.signup_app = step.signup_app;
            const created = await svc(`${p.key} 생성`, "/auth/v1/admin/users", {
              method: "POST",
              body: { email, password: cfg.password, email_confirm: true, user_metadata: meta },
            });
            id = created.id ?? created.user?.id;
            existing.set(email, id);
            log(`생성 ${p.key}`);
          } else {
            log(`건너뜀(이미 있음) ${p.key}`);
          }
          users.set(p.key, { id, token: await signIn(p.key), orgId: await personalOrg(id) });
          break;
        }
        case "join_org": {
          const me = users.get(p.key);
          const owner = users.get(step.of);
          const rows = await svc("멤버 조회", `/rest/v1/org_members?org_id=eq.${owner.orgId}&user_id=eq.${me.id}&select=role,status`, { profile: S.core });
          const row = rows?.[0];
          if (!row || row.status !== "active" || row.role !== step.role) {
            if (row?.status === "active" && row.role !== step.role) {
              await call("역할 변경", "/rest/v1/rpc/change_member_role", {
                method: "POST", token: owner.token, profile: S.core,
                body: { p_org_id: owner.orgId, p_user_id: me.id, p_role: step.role },
              });
            } else {
              await call("초대", "/rest/v1/rpc/invite_member", {
                method: "POST", token: owner.token, profile: S.core,
                body: { p_org_id: owner.orgId, p_user_id: me.id, p_role: step.role },
              });
              await call("초대 수락", "/rest/v1/rpc/accept_invite", {
                method: "POST", token: me.token, profile: S.core, body: { p_org_id: owner.orgId },
              });
            }
          }
          me.joinedOrg = owner.orgId;
          break;
        }
        case "set_profile": {
          const patch = {};
          if (step.status) patch.status = step.status;
          if (step.platform_role) patch.platform_role = step.platform_role;
          await svc("프로필 갱신", `/rest/v1/profiles?id=eq.${users.get(p.key).id}`, { method: "PATCH", body: patch, profile: S.core });
          break;
        }
        case "age_entitlement": {
          await svc("엔타이틀먼트 시각", `/rest/v1/app_entitlements?org_id=eq.${users.get(p.key).orgId}&app_id=eq.arch`, {
            method: "PATCH", body: { created_at: isoDaysFromNow(-step.days, now) }, profile: S.core,
          });
          break;
        }
        case "set_plan": {
          const orgId = users.get(p.key).orgId;
          const pid = await planId(step.plan);
          await svc("엔타이틀먼트 플랜", `/rest/v1/app_entitlements?org_id=eq.${orgId}&app_id=eq.arch`, {
            method: "PATCH", body: { plan_id: pid, status: step.status, source: "subscription" }, profile: S.core,
          });
          await svc("구독 플랜", `/rest/v1/subscriptions?org_id=eq.${orgId}&app_id=eq.arch`, {
            method: "PATCH", body: { plan_id: pid, status: step.status === "active" ? "active" : "expired" }, profile: S.core,
          });
          break;
        }
        case "grant_license": {
          const orgId = users.get(p.key).orgId;
          const until = isoDaysFromNow(step.updates_until_days, now).slice(0, 10);
          await svc("라이선스", "/rest/v1/licenses?on_conflict=serial_hash", {
            method: "POST", profile: S.arch, prefer: "resolution=merge-duplicates,return=minimal",
            body: { org_id: orgId, sku_code: step.sku, ...devSerial(p.key), status: "active", updates_until: until, max_activations: 2 },
          });
          break;
        }
        default:
          throw new Error(`알 수 없는 단계 ${String(step.op)}`);
      }
    }
  }

  // 대조: 각 페르소나로 로그인해 session_context·org_features를 읽는다.
  const report = [];
  for (const p of data.personas) {
    const u = users.get(p.key);
    const token = await signIn(p.key);
    const orgParam = p.expect.org === "self" ? {} : { p_org: users.get(p.expect.org).orgId };
    const ctx = await call("session_context", "/rest/v1/rpc/session_context", {
      method: "POST", token, profile: S.core, body: { p_app: "arch", ...orgParam },
    });
    const orgId = ctx?.org?.id ?? u.orgId;
    let state = null;
    try {
      const feat = await call("org_features", "/rest/v1/rpc/org_features", { method: "POST", token, profile: S.arch, body: { p_org: orgId } });
      state = feat?.state ?? null;
    } catch {
      state = null;
    }
    const actual = {
      role: ctx?.org?.role ?? null,
      entitled: ctx?.entitled ?? null,
      plan_code: ctx?.plan_code ?? null,
      credit_balance: ctx?.credit_balance ?? null,
      status: ctx?.status ?? null,
      platform_role: ctx?.platform_role ?? null,
      features_state: state,
    };
    const mismatch = Object.entries(p.expect)
      .filter(([k]) => k !== "org")
      .filter(([k, v]) => actual[k] !== v)
      .map(([k]) => k);
    report.push({ persona: p.key, email: personaEmail(data, p.key), org_id: orgId, ...actual, ok: mismatch.length === 0, mismatch });
  }
  return report;
}

/** 표 출력(비밀번호·토큰 없음). */
export function formatReport(report) {
  const head = ["persona", "email", "org_id", "role", "entitled", "plan_code", "credit_balance", "features_state", "ok"];
  const lines = [head.join("\t")];
  for (const r of report) lines.push(head.map((h) => (h === "ok" ? (r.ok ? "OK" : `불일치:${r.mismatch.join(",")}`) : String(r[h]))).join("\t"));
  return lines.join("\n");
}
