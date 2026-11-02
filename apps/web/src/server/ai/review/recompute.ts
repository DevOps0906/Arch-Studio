// 클라우드 검토 입력의 서버 재계산(02_ARCHITECTURE.md 4장 마지막 문단·6절 위험 #1, AR-06-051).
// 데스크톱이 보낸 JudgmentResult·model_summary는 믿지 않는다: 업로드된 DesignModel을 같은 packages/rules 엔진·같은 규칙 팩 버전으로
// 다시 돌린 결과만 arch.reviews(judgment·model_summary)에 저장한다. 그래프는 이 값만 읽고, LLM은 숫자를 자리표시자로만 쓴다.
// import 경로: apps/web에는 @arch-studio/rules 워크스페이스 의존성이 아직 없어(package.json은 이 작업 범위 밖) 소스를 상대 경로로 읽는다.
// server-only를 import하지 않는다(node --test 대상).
import { designModelV1Schema, type DesignModelV1, type JudgmentResult } from "../../../../../../packages/domain/src/index.ts";
import { judge, loadRulePack, measure, RulesError, type RulePack } from "../../../../../../packages/rules/src/index.ts";
import { GatewayError } from "../gateway/http.ts";

export type { RulePack };

/** arch.reviews.model_summary(04_API.md 2.1절 review 행 + 그래프 select_items용 ordinance_unverified). 모두 서버 계산값. */
export interface ReviewModelSummary {
  site_area_m2: number;
  use_district: string;
  floors: number;
  gross_area_m2: number;
  building_area_m2: number;
  height_mm: number;
  /** "조례 미확인"(ORDINANCE_UNVERIFIED) 사유가 붙은 판정 key(사전순, 중복 없음). */
  ordinance_unverified: string[];
}

export interface ServerJudgment {
  judgment: JudgmentResult;
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

/**
 * DesignModel(검사 전 값) + 서버 규칙 팩 → 서버 판정. DesignModel이 계약과 다르거나 rule_context 버전이 팩과 다르면 invalid_input/22023.
 * 결정적: 같은 입력이면 같은 출력(엔진 규칙).
 */
export function recomputeJudgment(rawModel: unknown, pack: RulePack): ServerJudgment {
  const parsed = designModelV1Schema.safeParse(rawModel);
  if (!parsed.success) throw new GatewayError("invalid_input");
  const model: DesignModelV1 = parsed.data;
  if (model.rule_context.rule_pack_version !== pack.version) throw new GatewayError("22023");
  let out: ReturnType<typeof judge>;
  try {
    out = judge(model, pack, { pendingChanges: 0 });
  } catch (error) {
    if (error instanceof RulesError) throw new GatewayError("invalid_input");
    throw error;
  }
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
    },
  };
}
