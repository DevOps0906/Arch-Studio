// 엔티티를 펼쳐 "체인"(꼭짓점 열)으로 만든다: INSERT 블록 펼침(회전·배율·배열), 호·원·불룩(bulge) 근사.
// 변환은 부모 행렬과 로컬 행렬을 합성해 원래 좌표에 한 번만 적용한다(부동소수 누적 최소화).
// 삼각함수는 trig.ts(사칙연산만), 불룩은 이등분 재귀(제곱근만)라 모든 엔진에서 같은 결과가 나온다.
import { DxfFail } from "./errors.ts";
import { ARC_STEP_DEG, BULGE_FLAT, BULGE_MAX_DEPTH, MAX_INSERT_ARRAY, MAX_SKIP_KINDS, type DxfImportLimits } from "./limits.ts";
import type { DxfDoc, Ent } from "./parse.ts";
import { sinCosDeg } from "./trig.ts";

/** 아핀 변환: x' = a·x + c·y + e, y' = b·x + d·y + f. */
interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function compose(p: Mat, m: Mat): Mat {
  return {
    a: p.a * m.a + p.c * m.b,
    b: p.b * m.a + p.d * m.b,
    c: p.a * m.c + p.c * m.d,
    d: p.b * m.c + p.d * m.d,
    e: p.a * m.e + p.c * m.f + p.e,
    f: p.b * m.e + p.d * m.f + p.f,
  };
}

export interface FlatResult {
  xs: Float64Array;
  ys: Float64Array;
  /** 체인별: 시작 인덱스, 점 개수, 레이어 번호, 닫힘 여부. */
  start: number[];
  len: number[];
  layer: number[];
  closed: boolean[];
  /** 원(CIRCLE)에서 온 체인인지. */
  circle: boolean[];
  layerNames: string[];
  skipped: Record<string, number>;
  expanded: number;
  hiddenLayerEntities: number;
  ignoredAnnotations: number;
  vertices: number;
}

const CIRCLE_N = 360 / ARC_STEP_DEG;
let circleTable: Array<[number, number]> | null = null;
function circlePts(): Array<[number, number]> {
  if (circleTable === null) {
    circleTable = [];
    for (let i = 0; i < CIRCLE_N; i++) circleTable.push(sinCosDeg(i * ARC_STEP_DEG));
  }
  return circleTable;
}

export function flatten(doc: DxfDoc, limits: DxfImportLimits): FlatResult {
  let cap = 1024;
  let xs = new Float64Array(cap);
  let ys = new Float64Array(cap);
  let n = 0;
  const start: number[] = [];
  const len: number[] = [];
  const layer: number[] = [];
  const closed: boolean[] = [];
  const circle: boolean[] = [];
  const layerIds = new Map<string, number>();
  const layerNames: string[] = [];
  const skippedRaw = new Map<string, number>();
  let expanded = 0;
  let hidden = 0;
  let annos = 0;

  const layerId = (name: string): number => {
    let id = layerIds.get(name);
    if (id === undefined) {
      id = layerNames.length;
      layerIds.set(name, id);
      layerNames.push(name);
    }
    return id;
  };
  const skip = (name: string): void => {
    skippedRaw.set(name, (skippedRaw.get(name) ?? 0) + 1);
  };

  // ---- 체인 작성 ----
  let curStart = 0;
  const beginChain = (): void => {
    curStart = n;
  };
  const addPt = (m: Mat, x: number, y: number): void => {
    if (n >= limits.max_total_vertices) {
      throw new DxfFail("DXF_TOO_MANY_ENTITIES", `꼭짓점이 ${limits.max_total_vertices}개를 넘습니다`, { limit: limits.max_total_vertices });
    }
    if (n >= cap) {
      cap = Math.min(cap * 2, limits.max_total_vertices);
      const nx = new Float64Array(cap);
      nx.set(xs);
      xs = nx;
      const ny = new Float64Array(cap);
      ny.set(ys);
      ys = ny;
    }
    xs[n] = m.a * x + m.c * y + m.e;
    ys[n] = m.b * x + m.d * y + m.f;
    n++;
  };
  const endChain = (lay: number, isClosed: boolean, isCircle: boolean): void => {
    const count = n - curStart;
    if (count < 2) {
      n = curStart;
      return;
    }
    start.push(curStart);
    len.push(count);
    layer.push(lay);
    closed.push(isClosed);
    circle.push(isCircle);
  };

  /** (x0,y0)→(x1,y1) 불룩 호의 중간 점들과 끝점을 추가(시작점 제외). 이등분 재귀. */
  const bulgeSeg = (m: Mat, mir: boolean, x0: number, y0: number, x1: number, y1: number, b: number, depth: number): void => {
    if (depth >= BULGE_MAX_DEPTH || Math.abs(b) <= BULGE_FLAT || !Number.isFinite(b)) {
      addPt(m, mir ? -x1 : x1, y1);
      return;
    }
    const dx = x1 - x0;
    const dy = y1 - y0;
    // 호의 중점: 현 중점에서 오른쪽 법선 방향으로 b·c/2 (양의 불룩 = 반시계 호)
    const mx = (x0 + x1) / 2 + (dy * b) / 2;
    const my = (y0 + y1) / 2 - (dx * b) / 2;
    const bh = b / (1 + Math.sqrt(1 + b * b)); // tan(θ/8) = tan(θ/4)/(1+√(1+tan²(θ/4)))
    bulgeSeg(m, mir, x0, y0, mx, my, bh, depth + 1);
    bulgeSeg(m, mir, mx, my, x1, y1, bh, depth + 1);
  };

  const walk = (ents: Ent[], m: Mat, depth: number, stack: string[], inherited: string): void => {
    for (const e of ents) {
      expanded++;
      if (expanded > limits.max_expanded_entities) {
        throw new DxfFail("DXF_TOO_MANY_ENTITIES", `블록을 펼친 엔티티가 ${limits.max_expanded_entities}개를 넘습니다`, {
          limit: limits.max_expanded_entities,
        });
      }
      const eff = e.layer === "0" ? inherited : e.layer;
      if (doc.hiddenLayers.has(eff.toUpperCase())) {
        hidden++;
        continue;
      }
      switch (e.k) {
        case "ANNO":
          annos++;
          break;
        case "SKIP":
          skip(e.name);
          break;
        case "LINE": {
          beginChain();
          addPt(m, e.x1, e.y1);
          addPt(m, e.x2, e.y2);
          endChain(layerId(eff), false, false);
          break;
        }
        case "PL": {
          const cnt = e.v.length / 3;
          if (cnt < 2) break;
          beginChain();
          const mir = e.mirror;
          const px = (i: number): number => (e.v[i * 3] as number) * (mir ? -1 : 1);
          addPt(m, px(0), e.v[1] as number);
          for (let i = 0; i + 1 < cnt; i++) {
            bulgeSeg(m, false, px(i), e.v[i * 3 + 1] as number, px(i + 1), e.v[(i + 1) * 3 + 1] as number, (e.v[i * 3 + 2] as number) * (mir ? -1 : 1), 0);
          }
          if (e.closed) {
            const last = cnt - 1;
            // 닫는 변: 마지막 → 첫 꼭짓점(불룩이 있으면 호). 끝점이 첫 점과 같아지므로 마지막에 중복 점을 뺀다.
            bulgeSeg(m, false, px(last), e.v[last * 3 + 1] as number, px(0), e.v[1] as number, (e.v[last * 3 + 2] as number) * (mir ? -1 : 1), 0);
            n--; // 닫는 점(첫 점과 동일) 제거
          }
          endChain(layerId(eff), e.closed, false);
          break;
        }
        case "CIRCLE": {
          if (!(e.r > 0)) break;
          beginChain();
          for (const [s, c] of circlePts()) addPt(m, e.cx + (e.mirror ? -1 : 1) * e.r * c, e.cy + e.r * s);
          endChain(layerId(eff), true, true);
          break;
        }
        case "ARC": {
          if (!(e.r > 0)) break;
          let sweep = e.a1 - e.a0;
          sweep -= 360 * Math.floor(sweep / 360);
          if (sweep === 0) sweep = 360;
          const steps = Math.max(1, Math.ceil(sweep / ARC_STEP_DEG));
          beginChain();
          for (let i = 0; i <= steps; i++) {
            const ang = i === steps ? e.a0 + sweep : e.a0 + (sweep * i) / steps;
            const [s, c] = sinCosDeg(ang);
            addPt(m, e.cx + (e.mirror ? -1 : 1) * e.r * c, e.cy + e.r * s);
          }
          endChain(layerId(eff), false, false);
          break;
        }
        case "INSERT": {
          const key = e.block.toUpperCase();
          const def = doc.blocks.get(key);
          if (def === undefined) {
            skip("INSERT(블록 정의 없음)");
            break;
          }
          if (stack.includes(key)) {
            throw new DxfFail("DXF_CIRCULAR_BLOCK", "블록이 자기 자신을 (간접적으로) 포함합니다");
          }
          if (depth + 1 > limits.max_insert_depth) {
            throw new DxfFail("DXF_NESTING_TOO_DEEP", `블록 중첩이 ${limits.max_insert_depth}단계를 넘습니다`, { limit: limits.max_insert_depth });
          }
          const cols = e.cols >= 1 ? e.cols : 1;
          const rows = e.rows >= 1 ? e.rows : 1;
          if (cols * rows > MAX_INSERT_ARRAY) {
            throw new DxfFail("DXF_TOO_MANY_ENTITIES", `배열 삽입이 ${MAX_INSERT_ARRAY}개를 넘습니다`, { limit: MAX_INSERT_ARRAY });
          }
          const [s, c] = sinCosDeg(e.rot);
          const a = c * e.sx;
          const b = s * e.sx;
          const cc = -s * e.sy;
          const d = c * e.sy;
          const nextStack = [...stack, key];
          for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
              const ox = i * e.dx;
              const oy = j * e.dy;
              const local: Mat = {
                a,
                b,
                c: cc,
                d,
                e: e.x + (c * ox - s * oy) - (a * def.bx + cc * def.by),
                f: e.y + (s * ox + c * oy) - (b * def.bx + d * def.by),
              };
              walk(def.ents, compose(m, local), depth + 1, nextStack, eff);
            }
          }
          break;
        }
      }
    }
  };

  walk(doc.entities, IDENTITY, 0, [], "0");

  // 미지원 종류 요약: 이름 사전순, 종류 상한 초과분은 "기타"로 합친다
  const skipped: Record<string, number> = {};
  const names = [...skippedRaw.keys()].sort();
  let other = 0;
  names.forEach((k, i) => {
    const v = skippedRaw.get(k) as number;
    if (i < MAX_SKIP_KINDS) skipped[k] = v;
    else other += v;
  });
  if (other > 0) skipped["기타"] = other;

  return { xs, ys, start, len, layer, closed, circle, layerNames, skipped, expanded, hiddenLayerEntities: hidden, ignoredAnnotations: annos, vertices: n };
}
