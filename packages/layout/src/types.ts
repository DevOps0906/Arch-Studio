// layout 공용 타입(02_ARCHITECTURE.md 2장 layout 행, 04_API.md 4.7.1 floor_layouts·4.7.5 validate_layout).
// 좌표는 모두 mm 정수(DesignModel 그대로). 면적은 ㎡ × 100 정수("h100")로만 들고 다닌다 — 부동소수 누적 금지.
import type { DesignModelV1, Point } from "@arch-studio/domain";

export type FloorLayout = DesignModelV1["floor_layouts"][number];
export type Room = FloorLayout["rooms"][number];
export type Opening = FloorLayout["openings"][number];
export type ProgramTarget = DesignModelV1["program"]["targets"][number];

/**
 * AR051 사유. 04_API.md 4.7.5의 `kind: 'overlap' | 'outside'`에 문·창(`opening`)과 입력 불량(`invalid`)을 더했다
 * (이 작업의 범위 "변 범위를 벗어나면 위반", 실 다각형 자기교차·id 중복도 저장을 막아야 한다).
 * - overlap: 두 실의 내부가 겹친다(경계 접촉은 허용). room_ids = 정렬된 두 실 id.
 * - outside: 실이 층 외곽(그 층 매스 외곽 합집합) 밖으로 나간다. room_ids = [실 id].
 * - opening: 문·창이 호스트 실·변이 없거나, 변 범위를 벗어나거나, 같은 벽에서 서로 겹친다. opening_ids 필수.
 * - invalid: 실 다각형이 geometry 검사를 통과하지 못하거나 실·문창 id가 중복된다.
 */
export type LayoutIssueKind = "overlap" | "outside" | "opening" | "invalid";

export interface LayoutIssue {
  code: "AR051";
  kind: LayoutIssueKind;
  /** 관련 실 id(사전순). 편집기가 이 실들을 강조한다. */
  room_ids: string[];
  /** kind = opening일 때 관련 문·창 id(사전순). */
  opening_ids?: string[];
  /** 사람용 설명(한국어). 화면 문구는 03_SCREENS_UX.md AR051 행이 정한다. */
  detail: string;
}

/** 벽 두께(mm 정수, 짝수 권장 — 중심선에서 양쪽 절반씩). 실 다각형·층 외곽은 벽 중심선이다. */
export interface WallSpec {
  exterior_mm: number;
  interior_mm: number;
}

/** PRD AR-F-032 제안값: 외벽 200mm, 내벽 100mm. DraftingProfile에 벽 두께 칸이 없어 상수로 둔다. */
export const DEFAULT_WALLS: Readonly<WallSpec> = Object.freeze({ exterior_mm: 200, interior_mm: 100 });

/** 실 한 개의 면적·목표 차이(validate_layout 결과 rooms[] 행). */
export interface RoomAreaRow {
  room_id: string;
  /** 실 면적 ㎡ × 100(벽 중심선 기준, half-away 반올림). */
  area_h100: number;
  /** 프로그램 목표 ㎡ × 100(half-away), 대응 목표가 없으면 null. */
  target_h100: number | null;
  /** area_h100 − target_h100(정수), 목표가 없으면 null. */
  diff_h100: number | null;
  /** 04_API.md 계약 값(= h100 / 100). */
  area_m2: number;
  target_diff_m2: number | null;
}

/** 경계 이동: 실 외곽 고리의 edge_index번 변(꼭짓점 i, i+1)을 (dx, dy)mm 옮긴다. */
export interface BoundaryMove {
  room_id: string;
  edge_index: number;
  dx_mm: number;
  dy_mm: number;
}

export type WallKind = "exterior" | "interior";

/** 벽 조각(중심선). 같은 직선 위 겹치는 실 변은 한 조각으로 합친다(공유 내벽 1번만). */
export interface WallSegment {
  key: string;
  kind: WallKind;
  thickness_mm: number;
  a: Point;
  b: Point;
}

/**
 * 문·창 배치 결과. 국소 좌표계: x = 벽을 따라(개구부 시작 → 끝), y = 호스트 실 안쪽, 원점 = 개구부 시작점(벽 중심선 위).
 * 블록 정의는 이 국소 좌표계로 그리고 INSERT(origin, rot_deg)로 놓는다. 변이 축에 평행하지 않으면 rot_deg = null
 * (INSERT 회전이 90° 배수만이라 블록 쪽을 미리 돌린다 — dir로 회전).
 */
export interface OpeningPlacement {
  opening_id: string;
  kind: Opening["kind"];
  room_id: string;
  width_mm: number;
  /** 문만. 실 안에서 벽을 바라볼 때 경첩 쪽('left' = 왼손 쪽 = 국소 x = width). 없으면 'left'. */
  swing: "left" | "right";
  wall: WallKind;
  thickness_mm: number;
  origin: Point;
  /** 국소 x축 방향(정수 원시 벡터, gcd 1). */
  dir: Point;
  rot_deg: 0 | 90 | 180 | 270 | null;
  /** 개구부 양 끝(벽 중심선 위, 반올림 mm). */
  a: Point;
  b: Point;
  /** 벽 직선 키(walls.ts lineOf)와 그 직선 위 개구부 구간 t(벽 끊기용, 축 평행이면 정수). */
  line_key: string;
  t: [number, number];
}

export type LayoutErrorCode = "UNKNOWN_FLOOR" | "UNKNOWN_ROOM" | "INVALID_ARGUMENT";

/** 호출자 버그(없는 층·실, 정수 아닌 이동량). 사용자 안내(AR051)는 LayoutIssue 값으로 돌려주고 예외로 쓰지 않는다. */
export class LayoutError extends Error {
  readonly code: LayoutErrorCode;
  constructor(code: LayoutErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "LayoutError";
    this.code = code;
  }
}
