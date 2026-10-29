# writers/png — PNG 래스터화 (AR-06-022)

`writePng(sheet, options)` = `writeSvg` 결과 SVG → **resvg**(npm `@resvg/resvg-js` 2.6.2) → PNG(`Uint8Array`). 미리보기 = SVG = PNG(같은 장면).

- 쓰는 곳: **웹 서버·작업 워커·CI·샘플 생성(Node)**. 하위 경로 export `@arch-studio/drafting/writers/png`로만 쓴다. 패키지 루트(`src/index.ts`)는 **타입(`PngOptions`·`PngResult`)과 `OutputError`만** 내보낸다 — resvg는 네이티브 모듈이라 루트가 끌어오면 엔진 워커·웹 번들이 깨진다(`png.test.ts`가 확인).
- **데스크톱(Tauri, Node 없음)에서는 쓸 수 없다.** 아래 "데스크톱 — 후속 결정 항목".
- 결정 이력: 대표 결정으로 래스터화 라이브러리를 sharp(libvips, LGPL)에서 **resvg(MPL-2.0)** 로 바꿨다. 이유: 설치형(Rust)에서 같은 렌더러(resvg 크레이트)를 쓸 수 있어 웹·설치형 결과를 같은 엔진으로 맞출 수 있고, 시스템 글꼴 의존이 없다.

## 한글 글꼴 — 채택안과 실험 결과
| 방법 | 결과 |
|---|---|
| (sharp/librsvg) 시스템 글꼴 | 'Noto Sans KR'을 못 찾으면 시스템의 임의 CJK 글꼴로 대체됨 → PC마다 다른 글꼴. 폐기 |
| (sharp/librsvg) SVG `@font-face` base64 | 시험 결과 **무시됨**(시스템 글꼴과 같은 결과). 폐기 |
| (sharp/librsvg) `FONTCONFIG_FILE`로 fonts/ 지정 | 번들 글꼴이 적용되나 프로세스 환경 변수·첫 호출 전 설정이 필요하고, 이미 fontconfig가 초기화된 프로세스에서는 적용되지 않음(지연 설정 시 결과가 달라짐) |
| **채택: resvg `font.fontFiles` + `loadSystemFonts:false`** | 번들 TTF 경로만 로드, 시스템 글꼴 완전 배제. `defaultFontFamily`·sans-serif·serif·monospace·cursive·fantasy를 모두 'Noto Sans KR'로 지정 → 어떤 family 이름이어도 번들 글꼴 |
- resvg-js 2.6.2의 `font` 옵션은 `fontFiles`(경로 목록)·`fontDirs`만 있다(`fontBuffers`는 2.6.3 이후 알파). 그래서 `font_file` 옵션은 **파일 경로**다. 기본은 `fonts/NotoSansKR-Regular.subset.ttf`.
- 한글이 두부(□)가 아님: `png.test.ts` "한글 렌더" — '가나다'가 그려지고(잉크 픽셀 다수) 부분 집합 밖 글자(.notdef)와 다른 그림이며, 글꼴이 없으면 아무것도 그리지 않는다(조용한 시스템 글꼴 대체 없음). 골든 `png-korean-long-names`도 눈으로 확인했다.
- 부분 집합 밖 글자(한자 등): 이 글꼴의 `.notdef`는 빈 글리프라 빈칸으로 나오고, `PngResult.warnings`에 `AR057`을 돌려준다(`fonts/README.md`).

## 렌더 옵션 전체(`PNG_RENDER_OPTIONS`·`writePng` — 후속 Rust가 그대로 재현할 것)
| 항목 | 값 |
|---|---|
| 입력 SVG | `writeSvg(sheet, { font_family: "'Noto Sans KR', sans-serif", metrics: 번들 폭 표 })` — 골든 `input.svg`와 같음 |
| 크기 | 가로 = `round(용지mm / 25.4 × dpi)`(dpi 기본 150, 10~1200) 또는 `width_px`. `fitTo: { mode: "width", value }`, 세로는 비율. 상한 1억 화소 |
| 배경 | `#ffffff`(흰색). SVG 자체에도 흰 용지 `<rect>` |
| shapeRendering | 2 = GeometricPrecision(안티앨리어싱 켬) |
| textRendering | 2 = GeometricPrecision(글자 힌팅 없음) |
| imageRendering | 0 = OptimizeQuality(도면에 이미지 없음) |
| 글꼴 | `fontFiles:[번들 TTF]`, `loadSystemFonts:false`, 모든 generic family → 'Noto Sans KR', `defaultFontSize` 기본 |
| dpi 옵션(resvg `dpi`) | 쓰지 않음(기본 96). 크기는 위 fitTo로 정함 — SVG `width`는 mm이므로 px 변환이 dpi에 의존하지 않게 하려는 것 |
| 출력 | RGBA(알파 255 고정, 흰 배경으로 채움)·8비트·비인터레이스. 청크 = IHDR·IDAT·IEND만 |
- 렌더러: `@resvg/resvg-js@2.6.2` = Rust **resvg 0.34.0**(`zimond/resvg` rev `3495d870` 포크, resvg-js `[patch.crates-io]`), tiny-skia 0.10.0, fontdb 0.14.1, rustybuzz 0.7.0, ttf-parser 0.18.1, png 0.17.5(바이너리 문자열·Cargo.toml v2.6.2 확인). resvg-js 빌드 기능: `raster-images`, `text`, `system-fonts`(우리는 런타임에 시스템 글꼴을 끔). 리눅스 x64 바이너리 sha256 `56c967fa1e26484021a1a32d5b4e6b75cfe789ce396d58ec1bb87f4d7e7d39b8`.
- **후속 Rust(AR-06-080) 재현 방법**: resvg 크레이트(같은 0.34.x, `text`·`raster-images`)로 `golden/png-*/input.svg`를 위 옵션으로 렌더(`usvg::Options`에 `fontdb`에 번들 TTF만 로드, 시스템 글꼴 로드 안 함, generic family를 'Noto Sans KR'로 지정, 폭은 fitTo width, 흰 배경 채움)하고 `expected.png`와 픽셀 비교한다. 크레이트 버전이 올라가면 안티앨리어싱·글자 배치가 조금 달라질 수 있어 **바이트가 아니라 픽셀 허용오차**로 비교하고, 달라지면 골든 `--force` 갱신과 이유를 남긴다.

## 결정성 분석
- 같은 환경 2회: **바이트 동일**(같은 프로세스 2회, 별개 프로세스, `TZ=UTC·Asia/Seoul·America/New_York` — 한글 긴 이름 시트 840px에서 sha256 `a9e3336dbc8fc8c4…` 모두 같음).
- 메타데이터: IHDR·IDAT·IEND뿐(pHYs도 없음) — 시각(tIME)·텍스트(tEXt)·소프트웨어 이름 청크 없음. 같은 입력이면 같은 바이트(`png.test.ts`가 청크 목록을 확인).
- 플랫폼·resvg/zlib 버전 간 바이트 동일은 **보장하지 않는다**: 안티앨리어싱 부동소수점·SIMD 경로, png 크레이트 deflate 구현이 다를 수 있다. 따라서 **골든은 같은 환경에서는 바이트 비교, 다르면 디코드한 RGBA 픽셀 허용오차(채널 차 3 초과 화소가 0.1% 미만)** 로 설계했다(`png.test.ts`, 시험용 PNG 디코더 `golden/png-tools/harness.ts`). `meta.json`에 바이트 sha256과 디코드 픽셀 sha256을 모두 적는다.
- 성능: A3 @150dpi(2480×1754) 한 장 ≈ 160ms(79KB), Node 22 리눅스 x64.

## 골든(3건, `golden/png-*`)
| 케이스 | 폭 | 검증 |
|---|---|---|
| `png-site-a3-basic` | 840px | 선·해치·치수·한글 표제란 |
| `png-korean-long-names` | 840px | 한글 긴 이름·MTEXT 줄바꿈(두부 아님) |
| `png-hatch-ansi31` | 600px | ANSI31·SOLID 해치, 가는 선 안티앨리어싱 |
- 파일: `input.svg`(writeSvg 결과), `expected.png`(약 15~24KB), `meta.json`(렌더러·옵션 전체·sha256). 총 약 100KB.
- 갱신: `cd packages/drafting && node golden/png-tools/update.ts [--force]`. `--force`는 그림이 바뀔 때만, 이유(resvg 버전·글꼴·`PNG_WRITER_VERSION`)를 커밋 본문에 적는다.

## 라이선스(법률 자문 아님)
- `@resvg/resvg-js` 및 플랫폼 바이너리 12종: **MPL-2.0**. 수정 없이 쓰는 배포는 고지 + 소스 위치(THIRD_PARTY_NOTICES.md)로 충족. GPL·AGPL·LGPL 아님. 전이 npm 의존성 없음(optionalDependencies만). 자세한 표는 THIRD_PARTY_NOTICES.md.

## 데스크톱 — 후속 결정 항목(구현하지 않음)
이 앱의 데스크톱 셸은 Tauri(Rust)이고 **Node 런타임이 없다**. resvg-js·sharp 같은 npm 네이티브 모듈은 설치형에 들어가지 않으므로 이 `writePng`는 데스크톱에서 호출할 수 없다. PNG가 필요한 곳과 대안:
1. **필요한 곳**: 도면 PNG 미리보기·내보내기(AR-F-038), 제안서·보고서에 넣는 시트 이미지(AR-06-032), 샘플 생성. 웹(서버/워커/CI)은 이 모듈로 충족된다. 설치형(오프라인)은 로컬에서 같은 결과가 필요하다.
2. **후속 결정 후보**
   - (가) **Rust resvg 크레이트**(AR-06-080 후보): 같은 렌더러·같은 옵션 → 웹과 같은 그림(위 "재현 방법"). 설치 파일 크기 증가(수 MB)·Tauri 커맨드·글꼴 리소스 번들이 필요. 추천 후보.
   - (나) **WebView canvas 래스터화**: 구현은 쉬우나 WebView 글꼴 렌더러(WebView2/WKWebView)가 달라 플랫폼마다 그림이 다르고 결정성이 없다. 미리보기용으로는 가능, 내보내기 정본으로는 부적합.
3. 결정 전까지 설치형은 SVG·PDF·DXF 내보내기만 보장한다. 결정할 것: 설치형 PNG를 정본 내보내기에 포함할지, (가)로 갈 때 resvg 크레이트 버전 고정과 골든 공유(`golden/png-*/input.svg`를 Rust 테스트가 읽음).
