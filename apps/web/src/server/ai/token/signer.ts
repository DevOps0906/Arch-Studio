// AI 서명 토큰·잡 토큰 발급(04_API.md 2.2절, AI_ARCHITECTURE.md 2.1절). JWS compact, EdDSA(Ed25519), Node 내장 node:crypto만.
// 검증자: apps/api/app/auth/tokens.py(JWKS 공개키). 클레임 iss=arch, aud=platform-ai:arch, app=arch, sub, org, scope, jti, iat, exp
// (+ feat, conv 선택). 잡 토큰은 sub=job:<job_id> + `job`(= job_id) + `run`(실행 행 id) 클레임으로 잡·실행 하나에 묶는다.
//
// 키 분리·도메인 분리(라이선스 서명 040과 같은 원칙, 다른 접두):
// - 키: AI_TOKEN_PRIVATE_KEY / AI_TOKEN_KID. LICENSE_SIGNING_PRIVATE_KEY와 같은 키(공개키 비교)·같은 kid면 서명기를 만들지 않는다.
// - 도메인: 라이선스 서명 입력은 "arch-license-v1\n" || payload. AI 토큰 서명 입력은 JWS 표준(ASCII(base64url(header) "." base64url(payload)))이고
//   보호 헤더에 ctx=AI_TOKEN_CONTEXT를 넣어 용도를 서명 대상에 묶는다. 두 입력은 첫 바이트부터 다르다("a…" vs "eyJ…").
// 보안 규칙: 키 원문·파싱 오류 원문은 예외 메시지·로그에 넣지 않는다. 토큰 값은 로그에 넣지 않는다.
import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";

export const AI_TOKEN_CONTEXT = "arch-ai-token-v1";
export const AI_APP = "arch";
export const AI_ISSUER = "arch";
export const AI_AUDIENCE = "platform-ai:arch";
/** 검증자 상한(apps/api MAX_LIFETIME_S)과 같다. 발급 수명은 이 값 이하만. */
export const MAX_TOKEN_LIFETIME_S = 600;
export const JOB_TOKEN_TTL_S = 300;
export const USER_TOKEN_TTL_S = 600;
export const JOB_SUB_PREFIX = "job:";

/** 잡 토큰 scope(그래프·제품 엔드포인트, 04_API.md 6.3절). 사용자 토큰은 이 값을 가질 수 없다. */
export const JOB_SCOPES = ["graph:arch.review", "graph:arch.intake", "graph:arch.proposal_narrative"] as const;
export type JobScope = (typeof JOB_SCOPES)[number];
/** 사용자 서명 토큰 scope(04_API.md 2.2절 chat·wiki·voice). `graph:` 접두는 어떤 경우에도 불가. */
export const USER_SCOPES = ["chat", "wiki", "voice"] as const;
export type UserScope = (typeof USER_SCOPES)[number];

/** 라우팅 feature 키(02_ARCHITECTURE.md 5장). 서버가 실행 행에서 정한다. */
export const FEATURES = ["arch.review", "arch.intake", "arch.intake_consult", "arch.proposal_narrative", "arch.chat"] as const;
export type Feature = (typeof FEATURES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;

export type AiSignerFailure = "missing" | "invalid_key" | "not_ed25519" | "invalid_kid" | "same_as_license_key" | "same_kid_as_license";

export class AiSignerError extends Error {
  readonly reason: AiSignerFailure;
  constructor(reason: AiSignerFailure) {
    super(`ai token signer unavailable: ${reason}`);
    this.name = "AiSignerError";
    this.reason = reason;
  }
}

/** 발급 입력 오류(코드 버그·허용 밖 값). 메시지에 값은 넣지 않는다. */
export class AiTokenClaimError extends Error {
  constructor(field: string) {
    super(`invalid ai token claim: ${field}`);
    this.name = "AiTokenClaimError";
  }
}

export interface AiSignerKeyInput {
  privateKey: string | undefined;
  kid: string | undefined;
  /** 혼용 검사용. 비교에만 쓰고 보관하지 않는다. */
  licensePrivateKey: string | undefined;
  licenseKid: string | undefined;
}

export interface PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
}

export interface IssuedToken {
  token: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface JobTokenInput {
  jobId: string;
  runId: string;
  orgId: string;
  scope: JobScope;
  feat: Feature;
  nowS: number;
}

export interface UserTokenInput {
  userId: string;
  orgId: string;
  scope: UserScope;
  feat?: Feature;
  conv?: string;
  nowS: number;
}

export interface AiTokenSigner {
  readonly kid: string;
  publicJwk(): PublicJwk;
  issueJobToken(input: JobTokenInput): IssuedToken;
  issueUserToken(input: UserTokenInput): IssuedToken;
}

function parsePrivateKey(raw: string): KeyObject | null {
  const text = raw.trim();
  try {
    if (text.includes("-----BEGIN")) return createPrivateKey({ key: text.replace(/\\n/g, "\n"), format: "pem" });
    if (!/^[A-Za-z0-9+/_=-]+$/.test(text)) return null;
    const der = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    return null; // 원인 메시지는 버린다(키 조각이 섞일 수 있음)
  }
}

function spki(key: KeyObject): Buffer {
  return createPublicKey(key).export({ format: "der", type: "spki" });
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertInt(name: string, v: number) {
  if (!Number.isSafeInteger(v) || v <= 0) throw new AiTokenClaimError(name);
}

/** 환경 변수 값으로 AI 토큰 서명기를 만든다. 실패하면 AiSignerError(이유 코드만). */
export function createAiTokenSigner(input: AiSignerKeyInput): AiTokenSigner {
  const rawKey = input.privateKey?.trim();
  const kid = input.kid?.trim();
  if (!rawKey || !kid) throw new AiSignerError("missing");
  if (!KID.test(kid)) throw new AiSignerError("invalid_kid");
  const licRaw = input.licensePrivateKey?.trim();
  if (licRaw && licRaw === rawKey) throw new AiSignerError("same_as_license_key");
  if (input.licenseKid?.trim() === kid) throw new AiSignerError("same_kid_as_license");

  const parsed = parsePrivateKey(rawKey);
  if (!parsed) throw new AiSignerError("invalid_key");
  const key: KeyObject = parsed;
  if (key.asymmetricKeyType !== "ed25519") throw new AiSignerError("not_ed25519");
  const publicKeyDer = spki(key);
  if (licRaw) {
    const licKey = parsePrivateKey(licRaw);
    if (licKey && licKey.asymmetricKeyType === "ed25519" && spki(licKey).equals(publicKeyDer)) {
      throw new AiSignerError("same_as_license_key");
    }
  }
  const publicKey = createPublicKey(key);
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new AiSignerError("invalid_key");
  const header = { alg: "EdDSA", typ: "JWT", kid, ctx: AI_TOKEN_CONTEXT } as const;
  const encodedHeader = b64urlJson(header);

  function signClaims(claims: Record<string, unknown>, ttl: number, nowS: number): IssuedToken {
    assertInt("iat", nowS);
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_TOKEN_LIFETIME_S) throw new AiTokenClaimError("ttl");
    const jti = randomBytes(16).toString("base64url"); // 128비트, 22자(검증자 8..128)
    const exp = nowS + ttl;
    const body = { iss: AI_ISSUER, aud: AI_AUDIENCE, app: AI_APP, ...claims, jti, iat: nowS, exp };
    const signingInput = `${encodedHeader}.${b64urlJson(body)}`;
    const sig = sign(null, Buffer.from(signingInput, "ascii"), key);
    if (!verify(null, Buffer.from(signingInput, "ascii"), publicKey, sig)) throw new Error("ai token self-verification failed");
    return { token: `${signingInput}.${sig.toString("base64url")}`, jti, iat: nowS, exp };
  }

  return {
    kid,
    publicJwk: () => ({ kty: "OKP", crv: "Ed25519", x: jwk.x as string, kid, alg: "EdDSA", use: "sig" }),
    issueJobToken(i) {
      if (!UUID.test(i.jobId)) throw new AiTokenClaimError("job");
      if (!UUID.test(i.runId)) throw new AiTokenClaimError("run");
      if (!UUID.test(i.orgId)) throw new AiTokenClaimError("org");
      if (!(JOB_SCOPES as readonly string[]).includes(i.scope)) throw new AiTokenClaimError("scope");
      if (!(FEATURES as readonly string[]).includes(i.feat)) throw new AiTokenClaimError("feat");
      return signClaims(
        { sub: `${JOB_SUB_PREFIX}${i.jobId}`, org: i.orgId, scope: i.scope, feat: i.feat, run: i.runId, job: i.jobId },
        JOB_TOKEN_TTL_S,
        i.nowS,
      );
    },
    issueUserToken(i) {
      // sub는 사용자 UUID만: "job:" 접두나 다른 형식으로 잡 토큰을 흉내낼 수 없다.
      if (!UUID.test(i.userId)) throw new AiTokenClaimError("sub");
      if (!UUID.test(i.orgId)) throw new AiTokenClaimError("org");
      if (!(USER_SCOPES as readonly string[]).includes(i.scope)) throw new AiTokenClaimError("scope");
      if (i.feat !== undefined && !(FEATURES as readonly string[]).includes(i.feat)) throw new AiTokenClaimError("feat");
      if (i.conv !== undefined && !UUID.test(i.conv)) throw new AiTokenClaimError("conv");
      const claims: Record<string, unknown> = { sub: i.userId, org: i.orgId, scope: i.scope };
      if (i.feat) claims.feat = i.feat;
      if (i.conv) claims.conv = i.conv;
      return signClaims(claims, USER_TOKEN_TTL_S, i.nowS);
    },
  };
}

export type VerifyFailure = "malformed" | "header" | "unknown_kid" | "signature" | "claims" | "expired";

/**
 * 검증 참조 구현(테스트·문서용, 검증 정본은 apps/api). 헤더 고정값(alg·ctx)·서명·iss/aud/app·수명을 본다.
 * publicKeys: kid → SPKI DER.
 */
export function verifyAiToken(
  token: string,
  publicKeys: Readonly<Record<string, Buffer>>,
  nowS: number,
): { ok: true; header: Record<string, unknown>; claims: Record<string, unknown> } | { ok: false; reason: VerifyFailure } {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "EdDSA" || header.ctx !== AI_TOKEN_CONTEXT) return { ok: false, reason: "header" };
  const kid = typeof header.kid === "string" ? header.kid : "";
  const der = Object.prototype.hasOwnProperty.call(publicKeys, kid) ? publicKeys[kid] : undefined;
  if (!der) return { ok: false, reason: "unknown_kid" };
  let valid = false;
  try {
    valid = verify(null, Buffer.from(`${h}.${p}`, "ascii"), createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(s, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature" };
  if (claims.iss !== AI_ISSUER || claims.aud !== AI_AUDIENCE || claims.app !== AI_APP) return { ok: false, reason: "claims" };
  const iat = claims.iat;
  const exp = claims.exp;
  if (typeof iat !== "number" || typeof exp !== "number" || exp - iat > MAX_TOKEN_LIFETIME_S) return { ok: false, reason: "claims" };
  if (exp <= nowS) return { ok: false, reason: "expired" };
  return { ok: true, header, claims };
}
