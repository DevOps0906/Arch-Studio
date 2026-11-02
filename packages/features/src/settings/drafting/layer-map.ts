// 레이어 매핑 표·경고(PRD 9.6절, 03장 3.14절 LayerMapTable). 미리보기·경고는 도면 엔진 `resolveLayerMap`
// (packages/drafting/src/layers/index.ts)과 같은 결과여야 한다. features는 @arch-studio/drafting에 의존하지 않으므로
// (package.json·lockfile은 이 작업 범위 밖) 정본을 글자 그대로 옮긴 사본을 두고, layer-map.test.ts가 정본·서버 사본
// (apps/web/src/server/drafting-profile/layers.ts)과 같은 사례 400건으로 대조한다. 정본이 바뀌면 테스트가 깨진다.
import { STD_LAYERS, type StdLayer } from "@arch-studio/domain";

export type Linetype = "CONTINUOUS" | "DASHED" | "DASHDOT";

export interface LayerRow {
  name: StdLayer;
  aci: number;
  linetype: Linetype;
  description: string;
}

/** 정본 LAYER_TABLE과 같은 값(표 순서 = STD_LAYERS 순서). ACI는 CAD 색 번호라 디자인 토큰이 아니다. */
export const LAYER_ROWS: readonly LayerRow[] = Object.freeze(
  (
    [
      ["A-SITE-BNDY", 1, "DASHDOT", "대지 경계, 지번"],
      ["A-SITE-ROAD", 8, "CONTINUOUS", "도로 경계, 도로 폭"],
      ["A-SITE-SETB", 3, "DASHED", "건축선, 대지안의 공지(이격선)"],
      ["A-ENVL", 4, "DASHED", "엔벨로프, 일조사선"],
      ["A-MASS", 7, "CONTINUOUS", "매스 외곽"],
      ["A-WALL", 7, "CONTINUOUS", "벽(평면 개략도)"],
      ["A-DOOR", 2, "CONTINUOUS", "문 심볼"],
      ["A-GLAZ", 5, "CONTINUOUS", "창 심볼"],
      ["A-AREA", 6, "CONTINUOUS", "면적 산정 구획, 해치"],
      ["A-AREA-IDEN", 7, "CONTINUOUS", "실명, 면적 라벨"],
      ["A-PARK", 3, "CONTINUOUS", "주차구획"],
      ["A-ANNO-DIMS", 1, "CONTINUOUS", "치수(분해)"],
      ["A-ANNO-TEXT", 7, "CONTINUOUS", "주석 문자, 경고 기호"],
      ["A-ANNO-NRTH", 7, "CONTINUOUS", "방위표, 축척 막대"],
      ["A-TTLB", 7, "CONTINUOUS", "도곽, 표제란"],
      ["A-REFR", 9, "CONTINUOUS", "참조 언더레이(Phase 2)"],
      ["A-ANNO-USER", 6, "CONTINUOUS", "사람 주석(치수·문자·지시선·구름)"],
    ] as const
  ).map(([name, aci, linetype, description]) => Object.freeze({ name, aci, linetype, description })),
);

export const LINETYPE_LABEL: Readonly<Record<Linetype, string>> = { CONTINUOUS: "실선", DASHED: "파선", DASHDOT: "1점 쇄선" };

/** 이름을 바꿀 수 없는(읽기 전용) 레이어: 서버 DB(upsert_drafting_profile v_std)가 아직 받지 않는다(AR-06-086, 마이그레이션 후 해제). */
export const LOCKED_LAYERS: ReadonlySet<StdLayer> = new Set<StdLayer>(["A-ANNO-USER"]);
export const LOCKED_LAYER_TEXT = "사람 주석 레이어는 서버 저장 지원 전까지 표준 이름으로 내보냅니다.";

const ORDER: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(STD_LAYERS.map((name, i) => [name, i])));

export function isStdLayer(key: string): key is StdLayer {
  return Object.prototype.hasOwnProperty.call(ORDER, key);
}

const FORBIDDEN = /[<>/\\":;?*|=,\u0000-\u001f\u007f]/;
/** DB 저장 규칙(arch.upsert_drafting_profile 값 정규식). */
export const DB_LAYER_NAME = /^[A-Za-z0-9_$-]{1,64}$/;
/** 서버가 422로 거부하는 문자(제어 문자·줄 구분·bidi 제어). 화면은 저장 전에 같은 규칙으로 막는다. */
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
  /** 출력 레이어 이름(대소문자 무시 중복 제거, 표 순서). */
  table: string[];
  warnings: LayerMapWarning[];
}

/** 정본 resolveLayerMap과 같은 규칙(names·warnings 글자 그대로, table은 이름만). */
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

export interface SaveLayerWarning {
  kind: "invalid_name" | "unsupported_name" | "name_conflict";
  key: StdLayer;
  name: string;
}

export type NormalizeResult =
  | { ok: true; map: Partial<Record<StdLayer, string>>; warnings: SaveLayerWarning[] }
  | { ok: false; reason: "not_object" | "unknown_key" | "not_string" | "control_char" | "too_long" };

/** 서버 normalizeLayerMap과 같은 규칙(저장할 map + 경고). layer-map.test.ts가 두 구현을 대조한다. */
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

export const WARNING_TEXT: Readonly<Record<SaveLayerWarning["kind"], string>> = {
  invalid_name: "DXF 레이어 이름에 쓸 수 없는 문자가 있어 표준 이름으로 내보냅니다.",
  unsupported_name: "영문·숫자·_ - $만 저장할 수 있어 표준 이름으로 내보냅니다.",
  name_conflict: "앞 레이어 이름과 대소문자만 다르거나 예약 이름(0)이라 표준 이름으로 내보냅니다.",
};

/** 표 한 줄 모델(입력 칸 값 → 출력 이름·경고). 빈 칸은 "표준 이름 사용"(경고 없음). */
export interface LayerTableRow extends LayerRow {
  input: string;
  output: string;
  warning: SaveLayerWarning["kind"] | null;
  /** 저장 불가(서버 422): 제어 문자·64자 초과. */
  blocked: boolean;
  /** 읽기 전용 행(LOCKED_LAYERS): 입력은 무시하고 표준 이름. */
  locked: boolean;
}

/**
 * 화면 표: 편집 중인 입력(빈 문자열 = 매핑 없음) → 행. 출력 이름은 "저장 후 내보낼 때" 이름이다:
 * 저장 정규화(normalizeLayerMap)로 빠지는 값은 표준 이름, 남은 map은 resolveLayerMap 결과 그대로.
 */
export function layerTable(inputs: Readonly<Partial<Record<StdLayer, string>>>): { rows: LayerTableRow[]; saveMap: Partial<Record<StdLayer, string>> | null } {
  const raw: Record<string, string> = {};
  const blocked = new Set<StdLayer>();
  for (const std of STD_LAYERS) {
    const v = inputs[std];
    if (v === undefined || v === "" || LOCKED_LAYERS.has(std)) continue;
    if (REJECT_CHARS.test(v) || [...v].length > LAYER_NAME_MAX) blocked.add(std);
    else raw[std] = v;
  }
  const n = normalizeLayerMap(raw);
  const map = n.ok ? n.map : {};
  const warn = new Map<StdLayer, SaveLayerWarning["kind"]>();
  if (n.ok) for (const w of n.warnings) warn.set(w.key, w.kind);
  const resolved = resolveLayerMap(map as Record<string, string>);
  const rows = LAYER_ROWS.map((row) => ({
    ...row,
    input: LOCKED_LAYERS.has(row.name) ? "" : (inputs[row.name] ?? ""),
    output: resolved.names[row.name],
    warning: blocked.has(row.name) ? null : (warn.get(row.name) ?? null),
    blocked: blocked.has(row.name),
    locked: LOCKED_LAYERS.has(row.name),
  }));
  return { rows, saveMap: blocked.size > 0 ? null : map };
}
