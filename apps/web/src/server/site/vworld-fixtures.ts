// VWorld 응답 픽스처(테스트 전용, 프로덕션 코드에서 import하지 않는다). 형식은 공개 문서 기준이며 원문 확인 전(D-14, 미확인).
// 지오코더 2.0: { response: { status, result: { crs, point: { x, y } } } } (x·y는 문자열)
// 데이터 API 2.0: { response: { status, result: { featureCollection: { type, features: [{ geometry, properties }] } } } }
// 값은 [예시]: 실제 필지가 아니다.

export const FIXTURE_PNU = "4113510900100120004";

/** 18 × 22m 직사각형(EPSG:5186, m). 닫는 점 포함(GeoJSON 관례). */
export const FIXTURE_RING: [number, number][] = [
  [200100.125, 550100.5],
  [200118.125, 550100.5],
  [200118.125, 550122.5],
  [200100.125, 550122.5],
  [200100.125, 550100.5],
];

export function geocodeOk(x = "200109.0", y = "550111.0"): unknown {
  return { response: { service: { name: "address" }, status: "OK", input: { type: "PARCEL" }, refined: { text: "[예시]" }, result: { crs: "EPSG:5186", point: { x, y } } } };
}

export function parcelOk(ring: unknown = FIXTURE_RING, props: Record<string, unknown> = {}): unknown {
  return {
    response: {
      status: "OK",
      result: {
        featureCollection: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "MultiPolygon", coordinates: [[ring]] },
              properties: { pnu: FIXTURE_PNU, addr: "[예시] 경기도 성남시 분당구 운중동 12-4", jibun: "12-4대", ...props },
            },
          ],
        },
      },
    },
  };
}

export function zoningOk(names: string[] = ["제1종일반주거지역"]): unknown {
  return {
    response: {
      status: "OK",
      result: { featureCollection: { type: "FeatureCollection", features: names.map((uname) => ({ type: "Feature", geometry: null, properties: { uname } })) } },
    },
  };
}

export const NOT_FOUND = { response: { status: "NOT_FOUND" } };
export const PROVIDER_ERROR = { response: { status: "ERROR", error: { code: "INVALID_KEY", text: "인증키 정보가 올바르지 않습니다." } } };
