// 번들 기본 글꼴(AR-06-022, 대표 결정: Noto Sans KR, SIL OFL 1.1). 파일은 packages/drafting/fonts/(출처·부분 집합 근거는 그 README).
// 이 모듈은 이름·파일 이름 상수만 둔다(순수, 브라우저·워커에서도 import 가능). 파일 읽기는 Node 전용 ./node.ts(loadBundledFont),
// 브라우저·워커는 호출자가 앱 자산으로 배포한 같은 파일을 fetch해 writePdf({ font: { family: BUNDLED_FONT_FAMILY, ttf } })로 넣는다.

/** CSS·SVG font-family 이름(글꼴 name 표 1번과 같다). */
export const BUNDLED_FONT_NAME = "Noto Sans KR";
/** jsPDF 등록 이름(공백 없는 PostScript 계열 이름). */
export const BUNDLED_FONT_FAMILY = "NotoSansKR";
/** fonts/ 안의 글꼴 파일(현대 한글 11,172자 + 기호 부분 집합). */
export const BUNDLED_FONT_FILE = "NotoSansKR-Regular.subset.ttf";
/** fonts/ 안의 폭 표(scripts/font-metrics/generate.ts --name NotoSansKR). */
export const BUNDLED_METRICS_FILE = "NotoSansKR.metrics.json";
/** fonts/ 안의 라이선스 전문(배포물에 글꼴과 함께 넣는다). */
export const BUNDLED_FONT_LICENSE_FILE = "OFL.txt";
