// RulePackStore(AR-06-042): 서명 규칙 팩 설치·불러오기. 설치형은 Rust `commands/rule_pack.rs`가 서명·해시·자격·롤백을 판정하고,
// 이 모듈은 결과 상태 이름만 다룬다(본문·서명은 화면 로그에 남기지 않는다). 웹(072)은 서버가 같은 팩을 내준다 — 여기 없음.
// 내려받기는 화면 쪽 fetch로 한다(Rust에 TLS 스택 의존성을 새로 넣지 않음). 받은 바이트는 Rust가 다시 검증하므로 전송 경로를 믿지 않는다.

/** Rust `RulePackInstallStatus.state`. */
export const RULE_PACK_INSTALL_STATES = [
  "installed",
  "already_installed",
  "downgrade",
  "conflict",
  "not_entitled",
  "too_large",
  "malformed",
  "unknown_kid",
  "invalid_signature",
  "content_mismatch",
  "write_failed",
] as const;
export type RulePackInstallState = (typeof RULE_PACK_INSTALL_STATES)[number];

/** Rust `RulePackLoadStatus.state`. */
export const RULE_PACK_LOAD_STATES = ["ok", "missing", "invalid", "not_entitled"] as const;
export type RulePackLoadState = (typeof RULE_PACK_LOAD_STATES)[number];

export interface LoadedRulePack {
  readonly version: string;
  readonly sha256: string;
  readonly basisDate: string;
  readonly publishedAt: string;
  /** 팩 본문(UTF-8 JSON 문자열). 워커가 loadRulePack으로 다시 검사한다. */
  readonly text: string;
}

export type RulePackLoadResult = { readonly state: "ok"; readonly pack: LoadedRulePack } | { readonly state: Exclude<RulePackLoadState, "ok"> };

export interface RulePackInstallResult {
  readonly state: RulePackInstallState;
  readonly version: string | null;
}

export interface RulePackStore {
  /** 설치된 최고 버전 팩(디스크에서 다시 검증 + 라이선스 자격). */
  load(licenseFile: string | null): Promise<RulePackLoadResult>;
  /** 서버 download 응답의 signed_manifest + 내려받은 본문을 설치(Rust가 검증). */
  install(licenseFile: string | null, signedManifest: string, packText: string): Promise<RulePackInstallResult>;
}

/** 상한(Rust MAX_PACK_BYTES·MAX_SIGNED_MANIFEST_BYTES와 같다). */
export const RULE_PACK_LIMITS = Object.freeze({ maxPackBytes: 8 * 1024 * 1024, maxSignedManifestBytes: 8 * 1024 });

/** 내려받기 실패 이유(값·URL은 담지 않는다). */
export type RulePackDownloadError = "url_rejected" | "http_error" | "size_mismatch" | "too_large" | "not_utf8" | "network";

export class RulePackDownloadFailure extends Error {
  readonly reason: RulePackDownloadError;
  constructor(reason: RulePackDownloadError) {
    super(`rule-pack download: ${reason}`);
    this.name = "RulePackDownloadFailure";
    this.reason = reason;
  }
}

/**
 * 다운로드 URL 검사(계획 공격 P5): https만, 설정된 저장소 출처(VITE_SUPABASE_URL의 origin)와 정확히 같아야 한다.
 * API가 오염돼 임의 호스트로 보내는 경로를 막는다(본문은 어차피 Rust가 서명 검증).
 */
export function assertRulePackUrl(url: string, allowedOrigin: string): URL {
  let u: URL;
  let allowed: URL;
  try {
    u = new URL(url);
    allowed = new URL(allowedOrigin);
  } catch {
    throw new RulePackDownloadFailure("url_rejected");
  }
  if (u.protocol !== "https:" || allowed.protocol !== "https:" || u.origin !== allowed.origin || u.username || u.password) {
    throw new RulePackDownloadFailure("url_rejected");
  }
  return u;
}

export interface FetchedResponse {
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}
export type RulePackFetch = (url: string, init: { redirect: "error"; credentials: "omit"; cache: "no-store" }) => Promise<FetchedResponse>;

/**
 * 본문을 스트림으로 읽으며 `expectedBytes`(서명된 manifest.bytes, 상한 이하)를 넘는 순간 끊는다(압축 폭탄·거대 본문, P6).
 * Content-Length가 있으면 읽기 전에 비교한다. 결과는 UTF-8 엄격 해석(BOM 보존) 문자열 — 바이트가 그대로 Rust로 간다.
 */
export async function fetchRulePackText(fetchFn: RulePackFetch, url: string, allowedOrigin: string, expectedBytes: number): Promise<string> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > RULE_PACK_LIMITS.maxPackBytes) {
    throw new RulePackDownloadFailure("too_large");
  }
  const u = assertRulePackUrl(url, allowedOrigin);
  let res: FetchedResponse;
  try {
    res = await fetchFn(u.href, { redirect: "error", credentials: "omit", cache: "no-store" });
  } catch {
    throw new RulePackDownloadFailure("network");
  }
  if (!res.ok || !res.body) throw new RulePackDownloadFailure("http_error");
  const declared = res.headers.get("content-length");
  const encoded = (res.headers.get("content-encoding") ?? "identity").toLowerCase();
  // 압축 전송이면 Content-Length는 압축 크기라 비교하지 않는다(해제 후 바이트로 끊는다).
  if (declared !== null && encoded === "identity" && Number(declared) !== expectedBytes) throw new RulePackDownloadFailure("size_mismatch");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch {
      throw new RulePackDownloadFailure("network");
    }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > expectedBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RulePackDownloadFailure("too_large");
    }
    chunks.push(step.value);
  }
  if (total !== expectedBytes) throw new RulePackDownloadFailure("size_mismatch");
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new RulePackDownloadFailure("not_utf8");
  }
}

/** 서버 `GET /api/rule-packs/{version}/download` 응답 중 설치에 쓰는 필드. */
export interface RulePackDownloadTicket {
  readonly url: string;
  readonly bytes: number;
  readonly signed_manifest: string;
}

/** 내려받기 → Rust 설치. 화면은 결과 상태만 본다. */
export async function downloadAndInstallRulePack(input: {
  readonly ticket: RulePackDownloadTicket;
  readonly fetch: RulePackFetch;
  readonly allowedOrigin: string;
  readonly store: RulePackStore;
  readonly licenseFile: string | null;
}): Promise<RulePackInstallResult> {
  const { ticket } = input;
  if (typeof ticket.signed_manifest !== "string" || ticket.signed_manifest.length > RULE_PACK_LIMITS.maxSignedManifestBytes) {
    return { state: "too_large", version: null };
  }
  const text = await fetchRulePackText(input.fetch, ticket.url, input.allowedOrigin, ticket.bytes);
  return input.store.install(input.licenseFile, ticket.signed_manifest, text);
}

/** 어댑터 묶음의 규칙 팩 저장소(설치형만). 없으면 null. */
export function rulePacksOf(adapters: { readonly rulePacks?: RulePackStore }): RulePackStore | null {
  return adapters.rulePacks ?? null;
}
