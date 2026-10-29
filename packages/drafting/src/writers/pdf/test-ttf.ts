// 테스트 전용: 메모리에서 만드는 최소 TrueType(글리프 윤곽 없음). 파서·폭 표 시험용이고 jsPDF 임베드에는 쓰지 않는다.
// 글리프: 0 .notdef(500), 1 'A'(600), 2 'B'(600), 3 공백(250), 4 '가'(1000), 5 '각'(1000), 6 U+1D400(hmtx 공유 → 1000).
// cmap 형식 4: ' '→3, '0'→2·'1'→0(idRangeOffset 경로), 'A'·'B'→1·2, '가'·'각'→4·5. 형식 12(선택): 위 + U+1D400→6.

class W {
  private b: number[] = [];
  u8(v: number) {
    this.b.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number) {
    return this.u16(v & 0xffff);
  }
  u32(v: number) {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff);
  }
  bytes(a: ArrayLike<number>) {
    for (let i = 0; i < a.length; i++) this.u8(a[i] as number);
    return this;
  }
  get length() {
    return this.b.length;
  }
  out() {
    return Uint8Array.from(this.b);
  }
}

function fmt4(): Uint8Array {
  const segs: Array<[number, number, number, number]> = [
    // [start, end, delta, idRangeOffset 사용]
    [0x20, 0x20, 3 - 0x20, 0],
    [0x30, 0x31, 0, 1],
    [0x41, 0x42, 1 - 0x41, 0],
    [0xac00, 0xac01, 4 - 0xac00, 0],
    [0xffff, 0xffff, 1, 0],
  ];
  const n = segs.length;
  const glyphIds = [2, 0];
  const w = new W();
  const len = 16 + n * 8 + glyphIds.length * 2;
  w.u16(4).u16(len).u16(0).u16(n * 2).u16(8).u16(2).u16(2);
  for (const s of segs) w.u16(s[1]);
  w.u16(0);
  for (const s of segs) w.u16(s[0]);
  for (const s of segs) w.i16(s[2]);
  segs.forEach((s, i) => w.u16(s[3] ? (n - i) * 2 : 0));
  for (const g of glyphIds) w.u16(g);
  return w.out();
}

function fmt12(): Uint8Array {
  const groups: Array<[number, number, number]> = [
    [0x20, 0x20, 3],
    [0x41, 0x42, 1],
    [0xac00, 0xac01, 4],
    [0x1d400, 0x1d400, 6],
  ];
  const w = new W();
  w.u16(12).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
  for (const g of groups) w.u32(g[0]).u32(g[1]).u32(g[2]);
  return w.out();
}

export function buildTestTtf(opts: { format12?: boolean; family?: string; tag?: number } = {}): Uint8Array {
  const head = new W();
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0).u16(1000);
  while (head.length < 54) head.u8(0);
  const hhea = new W();
  hhea.u32(0x00010000);
  while (hhea.length < 34) hhea.u8(0);
  hhea.u16(6);
  const maxp = new W().u32(0x00005000).u16(7);
  const hmtx = new W();
  for (const a of [500, 600, 600, 250, 1000, 1000]) hmtx.u16(a).i16(0);
  hmtx.i16(0);
  const subs: Array<[number, number, Uint8Array]> = [[3, 1, fmt4()]];
  if (opts.format12) subs.push([3, 10, fmt12()]);
  const cmap = new W().u16(0).u16(subs.length);
  let off = 4 + subs.length * 8;
  for (const [pid, eid, body] of subs) {
    cmap.u16(pid).u16(eid).u32(off);
    off += body.length;
  }
  for (const [, , body] of subs) cmap.bytes(body);
  const fam = opts.family ?? "Test Sans";
  const name = new W().u16(0).u16(1).u16(18).u16(3).u16(1).u16(0x409).u16(1).u16(fam.length * 2).u16(0);
  for (let i = 0; i < fam.length; i++) name.u16(fam.charCodeAt(i));

  const tables: Array<[string, Uint8Array]> = [
    ["cmap", cmap.out()],
    ["glyf", new Uint8Array(0)],
    ["head", head.out()],
    ["hhea", hhea.out()],
    ["hmtx", hmtx.out()],
    ["maxp", maxp.out()],
    ["name", name.out()],
  ];
  const w = new W();
  w.u32(opts.tag ?? 0x00010000).u16(tables.length).u16(0).u16(0).u16(0);
  let at = 12 + tables.length * 16;
  const placed: Array<[number, Uint8Array]> = [];
  for (const [tag, body] of tables) {
    for (let i = 0; i < 4; i++) w.u8(tag.charCodeAt(i));
    w.u32(0).u32(at).u32(body.length);
    placed.push([at, body]);
    at += (body.length + 3) & ~3;
  }
  for (const [, body] of placed) {
    w.bytes(body);
    while (w.length % 4 !== 0) w.u8(0);
  }
  return w.out();
}
