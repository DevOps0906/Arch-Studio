// ASCII DXF 파서: 그룹 코드/값 쌍을 줄 단위로 스트리밍(문자열 전체를 줄 배열로 쪼개지 않는다).
// 섹션 HEADER(INSUNITS·MEASUREMENT)·TABLES(LAYER)·BLOCKS·ENTITIES만 해석하고 나머지는 건너뛴다.
// 지원 엔티티: LINE·LWPOLYLINE·POLYLINE(+VERTEX)·ARC·CIRCLE·INSERT. TEXT·MTEXT·ATTRIB·ATTDEF는 의도적으로 무시(주석),
// 그 밖의 종류는 SKIP으로 기록해 펼침 단계에서 AR054 요약에 센다. 기하 변환·단위 환산은 여기서 하지 않는다(원시 도면 단위).
import { DxfFail } from "./errors.ts";
import { MAX_NAME_LENGTH, type DxfImportLimits } from "./limits.ts";
import { decodeDxfEscapes } from "./text.ts";

export interface BaseEnt {
  layer: string;
}
export interface LineEnt extends BaseEnt {
  k: "LINE";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface PolyEnt extends BaseEnt {
  k: "PL";
  closed: boolean;
  /** x, y, bulge 3개씩. */
  v: number[];
  /** 압출 방향 z<0이면 OCS x 반전. */
  mirror: boolean;
}
export interface ArcEnt extends BaseEnt {
  k: "ARC";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  mirror: boolean;
}
export interface CircleEnt extends BaseEnt {
  k: "CIRCLE";
  cx: number;
  cy: number;
  r: number;
  mirror: boolean;
}
export interface InsertEnt extends BaseEnt {
  k: "INSERT";
  block: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  rot: number;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
}
export interface AnnoEnt extends BaseEnt {
  k: "ANNO";
}
export interface SkipEnt extends BaseEnt {
  k: "SKIP";
  name: string;
}
export type Ent = LineEnt | PolyEnt | ArcEnt | CircleEnt | InsertEnt | AnnoEnt | SkipEnt;

export interface BlockDef {
  name: string;
  bx: number;
  by: number;
  ents: Ent[];
}

export interface DxfDoc {
  insunits: number | null;
  measurement: number | null;
  /** 대문자 레이어 이름 → 숨김(동결·꺼짐) 여부. */
  hiddenLayers: Set<string>;
  blocks: Map<string, BlockDef>;
  entities: Ent[];
  entityCount: number;
  paperSpace: number;
}

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

class Reader {
  code = 0;
  val = "";
  line = 0;
  private pos = 0;
  private readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  /** 다음 쌍을 읽는다. 텍스트 끝이면 DXF_TRUNCATED(EOF 표지 전에 끊김). */
  next(): void {
    const s = this.s;
    const n = s.length;
    if (this.pos >= n) throw new DxfFail("DXF_TRUNCATED", "파일이 중간에 끊겼습니다(EOF 표지 없음)", { line: this.line + 1 });
    // 그룹 코드 줄
    let e = s.indexOf("\n", this.pos);
    if (e < 0) e = n;
    this.line++;
    this.code = parseCode(s, this.pos, e, this.line);
    if (e >= n) throw new DxfFail("DXF_TRUNCATED", "그룹 코드 뒤에 값이 없습니다", { line: this.line + 1 });
    this.pos = e + 1;
    // 값 줄
    let e2 = s.indexOf("\n", this.pos);
    if (e2 < 0) e2 = n;
    this.line++;
    let end = e2;
    if (end > this.pos && s.charCodeAt(end - 1) === 13) end--;
    this.val = s.substring(this.pos, end);
    this.pos = e2 < n ? e2 + 1 : n;
  }

  fail(msg: string): never {
    throw new DxfFail("DXF_MALFORMED", msg, { line: this.line });
  }

  /** 현재 값을 실수로(유한하지 않으면 오류). */
  num(): number {
    const t = this.val.trim();
    if (!NUM_RE.test(t)) this.fail("숫자 값이 올바르지 않습니다");
    const v = Number(t);
    if (!Number.isFinite(v)) this.fail("숫자 값이 범위를 벗어났습니다");
    return v;
  }

  int(): number {
    return Math.trunc(this.num());
  }

  str(): string {
    const t = decodeDxfEscapes(this.val.trim());
    return t.length > MAX_NAME_LENGTH ? t.slice(0, MAX_NAME_LENGTH) : t;
  }
}

function parseCode(s: string, a: number, b: number, line: number): number {
  let i = a;
  let end = b;
  if (end > i && s.charCodeAt(end - 1) === 13) end--;
  while (i < end && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  while (end > i && (s.charCodeAt(end - 1) === 32 || s.charCodeAt(end - 1) === 9)) end--;
  let neg = false;
  if (i < end && s.charCodeAt(i) === 45) {
    neg = true;
    i++;
  }
  if (i >= end || end - i > 5) throw new DxfFail("DXF_MALFORMED", "그룹 코드가 올바르지 않습니다", { line });
  let v = 0;
  for (; i < end; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) throw new DxfFail("DXF_MALFORMED", "그룹 코드가 숫자가 아닙니다", { line });
    v = v * 10 + c;
  }
  v = neg ? -v : v;
  if (v < -5 || v > 1071) throw new DxfFail("DXF_MALFORMED", "그룹 코드가 범위(−5~1071) 밖입니다", { line });
  return v;
}

const ANNOTATION = new Set(["TEXT", "MTEXT", "ATTRIB", "ATTDEF"]);

/** 텍스트에서 DXF 구조를 읽는다. 구조 오류는 DxfFail. */
export function parseDxf(text: string, limits: DxfImportLimits): DxfDoc {
  if (text.trim() === "") throw new DxfFail("DXF_MALFORMED", "빈 파일입니다");
  const r = new Reader(text);
  const doc: DxfDoc = {
    insunits: null,
    measurement: null,
    hiddenLayers: new Set(),
    blocks: new Map(),
    entities: [],
    entityCount: 0,
    paperSpace: 0,
  };
  let vertexBudget = limits.max_total_vertices;

  const countEntity = (): void => {
    doc.entityCount++;
    if (doc.entityCount > limits.max_entities) {
      throw new DxfFail("DXF_TOO_MANY_ENTITIES", `엔티티가 ${limits.max_entities}개를 넘습니다`, { limit: limits.max_entities });
    }
  };
  const spendVertex = (): void => {
    if (--vertexBudget < 0) {
      throw new DxfFail("DXF_TOO_MANY_ENTITIES", `꼭짓점이 ${limits.max_total_vertices}개를 넘습니다`, { limit: limits.max_total_vertices });
    }
  };

  // ---- 엔티티 하나 읽기. 시작: 현재 쌍이 (0, TYPE). 끝: 현재 쌍이 다음 (0, …) ----
  const readEntity = (type: string, out: Ent[]): void => {
    let layer = "0";
    let paper = false;
    let nz = 0;
    const common = (): boolean => {
      if (r.code === 8) layer = r.str();
      else if (r.code === 67) paper = r.int() === 1;
      else if (r.code === 230) nz = r.num();
      else return false;
      return true;
    };
    const push = (e: Ent): void => {
      if (paper) doc.paperSpace++;
      else out.push(e);
    };
    const mirror = (): boolean => nz < 0;

    switch (type) {
      case "LINE": {
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (common()) continue;
          if (r.code === 10) x1 = r.num();
          else if (r.code === 20) y1 = r.num();
          else if (r.code === 11) x2 = r.num();
          else if (r.code === 21) y2 = r.num();
        }
        push({ k: "LINE", layer, x1, y1, x2, y2 });
        return;
      }
      case "LWPOLYLINE": {
        const v: number[] = [];
        let flags = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (common()) continue;
          if (r.code === 70) flags = r.int();
          else if (r.code === 10) {
            spendVertex();
            v.push(r.num(), 0, 0);
          } else if (r.code === 20) {
            if (v.length >= 3) v[v.length - 2] = r.num();
          } else if (r.code === 42) {
            if (v.length >= 3) v[v.length - 1] = r.num();
          }
        }
        push({ k: "PL", layer, closed: (flags & 1) === 1, v, mirror: mirror() });
        return;
      }
      case "POLYLINE": {
        let flags = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (common()) continue;
          if (r.code === 70) flags = r.int();
        }
        const v: number[] = [];
        // VERTEX … SEQEND
        for (;;) {
          const t = r.val.trim().toUpperCase();
          if (t === "VERTEX") {
            let vf = 0, x = 0, y = 0, b = 0;
            for (;;) {
              r.next();
              if (r.code === 0) break;
              if (r.code === 70) vf = r.int();
              else if (r.code === 10) x = r.num();
              else if (r.code === 20) y = r.num();
              else if (r.code === 42) b = r.num();
            }
            // 곡선맞춤 보조점(1)·스플라인 점(8)·제어점(16)·면 레코드(128)는 형상이 아니다
            if ((vf & (1 | 8 | 16 | 128)) === 0) {
              spendVertex();
              v.push(x, y, b);
            }
          } else if (t === "SEQEND") {
            for (;;) {
              r.next();
              if (r.code === 0) break;
            }
            break;
          } else break; // SEQEND 없이 끝남 — 관대하게 마무리
        }
        if ((flags & (2 | 4 | 16 | 64)) !== 0) {
          // 곡선맞춤·스플라인맞춤·3D 메시·폴리페이스: 근사하면 형상이 달라지므로 지원하지 않는다
          push({ k: "SKIP", layer, name: (flags & (16 | 64)) !== 0 ? "POLYLINE(메시)" : "POLYLINE(곡선맞춤)" });
        } else push({ k: "PL", layer, closed: (flags & 1) === 1, v, mirror: mirror() });
        return;
      }
      case "ARC": {
        let cx = 0, cy = 0, rr = 0, a0 = 0, a1 = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (common()) continue;
          if (r.code === 10) cx = r.num();
          else if (r.code === 20) cy = r.num();
          else if (r.code === 40) rr = r.num();
          else if (r.code === 50) a0 = r.num();
          else if (r.code === 51) a1 = r.num();
        }
        push({ k: "ARC", layer, cx, cy, r: rr, a0, a1, mirror: mirror() });
        return;
      }
      case "CIRCLE": {
        let cx = 0, cy = 0, rr = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (common()) continue;
          if (r.code === 10) cx = r.num();
          else if (r.code === 20) cy = r.num();
          else if (r.code === 40) rr = r.num();
        }
        push({ k: "CIRCLE", layer, cx, cy, r: rr, mirror: mirror() });
        return;
      }
      case "INSERT": {
        let block = "";
        let x = 0, y = 0, sx = 1, sy = 1, rot = 0, cols = 1, rows = 1, dx = 0, dy = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (common()) continue;
          if (r.code === 2) block = r.str();
          else if (r.code === 10) x = r.num();
          else if (r.code === 20) y = r.num();
          else if (r.code === 41) sx = r.num();
          else if (r.code === 42) sy = r.num();
          else if (r.code === 50) rot = r.num();
          else if (r.code === 70) cols = r.int();
          else if (r.code === 71) rows = r.int();
          else if (r.code === 44) dx = r.num();
          else if (r.code === 45) dy = r.num();
        }
        push({ k: "INSERT", layer, block, x, y, sx, sy, rot, cols, rows, dx, dy });
        return;
      }
      default: {
        for (;;) {
          r.next();
          if (r.code === 0) break;
          common();
        }
        if (ANNOTATION.has(type)) push({ k: "ANNO", layer });
        else push({ k: "SKIP", layer, name: sanitizeKind(type) });
      }
    }
  };

  // ---- 엔티티 목록: 현재 쌍이 (0, …). 끝 표지(ENDSEC·ENDBLK)에서 멈춘다(현재 쌍 = 그 표지) ----
  const readEntities = (out: Ent[]): string => {
    for (;;) {
      if (r.code !== 0) {
        r.next(); // 엉뚱한 쌍은 건너뛴다
        continue;
      }
      const type = r.val.trim().toUpperCase();
      if (type === "ENDSEC" || type === "ENDBLK") return type;
      if (type === "EOF") throw new DxfFail("DXF_TRUNCATED", "섹션이 닫히기 전에 파일이 끝났습니다", { line: r.line });
      if (type === "SEQEND" || type === "VERTEX") {
        for (;;) {
          r.next();
          if (r.code === 0) break;
        }
        continue;
      }
      countEntity();
      readEntity(type, out);
    }
  };

  // ---- 최상위 ----
  do r.next();
  while (r.code === 999);
  if (!(r.code === 0 && r.val.trim() === "SECTION")) r.fail("DXF 헤더가 아닙니다(첫 쌍이 0/SECTION이 아님)");

  for (;;) {
    // 현재 (0, SECTION)
    r.next();
    if (r.code !== 2) r.fail("섹션 이름(그룹 코드 2)이 없습니다");
    const name = r.val.trim().toUpperCase();
    r.next();
    if (name === "HEADER") {
      let cur = "";
      while (!(r.code === 0)) {
        if (r.code === 9) cur = r.val.trim().toUpperCase();
        else if (r.code === 70 && cur === "$INSUNITS") doc.insunits = r.int();
        else if (r.code === 70 && cur === "$MEASUREMENT") doc.measurement = r.int();
        r.next();
      }
    } else if (name === "TABLES") {
      let inLayer = false;
      let lname = "";
      let lflags = 0;
      let lcolor = 7;
      const fin = (): void => {
        if (inLayer && (((lflags & 1) === 1) || lcolor < 0)) doc.hiddenLayers.add(lname.toUpperCase());
        inLayer = false;
      };
      for (;;) {
        if (r.code === 0) {
          fin();
          const t = r.val.trim().toUpperCase();
          if (t === "ENDSEC") break;
          if (t === "EOF") throw new DxfFail("DXF_TRUNCATED", "섹션이 닫히기 전에 파일이 끝났습니다", { line: r.line });
          if (t === "LAYER") {
            inLayer = true;
            lname = "0";
            lflags = 0;
            lcolor = 7;
          }
        } else if (inLayer) {
          if (r.code === 2) lname = r.str();
          else if (r.code === 70) lflags = r.int();
          else if (r.code === 62) lcolor = r.int();
        }
        r.next();
      }
    } else if (name === "BLOCKS") {
      for (;;) {
        // 현재 (0, BLOCK) 또는 (0, ENDSEC)
        const t = r.val.trim().toUpperCase();
        if (r.code !== 0) {
          r.next();
          continue;
        }
        if (t === "ENDSEC") break;
        if (t === "EOF") throw new DxfFail("DXF_TRUNCATED", "섹션이 닫히기 전에 파일이 끝났습니다", { line: r.line });
        if (t !== "BLOCK") {
          r.next();
          continue;
        }
        let bname = "";
        let bx = 0, by = 0;
        for (;;) {
          r.next();
          if (r.code === 0) break;
          if (r.code === 2 && bname === "") bname = r.str();
          else if (r.code === 10) bx = r.num();
          else if (r.code === 20) by = r.num();
        }
        const ents: Ent[] = [];
        const endName = readEntities(ents);
        const key = bname.toUpperCase();
        if (!doc.blocks.has(key)) doc.blocks.set(key, { name: bname, bx, by, ents });
        if (endName === "ENDSEC") break; // ENDBLK 없이 섹션이 닫힘
        r.next(); // ENDBLK 속성은 아래 루프가 건너뛴다
        while (r.code !== 0) r.next();
      }
    } else if (name === "ENTITIES") {
      readEntities(doc.entities);
    } else {
      // CLASSES·OBJECTS·THUMBNAILIMAGE 등: ENDSEC까지 건너뜀
      for (;;) {
        if (r.code === 0) {
          const t = r.val.trim().toUpperCase();
          if (t === "ENDSEC") break;
          if (t === "EOF") throw new DxfFail("DXF_TRUNCATED", "섹션이 닫히기 전에 파일이 끝났습니다", { line: r.line });
        }
        r.next();
      }
    }
    // 현재 (0, ENDSEC)
    if (r.code !== 0 || r.val.trim().toUpperCase() !== "ENDSEC") r.fail("섹션이 ENDSEC로 닫히지 않았습니다");
    r.next();
    if (r.code !== 0) r.fail("ENDSEC 뒤에 SECTION 또는 EOF가 와야 합니다");
    const t = r.val.trim().toUpperCase();
    if (t === "EOF") return doc;
    if (t !== "SECTION") r.fail("ENDSEC 뒤에 SECTION 또는 EOF가 와야 합니다");
  }
}

/** 미지원 종류 이름: 영문 대문자·숫자·밑줄·괄호 한글만, 32자 제한. 요약 키에 쓰므로 깨끗하게. */
function sanitizeKind(t: string): string {
  const s = t.replace(/[^A-Z0-9_()가-힣]/g, "?").slice(0, 32);
  return s === "" ? "?" : s;
}
