// 평면 편집기 모델(순수): 층 목록, 층 실 배치 교체, layout 검사 결과(면적·목표 차이·AR051), 미배치 실 자동 자리 찾기, 저장용 직렬화.
// 면적·겹침·외곽 이탈은 @arch-studio/layout의 결정적 순수 함수가 정한다. 이 파일은 값을 다시 계산하지 않고 묶어서 보인다.
import { designModelV1Schema, type DesignModelV1, type Polygon } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import {
  createLayoutStateFrom,
  floorOutline,
  h100OfArea2,
  polygonArea2,
  prepareOutline,
  prepareRoom,
  roomOutside,
  roomsOverlap,
  type PreparedRoom,
  type FloorLayout,
  type LayoutIssue,
  type LayoutState,
  type ProgramTarget,
  type RoomAreaRow,
} from "@arch-studio/layout";
import { GRID_MM, rectPolygon, snapMm } from "./ops.ts";

export type Layouts = DesignModelV1["floor_layouts"];

export type ParsedModel = { ok: true; model: DesignModelV1 } | { ok: false };

export function parseDesignModel(json: string): ParsedModel {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  const r = designModelV1Schema.safeParse(raw);
  return r.success ? { ok: true, model: r.data } : { ok: false };
}

export interface FloorInfo {
  readonly id: string;
  readonly level: number;
  readonly label: string;
}

/** 층 이름: 1 → "1층", 0 → "0층", -1 → "지하 1층". */
export function floorLabel(level: number): string {
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}

/** 모델의 층 목록(매스 floors의 id 기준, level 오름차순, 같은 id는 한 번). */
export function floorsOf(model: Pick<DesignModelV1, "masses">): FloorInfo[] {
  const seen = new Map<string, FloorInfo>();
  for (const m of model.masses) for (const f of m.floors) if (!seen.has(f.id)) seen.set(f.id, { id: f.id, level: f.level, label: floorLabel(f.level) });
  return [...seen.values()].sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const emptyLayout = (floor_id: string): FloorLayout => ({ floor_id, rooms: [], openings: [] });

export function layoutOfFloor(layouts: Layouts, floor_id: string): FloorLayout {
  return layouts.find((l) => l.floor_id === floor_id) ?? emptyLayout(floor_id);
}

/** 그 층 배치를 바꾼 새 배열. 없던 층은 실이 생길 때만 덧붙인다(빈 배치를 저장 모델에 넣지 않는다). */
export function withFloorLayout(layouts: Layouts, layout: FloorLayout): Layouts {
  const has = layouts.some((l) => l.floor_id === layout.floor_id);
  if (has) return layouts.map((l) => (l.floor_id === layout.floor_id ? layout : l));
  return layout.rooms.length > 0 || layout.openings.length > 0 ? [...layouts, layout] : layouts;
}

export function withLayouts(model: DesignModelV1, layouts: Layouts): DesignModelV1 {
  return { ...model, floor_layouts: layouts };
}

// ---------- 검사·면적 ----------

export interface Analysis {
  readonly state: LayoutState;
  readonly rows: ReadonlyMap<string, RoomAreaRow>;
  readonly issues: readonly LayoutIssue[];
  /** 층 외곽(그 층 매스 합집합) 면적, ㎡ × 100. */
  readonly outlineH100: number;
  /** 실 면적 합, ㎡ × 100. */
  readonly totalH100: number;
  /** 면적표(program.targets)에 있으나 이 층에 같은 이름의 실이 없는 행. */
  readonly unplaced: readonly ProgramTarget[];
  /** AR051 실 id 집합(빗금 표시). */
  readonly badRooms: ReadonlySet<string>;
  readonly badOpenings: ReadonlySet<string>;
}

export function outlineOf(model: Pick<DesignModelV1, "masses">, floor_id: string): Polygon[] {
  return floorOutline(model, floor_id);
}

export function analyze(model: Pick<DesignModelV1, "program">, floor_id: string, outline: readonly Polygon[], layout: FloorLayout): Analysis {
  const state = createLayoutStateFrom(floor_id, outline, layout, model.program.targets);
  const rows = new Map(state.rows.map((r) => [r.room_id, r] as const));
  const names = new Set(layout.rooms.map((r) => r.name));
  const bad = new Set<string>();
  const badO = new Set<string>();
  for (const i of state.issues) {
    for (const id of i.room_ids) bad.add(id);
    for (const id of i.opening_ids ?? []) badO.add(id);
  }
  return {
    state,
    rows,
    issues: state.issues,
    outlineH100: state.outline.polys.reduce((s, p) => s + h100OfArea2(polygonArea2(p)), 0),
    totalH100: state.rows.reduce((s, r) => s + r.area_h100, 0),
    unplaced: model.program.targets.filter((t) => !names.has(t.name)),
    badRooms: bad,
    badOpenings: badO,
  };
}

/** AR051 문구(03장 5.2절 AR051 행). 실 이름만 넣고 좌표는 넣지 않는다. */
export function issueText(issue: LayoutIssue, layout: FloorLayout): string {
  const name = (id: string) => layout.rooms.find((r) => r.id === id)?.name ?? id;
  const names = issue.room_ids.map((id) => `‘${name(id)}’`);
  switch (issue.kind) {
    case "overlap":
      return `${names.join("와(과) ")}이(가) 서로 겹칩니다.`;
    case "outside":
      return `${names.join(", ")}이(가) 층 외곽 밖으로 나갔습니다.`;
    case "opening":
      return `문·창 위치가 벽을 벗어나거나 다른 문·창과 겹칩니다(${names.join(", ")}).`;
    default:
      return `${names.join(", ")}의 모양이나 번호가 올바르지 않습니다.`;
  }
}

/** 저장을 막는 이유 한 줄(없으면 null). 03장 3.7절: 겹침·이탈이 있으면 저장 버튼이 비활성이고 이유를 같은 줄에 적는다. */
export function saveBlocker(a: Analysis): string | null {
  return a.issues.length === 0 ? null : `저장 불가(AR051): 오류 ${a.issues.length}건을 고친 뒤 저장하세요.`;
}

// ---------- 미배치 실 놓기 ----------

/** 놓을 모양 후보: 가로:세로 비율(분자/분모). 앞 순서가 우선이다. 각 비율은 가로·세로를 바꾼 모양도 시도한다. */
const SLOT_RATIOS: readonly (readonly [number, number])[] = [
  [4, 3],
  [3, 2],
  [1, 1],
  [2, 1],
  [5, 2],
  [3, 1],
  [4, 1],
];

/**
 * 면적표 행을 층에 놓을 빈 자리를 결정적으로 찾는다: 목표 면적에 가까운 직사각형(SLOT_RATIOS 순서, 그리드 맞춤)을 외곽 상자 안에서
 * 왼쪽 아래부터 500mm 간격으로 훑어 겹침·이탈이 없는 첫 자리를 쓴다. 없으면 null. LLM·난수 없음 — 같은 입력이면 같은 자리.
 * 겹침·이탈 판정은 layout의 같은 순수 함수(roomsOverlap·roomOutside)다.
 */
export function findSlot(_floor_id: string, outline: readonly Polygon[], layout: FloorLayout, target_area_m2: number, newId: string): Polygon | null {
  const mm2 = target_area_m2 * 1_000_000;
  if (!(mm2 >= 1_000_000)) return null;
  const o = prepareOutline(outline);
  const others: PreparedRoom[] = [];
  for (const r of layout.rooms) {
    const p = prepareRoom(r);
    if (!("error" in p)) others.push(p);
  }
  const xs = outline.flatMap((p) => p.outer.map((q) => q[0]));
  const ys = outline.flatMap((p) => p.outer.map((q) => q[1]));
  if (xs.length === 0) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const STEP = 500;
  for (const [rn, rd] of SLOT_RATIOS) {
    const w = Math.max(GRID_MM, snapMm(Math.sqrt((mm2 * rn) / rd)));
    const h = Math.max(GRID_MM, snapMm(mm2 / w));
    for (const [cw, ch] of rn === rd ? ([[w, h]] as const) : ([[w, h], [h, w]] as const)) {
      for (let y = minY; y + ch <= maxY; y += STEP) {
        for (let x = minX; x + cw <= maxX; x += STEP) {
          const poly = rectPolygon(x, y, cw, ch);
          const p = prepareRoom({ id: newId, name: "", use: "", polygon: poly });
          if ("error" in p || roomOutside(p, o) || others.some((q) => roomsOverlap(p, q))) continue;
          return poly;
        }
      }
    }
  }
  return null;
}

/** 분 단위 아닌 정수 mm 입력 해석("1,200" · "1200" · "1200.4"→1200). 숫자가 아니면 null. */
export function parseMm(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = roundHalfAway(Number(t));
  return Number.isSafeInteger(n) ? n : null;
}
