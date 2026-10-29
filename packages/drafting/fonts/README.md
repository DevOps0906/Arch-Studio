# packages/drafting/fonts — 번들 기본 글꼴(Noto Sans KR)과 폭 표

> 상태: **확정**(대표 결정, AR-06-022). 번들 기본 글꼴 = **Noto Sans KR Regular(400)**, SIL OFL 1.1, **현대 한글 음절 11,172자 + 기호 부분 집합 TTF**. 나눔고딕 잠정 후보는 폐기했다.

## 들어 있는 파일
| 파일 | 내용 |
|---|---|
| `NotoSansKR-Regular.subset.ttf` | 번들 글꼴(부분 집합, 2,717,880B, sha256 `a959c81476af1cbdce3f31431c0516bc5a3e29fb85c0b15b7e34e80a8d87b2c7`). 정적 TrueType(glyf), 글리프 12,738개, cmap 12,604자, unitsPerEm 1000 |
| `NotoSansKR.metrics.json` | 위 파일에서 뽑은 글자 advance 폭 표(`arch-font-metrics/1`). SVG·PDF·PNG의 MTEXT 줄바꿈이 같은 표를 쓴다 |
| `OFL.txt` | SIL OFL 1.1 전문 + 저작권 고지(원본 패키지 `LICENSE_FONT` 그대로). **글꼴 파일과 함께 배포물(설치 파일·웹 번들)에 넣는다** |

## 출처(재현 가능)
- 원본: npm `@expo-google-fonts/noto-sans-kr@0.4.4`(tarball sha256 `fabc22bd03ec09aacd59377d912cf2f453ece85ac33599654665e72b83c06861`, gitHead `23a79eeb`)의 `400Regular/NotoSansKR_400Regular.ttf`.
  이 패키지의 `metadata.json`이 가리키는 Google Fonts 공식 배포본(`fonts.gstatic.com/s/notosanskr/v40/…`, family "Noto Sans KR", v40)과 같은 정적 인스턴스다. 패키지 라이선스 `MIT AND OFL-1.1`(MIT는 npm 래퍼 코드, 글꼴은 OFL).
- 원본 파일: 6,191,364B, sha256 `b4a747e78805bc25b610dcfc3003cb5fb2e2ec034763774b24216ed15889eef4`, name 표 버전 `2.004-H2`, 글리프 24,868개.
- **가변 글꼴 아님**: `fvar` 표 없음, 굵기별 정적 파일(100~900). jsPDF 임베드와 `ttf.ts`(정적 hmtx 전제)와 호환된다. Bold(700)는 받아 확인만 했고(6,189,424B, sha256 `c76f806d…16d0e9cc`) 번들하지 않는다 — 도면은 단일 굵기로 그린다. 필요해지면 같은 방식으로 부분 집합을 추가한다(약 +2.7MB).
- 저작권: Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. 라이선스 OFL 1.1.

## 전체 글꼴 vs 부분 집합 — 비교와 추천
| 안 | 크기 | 비고 |
|---|---|---|
| A. 원본 전체 | 6.19MB | 한자·가나·확장 라틴 포함. 저장소·설치 파일·웹 번들 부담이 가장 크다 |
| B. KS X 1001 한글 2,350자 + 기호 | 0.74MB | 가장 작다. 그러나 현대 한글 음절 8,822자가 없다(예: '똠'·'뷁'·'큥'). 사람 이름·지명·상호에 드물게 쓰이는 글자가 빈칸이 된다 |
| **C. 현대 한글 11,172자 + 기호(채택)** | **2.72MB** | 한글 음절 전부 + ASCII·라틴 1·일반 구두점·단위 기호(㎡ ㎥ ㎝ ㎜)·×±°²·화살표·원문자·도형·CJK 기호·전각 |
- 추천·적용: **C**. 근거: (1) 도면 문자는 이름·주소·상호라 B의 누락이 실사용에서 생긴다. A와 C의 차이는 도면에서 거의 안 쓰는 한자·가나·확장 라틴뿐이다. (2) 크기가 A의 44%이고 설치 파일 상한(200MB)·웹 `font-src 'self'`에 부담이 작다. (3) 폭 표 범위(`DEFAULT_METRIC_RANGES`)와 글꼴 범위가 같아 "표에 있는 글자 = 글꼴에 있는 글자"가 성립한다. (4) PDF는 jsPDF가 쓴 글자만 다시 부분 집합으로 넣으므로 PDF 크기는 어느 안이든 같다(10장 약 148KB).
- 범위(UNICODES): U+0020–007E, 00A0–00FF, 2000–206F, 2100–214F, 2190–21FF, 2200–22FF, 2460–24FF, 25A0–25FF, 3000–303F, 3130–318F, 3200–32FF, 3300–33FF, AC00–D7A3, FF00–FFEF. `GSUB`·`GPOS`·`BASE`·`STAT` 표는 남고 `GDEF`는 pyftsubset 기본 동작으로 빠진다. 커닝·합자는 쓰지 않는다(폭 표와 같은 단순 합).
- 만들기: `scripts/font-metrics/subset.sh <원본 400Regular.ttf>`(fonttools 4.68.0 `pyftsubset`, 원본·결과 sha256을 확인하고 다르면 실패). 같은 원본·같은 fonttools면 같은 바이트다. 개발자 PC에서만 수동 실행한다(저장소 의존성 아님).

## OFL 1.1 조건 확인(법률 자문 아님)
- **Reserved Font Name(RFN)**: 저작권 고지가 예약 이름으로 `Source`를 적는다. 부분 집합은 OFL상 "수정본(Modified Version)"이고, 수정본은 RFN을 쓰지 못한다. 그러나 이 글꼴의 **이름 표(family "Noto Sans KR", full name, PostScript "NotoSansKR-Regular")에는 'Source'가 없다**(name 0 저작권·name 7 상표 고지 문장에만 나옴). 따라서 **이름 변경이 필요 없다**고 판단하고 이름 표를 원본 그대로 둔다(`--name-IDs='*'`로 저작권·라이선스 레코드도 지우지 않음). 만약 법무 검토에서 이름 변경이 필요하다고 하면 `subset.sh`에 `--name` 치환을 넣고 SVG 기본 font-family·폭 표 family·`BUNDLED_FONT_*` 상수를 함께 바꾼다.
- 저작권 고지·`OFL.txt` 동봉: 설치 파일·웹 번들 모두 `OFL.txt`를 글꼴 옆에 넣는다. 앱 "정보/라이선스" 화면에서 THIRD_PARTY_NOTICES.md를 보여 준다.
- 글꼴만 따로 판매하지 않는다(앱·PDF·PNG에 넣어 배포하는 것은 허용). PDF 임베드(부분 집합 포함)는 OFL이 허용한다. 수정본(이 부분 집합)도 OFL로 배포한다.
- 맑은 고딕 등 재배포 불가 글꼴은 번들·PDF 임베드 금지(DXF는 이름만 참조하므로 무관 — `DEFAULT_DXF_FONT`).

## 부분 집합에 없는 글자(한자 등)의 동작
- 이 글꼴의 `.notdef`는 **빈 글리프(폭 1em)** 라 상자(□)가 아니라 **빈칸**으로 나온다.
- PDF: `writePdf`가 없는 글자를 세어 `AR057`("글꼴 … 에 없는 글자 N종(예: …)") 경고를 돌려준다. 문자열은 그대로 두고 빈칸이 그려진다.
- PNG: `writePng`도 같은 `AR057` 경고를 `warnings`로 돌려준다. 시스템 글꼴 대체는 쓰지 않는다(PC마다 다른 결과를 막기 위해 `loadSystemFonts:false`).
- SVG: 글꼴 파일을 넣지 않고 이름만 참조하므로 화면 글꼴 대체 규칙을 따른다(`'Noto Sans KR', sans-serif` → 번들 글꼴에 없으면 브라우저가 sans-serif로 대체). 앱이 번들 파일을 같은 이름으로 등록하면 한글 음절은 항상 번들 글꼴이다.
- DXF: 이름만 참조(`DEFAULT_DXF_FONT`), 영향 없음.
- 글자를 늘려야 하면: `subset.sh`의 UNICODES(또는 `--text`)에 추가 → `OUT_SHA256` 갱신 → `node scripts/font-metrics/generate.ts packages/drafting/fonts/NotoSansKR-Regular.subset.ttf --name NotoSansKR` → `node golden/svg-tools/update.ts`·`node golden/png-tools/update.ts --force`(이유를 커밋 본문에).

## 폭 표 만들기·확인 (빌드 시)
```sh
node scripts/font-metrics/generate.ts packages/drafting/fonts/NotoSansKR-Regular.subset.ttf --name NotoSansKR           # → fonts/NotoSansKR.metrics.json
node scripts/font-metrics/generate.ts packages/drafting/fonts/NotoSansKR-Regular.subset.ttf --name NotoSansKR --check   # 표가 글꼴과 다르면 종료 코드 1(CI용)
```
- 폭 표 형식(`arch-font-metrics/1`): `units_per_em`, `default_advance`(없는 글자), `runs` = `[첫 코드 포인트, 끝 코드 포인트, 폭]`. 수집 범위는 `DEFAULT_METRIC_RANGES`(라틴, 구두점, 화살표, 도형, 한글 자모·음절 11,172자, CJK 기호·호환(㎡ 등), 전각·반각). 결과: 글자 12,514자, 구간 196개, 4.5KB. Noto Sans KR의 한글 음절 폭은 모두 920(0.92em, 한 구간)이고 라틴은 비례폭이다.
- 같은 글꼴 → 같은 바이트(시각·경로 없음, 파일 이름·크기·sha256만 기록). 파서는 `src/writers/pdf/ttf.ts`(외부 의존성 없음). CFF(OTF)·TTC는 거부한다.

## 쓰는 법
- Node(서버·CI·샘플 생성·PNG): `import { loadBundledFont, loadBundledMetrics } from "@arch-studio/drafting/writers/pdf/node"` → `writePdf(sheets, { font: loadBundledFont(), metrics: loadBundledMetrics() })`. 글꼴 크기가 폭 표 기록과 다르면 `OutputError(font_unavailable)`.
- 브라우저·워커: 같은 `NotoSansKR-Regular.subset.ttf`를 앱 정적 자산으로 배포하고 호출자가 fetch해 `writePdf({ font: { family: BUNDLED_FONT_FAMILY, ttf } })`로 넣는다(`BUNDLED_*` 상수는 `@arch-studio/drafting/writers/pdf`에서 import, Node 의존 없음). 폭 표 JSON도 같은 방식으로 넣는다. 웹은 `@font-face`로 같은 파일을 `font-family: 'Noto Sans KR'`로 등록한다(`font-src 'self'`, 02_ARCHITECTURE.md CSP).
- 설치형(Tauri): 같은 두 파일(+ `OFL.txt`)을 리소스로 번들한다.
