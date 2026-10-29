// Phase 2 배치 솔버(AR-F-035) — 인터페이스(타입)만. 구현은 Phase 2(D-25)에서 한다. 이 파일에 함수 구현을 넣지 않는다.
//
// LLM은 좌표를 만들지 않는다(개발서 12.9절, .claude/rules/engine.md):
//  - LLM(LangGraph)이 만들 수 있는 것은 LayoutProposalParams뿐이다 — 실 목록(이름·용도·목표 ㎡), 실 사이 인접·조닝 의도,
//    채광 방향 같은 "파라미터 제안". 좌표·치수·다각형·변 길이 필드는 일부러 두지 않는다(타입에 자리가 없다).
//  - 층 외곽(Polygon)은 솔버 입력에서 엔진이 DesignModel로부터 구해 넣는다(floorOutline). 제안 JSON에서 오지 않는다.
//  - 실 다각형은 결정적 솔버(같은 입력 → 같은 3안)만 만든다. 결과는 checkRooms·placeOpenings를 통과해야 하고(겹침 0),
//    사용자가 AR-F-032 편집기에서 채택·수정해야 DesignModel에 들어간다.
import type { Polygon } from "@arch-studio/domain";
import type { FloorLayout, LayoutIssue, WallSpec } from "./types.ts";

/** 조닝 의도(제안). */
export type RoomZone = "public" | "private" | "service" | "circulation";

/** 채광 선호 방위(정북 기준, 솔버가 north_angle_deg로 외곽 변에 대응시킨다). */
export type Orientation8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "any";

/** LLM·사용자가 줄 수 있는 실 파라미터. 좌표 없음. */
export interface RoomProposal {
  /** 프로그램 면적표 행 이름(program.targets[].name)과 같아야 한다. */
  name: string;
  use: string;
  /** 목표 ㎡. 엔진이 ㎡ × 100 정수로 바꾼다. 면적표(AR-F-011) 값이 우선이고 제안은 참고. */
  target_area_m2: number;
  zone?: RoomZone;
  daylight?: Orientation8;
}

/** 실 사이 관계 의도(이름으로 가리킨다). */
export interface AdjacencyIntent {
  a: string;
  b: string;
  strength: "required" | "preferred" | "avoid";
}

/**
 * LLM이 만들 수 있는 유일한 입력(고정 JSON 스키마, AR-F-035 "실 인접·조닝 의도 JSON").
 * 위치를 가리켜야 하면 좌표가 아니라 선택자(방위, 외곽 변 번호)만 쓴다.
 */
export interface LayoutProposalParams {
  rooms: RoomProposal[];
  adjacency: AdjacencyIntent[];
  /** 현관 위치: 층 외곽 변 번호(엔진이 정규화한 외곽 고리 기준) 또는 방위. */
  entrance?: { edge_index: number } | { facing: Orientation8 };
  notes?: string;
}

/** 솔버 입력. outline·grid·walls는 엔진이 채운다(제안 JSON에서 오지 않는다). */
export interface LayoutSolverInput {
  floor_id: string;
  /** 층 외곽(벽 중심선) — floorOutline(model, floor_id). */
  outline: Polygon[];
  north_angle_deg: number;
  params: LayoutProposalParams;
  /** 그리드 스냅(mm, AR-F-032 기본 100). */
  grid_mm: number;
  walls: WallSpec;
}

export type LayoutCandidateLabel = "adjacency_first" | "daylight_first" | "regular_grid";

/** 솔버 후보 1안. layout은 DesignModel floor_layouts 행 그대로(실 다각형은 솔버가 만든 정수 mm). */
export interface LayoutCandidate {
  label: LayoutCandidateLabel;
  layout: FloorLayout;
  /** 실별 목표 대비 차이(㎡ × 100 정수). PRD 수용 기준 ±15%(제안). */
  area_diff_h100: Record<string, number>;
  /** 결정적 점수(정수, 클수록 좋음). */
  score: number;
  /** 비어 있어야 후보로 낸다(겹침 0). */
  issues: LayoutIssue[];
}

/** Phase 2 솔버 계약: 결정적 순수 함수, 3안. 구현 없음(Phase 2). */
export type LayoutSolver = (input: LayoutSolverInput) => LayoutCandidate[];
