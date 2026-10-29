// 로고 올리기(04_API.md `:59`): PNG 1MB 이하만(SVG는 스크립트 위험으로 받지 않는다). 업로드 전에 화면이
// 시그니처·청크 구조를 확인하고 메타데이터 청크(tEXt·zTXt·iTXt·eXIf·tIME 등)를 지운다 — 서버(png.ts inspectPng)는 같은
// 허용 목록 밖 청크가 있으면 저장을 거부한다(화면 검사는 안내일 뿐, 서버가 정본).
// 순서: 파일 읽기 → stripPng → sha256 → POST /api/drafting-profile/logo-upload-url → 서명 URL로 PUT → 프로필 저장(logo_storage_path).

export const LOGO_MAX_BYTES = 1024 * 1024;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** 서버 ALLOWED_CHUNKS와 같은 목록. */
export const KEEP_CHUNKS: ReadonlySet<string> = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "pHYs", "sBIT", "bKGD"]);

export type LogoFailure = "too_large" | "not_png" | "broken";

export const LOGO_FAILURE_TEXT: Readonly<Record<LogoFailure, string>> = {
  too_large: "로고는 1MB 이하 PNG만 올릴 수 있습니다.",
  not_png: "PNG 파일만 올릴 수 있습니다. SVG·JPG는 PNG로 바꿔 올리세요.",
  broken: "PNG 파일을 읽지 못했습니다. 다른 프로그램에서 다시 저장해 올리세요.",
};

/** PNG 바이트 → 허용 청크만 남긴 바이트. 시그니처·구조가 틀리면 실패. */
export function stripPng(bytes: Uint8Array): { ok: true; bytes: Uint8Array; removed: string[] } | { ok: false; reason: LogoFailure } {
  if (bytes.byteLength > LOGO_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (bytes.byteLength < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return { ok: false, reason: "not_png" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];
  let off = 8;
  let first = true;
  for (;;) {
    if (off + 12 > bytes.byteLength) return { ok: false, reason: "broken" };
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4] as number, bytes[off + 5] as number, bytes[off + 6] as number, bytes[off + 7] as number);
    const end = off + 12 + len;
    if (!/^[A-Za-z]{4}$/.test(type) || len > 0x7fffffff || end > bytes.byteLength) return { ok: false, reason: "broken" };
    if (first && type !== "IHDR") return { ok: false, reason: "broken" };
    first = false;
    if (KEEP_CHUNKS.has(type)) parts.push(bytes.subarray(off, end));
    else removed.push(type);
    off = end;
    if (type === "IEND") break;
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return { ok: true, bytes: out, removed };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LogoUploadTicket {
  signed_upload_url: string;
  path: string;
  expires_at: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** 서명 응답 검사: 경로는 서버 형식, URL은 https(로컬 Supabase 개발용 loopback http만 예외). */
export function parseTicket(data: unknown, orgId: string): LogoUploadTicket {
  const d = (data ?? {}) as Record<string, unknown>;
  const path = d.path;
  const url = d.signed_upload_url;
  if (typeof path !== "string" || !new RegExp(`^${orgId}/arch/drafting-logo/${UUID}\\.png$`).test(path)) throw new Error("invalid");
  if (typeof url !== "string" || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(url)) throw new Error("invalid");
  return { signed_upload_url: url, path, expires_at: typeof d.expires_at === "string" ? d.expires_at : "" };
}
