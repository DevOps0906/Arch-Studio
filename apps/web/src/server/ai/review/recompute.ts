// 클라우드 검토 입력의 서버 재계산(02_ARCHITECTURE.md 4장 마지막 문단·6절 위험 #1, AR-06-051).
// 데스크톱이 보낸 JudgmentResult·model_summary는 믿지 않는다: 업로드된 DesignModel을 같은 packages/rules 엔진·같은 규칙 팩 버전으로
// 다시 돌린 결과만 arch.reviews(judgment·model_summary)에 저장한다. 그래프는 이 값만 읽고, LLM은 숫자를 자리표시자로만 쓴다.
// DesignModel 모양 검사는 judge 안의 designModelV1Schema(strict)가 한다(실패 = RulesError INVALID_INPUT).
// server-only를 import하지 않는다(node --test 대상).
import { createHash } from "node:crypto";
import { canonicalJson, judge, loadRulePack, measure, RulesError, type JudgeOutput, type RulePack } from "@arch-studio/rules";
import { GatewayError } from "../gateway/http.ts";

export type { RulePack };

type DesignModel = Parameters<typeof judge>[0];
export type ServerJudgmentResult = JudgeOutput["result"];

/** arch.reviews.model_summary(04_API.md 2.1절 review 행 + 그래프 select_items용 ordinance_unverified + 입력 지문). 모두 서버 계산값. */
export interface ReviewModelSummary {
  site_area_m2: number;
  use_district: string;
  floors: number;
  gross_area_m2: number;
  building_area_m2: number;
  height_mm: number;
  /** "조례 미확인"(ORDINANCE_UNVERIFIED) 사유가 붙은 판정 key(사전순, 중복 없음). */
  ordinance_unverified: string[];
  /** DesignModel 정규 JSON의 sha256(소문자 hex). 같은 request_id 재전송이 같은 입력인지 대조한다. */
  input_sha256: string;
}

export interface ServerJudgment {
  judgment: ServerJudgmentResult;
  summary: ReviewModelSummary;
}

/** 2배 mm² 면적 → m²(소수 둘째 자리 반올림, 정수 연산). */
function m2Of(area2: bigint): number {
  return Number((area2 * 100n + 1_000_000n) / 2_000_000n) / 100;
}

/** 저장소에서 읽은 팩 원문 → RulePack. 형식 오류는 null(호출자가 실패 닫힘). */
export function parseRulePack(text: string): RulePack | null {
  try {
    return loadRulePack(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 입력 지문: 키 정렬 JSON의 sha256. 같은 DesignModel이면 키 순서와 상관없이 같다. */
export function designModelFingerprint(rawModel: unknown): string {
  return createHash("sha256").update(canonicalJson(rawModel), "utf8").digest("hex");
}

/**
 * DesignModel(검사 전 값) + 서버 규칙 팩 → 서버 판정. DesignModel이 계약과 다르면 invalid_input, rule_context 버전이 팩과 다르면 22023.
 * 결정적: 같은 입력이면 같은 출력(엔진 규칙).
 */
export function recomputeJudgment(rawModel: unknown, pack: RulePack): ServerJudgment {
  let out: JudgeOutput;
  try {
    out = judge(rawModel as DesignModel, pack, { pendingChanges: 0 });
  } catch (error) {
    if (error instanceof RulesError) throw new GatewayError("invalid_input");
    throw error;
  }
  // judge가 strict 검사를 통과시켰으므로 여기부터 rawModel은 DesignModel이다.
  const model = rawModel as DesignModel;
  if (model.rule_context.rule_pack_version !== pack.version) throw new GatewayError("22023");
  const m = measure(model);
  const unverified = new Set<string>();
  out.details.forEach((d) => {
    if (d.reasons.includes("ORDINANCE_UNVERIFIED")) unverified.add(d.key);
  });
  return {
    judgment: out.result,
    summary: {
      site_area_m2: m2Of(m.site_area2),
      use_district: model.site.zoning.use_district,
      floors: m.above_floors,
      gross_area_m2: m2Of(m.gross_area2),
      building_area_m2: m2Of(m.building_area2),
      height_mm: m.height_mm,
      ordinance_unverified: [...unverified].sort(),
      input_sha256: designModelFingerprint(model),
    },
  };
}
