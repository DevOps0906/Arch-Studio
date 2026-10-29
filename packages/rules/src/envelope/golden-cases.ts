// 엔벨로프 골든 입력 생성·평가 공용(테스트·update-golden 전용, 배포 코드에서 import하지 않는다).
import type { DesignModelV1 } from "@arch-studio/domain";
import type { SolidKernel } from "@arch-studio/geometry";
import { loadRulePack } from "../pack.ts";
import { fixtureModel } from "../test-fixtures.ts";
import { buildEnvelope, serializeEnvelope, type EnvelopeOptions } from "./envelope.ts";
import { envelopeFixturePackRaw, TEST_CAP_MM } from "./test-fixtures.ts";

export interface EnvelopeGoldenInput {
  /** "fixture"(가짜 팩) 또는 packs/<버전>. */
  pack: string;
  model: DesignModelV1;
  options: EnvelopeOptions;
}

/** 골든 케이스 입력(갱신 스크립트가 input.json으로 쓴다). 신·구 쌍은 가짜 시행 경계 2000-07-01 전날·당일. */
export function goldenInputs(): Record<string, EnvelopeGoldenInput> {
  const options = { cap_height_mm: TEST_CAP_MM };
  const rotated = fixtureModel();
  rotated.site.north_angle_deg = 30;
  const shipped = fixtureModel({ rule_pack_version: "2026.10.0", application_date: "2026-11-02" });
  return {
    "fixture-sunlight-old": { pack: "fixture", model: fixtureModel({ application_date: "2000-06-30" }), options },
    "fixture-sunlight-new": { pack: "fixture", model: fixtureModel({ application_date: "2000-07-01" }), options },
    "fixture-north-30deg": { pack: "fixture", model: rotated, options },
    "shipped-2026.10.0-basic": { pack: "2026.10.0", model: shipped, options },
  };
}

/** 골든 입력 → 정규 JSON 바이트. readPack은 packs/<버전>/pack.json 원본(JSON 값)을 돌려준다. */
export function runGolden(input: EnvelopeGoldenInput, kernel: SolidKernel, readPack: (version: string) => unknown): string {
  const raw = input.pack === "fixture" ? envelopeFixturePackRaw() : readPack(input.pack);
  return serializeEnvelope(buildEnvelope(input.model, loadRulePack(raw), kernel, input.options));
}
