// 규칙 팩 서명 매니페스트(AR-06-041 D1·D2, AR-06-042). 서명 입력 = "arch-rulepack-v1\n" ‖ manifest 바이트 그대로.
// 웹 서버는 **서명하지 않는다**(팩 서명 키를 갖지 않음, 계획 공격 P3). 저장소에 미리 서명돼 올라간 매니페스트를 읽어
// DB 행과 맞는지 확인만 하고 문자열 그대로 내준다(검증 정본은 Rust `verify_rule_pack`).
// signRulePackManifest는 운영 서명 도구(scripts/rule-packs/sign.ts)와 테스트만 쓴다. 키는 호출자가 환경 변수에서 넘긴다.
// 이 파일은 server-only를 import하지 않는다(node --test·CLI 대상).
import { createHash, createPrivateKey, sign } from "node:crypto";

export const RULEPACK_SIGNING_CONTEXT = "arch-rulepack-v1\n";
/** 서명 매니페스트 문자열 상한(Rust MAX_SIGNED_MANIFEST_BYTES와 같다). */
export const MAX_SIGNED_MANIFEST_BYTES = 8 * 1024;
/** 디코드한 manifest 상한(Rust MAX_MANIFEST_BYTES). */
export const MAX_MANIFEST_BYTES = 4 * 1024;
/** 팩 본문 상한(Rust MAX_PACK_BYTES). */
export const MAX_PACK_BYTES = 8 * 1024 * 1024;
/**
 * `YYYY.MM.n` 정준형: 월 01~12, n은 `0` 또는 `[1-9][0-9]{0,2}`(앞자리 0 금지). Rust `valid_version`·shell-bridge·packages/rules와 같다.
 * DB `rule_packs_version_check`(`^[0-9]{4}\.[0-9]{2}\.[0-9]{1,3}$`)는 아직 더 넓다 — 새 마이그레이션으로 맞추는 것은 후속(tasks/logs/AR-06-042.md).
 * 그래서 DB 행 중 정준형이 아닌 버전은 목록에서 빠지고 다운로드는 422가 된다(실패 닫힘).
 */
export const VERSION_RE = /^[0-9]{4}\.(0[1-9]|1[0-2])\.(0|[1-9][0-9]{0,2})$/;

export interface RulePackManifestV1 {
  v: 1;
  app_id: "arch";
  version: string;
  published_at: string;
  basis_date: string;
  sha256: string;
  bytes: number;
  kid: string;
}

export interface SignedRulePackManifest {
  manifest: string;
  sig: string;
  kid: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KID = /^[A-Za-z0-9_-]{1,40}$/; // DB rule_packs_kid_check(Rust는 점도 허용하지만 DB가 더 좁다)
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** manifest JSON 바이트(키 사전순, 공백 없음). Rust는 바이트 그대로 검증하므로 형식은 자유지만 도구 출력은 결정적으로 둔다. */
export function manifestBytes(m: RulePackManifestV1): Buffer {
  const ordered = {
    app_id: m.app_id,
    basis_date: m.basis_date,
    bytes: m.bytes,
    kid: m.kid,
    published_at: m.published_at,
    sha256: m.sha256,
    v: m.v,
    version: m.version,
  };
  return Buffer.from(JSON.stringify(ordered), "utf8");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface SignInput {
  /** Ed25519 개인키 PEM(PKCS#8). 호출자가 환경 변수 RULEPACK_SIGNING_PRIVATE_KEY에서 읽는다. 저장소에 두지 않는다. */
  privateKeyPem: string;
  kid: string;
  version: string;
  publishedAt: string;
  basisDate: string;
  pack: Uint8Array;
}

/** 운영 서명 도구·테스트 전용. 결과는 저장소 `rule-packs/<version>/manifest.json`에 그대로 올리는 문자열. */
export function signRulePackManifest(input: SignInput): string {
  if (!VERSION_RE.test(input.version)) throw new Error("version 형식");
  if (!KID.test(input.kid)) throw new Error("kid 형식");
  if (!RFC3339.test(input.publishedAt) || !DATE.test(input.basisDate)) throw new Error("날짜 형식");
  if (input.pack.byteLength === 0 || input.pack.byteLength > MAX_PACK_BYTES) throw new Error("팩 크기");
  const manifest: RulePackManifestV1 = {
    v: 1,
    app_id: "arch",
    version: input.version,
    published_at: input.publishedAt,
    basis_date: input.basisDate,
    sha256: sha256Hex(input.pack),
    bytes: input.pack.byteLength,
    kid: input.kid,
  };
  const body = manifestBytes(manifest);
  const key = createPrivateKey(input.privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 키가 아니다");
  const sig = sign(null, Buffer.concat([Buffer.from(RULEPACK_SIGNING_CONTEXT, "utf8"), body]), key);
  return JSON.stringify({ manifest: body.toString("base64url"), sig: sig.toString("base64url"), kid: input.kid } satisfies SignedRulePackManifest);
}

/** DB 행에서 매니페스트와 대조할 값. */
export interface RulePackRowFacts {
  version: string;
  sha256: string;
  bytes: number;
  kid: string;
  signature: string;
  /** DB rule_packs.published_at(timestamptz 문자열). manifest와 **같은 시각**이어야 한다(표기 차이 `Z`·`+00:00`은 허용). */
  published_at: string;
  /** DB rule_packs.basis_date(`YYYY-MM-DD`). manifest와 문자열이 정확히 같아야 한다. */
  basis_date: string;
}

/** RFC 3339 문자열을 시각(ms)으로. 형식이 틀리거나 달력에 없는 값(2월 31일·24시 — Date.parse는 넘겨 버린다)이면 null. */
function instantMs(v: unknown): number | null {
  if (typeof v !== "string" || !RFC3339.test(v)) return null;
  const [y, mo, d, h, mi, se] = [v.slice(0, 4), v.slice(5, 7), v.slice(8, 10), v.slice(11, 13), v.slice(14, 16), v.slice(17, 19)].map(Number) as [number, number, number, number, number, number];
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** PostgREST timestamptz 표기(`2026-10-20 00:00:00+00`처럼 공백·짧은 오프셋)도 받는다. 해석 불가면 null. */
function dbInstantMs(v: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(v);
  if (!m) return null;
  const [, d, t, zRaw] = m as unknown as [string, string, string, string];
  const z = zRaw === "Z" ? "Z" : zRaw.length === 3 ? `${zRaw}:00` : zRaw.includes(":") ? zRaw : `${zRaw.slice(0, 3)}:${zRaw.slice(3)}`;
  return instantMs(`${d}T${t}${z}`);
}

export type ManifestCheck = { ok: true; text: string; manifest: RulePackManifestV1 } | { ok: false; reason: string };

/**
 * 저장소에서 읽은 서명 매니페스트 문자열을 DB 행과 대조한다(서명 자체는 Rust가 검증한다). 하나라도 다르면 내주지 않는다(실패 닫힘).
 * 확인: 크기 상한, 바깥 키 3개만, sig = rule_packs.signature, kid = rule_packs.kid, manifest의 v·app_id·version·sha256·bytes·kid = 행,
 * manifest의 published_at = 행(같은 시각, 앱 자격 판정이 이 값을 쓴다), basis_date = 행(문자열 정확히).
 */
export function checkSignedManifest(text: string, row: RulePackRowFacts): ManifestCheck {
  if (Buffer.byteLength(text, "utf8") > MAX_SIGNED_MANIFEST_BYTES) return { ok: false, reason: "too_large" };
  let outer: unknown;
  try {
    outer = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json" };
  }
  if (outer === null || typeof outer !== "object" || Array.isArray(outer)) return { ok: false, reason: "shape" };
  const o = outer as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "kid,manifest,sig") return { ok: false, reason: "shape" };
  if (typeof o.manifest !== "string" || typeof o.sig !== "string" || typeof o.kid !== "string") return { ok: false, reason: "shape" };
  if (!B64URL.test(o.manifest) || !B64URL.test(o.sig) || o.sig.length !== 86) return { ok: false, reason: "encoding" };
  if (o.sig !== row.signature) return { ok: false, reason: "signature_mismatch" };
  if (o.kid !== row.kid) return { ok: false, reason: "kid_mismatch" };
  const body = Buffer.from(o.manifest, "base64url");
  if (body.byteLength === 0 || body.byteLength > MAX_MANIFEST_BYTES) return { ok: false, reason: "manifest_size" };
  let m: unknown;
  try {
    m = JSON.parse(body.toString("utf8"));
  } catch {
    return { ok: false, reason: "manifest_json" };
  }
  if (m === null || typeof m !== "object") return { ok: false, reason: "manifest_shape" };
  const mm = m as Record<string, unknown>;
  const same =
    mm.v === 1 &&
    mm.app_id === "arch" &&
    mm.version === row.version &&
    mm.sha256 === row.sha256 &&
    mm.bytes === row.bytes &&
    mm.kid === row.kid &&
    typeof mm.basis_date === "string" &&
    DATE.test(mm.basis_date) &&
    HEX64.test(row.sha256);
  if (!same) return { ok: false, reason: "manifest_mismatch" };
  // 게시 시각·기준일(감사 #1): 서버 자격 판정(DB published_at)과 앱 자격 판정(서명된 manifest published_at)이 같은 값을 봐야 한다.
  const signedAt = instantMs(mm.published_at);
  const rowAt = dbInstantMs(row.published_at);
  if (signedAt === null || rowAt === null || signedAt !== rowAt) return { ok: false, reason: "published_at_mismatch" };
  if (mm.basis_date !== row.basis_date) return { ok: false, reason: "basis_date_mismatch" };
  return { ok: true, text, manifest: mm as unknown as RulePackManifestV1 };
}

/** 저장소 경로(서버가 버전에서 만든다. 화면·DB 값을 경로로 그대로 쓰지 않는다, 계획 공격 P7). */
export function packStoragePath(version: string): string {
  if (!VERSION_RE.test(version)) throw new Error("version 형식");
  return `rule-packs/${version}/pack.json`;
}

export function manifestStoragePath(version: string): string {
  if (!VERSION_RE.test(version)) throw new Error("version 형식");
  return `rule-packs/${version}/manifest.json`;
}

/** YYYY.MM.n 비교(-1·0·1). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
