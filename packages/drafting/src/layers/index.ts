// 레이어 표준(PRD 9.6절, D-24 (a)). SheetModel은 표준 이름만 쓰고, 사무소 이름 매핑(layer_map)은 DXF 작성기만 적용한다.
// 색은 DXF ACI 번호(CAD 색 체계)라 디자인 토큰이 아니다 — 작성기 상수로 고정.
import { STD_LAYERS, type StdLayer } from "@arch-studio/domain";

export type Linetype = "CONTINUOUS" | "DASHED" | "DASHDOT";

export interface LayerDef {
  name: StdLayer;
  /** AutoCAD Color Index(1~255). */
  aci: number;
  linetype: Linetype;
  description: string;
}

// 표 순서 = STD_LAYERS 순서 = 조립 정렬의 "레이어 표 순서". 문자 전용 레이어(PRD 표 "-")는 CONTINUOUS.
export const LAYER_TABLE: readonly LayerDef[] = Object.freeze(
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
    ] as const
  ).map(([name, aci, linetype, description]) => Object.freeze({ name, aci, linetype, description })),
);

const ORDER: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(STD_LAYERS.map((name, i) => [name, i])),
);

/** 레이어 표 순서(0부터). 표준 밖 이름은 RangeError. */
export function layerOrder(name: StdLayer): number {
  const i = ORDER[name];
  if (i === undefined) throw new RangeError(`표준 레이어가 아닙니다: ${name}`);
  return i;
}

export function layerDef(name: StdLayer): LayerDef {
  return LAYER_TABLE[layerOrder(name)] as LayerDef;
}

/** DXF 레이어 이름 금지 문자(02_ARCHITECTURE.md 2.3절) + 제어 문자(DXF 줄 구조를 깬다). */
const FORBIDDEN = /[<>/\\":;?*|=,\u0000-\u001f\u007f]/;

/** 레이어 이름 비교 키: CAD는 이름을 대소문자 구분 없이 다루므로 ASCII만 대문자로. */
function nameKey(name: string): string {
  return name.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

export interface ResolvedLayer {
  /** 출력 레이어 이름(사무소 이름 또는 표준 이름). */
  name: string;
  aci: number;
  linetype: Linetype;
}

export interface LayerMapWarning {
  /** name_conflict: 대소문자만 다른 이름·예약 이름 "0"과 겹침 → 표준 이름으로 되돌림. */
  kind: "invalid_name" | "unknown_key" | "name_conflict";
  key: string;
  name: string;
}

export interface ResolvedLayerMap {
  /** 표준 이름 → 출력 이름(16개 전부). */
  names: Record<StdLayer, string>;
  /** 출력 레이어 표(이름 중복 제거, 표 순서상 앞 레이어의 색·선 종류). */
  table: ResolvedLayer[];
  warnings: LayerMapWarning[];
}

/**
 * layer_map(표준 이름 → 사무소 이름) 해석(개발서 12.7절). 금지 문자·빈 이름은 표준 이름 유지 + 경고,
 * 표준 밖 키는 무시 + 경고, 두 표준 레이어를 한 이름으로 합치면 허용(색·선 종류는 표 순서상 앞 레이어).
 * 이름은 대소문자 무시(ASCII)로 비교한다: 철자가 정확히 같으면 합치기, 대소문자만 다르거나 예약 이름 "0"이면 충돌 —
 * 표 순서상 먼저 온 쪽을 유지하고 나중 쪽은 표준 이름으로 되돌리며 name_conflict 경고. 되돌린 표준 이름마저 앞 이름과
 * 대소문자만 다르면 앞 이름에 합친다(출력 표에 대소문자 무시 중복 0).
 */
export function resolveLayerMap(layerMap: Readonly<Record<string, string>> | undefined): ResolvedLayerMap {
  const map = layerMap ?? {};
  const warnings: LayerMapWarning[] = [];
  for (const key of Object.keys(map).sort()) {
    if (ORDER[key] === undefined) warnings.push({ kind: "unknown_key", key, name: String(map[key]) });
  }
  const names = {} as Record<StdLayer, string>;
  const table: ResolvedLayer[] = [];
  // 대소문자 무시 키 → 출력 철자. 예약 레이어 "0"을 먼저 넣는다.
  const taken = new Map<string, string>([["0", "0"]]);
  for (const def of LAYER_TABLE) {
    const mapped = Object.prototype.hasOwnProperty.call(map, def.name) ? map[def.name] : undefined;
    let name: string = def.name;
    if (mapped !== undefined) {
      if (typeof mapped === "string" && mapped.trim() !== "" && !FORBIDDEN.test(mapped)) name = mapped;
      else warnings.push({ kind: "invalid_name", key: def.name, name: String(mapped) });
    }
    const prev = taken.get(nameKey(name));
    if (prev !== undefined && (prev !== name || prev === "0")) {
      warnings.push({ kind: "name_conflict", key: def.name, name });
      name = taken.get(nameKey(def.name)) ?? def.name;
    }
    names[def.name] = name;
    if (!taken.has(nameKey(name))) {
      taken.set(nameKey(name), name);
      table.push({ name, aci: def.aci, linetype: def.linetype });
    }
  }
  return { names, table, warnings };
}
