// 라이선스 Route Handler 본체(04_API.md 2.1·2.4절). 순서: 인증 → 본문·zod → 레이트 리밋 → 서명기 확인 → DB → 서명 → 응답.
// 의존성은 LicenseDeps로 주입(테스트는 목). server-only를 import하지 않는다.
import { timingSafeEqual } from "node:crypto";
import { DbCallError, ERROR_TABLE, errorResponse, LicenseApiError, okResponse, type LicenseErrorCode } from "./errors.ts";
import { licenseLog, type LicenseRoute } from "./log.ts";
import { buildLicensePayload, type OrgFeaturesView } from "./payload.ts";
import { clientIp, hitActivateLimit } from "./rate-limit.ts";
import { activateSchema, deactivateSchema, MAX_BODY_BYTES, refreshSchema } from "./schemas.ts";
import { normalizeSerial, serialHash, serialLast5 } from "./serial.ts";
import { LicenseSignerError, type LicenseSigner, type SignedLicenseFile } from "./signing.ts";
import type { LicenseDeps, LicenseSession } from "./types.ts";

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);
const OWNER_ADMIN = new Set(["owner", "admin"]);
const PLAN_ACTIVE_STATES = new Set(["trial", "subscribed"]);
const SELF_WINDOW_MS = 30 * 86_400_000;

/** 본문을 MAX_BODY_BYTES까지만 읽어 JSON으로. 넘으면 413, 깨지면 400. */
async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new LicenseApiError("payload_too_large");
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new LicenseApiError("payload_too_large");
      }
      chunks.push(value);
    }
    text = new TextDecoder().decode(Buffer.concat(chunks));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LicenseApiError("invalid_json");
  }
}

function requireRole(session: LicenseSession, allowed: ReadonlySet<string>) {
  if (!allowed.has(session.role)) throw new LicenseApiError("42501");
}

class RateLimitedError extends LicenseApiError {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("rate_limited");
    this.retryAfter = retryAfter;
  }
}

async function checkActivateLimit(req: Request, session: LicenseSession, deps: LicenseDeps) {
  const result = await hitActivateLimit({
    store: deps.rateLimit,
    ipSalt: deps.ipSalt(),
    ip: clientIp(req.headers, deps.proxy),
    userId: session.userId,
    nowMs: deps.now(),
  });
  if (!result.allowed) throw new RateLimitedError(Math.max(1, Math.ceil((result.resetAtMs - deps.now()) / 1000)));
}

function loadSigner(deps: LicenseDeps): LicenseSigner {
  try {
    return deps.signer();
  } catch (error) {
    throw error instanceof LicenseSignerError ? error : new LicenseSignerError("invalid_key");
  }
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function toResponse(route: LicenseRoute, error: unknown): Response {
  if (error instanceof RateLimitedError) {
    licenseLog.warn("license_rate_limited", { route, code: "rate_limited", status: 429 });
    return errorResponse("rate_limited", undefined, { "retry-after": String(error.retryAfter) });
  }
  if (error instanceof LicenseSignerError) {
    licenseLog.error("license_signer_unavailable", { route, code: "license_signing_unavailable", signer_reason: error.reason });
    return errorResponse("license_signing_unavailable");
  }
  let code: LicenseErrorCode = "internal";
  let details: Record<string, unknown> | undefined;
  if (error instanceof LicenseApiError) {
    code = error.code;
    details = error.details;
  } else if (error instanceof DbCallError) {
    code = error.code;
  }
  const status = ERROR_TABLE[code].status;
  if (status >= 500) licenseLog.error("license_request_failed", { route, code, status });
  else licenseLog.info("license_request_rejected", { route, code, status });
  return errorResponse(code, details);
}

const EXPIRED = () => new LicenseApiError("entitlement_expired", { reason: "expired", can_download: true });

async function signFile(
  deps: LicenseDeps,
  signer: LicenseSigner,
  session: LicenseSession,
  input: {
    source: "license" | "plan";
    licenseId: string | null;
    orgId: string;
    sku: string;
    updatesUntil: string | null;
    activationId: string;
    deviceHash: string;
    features: OrgFeaturesView;
  },
): Promise<SignedLicenseFile> {
  const extension = deps.extension ? await deps.extension({ session, orgId: input.orgId, source: input.source }) : undefined;
  const payload = buildLicensePayload({ ...input, kid: signer.kid, nowMs: deps.now(), extension });
  return signer.signPayload(payload);
}

/** POST /api/license/activate */
export async function handleActivate(req: Request, deps: LicenseDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    requireRole(session, MEMBER_PLUS);
    const parsed = activateSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new LicenseApiError("invalid_input");
    await checkActivateLimit(req, session, deps);
    const signer = loadSigner(deps);
    const input = parsed.data;
    const user = deps.userRepo(session);

    if ("serial" in input) {
      // 형식 검사는 레이트 리밋 뒤: 잘못된 시리얼 시도도 버킷을 소모한다.
      const body = normalizeSerial(input.serial);
      if (!body) throw new LicenseApiError("invalid_input");
      const result = await deps.privilegedRepo().activateLicense({ serialHash: serialHash(body), deviceHash: input.device_hash, userId: session.userId });
      const features = await user.orgFeatures(result.license.org_id);
      const licenseFile = await signFile(deps, signer, session, {
        source: "license",
        licenseId: result.license.id,
        orgId: result.license.org_id,
        sku: result.license.sku,
        updatesUntil: result.license.updates_until,
        activationId: result.activation.id,
        deviceHash: input.device_hash,
        features,
      });
      licenseLog.info("license_activated", { route: "activate", source: "license", serial_last5: serialLast5(body), activation_id: result.activation.id });
      return okResponse({
        license_file: licenseFile,
        license: {
          id: result.license.id,
          sku: result.license.sku,
          serial_last5: result.license.serial_last5,
          updates_until: result.license.updates_until,
          status: result.license.status,
        },
        activation: { id: result.activation.id, activated_at: result.activation.activated_at },
      });
    }

    let activation: { id: string; activated_at: string };
    try {
      activation = await deps.privilegedRepo().activatePlanDevice({ orgId: session.orgId, userId: session.userId, deviceHash: input.device_hash });
    } catch (error) {
      // activate_plan_device의 AR003 = 체험·구독 만료(04_API 2.1: 402)
      if (error instanceof DbCallError && error.code === "AR003") throw EXPIRED();
      throw error;
    }
    const features = await user.orgFeatures(session.orgId);
    if (!PLAN_ACTIVE_STATES.has(features.state)) throw EXPIRED();
    const licenseFile = await signFile(deps, signer, session, {
      source: "plan",
      licenseId: null,
      orgId: session.orgId,
      sku: features.plan_code ?? features.state,
      updatesUntil: null,
      activationId: activation.id,
      deviceHash: input.device_hash,
      features,
    });
    licenseLog.info("license_activated", { route: "activate", source: "plan", activation_id: activation.id });
    return okResponse({ license_file: licenseFile, license: null, activation: { id: activation.id, activated_at: activation.activated_at } });
  } catch (error) {
    return toResponse("activate", error);
  }
}

/** POST /api/license/deactivate — 반드시 사용자 JWT(service_role이면 DB가 support 해제로 기록해 AR004 집계를 우회한다). */
export async function handleDeactivate(req: Request, deps: LicenseDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    requireRole(session, OWNER_ADMIN);
    const parsed = deactivateSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new LicenseApiError("invalid_input");
    const user = deps.userRepo(session);
    const row = await user.deactivateActivation(parsed.data.activation_id);
    const since = new Date(deps.now() - SELF_WINDOW_MS).toISOString();
    const used = await user.countSelfDeactivations(row.org_id, since);
    licenseLog.info("license_deactivated", { route: "deactivate", activation_id: row.id });
    return okResponse({ activation: { id: row.id, deactivated_at: row.deactivated_at }, self_deactivations_30d: used });
  } catch (error) {
    return toResponse("deactivate", error);
  }
}

/** POST /api/license/refresh — 서버 상태로 재판정 후 재서명. 활성화 없음·해제·기기 불일치·비멤버는 모두 같은 404. */
export async function handleRefresh(req: Request, deps: LicenseDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    requireRole(session, MEMBER_PLUS);
    const parsed = refreshSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new LicenseApiError("invalid_input");
    await checkActivateLimit(req, session, deps);
    const signer = loadSigner(deps);
    const { activation_id, device_hash } = parsed.data;

    const act = await deps.privilegedRepo().getActivationForRefresh(activation_id);
    if (!act || act.deactivated_at !== null || !sameHex(act.device_hash, device_hash)) throw new LicenseApiError("P0002");
    const user = deps.userRepo(session);
    let features: OrgFeaturesView;
    try {
      features = await user.orgFeatures(act.org_id); // 비멤버면 DB 42501 → 404로 숨김
    } catch (error) {
      if (error instanceof DbCallError && error.code === "42501") throw new LicenseApiError("P0002");
      throw error;
    }

    if (act.source === "license") {
      const lic = act.license_id ? await user.getLicense(act.license_id) : null;
      if (!lic || lic.org_id !== act.org_id) throw new LicenseApiError("P0002");
      if (lic.status !== "active") throw new LicenseApiError("AR003");
      const licenseFile = await signFile(deps, signer, session, {
        source: "license",
        licenseId: lic.id,
        orgId: act.org_id,
        sku: lic.sku_code,
        updatesUntil: lic.updates_until,
        activationId: act.id,
        deviceHash: act.device_hash,
        features,
      });
      licenseLog.info("license_refreshed", { route: "refresh", source: "license", activation_id: act.id });
      return okResponse({ license_file: licenseFile });
    }

    if (!PLAN_ACTIVE_STATES.has(features.state)) throw EXPIRED();
    const licenseFile = await signFile(deps, signer, session, {
      source: "plan",
      licenseId: null,
      orgId: act.org_id,
      sku: features.plan_code ?? features.state,
      updatesUntil: null,
      activationId: act.id,
      deviceHash: act.device_hash,
      features,
    });
    licenseLog.info("license_refreshed", { route: "refresh", source: "plan", activation_id: act.id });
    return okResponse({ license_file: licenseFile });
  } catch (error) {
    return toResponse("refresh", error);
  }
}

/** GET /api/license/list — 전부 사용자 JWT(RLS). 시리얼은 끝 5자만. */
export async function handleList(req: Request, deps: LicenseDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    requireRole(session, MEMBER_PLUS);
    const user = deps.userRepo(session);
    const [licenses, activations, features] = await Promise.all([
      user.listLicenses(session.orgId),
      user.listActiveActivations(session.orgId),
      user.orgFeatures(session.orgId),
    ]);
    const device = (a: (typeof activations)[number]) => ({ id: a.id, device_label: a.device_label, activated_at: a.activated_at, last_seen_at: a.last_seen_at });
    return okResponse({
      licenses: licenses.map((l) => ({
        id: l.id,
        sku: l.sku_code,
        serial_last5: l.serial_last5,
        status: l.status,
        purchased_at: l.purchased_at,
        updates_until: l.updates_until,
        activations: activations.filter((a) => a.source === "license" && a.license_id === l.id).map(device),
      })),
      plan_activations: activations.filter((a) => a.source === "plan").map(device),
      features,
      // arch.eligible_build는 service_role 전용이고 업데이트 API(AR-06-042) 소유라 여기서는 채우지 않는다.
      last_eligible_build: null,
    });
  } catch (error) {
    return toResponse("list", error);
  }
}
