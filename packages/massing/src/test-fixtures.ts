// 매스 제안 테스트·골든·벤치 전용 고정 입력(배포 코드에서 import하지 않는다).
// 규칙 팩은 rules의 가짜 팩(법령명·조문·수치 모두 가짜)을 그대로 쓴다. 실제 법규 값 아님.
import type { DesignModelV1, Point } from "@arch-studio/domain";
import type { SuggestTargets } from "./suggest.ts";
import { loadRulePack, type RulePack } from "@arch-studio/rules";
import { envelopeFixturePackRaw } from "../../rules/src/envelope/test-fixtures.ts";
import { fixtureModel } from "../../rules/src/test-fixtures.ts";

export { envelopeFixturePackRaw, fixtureModel };

/** 가짜 확정 팩(일조사선 신 기준 적용: 신청일 2000-07-02). */
export function fixturePack(): RulePack {
  return loadRulePack(envelopeFixturePackRaw());
}

/** 매스 없는 20m×15m 대지 모델(기준: 건폐 40%·용적 150%·높이 12m·이격 1.5m/1m·일조사선 가짜 신 기준). */
export function emptySiteModel(over: Partial<DesignModelV1["rule_context"]> = {}): DesignModelV1 {
  const m = fixtureModel({ application_date: "2000-07-02", ...over });
  m.masses = [];
  return m;
}

/** 고정 시드 LCG(테스트 입력 생성용 — 엔진 코드 아님). */
export function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

/** L자 대지(반시계): 30m×20m에서 오른쪽 위 15m×10m를 뺀 모양. */
export const L_SHAPE: Point[] = [
  [0, 0],
  [30000, 0],
  [30000, 10000],
  [15000, 10000],
  [15000, 20000],
  [0, 20000],
];

/** 골든 케이스(입력 생성기). 갱신: pnpm --filter @arch-studio/massing golden:update */
export function goldenCases(): Record<string, { model: DesignModelV1; targets: SuggestTargets }> {
  const lShape = emptySiteModel();
  lShape.site.boundary = { outer: L_SHAPE };
  lShape.site.north_angle_deg = 30;
  lShape.site.roads = [{ edge_index: 0, width_mm: 6000 }];
  const t = (gfa: number): SuggestTargets => ({ target_gfa_m2: gfa, floors: null, floor_height_mm: 3000, use: "가짜용도A" });
  return {
    "fixture-rect-target300": { model: emptySiteModel(), targets: t(300) },
    "fixture-rect-target-unreachable": { model: emptySiteModel(), targets: t(5000) },
    "fixture-lshape-north30": { model: lShape, targets: t(200) },
  };
}
