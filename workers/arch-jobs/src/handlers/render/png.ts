// PNG 서명·IHDR 검사(웹 apps/web/src/server/ai/render/png.ts와 같은 규칙. 패키지가 달라 복제, 디코딩하지 않는다).
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (String.fromCharCode(bytes[12] as number, bytes[13] as number, bytes[14] as number, bytes[15] as number) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) return null;
  return { width, height };
}
