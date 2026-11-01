// MapLibre 스타일시트(동적 import, 번들러가 CSS 청크로 처리한다). 값은 쓰지 않는다.
declare module "maplibre-gl/dist/maplibre-gl.css";

// MapLibre 워커(Vite `?worker&url`: 워커를 의존성까지 한 파일로 묶어 같은 출처 URL을 준다).
declare module "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url" {
  const url: string;
  export default url;
}
