// `arch.start_ai_run` 호출 헬퍼(04_API.md 3장, 02_ARCHITECTURE.md 4장). AI Route Handler(render·review·intake·proposal 작업)가 쓴다.
// 크레딧 선차감·enqueue는 이 RPC 한 트랜잭션 안에서만 한다. Route Handler는 core.consume_credits를 직접 부르지 않는다(검색 테스트).
// RPC 이름·인자는 supabase/modular/2400_arch.sql·2401_arch_fixes.sql에서 읽기만 했다:
//   arch.start_ai_run(p_org uuid, p_actor uuid, p_kind text, p_variant text, p_request_id uuid, p_project_ref uuid, p_options jsonb)
//   → table(run_id uuid, job_id uuid, credits integer). EXECUTE는 service_role에만(2401:249).
// service_role 사용 이유: 이 함수는 차감·enqueue를 하므로 사용자 역할에 EXECUTE가 없다(설계상 서버만). 호출은 RunStarter 하나로 모은다.
// 금액 인자는 없다: 차감액은 DB가 p_variant로 runtime_config에서 정하고, 여기서는 pricing.ts 상수와 반환값을 대조만 한다.
// server-only를 import하지 않는다(node --test 대상).
import { GatewayError, UUID_RE, UUID_V4_RE, type GatewayErrorCode } from "./http.ts";
import { gatewayLog } from "./log.ts";
import { isRunKind, isValidRunVariant, PHASE2_KINDS, priceOf, type RunKind, type RunVariant } from "../pricing.ts";

export interface StartAiRunInput {
  /** 세션에서 얻은 조직(본문 값 아님). */
  orgId: string;
  /** 세션 사용자. */
  actorId: string;
  kind: RunKind;
  variant: RunVariant;
  /** 클라이언트 멱등 키(UUID v4). 같은 값 재전송은 기존 실행을 돌려준다(추가 차감 없음). */
  requestId: string;
  projectRef: string;
  /** 서버가 만든 옵션(kind별 입력). 금액·조직 키는 거부한다. */
  options: Record<string, unknown>;
}

export interface StartAiRunResult {
  run_id: string;
  job_id: string;
  credits: number;
}

/** DB 호출 포트. 구현: supabase-repo.ts(service_role). 오류는 { code: SQLSTATE }를 담아 throw. */
export interface RunStarter {
  startAiRun(args: {
    p_org: string;
    p_actor: string;
    p_kind: RunKind;
    p_variant: RunVariant;
    p_request_id: string;
    p_project_ref: string;
    p_options: Record<string, unknown>;
  }): Promise<unknown>;
  /**
   * 같은 request_id의 실행 행이 이미 있는가(멱등 재전송 판별). 로그 분류에만 쓰며 차감 판단에는 쓰지 않는다.
   * 구현하지 않으면 재전송을 구분하지 못하고 불일치를 오류로 남긴다(실패 쪽이 경보 쪽).
   */
  runExists?(requestId: string): Promise<boolean>;
}

/** p_options에 들어오면 안 되는 키(금액·조직·행위자 위조 시도). 깊이 상관없이 검사한다. */
const FORBIDDEN_OPTION_KEYS = new Set([
  "credits",
  "credit",
  "amount",
  "price",
  "cost",
  "krw",
  "org",
  "org_id",
  "p_org",
  "actor",
  "actor_id",
  "user_id",
  "p_actor",
  "ledger",
  "credit_ledger_id",
  "idempotency_key",
]);

function findForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 32) return true; // 비정상적으로 깊은 입력은 거부
  if (Array.isArray(value)) return value.some((v) => findForbiddenKey(v, depth + 1));
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_OPTION_KEYS.has(k.toLowerCase()) || k === "__proto__") return true;
      if (findForbiddenKey(v, depth + 1)) return true;
    }
  }
  return false;
}

/** SQLSTATE → 게이트 오류 코드(04_API.md 7장). 모르는 코드는 internal. AR034 → AI_DAILY_LIMIT(429). */
export function mapStartRunError(error: unknown): GatewayErrorCode {
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case "AR012":
    case "AR030":
    case "AR031":
    case "CR001":
    case "42501":
    case "22023":
    case "23514":
      return code;
    case "AR034":
      return "AI_DAILY_LIMIT";
    case "P0002":
      return "not_found";
    default:
      return "internal";
  }
}

function parseResult(data: unknown): StartAiRunResult | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (row === null || typeof row !== "object") return null;
  const { run_id, job_id, credits } = row as Record<string, unknown>;
  if (typeof run_id !== "string" || !UUID_RE.test(run_id)) return null;
  if (typeof job_id !== "string" || !UUID_RE.test(job_id)) return null;
  if (typeof credits !== "number" || !Number.isSafeInteger(credits) || credits < 0) return null;
  return { run_id, job_id, credits };
}

/**
 * 실행 시작. 입력 검사(kind·variant 표, UUID, request_id v4, 옵션 금지 키) → RPC → 반환 검사.
 * 같은 request_id 재호출은 DB가 기존 실행을 돌려준다(그 경우 credits는 처음 차감액 그대로).
 */
export async function startAiRun(starter: RunStarter, input: StartAiRunInput): Promise<StartAiRunResult> {
  if (!isRunKind(input.kind) || !isValidRunVariant(input.kind, input.variant)) throw new GatewayError("22023");
  if (PHASE2_KINDS.has(input.kind)) throw new GatewayError("22023");
  if (!UUID_RE.test(input.orgId) || !UUID_RE.test(input.actorId) || !UUID_RE.test(input.projectRef)) throw new GatewayError("22023");
  if (!UUID_V4_RE.test(input.requestId)) throw new GatewayError("invalid_input");
  if (input.options === null || typeof input.options !== "object" || Array.isArray(input.options) || findForbiddenKey(input.options)) {
    throw new GatewayError("invalid_input");
  }
  const expected = priceOf(input.variant);

  // 재전송이면 DB는 최초 차감액을 돌려준다(현재 단가와 다를 수 있다). 호출 전에 알아야 하므로 먼저 본다.
  let replay = false;
  if (starter.runExists) {
    try {
      replay = await starter.runExists(input.requestId);
    } catch {
      replay = false; // 판별 실패는 경보 쪽으로(불일치를 오류로 남긴다)
    }
  }

  let data: unknown;
  try {
    data = await starter.startAiRun({
      p_org: input.orgId,
      p_actor: input.actorId,
      p_kind: input.kind,
      p_variant: input.variant,
      p_request_id: input.requestId,
      p_project_ref: input.projectRef,
      p_options: input.options,
    });
  } catch (error) {
    const code = mapStartRunError(error);
    gatewayLog.warn("start_ai_run.rejected", { route: "start_ai_run", code, kind: input.kind, variant: input.variant });
    throw new GatewayError(code);
  }
  const result = parseResult(data);
  if (!result) {
    gatewayLog.error("start_ai_run.bad_result", { route: "start_ai_run", kind: input.kind, variant: input.variant });
    throw new GatewayError("internal");
  }
  if (result.credits !== expected) {
    const fields = { route: "start_ai_run" as const, kind: input.kind, variant: input.variant, run_id: result.run_id };
    if (input.variant === "doc_template" && result.credits === 0) {
      // 정상: 같은 조직의 doc_template 성공 이력이 있으면 DB가 0크레딧으로 처리한다(2400_arch.sql 1225행 부근).
      gatewayLog.info("start_ai_run.free_rerun", fields);
    } else if (replay) {
      // 정상: 멱등 재전송은 최초 차감액을 돌려준다(단가가 그 뒤 바뀌었을 수 있음).
      gatewayLog.info("start_ai_run.replay", fields);
    } else {
      // 차감은 이미 DB 기준으로 끝났다(원장이 정본). 상수와 seed가 어긋났다는 운영 신호만 남긴다(AR-06-049가 CI에서 막는다).
      gatewayLog.error("start_ai_run.price_mismatch", fields);
    }
  }
  return result;
}
