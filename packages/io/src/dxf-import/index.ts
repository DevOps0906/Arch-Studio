// DXF 가져오기(AR-06-029): ASCII DXF → 대지 경계 "후보" 목록. 순수 함수 — I/O·시간·난수 없음, 같은 입력 → 같은 출력.
// 이 패키지는 DesignModel을 만들거나 고치지 않는다. 사용자가 후보를 확정한 뒤에야 호출자가 DesignModel.site에 반영한다.
//
// 사용:
//   const r = importDxf(bytes);                       // 1차 호출
//   if (r.ok && r.status === "needs_unit") ...        // AR053: 단위 선택 대화상자 → importDxf(bytes, { unit })
//   if (r.ok && r.status === "ok") r.candidates ...   // 경계 선택 화면, r.warnings(AR054) 표시
//   if (!r.ok) r.error.code ...                       // 상한 초과·손상·바이너리 등 (부분 결과 없음)
import { DxfFail, type DxfImportErrorCode } from "./errors.ts";
import { flatten } from "./flatten.ts";
import { DEFAULT_MAX_CANDIDATES, HARD_MAX_CANDIDATES, resolveLimits } from "./limits.ts";
import { extractCandidates, toMmInts } from "./loops.ts";
import { parseDxf } from "./parse.ts";
import { decodeUtf8 } from "./text.ts";
import { UNIT_TO_MM, type DxfImportOptions, type DxfImportResult, type DxfImportStats, type DxfWarning } from "./types.ts";
import { decideUnit } from "./units.ts";

export { DEFAULT_LIMITS, MAX_FILE_BYTES, MAX_INSERT_DEPTH, MAX_ENTITIES, MAX_EXPANDED_ENTITIES, MAX_TOTAL_VERTICES } from "./limits.ts";
export type { DxfImportLimits } from "./limits.ts";
export type { DxfImportError, DxfImportErrorCode } from "./errors.ts";
export { UNIT_TO_MM } from "./types.ts";
export type {
  DxfImportOptions,
  DxfImportResult,
  DxfImportStats,
  DxfUnit,
  DxfWarning,
  LayerHint,
  SiteCandidate,
  UnitInfo,
  UnitOption,
} from "./types.ts";

const BINARY_SENTINEL = "AutoCAD Binary DXF";

function fail(code: DxfImportErrorCode, message: string): DxfImportResult {
  return { ok: false, error: { code, message } };
}

export function importDxf(input: Uint8Array | string, options: DxfImportOptions = {}): DxfImportResult {
  try {
    return run(input, options);
  } catch (e) {
    if (e instanceof DxfFail) return { ok: false, error: e.info };
    // 예상 못 한 예외도 예외로 새지 않게 구조화한다(내용·경로 없음). 퍼징 테스트가 이 코드 0건을 확인한다.
    return fail("DXF_INTERNAL", "DXF를 처리하는 중 예상하지 못한 오류가 발생했습니다");
  }
}

function run(input: Uint8Array | string, options: DxfImportOptions): DxfImportResult {
  const limits = resolveLimits(options.limits);
  if (options.unit !== undefined && !Object.prototype.hasOwnProperty.call(UNIT_TO_MM, options.unit)) {
    throw new DxfFail("DXF_INVALID_OPTION", "알 수 없는 단위입니다");
  }
  const maxCand = options.max_candidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isInteger(maxCand) || maxCand < 1 || maxCand > HARD_MAX_CANDIDATES) {
    throw new DxfFail("DXF_INVALID_OPTION", `후보 개수는 1~${HARD_MAX_CANDIDATES}입니다`);
  }
  const tol = options.join_tolerance_mm ?? 1;
  if (tol !== 0 && tol !== 1) throw new DxfFail("DXF_INVALID_OPTION", "이음 허용 오차는 0 또는 1mm입니다");

  const size = typeof input === "string" ? input.length : input.length;
  if (size > limits.max_file_bytes) {
    throw new DxfFail("AR055", `DXF는 ${Math.floor(limits.max_file_bytes / (1024 * 1024))}MB까지 가져옵니다`, { limit: limits.max_file_bytes });
  }
  if (typeof input !== "string") {
    if (input.length >= BINARY_SENTINEL.length) {
      let isBin = true;
      for (let i = 0; i < BINARY_SENTINEL.length; i++) {
        if (input[i] !== BINARY_SENTINEL.charCodeAt(i)) {
          isBin = false;
          break;
        }
      }
      if (isBin) throw new DxfFail("DXF_BINARY", "바이너리 DXF는 지원하지 않습니다. ASCII DXF로 저장해 다시 시도해 주세요");
    }
    const head = Math.min(input.length, 4096);
    for (let i = 0; i < head; i++) {
      if (input[i] === 0) throw new DxfFail("DXF_MALFORMED", "텍스트 DXF가 아닌 바이트가 들어 있습니다");
    }
  } else if (input.startsWith(BINARY_SENTINEL)) {
    throw new DxfFail("DXF_BINARY", "바이너리 DXF는 지원하지 않습니다. ASCII DXF로 저장해 다시 시도해 주세요");
  }

  const text = typeof input === "string" ? input : decodeUtf8(input);
  const doc = parseDxf(text, limits);
  const flat = flatten(doc, limits);
  if (flat.start.length === 0) throw new DxfFail("DXF_EMPTY", "이 파일에서 도면 요소(선·폴리라인·호·원)를 읽지 못했습니다");

  const warnings: DxfWarning[] = [];
  const kinds = Object.keys(flat.skipped);
  if (kinds.length > 0) {
    const total = kinds.reduce((s, k) => s + (flat.skipped[k] as number), 0);
    const list = kinds.map((k) => `${k} ${flat.skipped[k]}`).join(", ");
    warnings.push({ code: "AR054", detail: `${total}개 요소를 건너뛰었습니다(${list})`, skipped_entities: { ...flat.skipped } });
  }

  const stats: DxfImportStats = {
    file_bytes: size,
    entities_parsed: doc.entityCount,
    entities_expanded: flat.expanded,
    chains: flat.start.length,
    vertices: flat.vertices,
    closed_chains: 0,
    open_chains: 0,
    paper_space_entities: doc.paperSpace,
    hidden_layer_entities: flat.hiddenLayerEntities,
    ignored_annotations: flat.ignoredAnnotations,
    loops_below_min_area: 0,
    loops_rejected: 0,
    loops_unchecked: 0,
    duplicates_removed: 0,
  };

  const decision = decideUnit(flat, doc.insunits, doc.measurement, options.unit);
  if (decision.kind === "ask") {
    return {
      ok: true,
      status: "needs_unit",
      code: "AR053",
      reason: decision.reason,
      declared_insunits: doc.insunits,
      options: decision.options,
      warnings,
      stats,
    };
  }

  const ints = toMmInts(flat, decision.info.unit);
  const { candidates, counters } = extractCandidates(flat, ints, maxCand, tol);
  Object.assign(stats, counters);
  return { ok: true, status: "ok", unit: decision.info, candidates, warnings, stats };
}
