// 테스트 전용 PNG 바이트 생성(CRC는 검사하지 않으므로 0). *.test.ts에서만 import한다.
export function chunk(type: string, data: number[] = []): number[] {
  const len = data.length;
  return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
export const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const ihdr = (w = 16, h = 16) => chunk("IHDR", [0, 0, w >> 8, w & 255, 0, 0, h >> 8, h & 255, 8, 6, 0, 0, 0]);

/** 테스트용 최소 PNG(CRC는 검사하지 않으므로 0). */
export function pngBytes(extra: number[][] = [], w = 16, h = 16): Uint8Array {
  return Uint8Array.from([...SIG, ...ihdr(w, h), ...extra.flat(), ...chunk("IDAT", [1, 2, 3]), ...chunk("IEND")]);
}

