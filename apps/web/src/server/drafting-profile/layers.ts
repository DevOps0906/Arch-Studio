// 레이어 매핑 규칙(PRD 9.6절, 개발서 12.7절). apps/web은 @arch-studio/drafting·domain에 의존하지 않으므로(package.json 범위 밖)
// `resolveLayerMap`(packages/drafting/src/layers/index.ts)을 글자 그대로 옮긴 사본이다. 정본과 같은 결과인지는
// layers.test.ts가 정본을 상대 경로로 불러 표·생성 사례로 비교한다(정본이 바뀌면 테스트가 깨진다).
// 화면 사본(packages/features/src/settings/drafting/layer-map.ts)도 같은 테스트 벡터로 고정한다.
// server-only를 import하지 않는다(node --test 대상).

/** 표준 레이어 16개(packages/domain/src/sheet.ts STD_LAYERS와 같은 순서, DB upsert_drafting_profile v_std와 같은 목록). */
export const STD_LAYERS = [
  "A-SITE-BNDY",
  "A-SITE-ROAD",
  "A-SITE-SETB",
  "A-ENVL",
  "A-MASS",
  "A-WALL",
  "A-DOOR",
  "A-GLAZ",
  "A-AREA",
  "A-AREA-IDEN",
  "A-PARK",
  "A-ANNO-DIMS",
  "A-ANNO-TEXT",
  "A-ANNO-NRTH",
  "A-TTLB",
  "A-REFR",
] as const;
export type StdLayer = (typeof STD_LAYERS)[number];

const ORDER: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(STD_LAYERS.map((name, i) => [name, i])));

export function isStdLayer(key: string): key is StdLayer {
  return Object.prototype.hasOwnProperty.call(ORDER, key);
}

/** DXF 레이어 이름 금지 문자 + 제어 문자(정본 FORBIDDEN과 같다). */
const FORBIDDEN = /[<>/\\":;?*|=,\u0000-\u001f\u007f]/;

/** DB 저장 규칙(upsert_drafting_profile: 값 `^[A-Za-z0-9_$-]{1,64}$`). */
export const DB_LAYER_NAME = /^[A-Za-z0-9_$-]{1,64}$/;

/** 저장 전 거부(422)하는 값: 제어 문자·줄 구분·bidi 제어(DXF 줄 구조·표시 위장). */
export const REJECT_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
export const LAYER_NAME_MAX = 64;

function nameKey(name: string): string {
  return name.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

export interface LayerMapWarning {
  kind: "invalid_name" | "unknown_key" | "name_conflict";
  key: string;
  name: string;
}

export interface ResolvedLayerMap {
  names: Record<StdLayer, string>;
  /** 출력 레이어 이름 목록(대소문자 무시 중복 제거, 표 순서). 정본은 색·선 종류도 담지만 서버는 이름만 쓴다. */
  table: string[];
  warnings: LayerMapWarning[];
}

/** 정본 resolveLayerMap과 같은 규칙(names·warnings는 글자 그대로 같다, table은 이름만). */
export function resolveLayerMap(layerMap: Readonly<Record<string, string>> | undefined): ResolvedLayerMap {
  const map = layerMap ?? {};
  const warnings: LayerMapWarning[] = [];
  for (const key of Object.keys(map).sort()) {
    if (ORDER[key] === undefined) warnings.push({ kind: "unknown_key", key, name: String(map[key]) });
  }
  const names = {} as Record<StdLayer, string>;
  const table: string[] = [];
  const taken = new Map<string, string>([["0", "0"]]);
  for (const std of STD_LAYERS) {
    const mapped = Object.prototype.hasOwnProperty.call(map, std) ? map[std] : undefined;
    let name: string = std;
    if (mapped !== undefined) {
      if (typeof mapped === "string" && mapped.trim() !== "" && !FORBIDDEN.test(mapped)) name = mapped;
      else warnings.push({ kind: "invalid_name", key: std, name: String(mapped) });
    }
    const prev = taken.get(nameKey(name));
    if (prev !== undefined && (prev !== name || prev === "0")) {
      warnings.push({ kind: "name_conflict", key: std, name });
      name = taken.get(nameKey(std)) ?? std;
    }
    names[std] = name;
    if (!taken.has(nameKey(name))) {
      taken.set(nameKey(name), name);
      table.push(name);
    }
  }
  return { names, table, warnings };
}

/** 저장 단계 경고: 정본 경고 + DB가 받지 못하는 이름(unsupported_name). */
export interface SaveLayerWarning {
  kind: "invalid_name" | "unsupported_name" | "name_conflict";
  key: StdLayer;
  name: string;
}

export type NormalizeResult =
  | { ok: true; map: Partial<Record<StdLayer, string>>; warnings: SaveLayerWarning[] }
  | { ok: false; reason: "not_object" | "unknown_key" | "not_string" | "control_char" | "too_long" };

/**
 * 입력 layer_map → 저장할 map + 경고. 거부(422): 객체 아님·표준 밖 키(`__proto__` 포함)·문자열 아님·제어 문자·64자 초과.
 * 표준 이름 유지 + 경고(저장하지 않음): 빈 값·DXF 금지 문자(invalid_name, 정본과 같은 판정), DB 정규식 밖(unsupported_name).
 * 남은 map에 정본을 다시 적용해 name_conflict 경고를 더한다(충돌 이름은 저장하되 내보낼 때 정본이 표준 이름으로 되돌린다).
 * 결과 객체는 null 프로토타입 + 표준 순서.
 */
export function normalizeLayerMap(raw: unknown): NormalizeResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not_object" };
  const entries = Object.keys(raw);
  if (entries.length > STD_LAYERS.length) return { ok: false, reason: "unknown_key" };
  for (const key of entries) {
    if (!isStdLayer(key)) return { ok: false, reason: "unknown_key" };
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== "string") return { ok: false, reason: "not_string" };
    if (REJECT_CHARS.test(v)) return { ok: false, reason: "control_char" };
    if ([...v].length > LAYER_NAME_MAX) return { ok: false, reason: "too_long" };
  }
  const src = raw as Record<string, string>;
  const pre = resolveLayerMap(src);
  const invalid = new Set(pre.warnings.filter((w) => w.kind === "invalid_name").map((w) => w.key));
  const warnings: SaveLayerWarning[] = [];
  const map = Object.create(null) as Partial<Record<StdLayer, string>>;
  for (const std of STD_LAYERS) {
    if (!Object.prototype.hasOwnProperty.call(src, std)) continue;
    const v = src[std] as string;
    if (invalid.has(std)) warnings.push({ kind: "invalid_name", key: std, name: v });
    else if (!DB_LAYER_NAME.test(v)) warnings.push({ kind: "unsupported_name", key: std, name: v });
    else map[std] = v;
  }
  for (const w of resolveLayerMap(map as Record<string, string>).warnings) {
    if (w.kind === "name_conflict") warnings.push({ kind: "name_conflict", key: w.key as StdLayer, name: w.name });
  }
  return { ok: true, map, warnings };
}
