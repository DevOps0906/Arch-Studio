// 바이트 → 문자열(UTF-8, 잘못된 바이트는 U+FFFD). TextDecoder는 엔진 패키지 타입에 없어 직접 구현한다.
// CP949(ANSI_949) 도면은 한글 레이어 이름만 깨지고 좌표·구조에는 영향이 없다(알려진 한계).

const CHUNK = 8192;

const cont = (b: number | undefined): boolean => b !== undefined && (b & 0xc0) === 0x80;

export function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  const buf: number[] = [];
  const n = bytes.length;
  let i = 0;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // BOM
  while (i < n) {
    const b = bytes[i] as number;
    let cp = 0xfffd;
    let len = 1;
    if (b < 0x80) {
      cp = b;
    } else if (b >= 0xc2 && b < 0xe0 && cont(bytes[i + 1])) {
      cp = ((b & 0x1f) << 6) | ((bytes[i + 1] as number) & 0x3f);
      len = 2;
    } else if (b >= 0xe0 && b < 0xf0 && cont(bytes[i + 1]) && cont(bytes[i + 2])) {
      const v = ((b & 0x0f) << 12) | (((bytes[i + 1] as number) & 0x3f) << 6) | ((bytes[i + 2] as number) & 0x3f);
      if (v >= 0x800 && (v < 0xd800 || v > 0xdfff)) cp = v;
      len = 3;
    } else if (b >= 0xf0 && b < 0xf5 && cont(bytes[i + 1]) && cont(bytes[i + 2]) && cont(bytes[i + 3])) {
      const v =
        ((b & 0x07) << 18) |
        (((bytes[i + 1] as number) & 0x3f) << 12) |
        (((bytes[i + 2] as number) & 0x3f) << 6) |
        ((bytes[i + 3] as number) & 0x3f);
      if (v >= 0x10000 && v <= 0x10ffff) cp = v;
      len = 4;
    }
    i += len;
    if (cp >= 0x10000) {
      const c = cp - 0x10000;
      buf.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else {
      buf.push(cp);
    }
    if (buf.length >= CHUNK) {
      out += String.fromCharCode(...buf);
      buf.length = 0;
    }
  }
  if (buf.length > 0) out += String.fromCharCode(...buf);
  return out;
}

/** DXF 유니코드 이스케이프 \U+XXXX 를 문자로 바꾼다(R2004 이하 레이어 이름). 잘못된 값은 그대로 둔다. */
export function decodeDxfEscapes(s: string): string {
  if (!s.includes("\\U+")) return s;
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}
