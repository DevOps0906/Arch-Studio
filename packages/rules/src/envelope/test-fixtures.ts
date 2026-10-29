// 엔벨로프 테스트·골든·벤치 전용 고정 입력(배포 코드에서 import하지 않는다).
// 판정 테스트 팩(FIXTURE_PACK_RAW, 전부 가짜)에 가짜 일조사선 수치를 넣은 복사본. 법령명·조문·수치·날짜는 모두 가짜다(실제 법규 값 아님).
import { FIXTURE_PACK_RAW } from "../test-fixtures.ts";

/** 가짜 구 기준: 높이 3m까지 거리 1m, 그 위는 거리 ≥ 높이(1/1). */
export const FAKE_SUNLIGHT_OLD = {
  bands_by_district: {
    가짜주거: [
      { up_to_mm: 3000, min_distance_mm: 1000 },
      { up_to_mm: null, distance_ratio: { num: 1, den: 1 } },
    ],
  },
  road_edges: "exempt",
};

/** 가짜 신 기준: 4m까지 1.2m, 7m까지 3m, 그 위는 거리 ≥ 높이 × 2/3. */
export const FAKE_SUNLIGHT_NEW = {
  bands_by_district: {
    가짜주거: [
      { up_to_mm: 4000, min_distance_mm: 1200 },
      { up_to_mm: 7000, min_distance_mm: 3000 },
      { up_to_mm: null, distance_ratio: { num: 2, den: 3 } },
    ],
  },
  road_edges: "exempt",
};

/** 엔벨로프용 가짜 팩 원본(JSON 값). 일조사선 시행 경계 2000-07-01(가짜). */
export function envelopeFixturePackRaw(): unknown {
  const raw = JSON.parse(JSON.stringify(FIXTURE_PACK_RAW)) as { title: string; rules: { id: string; params?: unknown }[] };
  raw.title = "엔벨로프 테스트 팩(가짜 값)";
  for (const r of raw.rules) {
    if (r.id === "sunlight.fake-old") r.params = JSON.parse(JSON.stringify(FAKE_SUNLIGHT_OLD)) as unknown;
    if (r.id === "sunlight.fake-new") r.params = JSON.parse(JSON.stringify(FAKE_SUNLIGHT_NEW)) as unknown;
  }
  return raw;
}

/** 표시 상한(테스트용, 법규 수치 아님). */
export const TEST_CAP_MM = 30000;
