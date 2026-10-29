// 엔진 워커 메시지 프로토콜(02_ARCHITECTURE.md 2.4절, 04_API.md 4.7.5절). 타입과 요청 검사만 있다(순수).
// 본문(모델·좌표)의 상세 검사는 호출되는 순수 함수(judge·validateDraftingInput)가 한다. 여기서는 봉투(op·req_id·lane·seq)만 본다.
import type { DesignModelV1 } from "@arch-studio/domain";
import type { DraftingInput, SheetModel } from "@arch-studio/drafting";

// mesh·preview 레인(AR-06-036 모델러 표시용 메시, 2.4절 추가 제안 — tasks/logs/AR-06-036.md [DECISION 필요]):
//  - mesh: mass_meshes(매스별 표시 메시). preview: mass_excess(엔벨로프 표시 메시 + 매스 − 엔벨로프 초과분). 둘 다 최신만 유효.
//  - 판정(judge) 레인과 분리해 드래그 중 표시 요청이 판정 요청을 superseded 로 밀어내지 않게 한다.
export const LANES = ["judge", "suggest", "layout", "sheet", "export", "import", "mesh", "preview"] as const;
export type Lane = (typeof LANES)[number];

/** engine.worker 가 맡는 레인 / drafting.worker 가 맡는 레인(2.4절). */
export const ENGINE_LANES: readonly Lane[] = ["judge", "suggest", "layout", "mesh", "preview"];
export const DRAFTING_LANES: readonly Lane[] = ["sheet", "export", "import"];

/** 레인마다 최신 요청만 유효한 레인. export 는 끝까지 실행, import 는 순서대로 모두 실행한다. */
export const LATEST_ONLY_LANES: readonly Lane[] = ["judge", "suggest", "layout", "sheet", "mesh", "preview"];
export function isLatestOnly(lane: Lane): boolean {
  return LATEST_ONLY_LANES.includes(lane);
}

export type LocalErrorCode = "AR050" | "AR051" | "AR052" | "AR053" | "AR054" | "AR055" | "AR056" | "AR057" | "AR058" | "AR059";

/** op → 레인. load_rule_pack·cancel 은 레인이 없는 제어 메시지다. */
export const OP_LANE = {
  judge: "judge",
  suggest_mass: "suggest",
  validate_layout: "layout",
  build_sheet: "sheet",
  write: "export",
  import_dxf: "import",
  mass_meshes: "mesh",
  mass_excess: "preview",
} as const;
export type LaneOp = keyof typeof OP_LANE;

export interface Envelope {
  req_id: string;
  lane: Lane;
  /** 최신만 유효 레인에서 필수. */
  seq?: number;
}

export type EngineRequest =
  | { op: "load_rule_pack"; req_id: string; version: string; sha256: string; pack: unknown }
  | { op: "judge"; req_id: string; lane: "judge"; seq: number; model_rev: string; model: DesignModelV1; pending_changes?: number }
  | { op: "suggest_mass"; req_id: string; lane: "suggest"; seq: number; model: DesignModelV1; targets: unknown }
  | { op: "validate_layout"; req_id: string; lane: "layout"; seq: number; model: DesignModelV1; floor_id: string }
  | { op: "build_sheet"; req_id: string; lane: "sheet"; seq: number; input: DraftingInput; area_breakdown?: unknown; site_plan_extras?: unknown }
  | {
      op: "write";
      req_id: string;
      lane: "export";
      format: "dxf" | "svg" | "pdf" | "png";
      sheets: SheetModel[];
      layer_map: Record<string, string>;
      bundle: boolean;
      project_name: string;
      date: string;
    }
  | { op: "import_dxf"; req_id: string; lane: "import"; bytes: ArrayBuffer; unit_hint?: "mm" | "m"; purpose: "site_boundary" | "reference" }
  // AR-06-036: 표시용 메시(정수 정규화 없음, Float32 Transferable). 본문 검사는 modeler.handlers.ts.
  | { op: "mass_meshes"; req_id: string; lane: "mesh"; seq: number; masses: DesignModelV1["masses"] }
  | {
      op: "mass_excess";
      req_id: string;
      lane: "preview";
      seq: number;
      model: DesignModelV1;
      /** 초과분을 계산할 매스 id. null = 모든 매스(드래그 끝 전체 재계산). */
      mass_ids: string[] | null;
      /** true면 엔벨로프 표시 메시를 함께 보낸다(처음·대지/규칙이 바뀐 뒤). */
      want_envelope: boolean;
    }
  | { op: "cancel"; req_id: string };

export type LaneRequest = Extract<EngineRequest, { lane: Lane }>;

export type EngineResponse =
  | { req_id: string; seq?: number; ok: true; op: string; result: unknown; engine_version: string; elapsed_ms: number }
  | { req_id: string; seq?: number; ok: false; code: LocalErrorCode; detail: string }
  | { req_id: string; status: "superseded" | "canceled" }
  | { req_id: string; status: "progress"; pct: number };

export type TerminalStatus = "superseded" | "canceled";

export type ParseResult = { ok: true; request: EngineRequest } | { ok: false; req_id: string | null; detail: string };

/** 봉투 검사. 본문은 들여다보지 않고 detail 에도 본문 값을 싣지 않는다. */
export function parseRequest(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object") return { ok: false, req_id: null, detail: "메시지가 객체가 아닙니다" };
  const r = raw as Record<string, unknown>;
  const req_id = typeof r.req_id === "string" && r.req_id !== "" ? r.req_id : null;
  if (req_id === null) return { ok: false, req_id: null, detail: "req_id 가 없습니다" };
  const op = r.op;
  if (op === "cancel") return { ok: true, request: { op: "cancel", req_id } };
  if (op === "load_rule_pack") {
    if (typeof r.version !== "string" || typeof r.sha256 !== "string") return { ok: false, req_id, detail: "load_rule_pack: version·sha256 가 필요합니다" };
    return { ok: true, request: { op: "load_rule_pack", req_id, version: r.version, sha256: r.sha256, pack: r.pack } };
  }
  if (typeof op !== "string" || !(op in OP_LANE)) return { ok: false, req_id, detail: "알 수 없는 op 입니다" };
  const lane = OP_LANE[op as LaneOp];
  if (r.lane !== lane) return { ok: false, req_id, detail: `${op} 의 lane 은 ${lane} 이어야 합니다` };
  if (isLatestOnly(lane) && !(typeof r.seq === "number" && Number.isSafeInteger(r.seq) && r.seq >= 0)) {
    return { ok: false, req_id, detail: `${lane} 레인은 seq(0 이상 정수)가 필요합니다` };
  }
  return { ok: true, request: r as unknown as EngineRequest };
}
