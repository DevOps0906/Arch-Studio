// 라이선스 파일 Ed25519 서명(04_API.md 2.4절). Node 내장 node:crypto만 쓴다(새 의존성 없음).
// 키: LICENSE_SIGNING_PRIVATE_KEY(PKCS#8 PEM 또는 PKCS#8 DER의 base64/base64url), LICENSE_SIGNING_KID.
// 키 형식·교체·폐기 규격은 코어 요청 C-3(T-C4) 미결: 09_SECURITY_PLAN.md S-4 "C-3 승인 전 AR-06-040 머지 보류 검토".
// 보안 규칙: 키 원문·파싱 오류 원문은 예외 메시지·로그에 넣지 않는다. AI 서명 토큰 키와 같은 키·같은 kid면 거부한다.
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalBytes } from "./canonical.ts";

/**
 * 서명 도메인 분리 접두(용도·버전). 서명 입력 = UTF-8(LICENSE_SIGNING_CONTEXT) || payload 바이트.
 * 같은 키·다른 용도(규칙 팩 매니페스트·업데이트 등)의 서명을 라이선스 파일로 재사용하지 못하게 한다.
 * payload 필드에는 접두를 넣지 않는다. Rust 검증자(AR-06-041 license.rs)와 같은 값이어야 한다(합의 필요 항목).
 */
export const LICENSE_SIGNING_CONTEXT = "arch-license-v1\n";
const CONTEXT_BYTES = Buffer.from(LICENSE_SIGNING_CONTEXT, "utf8");

/** 서명·검증 입력 바이트(접두 + payload 바이트). */
export function licenseSigningInput(payloadBytes: Buffer): Buffer {
  return Buffer.concat([CONTEXT_BYTES, payloadBytes]);
}

export interface SignedLicenseFile {
  payload: string; // base64url(정준 JSON UTF-8 바이트, 접두 없음)
  sig: string; // base64url(Ed25519(LICENSE_SIGNING_CONTEXT || payload 바이트))
  kid: string; // payload.kid와 같다
}

export type SignerFailure = "missing" | "invalid_key" | "not_ed25519" | "invalid_kid" | "same_as_ai_token_key" | "same_kid_as_ai_token";

/** 서명기를 만들 수 없을 때. message에는 이유 코드만 담는다(키 값 없음). */
export class LicenseSignerError extends Error {
  readonly reason: SignerFailure;
  constructor(reason: SignerFailure) {
    super(`license signer unavailable: ${reason}`);
    this.name = "LicenseSignerError";
    this.reason = reason;
  }
}

export interface LicenseSigner {
  readonly kid: string;
  /** SPKI DER(검증·배포용 공개키). */
  readonly publicKeyDer: Buffer;
  signPayload(payload: { kid: string }): SignedLicenseFile;
}

export interface SignerKeyInput {
  privateKey: string | undefined;
  kid: string | undefined;
  /** 혼용 검사용. 값은 비교에만 쓰고 보관하지 않는다. */
  aiTokenPrivateKey: string | undefined;
  aiTokenKid: string | undefined;
}

const KID = /^[A-Za-z0-9._-]{1,64}$/;

function parsePrivateKey(raw: string): KeyObject | null {
  const text = raw.trim();
  try {
    if (text.includes("-----BEGIN")) {
      // 배포 환경 변수에 줄바꿈이 \n 문자로 들어오는 경우를 허용한다.
      return createPrivateKey({ key: text.replace(/\\n/g, "\n"), format: "pem" });
    }
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

/** 환경 변수 값으로 서명기를 만든다. 실패하면 LicenseSignerError(이유 코드만). */
export function createLicenseSigner(input: SignerKeyInput): LicenseSigner {
  const rawKey = input.privateKey?.trim();
  const kid = input.kid?.trim();
  if (!rawKey || !kid) throw new LicenseSignerError("missing");
  if (!KID.test(kid)) throw new LicenseSignerError("invalid_kid");
  const aiRaw = input.aiTokenPrivateKey?.trim();
  if (aiRaw && aiRaw === rawKey) throw new LicenseSignerError("same_as_ai_token_key");
  if (input.aiTokenKid?.trim() === kid) throw new LicenseSignerError("same_kid_as_ai_token");

  const key = parsePrivateKey(rawKey);
  if (!key) throw new LicenseSignerError("invalid_key");
  if (key.asymmetricKeyType !== "ed25519") throw new LicenseSignerError("not_ed25519");
  const publicKeyDer = spki(key);
  if (aiRaw) {
    const aiKey = parsePrivateKey(aiRaw);
    // 형식이 달라도(PEM vs base64) 같은 키면 공개키가 같다.
    if (aiKey && aiKey.asymmetricKeyType === "ed25519" && spki(aiKey).equals(publicKeyDer)) {
      throw new LicenseSignerError("same_as_ai_token_key");
    }
  }
  const publicKey = createPublicKey(key);

  return {
    kid,
    publicKeyDer,
    signPayload(payload) {
      if (payload.kid !== kid) throw new Error("payload kid mismatch");
      const bytes = canonicalBytes(payload);
      const message = licenseSigningInput(bytes);
      const sig = sign(null, message, key);
      // 자체 검증: 키·바이트 불일치가 있으면 파일을 내보내지 않는다.
      if (!verify(null, message, publicKey, sig)) throw new Error("license self-verification failed");
      return { payload: bytes.toString("base64url"), sig: sig.toString("base64url"), kid };
    },
  };
}

export type VerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: "malformed" | "unknown_kid" | "invalid_signature" | "kid_mismatch" };

const B64URL = /^[A-Za-z0-9_-]*$/;

/**
 * 검증 참조 구현(Rust license.rs 동작 명세 겸 테스트용). 접두 + 디코드한 payload 바이트 그대로 검증한 뒤 파싱한다(재직렬화하지 않음).
 * publicKeys: kid → SPKI DER.
 */
export function verifyLicenseFile(file: unknown, publicKeys: Readonly<Record<string, Buffer>>): VerifyResult {
  if (file === null || typeof file !== "object") return { ok: false, reason: "malformed" };
  const { payload, sig, kid } = file as Record<string, unknown>;
  if (typeof payload !== "string" || typeof sig !== "string" || typeof kid !== "string") return { ok: false, reason: "malformed" };
  if (!B64URL.test(payload) || !B64URL.test(sig)) return { ok: false, reason: "malformed" };
  const der = Object.prototype.hasOwnProperty.call(publicKeys, kid) ? publicKeys[kid] : undefined;
  if (!der) return { ok: false, reason: "unknown_kid" };
  const bytes = Buffer.from(payload, "base64url");
  const sigBytes = Buffer.from(sig, "base64url");
  let valid = false;
  try {
    valid = sigBytes.length === 64 && verify(null, licenseSigningInput(bytes), createPublicKey({ key: der, format: "der", type: "spki" }), sigBytes);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "invalid_signature" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "malformed" };
  if ((parsed as Record<string, unknown>).kid !== kid) return { ok: false, reason: "kid_mismatch" };
  return { ok: true, payload: parsed as Record<string, unknown> };
}
