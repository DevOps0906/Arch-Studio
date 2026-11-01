// 데모 대지 조회 응답(개발 전용, DEV + VITE_DEMO_MODE 게이트 안에서만 쓰인다 — demo/index.ts). POST /api/site/lookup 계약(035 service.ts) 모양 그대로.
// 값은 [예시]: 실제 필지·실제 지역 데이터가 아니다(PNU 앞 2자리 99는 없는 시·도 코드 — 어느 필지로도 읽히지 않는 가짜 값). 좌표는 EPSG:5186(m) 형식만 흉내 낸다.
// 입력에 "없음"이 들어 있으면 AR021(not_found)로 실패 경로를 보인다.
import { DEMO_MARKER } from "./samples.ts";

/** 약 17° 기운 사각형 대지(회전 직사각형 가로·세로 표시 확인용). 서버 응답처럼 닫는 점 없음. */
const DEMO_RING: [number, number][] = [
  [200100.0, 550100.0],
  [200117.2, 550105.26],
  [200111.5, 550126.3],
  [200094.3, 550120.1],
];

/** 존재하지 않는 법정동 코드(시·도 99)의 가짜 PNU(19자리 형식만 맞춘다). */
export const DEMO_PNU = "9999999999100010001";

export function demoSiteLookup(body: unknown): { status: number; body: unknown } {
  const value = typeof body === "object" && body !== null ? (body as { query?: { value?: unknown } }).query?.value : undefined;
  if (typeof value === "string" && value.includes("없음")) {
    return { status: 502, body: { ok: false, error: { code: "AR021", message: "", details: { reason: "not_found", next: "draw" } } } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      data: {
        parcel: { pnu: DEMO_PNU, address_label: "[예시] 가상동 1-1" },
        crs: "EPSG:5186",
        boundary_m: DEMO_RING,
        zoning: { use_district: "제2종일반주거지역", districts: [] },
        roads: [],
        sources: [{ provider: DEMO_MARKER, datasets: [], fetched_at: "2026-11-01T09:00:00.000Z" }],
        source: { kind: "input_candidate", judgment_basis: false, notice: "[예시] 공공 데이터 값은 입력 후보이며 판정 기준이 아닙니다. 경계·용도지역을 확인한 뒤 반영하세요." },
        notes: [],
        remaining_today: 29,
      },
    },
  };
}
