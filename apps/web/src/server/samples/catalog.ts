// 샘플 도면 목록의 정본 id·형식. 파일은 scripts/samples/build.ts 가 만든 apps/web/public/samples/** (manifest.json 과 일치).
// 이 파일은 route·페이지·테스트가 함께 쓰므로 server-only 가드를 걸지 않는다(비밀·I/O 없음).
export const SAMPLE_IDS = ["site-plan", "area-plan", "sunlight-section"] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

export const SAMPLE_FORMATS = ["dxf"] as const;
export type SampleFormat = (typeof SAMPLE_FORMATS)[number];

/** 화면 문구(한국어). 가상 대지 3건, 수치는 예시다. */
export const SAMPLE_COPY: Readonly<Record<SampleId, { site: string; title: string; description: string; alt: string }>> = {
  "site-plan": {
    site: "예시 대지 1",
    title: "배치도",
    description: "대지 경계, 건물 윤곽, 이격 거리, 주차 배치와 요약표가 들어 있습니다.",
    alt: "예시 대지 1 배치도",
  },
  "area-plan": {
    site: "예시 대지 2",
    title: "면적 산정도",
    description: "층별 면적과 용도별 면적표, 건축면적·연면적 산정 근거가 들어 있습니다.",
    alt: "예시 대지 2 면적 산정도",
  },
  "sunlight-section": {
    site: "예시 대지 3",
    title: "일조사선 단면",
    description: "정북 방향 단면에 사선 제한선과 건물 윤곽을 겹쳐 보여 줍니다.",
    alt: "예시 대지 3 일조사선 단면",
  },
};

export const sampleFileName = (id: SampleId, format: SampleFormat): string => `${id}.${format}`;
export const samplePublicPath = (id: SampleId, format: SampleFormat): string => `/samples/${sampleFileName(id, format)}`;
