// 로고 PNG 검사(04_API.md 1장 "사용 시점에 서버가 크기·MIME·매직바이트를 다시 검사", `:59` PNG 1MB, SVG 거부).
// 확장자·Content-Type은 믿지 않고 바이트만 본다: 시그니처 → 청크 구조(길이·경계) → IHDR 첫 청크·IEND 마지막 →
// 허용 청크만(메타데이터 tEXt·zTXt·iTXt·eXIf·tIME 등은 거부: 위치·작성자 정보가 표제란 로고로 퍼지지 않게).
// 화면은 업로드 전에 같은 허용 목록으로 보조 청크를 지운다(packages/features/src/settings/drafting/logo.ts).
// server-only를 import하지 않는다(node --test 대상).

export const LOGO_MAX_BYTES = 1024 * 1024;
/** 로고 최대 변 길이(px). 표제란 로고에 이보다 큰 이미지는 필요 없다(제안) — 압축 폭탄(작은 파일·거대 캔버스) 방지. */
export const LOGO_MAX_SIDE = 4096;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 허용 청크: 필수(IHDR·PLTE·IDAT·IEND) + 색 표현 보조(tRNS·gAMA·cHRM·sRGB·iCCP·pHYs·sBIT·bKGD). */
export const ALLOWED_CHUNKS: ReadonlySet<string> = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "pHYs", "sBIT", "bKGD"]);

export type PngFailure = "too_large" | "empty" | "signature" | "structure" | "chunk" | "dimensions";

export function inspectPng(bytes: Uint8Array): { ok: true; width: number; height: number } | { ok: false; reason: PngFailure } {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > LOGO_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (bytes.byteLength < SIGNATURE.length || SIGNATURE.some((b, i) => bytes[i] !== b)) return { ok: false, reason: "signature" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off: number = SIGNATURE.length;
  let index = 0;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  for (;;) {
    if (off + 12 > bytes.byteLength) return { ok: false, reason: "structure" };
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4] as number, bytes[off + 5] as number, bytes[off + 6] as number, bytes[off + 7] as number);
    if (!/^[A-Za-z]{4}$/.test(type)) return { ok: false, reason: "structure" };
    const end = off + 12 + len;
    if (len > 0x7fffffff || end > bytes.byteLength) return { ok: false, reason: "structure" };
    if (!ALLOWED_CHUNKS.has(type)) return { ok: false, reason: "chunk" };
    if (index === 0) {
      if (type !== "IHDR" || len !== 13) return { ok: false, reason: "structure" };
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      if (width === 0 || height === 0 || width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) return { ok: false, reason: "dimensions" };
    } else if (type === "IHDR") return { ok: false, reason: "structure" };
    if (type === "IDAT") sawIdat = true;
    off = end;
    index++;
    if (type === "IEND") {
      if (off !== bytes.byteLength || !sawIdat) return { ok: false, reason: "structure" };
      return { ok: true, width, height };
    }
  }
}

/** `<org_id>/arch/drafting-logo/<uuid>.png`(DB drafting_profiles_logo_check·valid_user_path와 같은 모양). */
export function isOwnLogoPath(orgId: string, path: string): boolean {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (!new RegExp(`^${uuid}$`).test(orgId) || path.length > 300) return false;
  return new RegExp(`^${orgId}/arch/drafting-logo/${uuid}\\.png$`).test(path);
}

export function buildLogoPath(orgId: string, objectId: string): string | null {
  const path = `${orgId}/arch/drafting-logo/${objectId}.png`;
  return isOwnLogoPath(orgId, path) ? path : null;
}
