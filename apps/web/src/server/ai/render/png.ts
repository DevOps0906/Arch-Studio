// 렌더 입력 PNG 사용 시점 재검사(04_API.md 1장 "업로드": 크기·매직바이트, 2.1절 render 행: PNG·10MB·render_max_px).
// 앞 24바이트(서명 8 + IHDR 길이 4 + "IHDR" 4 + 폭 4 + 높이 4)만 본다. 디코딩하지 않는다.
// server-only를 import하지 않는다(node --test 대상).

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** 검사에 필요한 앞 바이트 수. */
export const PNG_HEAD_BYTES = 24;
/** PNG 명세 상한(2^31-1). */
const PNG_MAX_DIMENSION = 0x7fffffff;

export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** 첫 청크가 IHDR(길이 13)이면 폭·높이. 아니면 null. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!hasPngSignature(bytes) || bytes.length < PNG_HEAD_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (String.fromCharCode(bytes[12] as number, bytes[13] as number, bytes[14] as number, bytes[15] as number) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > PNG_MAX_DIMENSION || height > PNG_MAX_DIMENSION) return null;
  return { width, height };
}
