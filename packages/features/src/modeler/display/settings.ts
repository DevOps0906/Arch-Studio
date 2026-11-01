// 모델러 표시 값(AR-06-085, 03장 3.5절 "표시 절"): 조명 프리셋·그림자·재질 프리셋·층 라벨·층 숨김(층 탭)·분해도.
// 모델·출력·판정과 무관한 화면 값이다. DesignModel·실행 취소 이력에 넣지 않고, 이 PC(localStorage)에만 남긴다.
// 보관: 설치형 `local_settings` 어댑터가 아직 없어 셸 prefs.ts와 같이 웹뷰 localStorage에 둔다(어댑터가 생기면 옮긴다).
// 층 숨김(층 탭)은 프로젝트마다 층이 달라 저장하지 않는다(세션 값).
// 순수 함수만(three import 없음). 조명 세기·위치는 장면 비율 숫자이고, 색은 토큰(colors.ts)에서만 읽는다.
// Motion Studio 뷰어의 표시 패턴(조명 프리셋·재질 프리셋·층 라벨·분해도)만 참고했다. 코드는 옮기지 않았다(LICENSE 없음).
import { sortedFloors, type Mass, type Model } from "../state/commands.ts";
import { MAX_TRIANGLES } from "../engine/protocol.ts";

export type LightingPreset = "default" | "noon" | "evening" | "overcast";
export type MaterialPreset = "concrete" | "model" | "translucent";

export interface DisplaySettings {
  readonly lighting: LightingPreset;
  readonly shadows: boolean;
  readonly material: MaterialPreset;
  readonly floorLabels: boolean;
  /** 분해도 층 간격(mm 정수, 0 = 끔). */
  readonly explodeMm: number;
  /** 층 탭: 이 층(level)만 보인다. null = 전체. 저장하지 않는다. */
  readonly floorOnly: number | null;
}

export const LIGHTING_LABEL: Readonly<Record<LightingPreset, string>> = { default: "기본", noon: "한낮", evening: "저녁", overcast: "흐린 날" };
export const MATERIAL_LABEL: Readonly<Record<MaterialPreset, string>> = { concrete: "콘크리트", model: "모형(무광)", translucent: "반투명" };
/** 분해도 간격 고르기(mm). */
export const EXPLODE_STEPS: readonly number[] = [0, 1000, 3000];
export const EXPLODE_LABEL: Readonly<Record<number, string>> = { 0: "끔", 1000: "좁게(1m)", 3000: "넓게(3m)" };

export const DEFAULT_DISPLAY: DisplaySettings = Object.freeze({
  lighting: "default",
  shadows: false,
  material: "concrete",
  floorLabels: false,
  explodeMm: 0,
  floorOnly: null,
});

const KEY = "arch.modeler.display.v1";
const LIGHTINGS = Object.keys(LIGHTING_LABEL) as LightingPreset[];
const MATERIALS = Object.keys(MATERIAL_LABEL) as MaterialPreset[];

/** 저장 문자열 → 값. 모르는 값·깨진 JSON은 기본값(여기 들어오는 값은 신뢰하지 않는다). floorOnly는 항상 null. */
export function parseDisplay(raw: string | null): DisplaySettings {
  if (!raw) return DEFAULT_DISPLAY;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof DisplaySettings, unknown>>;
    return {
      lighting: LIGHTINGS.includes(v.lighting as LightingPreset) ? (v.lighting as LightingPreset) : DEFAULT_DISPLAY.lighting,
      shadows: v.shadows === true,
      material: MATERIALS.includes(v.material as MaterialPreset) ? (v.material as MaterialPreset) : DEFAULT_DISPLAY.material,
      floorLabels: v.floorLabels === true,
      explodeMm: typeof v.explodeMm === "number" && EXPLODE_STEPS.includes(v.explodeMm) ? v.explodeMm : 0,
      floorOnly: null,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** 저장할 문자열(층 숨김 제외). */
export function serializeDisplay(d: DisplaySettings): string {
  return JSON.stringify({ lighting: d.lighting, shadows: d.shadows, material: d.material, floorLabels: d.floorLabels, explodeMm: d.explodeMm });
}

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const storage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadDisplay(): DisplaySettings {
  try {
    return parseDisplay(storage()?.getItem(KEY) ?? null);
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function saveDisplay(d: DisplaySettings): void {
  try {
    storage()?.setItem(KEY, serializeDisplay(d));
  } catch {
    // 표시 값이라 실패해도 무시한다.
  }
}

/** 층 이름: 지상 1F·2F, 지하 B1·B2(레이어 패널과 같은 규칙). */
export const levelLabel = (level: number) => (level > 0 ? `${level}F` : `B${1 - level}`);

/** 층 탭에 보일 층(모든 매스의 level 합집합, 아래부터). */
export function floorTabLevels(model: Model): number[] {
  const s = new Set<number>();
  for (const m of model.masses) for (const f of m.floors) s.add(f.level);
  return [...s].sort((a, b) => a - b);
}

/** 모델에 없는 층을 고른 상태면 전체로 본다. */
export function effectiveFloorOnly(model: Model, floorOnly: number | null): number | null {
  return floorOnly !== null && model.masses.some((m) => m.floors.some((f) => f.level === floorOnly)) ? floorOnly : null;
}

export interface FloorSlab {
  readonly floorId: string;
  readonly level: number;
  readonly label: string;
  /** 표시 바닥·천장 높이(mm, 분해도 간격 포함). */
  readonly z0: number;
  readonly z1: number;
}

/**
 * 매스의 층별 표시 판(아래부터). 분해도면 i번째 층을 i × explodeMm만큼 띄운다. floorOnly가 있으면 그 층만.
 * 정수 mm 입력이면 결과도 정수(표시 전용, 판정·면적에 쓰지 않는다).
 */
export function floorSlabs(mass: Mass, explodeMm: number, floorOnly: number | null): FloorSlab[] {
  const out: FloorSlab[] = [];
  let z = mass.base_level_mm;
  sortedFloors(mass).forEach((f, i) => {
    const z0 = z + i * explodeMm;
    z += f.height_mm;
    if (floorOnly === null || f.level === floorOnly) out.push({ floorId: f.id, level: f.level, label: levelLabel(f.level), z0, z1: z0 + f.height_mm });
  });
  return out;
}

/** 층별로 나눠 그려야 하는가(분해도 또는 층 숨김). 아니면 기존 매스 메시 1개(워커 메시)를 그린다. */
export const needsSplit = (explodeMm: number, floorOnly: number | null) => explodeMm > 0 || floorOnly !== null;

/** 바닥 다각형 판 1장의 삼각형 수(earcut: 꼭짓점 n·구멍 h → n + 2h − 2개, 위·아래 2벌 + 옆면 변마다 2개). */
export function slabTriangles(mass: Mass): number {
  const holes = mass.footprint.holes ?? [];
  const n = mass.footprint.outer.length + holes.reduce((s, r) => s + r.length, 0);
  return 2 * (n + 2 * holes.length - 2) + 2 * n;
}

/** 층별로 나눠 그릴 때 장면 삼각형 수. */
export function splitTriangles(model: Model, explodeMm: number, floorOnly: number | null): number {
  let t = 0;
  for (const m of model.masses) t += slabTriangles(m) * floorSlabs(m, explodeMm, floorOnly).length;
  return t;
}

/** 층별 표시가 삼각형 상한(MAX_TRIANGLES) 안인가. 넘으면 분해도·층 숨김을 끄고 매스 메시로 그린다. */
export const splitAllowed = (model: Model, explodeMm: number, floorOnly: number | null) => splitTriangles(model, explodeMm, floorOnly) <= MAX_TRIANGLES;

/** 층별 표시가 켜졌지만 삼각형 상한 때문에 그리지 못하는가(표시 절·층 탭 안내). */
export function splitOverLimit(model: Model, d: DisplaySettings): boolean {
  const fo = effectiveFloorOnly(model, d.floorOnly);
  return needsSplit(d.explodeMm, fo) && !splitAllowed(model, d.explodeMm, fo);
}

/** 분해도가 실제로 그려지는가. 이때는 판이 모델 위치에서 떠 있어 측정(D)을 막는다(층 숨김만이면 허용). */
export function explodeActive(model: Model, d: DisplaySettings): boolean {
  return d.explodeMm > 0 && splitAllowed(model, d.explodeMm, effectiveFloorOnly(model, d.floorOnly));
}

export const EXPLODE_MEASURE_TEXT = "분해도 중에는 측정할 수 없습니다. 분해도를 끄면 측정할 수 있습니다.";

/** 층 라벨 최대 개수(DOM 겹침 비용 상한). */
export const MAX_FLOOR_LABELS = 300;

export interface LightRig {
  readonly ambient: number;
  /** 주광(그림자를 만드는 빛): 장면 중심에서의 방향(정규화 전, 월드 축)과 세기. */
  readonly sun: { readonly dir: readonly [number, number, number]; readonly intensity: number };
  readonly fill: { readonly dir: readonly [number, number, number]; readonly intensity: number };
}

/** 조명 프리셋 → 빛 세기·방향(색은 흰빛 기본값, 소스에 색 값 없음). "기본"은 AR-06-036 값 그대로. */
export const LIGHT_RIGS: Readonly<Record<LightingPreset, LightRig>> = {
  default: { ambient: 1.6, sun: { dir: [40, 80, 30], intensity: 1.8 }, fill: { dir: [-30, 40, -50], intensity: 0.6 } },
  noon: { ambient: 1.1, sun: { dir: [10, 100, 35], intensity: 2.6 }, fill: { dir: [-30, 40, -50], intensity: 0.3 } },
  evening: { ambient: 0.7, sun: { dir: [90, 22, 25], intensity: 2.2 }, fill: { dir: [-40, 30, -40], intensity: 0.35 } },
  overcast: { ambient: 2.3, sun: { dir: [20, 90, 20], intensity: 0.6 }, fill: { dir: [-30, 60, -30], intensity: 0.4 } },
};

export interface MaterialLook {
  /** 장면 색 키(colors.ts SceneColors). */
  readonly color: "mass" | "modelSurface";
  readonly roughness: number;
  readonly opacity: number;
}

export const MATERIAL_LOOKS: Readonly<Record<MaterialPreset, MaterialLook>> = {
  concrete: { color: "mass", roughness: 0.9, opacity: 1 },
  model: { color: "modelSurface", roughness: 1, opacity: 1 },
  translucent: { color: "mass", roughness: 0.6, opacity: 0.55 },
};
