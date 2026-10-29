# packages/drafting/fonts — 도면 글꼴 폭 표와 번들 글꼴 안내

> 상태: **번들 글꼴 미결정(사람 확인 대기)**. 이 폴더에는 글꼴 파일(.ttf·.otf·.woff*)을 넣지 않는다. 폭 표(`*.metrics.json`)만 둔다.

## 무엇이 있나
| 파일 | 내용 |
|---|---|
| `NanumGothic.metrics.json` | 나눔고딕 Regular의 글자 advance 폭 표(잠정 후보). 원본: npm `@kfonts/nanum-gothic@0.2.0`의 `src/NanumGothic.ttf`(OFL-1.1, sha256은 표의 `source`). 번들 글꼴이 다른 것으로 정해지면 지우거나 바꾼다 |

폭 표 형식(`arch-font-metrics/1`): `units_per_em`, `default_advance`(없는 글자), `runs` = `[첫 코드 포인트, 끝 코드 포인트, 폭]` 구간 목록. 수집 범위는 라틴 기본·보충, 일반 구두점·화살표·도형, 한글 호환 자모, CJK 기호·호환(㎡ 등), 한글 음절 11,172자, 전각·반각(`DEFAULT_METRIC_RANGES`). 커닝·합자는 쓰지 않는다.

## 만들기·확인 (빌드 시)
```sh
node scripts/font-metrics/generate.ts <글꼴.ttf>            # → packages/drafting/fonts/<파일 이름>.metrics.json
node scripts/font-metrics/generate.ts <글꼴.ttf> --check    # 표가 글꼴과 다르면 종료 코드 1(CI용)
```
- 같은 글꼴 → 같은 바이트(시각·경로 없음, 파일 이름·크기·sha256만 기록).
- 파서는 `src/writers/pdf/ttf.ts`(외부 의존성 없음: head·hhea·maxp·hmtx·cmap 형식 4·12·name). CFF(OTF)·TTC는 거부한다(jsPDF도 임베드하지 못함).
- 쓰는 곳: `writeSvg`·`writePdf`의 `metrics` 옵션(MTEXT 폭 줄바꿈). 없으면 근사 폭(한글 1em, 라틴 0.55em). SVG·PDF에 같은 표를 넘겨야 줄바꿈이 같다.

## 번들 글꼴 후보와 조건 (미결정)
| 후보 | 라이선스 | 비고 |
|---|---|---|
| 나눔고딕(NanumGothic) | SIL OFL 1.1 | Regular TTF 약 4.6MB. 한글 음절 폭 고정(940/1000). D-23 스파이크 시험 글꼴 |
| Noto Sans KR(본고딕 계열) | SIL OFL 1.1 | 배포판에 따라 OTF(CFF)·가변 글꼴이라 jsPDF가 임베드할 수 있는 정적 TTF(glyf) 판인지 확인해야 한다. 용량 큼 |
| 맑은 고딕 | 재배포 불가 | **번들·PDF 임베드 금지.** DXF는 이름만 참조하므로 무관(`DEFAULT_DXF_FONT`) |

OFL 글꼴을 번들할 때의 조건(SIL OFL 1.1):
- 글꼴 파일과 함께 라이선스 전문(`OFL.txt`)과 저작권 고지를 동봉한다(설치 파일·웹 번들 모두).
- 글꼴만 따로 판매하지 않는다. 앱·PDF에 넣어 배포하는 것은 허용된다(PDF 임베드 = 부분 집합 포함 허용).
- 수정본(부분 집합 재배포 포함)은 예약 글꼴 이름(Reserved Font Name)이 있으면 그 이름을 쓰지 않는다 → 원본 파일을 그대로 넣고 부분 집합은 jsPDF가 PDF 안에서만 만든다.
- 용량: 설치 파일 200MB 상한(PRD 5장) 안에서 결정. 웹은 `font-src 'self'`(02_ARCHITECTURE.md CSP).

결정되면 할 일: 글꼴 파일·`OFL.txt`를 앱 번들 위치(앱 소유 경로)에 넣고, 이 폴더의 폭 표를 그 파일로 다시 만들고, PDF 호출자(`writePdf({ font })`)와 SVG `font_family` 기본값을 맞춘다.
