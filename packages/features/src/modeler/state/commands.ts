// 모델 편집 명령(순수 함수): DesignModel v1 → DesignModel v1. 좌표·길이는 mm 정수만 받는다(LLM·난수·시간 없음).
// - 바뀐 매스만 새 객체로 만들고 나머지는 참조를 그대로 둔다(구조 공유 → 실행 취소 100단계 메모리, [DECISION] 1절).
// - 바뀐 것이 없으면 같은 모델 참조를 돌려준다(이력에 쌓지 않는다).
// - 잘못된 입력은 throw 대신 { ok: false, reason }(화면 문구, 한국어)으로 돌려준다.
import { MM_COORD_LIMIT, type DesignModelV1, type Point } from "@arch-studio/domain";
import { normalizePolygon, validatePolygon } from "@arch-studio/geometry";

export type Model = DesignModelV1;
export type Mass = Model["masses"][number];
export type Floor = Mass["floors"][number];
export type RoofType = Mass["roof"]["type"];

export const LIMITS = {
  /** 모델 하나의 매스 수(엔진 워커 MAX_MASSES와 같음). */
  masses: 200,
  /** 매스 하나의 지상 층 수(제안 — 소형 사무소 범위). */
  floors: 60,
  floorHeightMin: 1500,
  floorHeightMax: 10_000,
  /** 바닥 높이(지반 기준) 범위. */
  baseLevelMin: -30_000,
  baseLevelMax: 30_000,
  /** 꼭짓점 수(대지 상한과 같은 자릿수). */
  vertices: 400,
  useMaxLength: 40,
  pitchMax: 2,
} as const;

export const DEFAULT_FLOOR_HEIGHT = 3000;
export const DEFAULT_USE = "단독주택";
export const ROOF_TYPES: readonly RoofType[] = ["flat", "gable", "hip", "shed"];
export const ROOF_LABEL: Readonly<Record<RoofType, string>> = { flat: "평지붕", gable: "박공지붕", hip: "모임지붕", shed: "외쪽지붕" };

export type CommandResult = { readonly ok: true; readonly model: Model; readonly select?: string | null } | { readonly ok: false; readonly reason: string };

const ok = (model: Model, select?: string | null): CommandResult => (select === undefined ? { ok: true, model } : { ok: true, model, select });
const fail = (reason: string): CommandResult => ({ ok: false, reason });

const isMm = (v: number) => Number.isSafeInteger(v) && Math.abs(v) <= MM_COORD_LIMIT;

function findMass(model: Model, id: string): Mass | undefined {
  return model.masses.find((m) => m.id === id);
}

function replaceMass(model: Model, id: string, next: Mass): Model {
  return { ...model, masses: model.masses.map((m) => (m.id === id ? next : m)) };
}

/** 새 매스 id: 기존 `m-<n>` 최댓값 + 1(결정적, 난수 없음). */
export function nextMassId(model: Model): string {
  let n = 0;
  for (const m of model.masses) {
    const hit = /^m-(\d+)$/.exec(m.id);
    if (hit) n = Math.max(n, Number(hit[1]));
  }
  let id = `m-${n + 1}`;
  while (findMass(model, id)) id = `m-${++n + 1}`;
  return id;
}

function allFloorIds(model: Model): Set<string> {
  const s = new Set<string>();
  for (const m of model.masses) for (const f of m.floors) s.add(f.id);
  for (const l of model.floor_layouts) s.add(l.floor_id);
  return s;
}

/** 층 id: `<매스>-f<level>`. 모델 안에서 겹치면 `-2`, `-3`…을 붙인다. */
function floorId(taken: Set<string>, massId: string, level: number): string {
  let id = `${massId}-f${level}`;
  for (let k = 2; taken.has(id); k++) id = `${massId}-f${level}-${k}`;
  taken.add(id);
  return id;
}

/** 지상 층(level ≥ 1)을 level 순으로. */
export function sortedFloors(mass: Mass): Floor[] {
  return [...mass.floors].sort((a, b) => a.level - b.level);
}

export function massHeight(mass: Mass): number {
  return mass.floors.reduce((s, f) => s + f.height_mm, 0);
}

/** 층고가 모두 같으면 그 값, 다르면 null. */
export function uniformFloorHeight(mass: Mass): number | null {
  const h = mass.floors[0]?.height_mm;
  if (h === undefined) return null;
  return mass.floors.every((f) => f.height_mm === h) ? h : null;
}

export function footprintIssue(outer: readonly Point[]): string | null {
  if (outer.length < 3) return "바닥은 점 3개 이상이어야 합니다.";
  if (outer.length > LIMITS.vertices) return `바닥 꼭짓점은 ${LIMITS.vertices}개까지입니다.`;
  if (!outer.every(([x, y]) => isMm(x) && isMm(y))) return "좌표는 ±10km 안의 mm 정수여야 합니다.";
  const code = validatePolygon({ outer: outer as Point[] });
  if (code === "SELF_INTERSECTION") return "바닥 선이 서로 교차합니다.";
  if (code === "ZERO_AREA") return "바닥 면적이 0입니다.";
  if (code === "DUPLICATE_POINT") return "같은 점이 연달아 있습니다.";
  if (code !== null) return "바닥 모양을 쓸 수 없습니다.";
  return null;
}

function floorHeightIssue(h: number): string | null {
  if (!Number.isSafeInteger(h)) return "층고는 mm 정수로 넣으세요.";
  if (h < LIMITS.floorHeightMin || h > LIMITS.floorHeightMax) return `층고는 ${LIMITS.floorHeightMin.toLocaleString("ko-KR")}~${LIMITS.floorHeightMax.toLocaleString("ko-KR")}mm입니다.`;
  return null;
}

function floorCountIssue(n: number): string | null {
  if (!Number.isSafeInteger(n) || n < 1 || n > LIMITS.floors) return `층 수는 1~${LIMITS.floors}층입니다.`;
  return null;
}

function cleanUse(use: string): string | null {
  const v = use.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return v.length === 0 || v.length > LIMITS.useMaxLength ? null : v;
}

export interface AddMassInput {
  readonly outer: readonly Point[];
  readonly floors: number;
  readonly floorHeight: number;
  readonly use?: string;
  readonly baseLevel?: number;
}

/** 매스 추가. 바닥은 외곽 반시계로 정리한다(geometry normalizePolygon). 기본 용도는 첫 매스 1층 용도(없으면 단독주택). */
export function addMass(model: Model, input: AddMassInput): CommandResult {
  if (model.masses.length >= LIMITS.masses) return fail(`매스는 ${LIMITS.masses}개까지입니다.`);
  const issue = footprintIssue(input.outer) ?? floorCountIssue(input.floors) ?? floorHeightIssue(input.floorHeight);
  if (issue) return fail(issue);
  const base = input.baseLevel ?? 0;
  if (!Number.isSafeInteger(base) || base < LIMITS.baseLevelMin || base > LIMITS.baseLevelMax) return fail("바닥 높이가 범위를 벗어납니다.");
  const use = cleanUse(input.use ?? model.masses[0]?.floors[0]?.use ?? DEFAULT_USE) ?? DEFAULT_USE;
  const id = nextMassId(model);
  const taken = allFloorIds(model);
  const footprint = normalizePolygon({ outer: input.outer.map(([x, y]) => [x, y] as Point) });
  const mass: Mass = {
    id,
    footprint: { outer: footprint.outer },
    base_level_mm: base,
    floors: Array.from({ length: input.floors }, (_, i) => ({ id: floorId(taken, id, i + 1), level: i + 1, height_mm: input.floorHeight, use })),
    roof: { type: "flat" },
  };
  return ok({ ...model, masses: [...model.masses, mass] }, id);
}

/** 직사각형 바닥(x0,y0 모서리 + 폭·깊이). */
export function rectOuter(x: number, y: number, width: number, depth: number): Point[] {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + depth],
    [x, y + depth],
  ];
}

export function moveMass(model: Model, id: string, dx: number, dy: number): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) return fail("이동 거리는 mm 정수여야 합니다.");
  if (dx === 0 && dy === 0) return ok(model);
  const shift = (r: readonly Point[]): Point[] => r.map(([x, y]) => [x + dx, y + dy] as Point);
  const outer = shift(m.footprint.outer);
  const holes = m.footprint.holes?.map(shift);
  const all = [outer, ...(holes ?? [])].flat();
  if (!all.every(([x, y]) => isMm(x) && isMm(y))) return fail("좌표 범위(±10km)를 벗어납니다.");
  return ok(replaceMass(model, id, { ...m, footprint: holes ? { outer, holes } : { outer } }));
}

/** 층 수 변경: 늘리면 맨 위 층(층고·용도)을 복사해 쌓고, 줄이면 위에서부터 지운다(그 층의 평면 floor_layouts도 지운다). */
export function setFloorCount(model: Model, id: string, count: number): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  const issue = floorCountIssue(count);
  if (issue) return fail(issue);
  const floors = sortedFloors(m);
  if (count === floors.length) return ok(model);
  if (count > floors.length) {
    const top = floors[floors.length - 1];
    const taken = allFloorIds(model);
    const added: Floor[] = [];
    let level = top ? top.level : 0;
    for (let i = floors.length; i < count; i++) {
      level += 1;
      added.push({ id: floorId(taken, id, level), level, height_mm: top?.height_mm ?? DEFAULT_FLOOR_HEIGHT, use: top?.use ?? DEFAULT_USE });
    }
    return ok(replaceMass(model, id, { ...m, floors: [...floors, ...added] }));
  }
  const keep = floors.slice(0, count);
  const removed = new Set(floors.slice(count).map((f) => f.id));
  const next = replaceMass(model, id, { ...m, floors: keep });
  const layouts = model.floor_layouts.filter((l) => !removed.has(l.floor_id));
  return ok(layouts.length === model.floor_layouts.length ? next : { ...next, floor_layouts: layouts });
}

/** 층고 변경. floorId가 null이면 모든 층. */
export function setFloorHeight(model: Model, id: string, floorIdOrAll: string | null, height: number): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  const issue = floorHeightIssue(height);
  if (issue) return fail(issue);
  if (floorIdOrAll !== null && !m.floors.some((f) => f.id === floorIdOrAll)) return fail("층을 찾을 수 없습니다.");
  let changed = false;
  const floors = m.floors.map((f) => {
    if ((floorIdOrAll === null || f.id === floorIdOrAll) && f.height_mm !== height) {
      changed = true;
      return { ...f, height_mm: height };
    }
    return f;
  });
  return changed ? ok(replaceMass(model, id, { ...m, floors })) : ok(model);
}

/** 층 용도 변경. floorId가 null이면 모든 층. */
export function setFloorUse(model: Model, id: string, floorIdOrAll: string | null, use: string): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  const v = cleanUse(use);
  if (v === null) return fail(`용도는 1~${LIMITS.useMaxLength}자로 넣으세요.`);
  let changed = false;
  const floors = m.floors.map((f) => {
    if ((floorIdOrAll === null || f.id === floorIdOrAll) && f.use !== v) {
      changed = true;
      return { ...f, use: v };
    }
    return f;
  });
  return changed ? ok(replaceMass(model, id, { ...m, floors })) : ok(model);
}

export function setBaseLevel(model: Model, id: string, base: number): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  if (!Number.isSafeInteger(base) || base < LIMITS.baseLevelMin || base > LIMITS.baseLevelMax) {
    return fail(`바닥 높이는 ${LIMITS.baseLevelMin.toLocaleString("ko-KR")}~${LIMITS.baseLevelMax.toLocaleString("ko-KR")}mm입니다.`);
  }
  return base === m.base_level_mm ? ok(model) : ok(replaceMass(model, id, { ...m, base_level_mm: base }));
}

/** 지붕 종류·경사(DesignModel v1 roof). 평지붕은 경사를 지운다. 경사는 0~2(높이/거리 비, 제안). */
export function setRoof(model: Model, id: string, type: RoofType, pitch?: number): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  if (!ROOF_TYPES.includes(type)) return fail("지붕 종류를 고르세요.");
  if (pitch !== undefined && !(Number.isFinite(pitch) && pitch >= 0 && pitch <= LIMITS.pitchMax)) return fail(`경사는 0~${LIMITS.pitchMax} 사이 수입니다.`);
  const roof: Mass["roof"] = type === "flat" ? { type } : { type, ...(pitch !== undefined ? { pitch } : m.roof.pitch !== undefined ? { pitch: m.roof.pitch } : {}) };
  const same = roof.type === m.roof.type && roof.pitch === m.roof.pitch;
  return same ? ok(model) : ok(replaceMass(model, id, { ...m, roof }));
}

/** 매스 삭제(그 매스 층의 평면도 함께 지운다). */
export function deleteMass(model: Model, id: string): CommandResult {
  const m = findMass(model, id);
  if (!m) return fail("매스를 찾을 수 없습니다.");
  const removed = new Set(m.floors.map((f) => f.id));
  return ok(
    {
      ...model,
      masses: model.masses.filter((x) => x.id !== id),
      floor_layouts: model.floor_layouts.filter((l) => !removed.has(l.floor_id)),
    },
    null,
  );
}

/** 0에서 먼 쪽 반올림으로 step(mm) 격자에 맞춘다. */
export function snapMm(v: number, step: number): number {
  if (step <= 1) return Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
  const q = Math.floor(Math.abs(v) / step + 0.5) * step;
  return v < 0 ? -q : q;
}
