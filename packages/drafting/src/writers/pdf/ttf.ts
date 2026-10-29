// 최소 TrueType 파서(외부 의존성 없음): head·hhea·maxp·hmtx·cmap(형식 4·12)·name만 읽는다. 결정적 순수 함수.
// 쓰는 곳: PDF 작성기(주입 글꼴 확인·없는 글자 검사, AR057)와 글꼴 폭 표 생성 스크립트(scripts/font-metrics, 빌드 시).
// CFF 윤곽(OTTO)·TTC 묶음은 jsPDF가 임베드하지 못하므로 "지원 안 함"으로 돌려준다.
export interface TtfInfo {
  units_per_em: number;
  num_glyphs: number;
  /** name 표의 패밀리 이름(ID 16 우선, 없으면 1). 못 읽으면 "". */
  family: string;
  /** 코드 포인트 → 글리프 번호(0 = 없음). */
  glyph(cp: number): number;
  /** 글리프 advance 폭(글꼴 단위). */
  advance(gid: number): number;
}

export type TtfParse = { ok: true; font: TtfInfo } | { ok: false; reason: string };

interface Table {
  off: number;
  len: number;
}

export function parseTtf(bytes: Uint8Array): TtfParse {
  try {
    return parse(bytes);
  } catch (e) {
    return { ok: false, reason: e instanceof RangeError ? "파일이 잘렸습니다" : String(e) };
  }
}

function parse(bytes: Uint8Array): TtfParse {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o);
  const i16 = (o: number) => dv.getInt16(o);
  const u32 = (o: number) => dv.getUint32(o);
  if (bytes.byteLength < 12) return { ok: false, reason: "TTF가 아닙니다(너무 짧음)" };
  const tag = u32(0);
  if (tag === 0x4f54544f) return { ok: false, reason: "CFF 윤곽(OTF)은 지원하지 않습니다" };
  if (tag === 0x74746366) return { ok: false, reason: "TTC 묶음은 지원하지 않습니다" };
  if (tag !== 0x00010000 && tag !== 0x74727565) return { ok: false, reason: "TTF가 아닙니다(sfnt 버전)" };
  const n = u16(4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const name = String.fromCharCode(bytes[r] as number, bytes[r + 1] as number, bytes[r + 2] as number, bytes[r + 3] as number);
    const off = u32(r + 8);
    const len = u32(r + 12);
    if (off + len > bytes.byteLength) return { ok: false, reason: `표 ${name}가 파일 밖을 가리킵니다` };
    tables.set(name, { off, len });
  }
  for (const t of ["head", "hhea", "maxp", "hmtx", "cmap", "glyf"]) {
    if (!tables.has(t)) return { ok: false, reason: `필수 표 ${t}가 없습니다` };
  }
  const head = tables.get("head") as Table;
  const upem = u16(head.off + 18);
  if (upem < 16 || upem > 16384) return { ok: false, reason: `unitsPerEm이 올바르지 않습니다: ${upem}` };
  const numGlyphs = u16((tables.get("maxp") as Table).off + 4);
  const nh = u16((tables.get("hhea") as Table).off + 34);
  const hmtx = tables.get("hmtx") as Table;
  if (nh === 0 || nh > numGlyphs || hmtx.len < nh * 4) return { ok: false, reason: "hmtx가 올바르지 않습니다" };
  const advance = (gid: number) => (gid < 0 || gid >= numGlyphs ? 0 : u16(hmtx.off + Math.min(gid, nh - 1) * 4));

  // cmap: 유니코드 하위 표를 우선순위로 고른다 — (3,10)·(0,4)·(0,6) 형식 12 > (3,1)·(0,3) 형식 4.
  const cmap = (tables.get("cmap") as Table).off;
  const subs: Array<{ pid: number; eid: number; off: number; format: number }> = [];
  for (let i = 0, cnt = u16(cmap + 2); i < cnt; i++) {
    const r = cmap + 4 + i * 8;
    const off = cmap + u32(r + 4);
    subs.push({ pid: u16(r), eid: u16(r + 2), off, format: u16(off) });
  }
  const rank = (s: (typeof subs)[number]) => {
    if (s.format === 12 && ((s.pid === 3 && s.eid === 10) || (s.pid === 0 && (s.eid === 4 || s.eid === 6)))) return 0;
    if (s.format === 4 && ((s.pid === 3 && s.eid === 1) || (s.pid === 0 && s.eid <= 3))) return 1;
    return 9;
  };
  const best = [...subs].sort((a, b) => rank(a) - rank(b))[0];
  if (best === undefined || rank(best) === 9) return { ok: false, reason: "유니코드 cmap(형식 4·12)이 없습니다" };
  let glyph: (cp: number) => number;
  const o = best.off;
  if (best.format === 12) {
    const groups = u32(o + 12);
    glyph = (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = o + 16 + mid * 12;
        const start = u32(g);
        const end = u32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else {
          const gid = u32(g + 8) + (cp - start);
          return gid < numGlyphs ? gid : 0;
        }
      }
      return 0;
    };
  } else {
    const segX2 = u16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    glyph = (cp) => {
      if (cp > 0xffff) return 0;
      let lo = 0;
      let hi = segX2 / 2 - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const end = u16(ends + mid * 2);
        const start = u16(starts + mid * 2);
        if (cp > end) lo = mid + 1;
        else if (cp < start) hi = mid - 1;
        else {
          const delta = i16(deltas + mid * 2);
          const ro = u16(ranges + mid * 2);
          let gid: number;
          if (ro === 0) gid = (cp + delta) & 0xffff;
          else {
            const at = ranges + mid * 2 + ro + (cp - start) * 2;
            const g = u16(at);
            gid = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          return gid < numGlyphs ? gid : 0;
        }
      }
      return 0;
    };
  }

  return { ok: true, font: { units_per_em: upem, num_glyphs: numGlyphs, family: familyName(tables.get("name"), dv), glyph, advance } };
}

/** name 표: 윈도우 유니코드(3,1) UTF-16BE, ID 16(typographic family) 우선, 없으면 1. 언어는 0x409(영어) 우선. */
function familyName(t: Table | undefined, dv: DataView): string {
  if (t === undefined) return "";
  const count = dv.getUint16(t.off + 2);
  const strOff = t.off + dv.getUint16(t.off + 4);
  let best: { score: number; s: string } | null = null;
  for (let i = 0; i < count; i++) {
    const r = t.off + 6 + i * 12;
    const pid = dv.getUint16(r);
    const eid = dv.getUint16(r + 2);
    const lang = dv.getUint16(r + 4);
    const id = dv.getUint16(r + 6);
    const len = dv.getUint16(r + 8);
    const off = dv.getUint16(r + 10);
    if (pid !== 3 || eid !== 1 || (id !== 1 && id !== 16)) continue;
    let s = "";
    for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(dv.getUint16(strOff + off + j));
    const score = (id === 16 ? 2 : 0) + (lang === 0x409 ? 1 : 0);
    if (best === null || score > best.score) best = { score, s };
  }
  return best?.s ?? "";
}
