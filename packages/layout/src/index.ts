// @arch-studio/layout — 실 배치 편집 규칙(02_ARCHITECTURE.md 2장 layout 행, PRD AR-F-032): 겹침·외곽 검사(AR051),
// 벽 두께, 문·창 위치, 경계 이동 후 면적·목표 차이. 결정적 순수 함수, mm 정수. Phase 2 솔버는 인터페이스만(solver.ts).
export {
  DEFAULT_WALLS,
  LayoutError,
  type BoundaryMove,
  type FloorLayout,
  type LayoutErrorCode,
  type LayoutIssue,
  type LayoutIssueKind,
  type Opening,
  type OpeningPlacement,
  type ProgramTarget,
  type Room,
  type RoomAreaRow,
  type WallKind,
  type WallSegment,
  type WallSpec,
} from "./types.ts";
export {
  checkRooms,
  floorOutline,
  polygonArea2,
  prepareOutline,
  prepareRoom,
  roomOutside,
  roomsOverlap,
  sortIssues,
  type PreparedOutline,
  type PreparedRoom,
  type RoomCheck,
} from "./check.ts";
export { placeOpenings } from "./openings.ts";
export { wallBands, wallPieces, wallSegments, type WallPiece } from "./walls.ts";
export {
  createLayoutState,
  createLayoutStateFrom,
  h100OfArea2,
  h100OfM2,
  moveBoundary,
  moveEdge,
  roomArea2,
  roomRow,
  targetIndex,
  validateLayout,
  validateLayoutResult,
  type LayoutOptions,
  type LayoutState,
  type ValidateLayoutResult,
} from "./state.ts";
export { floorPlanGeometry, type FloorPlanGeometry } from "./plan.ts";
export type {
  AdjacencyIntent,
  LayoutCandidate,
  LayoutCandidateLabel,
  LayoutProposalParams,
  LayoutSolver,
  LayoutSolverInput,
  Orientation8,
  RoomProposal,
  RoomZone,
} from "./solver.ts";
