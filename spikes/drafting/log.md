# AR-06-019 도면 스파이크 로그 (2026-10-28, 버리는 코드)

재현: `pnpm install` → `node src/gen.ts [--svg2pdf]` → `.venv/Scripts/python audit.py` → `node --test test/spike.test.ts` → `node web/run-browser.mjs`(headless Edge 실제 Web Worker).
환경: Node 24.13(TS 직접 실행), jsPDF 4.2.1, svg2pdf.js 2.8.1, jsdom 30.1.3(시험용), esbuild(브라우저 워커 번들용 devDep), Python 3.11 + ezdxf 1.4.5(.venv, 검증 전용).
산출: `out/site{1,2,3}.dxf`(커밋 가능), `out/site*-{1,2}.svg`, `out/*.pdf`(gitignore). 샘플 3건 모두 시트 2장(배치도, 면적 산정도), 한글 포함.

## 결과 요약
| 항목 | 결과 |
|---|---|
| ezdxf `readfile`(엄격) + `recover` + `Auditor` | 3건 오류 0, 수정 0 (`audit.py`; `python -m ezdxf audit`도 "No errors found") |
| 결정성 | 같은 프로세스 2회, 별개 프로세스 2회 DXF·SVG·PDF sha256 동일. Edge Web Worker가 만든 PDF도 Node 워커 PDF와 바이트 동일 |
| 치수 일치 테스트 | 9건 통과(`test/spike.test.ts`): DXF 파일을 다시 읽어 신발끈 공식으로 계산한 대지·건축 면적과 건폐율 = 도면 TEXT 표기(표제란·산정도 라벨). 면적은 정수 mm 좌표 → 0.01㎡ 정수 half-up, 부동소수 오차 없음 |
| 면적값 | site1 대지 500.00㎡·건축 174.00㎡·34.80% / site2 581.00·144.00·24.78% / site3(L자 건물, 5각 대지) 748.00·237.00·31.68% |
| LibreCAD | 이 PC에 미설치 → **미검증**(사람 확인 체크리스트 참조). 대신 ezdxf+matplotlib 렌더로 한글·레이어·해치 시각 확인 |
| AutoCAD | **미검증**(사람, 라이선스 PC) |
| PDF(직접 그리기, 방식 B) | 통과: Node worker_threads(`document` 없음)와 **headless Edge 실제 Web Worker**(`document`/`window` 없음) 모두 동작. 3대지 6시트 1.0초(Edge 워커), pypdfium2 렌더로 한글 표시 확인 |
| PDF(svg2pdf.js, 방식 A) | Node+jsdom에서 동작(렌더 확인)하나 `getBBox` 스텁 필요. **DOM 필요 → Web Worker 불가** |
| 라이선스 | 런타임 의존성 64개(pnpm licenses) 전부 MIT·ISC·BSD·Apache·CC0·BlueOak·(MIT AND Zlib), dompurify만 (MPL-2.0 OR Apache-2.0)(Apache 선택). GPL·AGPL 0. `secscan license`는 pnpm lockfile에 라이선스 정보가 없어 "정보 없음 64"만 출력 → `pnpm licenses list`로 대체 확인. ezdxf(MIT)는 CI 전용, 런타임 비포함 |

## [DECISION] D-20 — (a) 자체 TS 작성기 유지
- 근거: `src/dxf.ts` 약 300줄로 LINE·LWPOLYLINE·ARC·CIRCLE·TEXT·MTEXT·HATCH(SOLID)·INSERT/BLOCK, 16개 표준 레이어, STYLE, 레이아웃 객체까지 작성. 외부 의존성 0, 출력 결정적(시각·난수·GUID 없음. `$TDCREATE` 등 시각 변수 생략), 한글 UTF-8 정상.
- 조건/주의: ezdxf는 매우 관대해서(아래 제거 실험) "ezdxf 오류 0 = AutoCAD 열림"이 아니다. AutoCAD·LibreCAD 열림은 사람 확인 후 확정. 사람 확인이 실패하면 020~022 착수 전에 보고(작업 표 규정).
- 미구현·후속: 해치 패턴(ANSI31 등)·MTEXT 서식·DIMENSION은 쓰지 않음(설계 규칙). HATCH는 SOLID+투명도 없음(ACI 색 단색)이라 겹치는 요소 위에 놓으면 가린다 → 그리기 순서 주의.

## [DECISION] D-23 — (a) 로컬 PDF 유지, 라이브러리는 jsPDF 직접 그리기(방식 B) 권고, svg2pdf.js는 보조
- jsPDF 4.2.1 MIT, svg2pdf.js 2.8.1 MIT, 전이 의존성 전부 허용 라이선스(위 표).
- 방식 B(모델 → jsPDF 도형·텍스트 직접): DOM 불필요, 실제 Web Worker에서 동작, 결정적(`setCreationDate`·`setFileId` 고정, `compress:false`로 시험. 압축 켠 경우 결정성은 미시험), 구현은 `src/pdf-direct.ts` 약 80줄. 한계: 호는 24분할 선분 근사, 해치 투명도는 GState 사용, SVG와 그리기 코드가 이중(SVG 미리보기 ≠ PDF 보장 아님).
- 방식 A(SVG → svg2pdf): SVG와 같은 결과 보장이 쉬움. 그러나 (1) `window/document/getComputedStyle/getBBox` 필요 → Web Worker 불가, Tauri 메인 웹뷰 스레드에서만. (2) Node에서는 jsdom + `getBBox` 스텁. (3) `import 'svg2pdf.js'`가 Node ESM에서 UMD로 풀려 `jspdf` 전역을 찾다 실패 → `svg2pdf.js/dist/svg2pdf.es.min.js` 직접 import 필요. (4) UI 스레드를 막는다(시트 2장 250~800ms @Node).
- 권고: PDF는 B, SVG는 화면 미리보기·PNG 전용. 둘이 어긋나지 않게 같은 `flatten()`(INSERT 펼침)·레이어 스타일 표를 공유하고 골든 비교(래스터 diff)를 CI에 둔다(제안).
- **팀장 확인 필요**: PDF 한글 글꼴은 글꼴 파일을 PDF에 임베드해야 한다. 이번엔 시스템 `NanumGothic-Regular.ttf`(SIL OFL)로 시험. 제품에 번들할 글꼴(Noto Sans KR·나눔 등 OFL)과 용량(5장 200MB 상한)을 정해야 한다. 맑은 고딕은 재배포 불가라 PDF 임베드용으로 쓰면 안 된다(DXF는 이름만 참조하므로 무관).

## AC1027 구조: 이번에 쓴 최소 구성 (ezdxf strict·audit 통과)
섹션 순서: HEADER → CLASSES(빈) → TABLES → BLOCKS → ENTITIES → OBJECTS → EOF.
- HEADER: `$ACADVER=AC1027`, `$ACADMAINTVER`, `$DWGCODEPAGE`, `$INSBASE`, `$EXTMIN/MAX`(모델 범위 계산), `$LIMMIN/MAX`, `$LTSCALE`, `$TEXTSTYLE=ARCH-KR`, `$CLAYER`, `$CELTYPE`, `$CECOLOR`, `$LUNITS/LUPREC/AUNITS/AUPREC`, `$MEASUREMENT=1`, `$INSUNITS=4`, `$DIMSTYLE`, `$HANDSEED`(마지막 핸들+1, 쓰기 끝에 확정).
- TABLES(9개 전부 작성): VPORT(`*Active`), LTYPE(ByBlock, ByLayer, CONTINUOUS, DASHED, DASHDOT), LAYER(`0` + 표준 16개, 각 plotstyle 390 핸들 참조), STYLE(Standard, ARCH-KR), VIEW(빈), UCS(빈), APPID(ACAD), DIMSTYLE(Standard 1개, `340`이 문자 스타일), BLOCK_RECORD(`*Model_Space`, `*Paper_Space`, 사용자 블록 DOOR-900·WIN-1200; 모델/페이퍼는 `340`으로 LAYOUT 핸들 참조).
- BLOCKS: `*Model_Space`, `*Paper_Space`(BLOCK의 `67 1`), 사용자 블록 — 각각 BLOCK/ENDBLK 쌍과 소유자(330) 필요. 모델 공간 엔티티는 ENTITIES에 둔다.
- 모든 레코드·엔티티: 핸들(5) 유일, 소유자(330), 서브클래스 마커(100). 엔티티는 `AcDbEntity` + 개별 마커(`AcDbLine`, `AcDbPolyline`, `AcDbCircle`+`AcDbArc`, `AcDbText`(2번 반복), `AcDbMText`, `AcDbHatch`, `AcDbBlockReference`).
- OBJECTS: 루트 DICTIONARY(`ACAD_GROUP`, `ACAD_LAYOUT`, `ACAD_MLINESTYLE`, `ACAD_PLOTSETTINGS`, `ACAD_PLOTSTYLENAME`), `ACAD_LAYOUT` 사전 안에 LAYOUT `Model`·`Layout1` 2개(PlotSettings 포함), MLINESTYLE `Standard`, ACDBDICTIONARYWDFLT+ACDBPLACEHOLDER(`Normal`).
- **설계 문서 정정 필요(제안)**: ARCHITECTURE의 "레이아웃 탭은 쓰지 않는다"는 사용자 눈에 보이는 탭을 뜻하는 것으로 읽고, 파일에는 Model·Layout1 LAYOUT 객체 2개가 있어야 AutoCAD 호환이 안전하다(미확인: AutoCAD 요구 여부. 사람 확인 항목). HEADER 시각 변수와 `$FINGERPRINTGUID/$VERSIONGUID`는 결정성을 위해 뺐다.

### 제거 실험 (`ablate.py`, ezdxf 기준 — AutoCAD 요구와 다를 수 있음)
기준 파일에서 하나씩 뺀 결과: OBJECTS·CLASSES·BLOCKS 섹션 전체, VPORT·VIEW·UCS·DIMSTYLE·APPID·BLOCK_RECORD 테이블, LAYOUT 객체는 빼도 ezdxf는 오류 0·수정 0(자동 보정/무시). STYLE 제거 시 수정 17건, LTYPE 제거 시 수정 3건, MLINESTYLE·PLOTSTYLE 객체 제거 시 수정 1건. → ezdxf 관대함 때문에 "필수 목록"은 ezdxf만으로 줄일 수 없다. **현재 목록 전체를 AutoCAD·LibreCAD 통과 구성으로 보고, 줄이는 실험은 사람 확인 뒤에** 한다.

## 한글 처리
- DXF는 UTF-8 그대로 기록(AC1027은 R2007+라 UTF-8). `$DWGCODEPAGE=ANSI_949`로 적었으나 R2007+에서는 문자열 인코딩이 UTF-8이고 코드페이지는 보조 정보(미확인: AutoCAD·LibreCAD의 코드페이지 무시 여부 → 체크리스트). 대안은 `ANSI_1252`(ezdxf 기본)이며 둘 다 결과가 같아야 한다.
- STYLE `ARCH-KR`: 12번(그룹 3)=`malgun.ttf`, 대형 글꼴(4)=빈 값, XDATA `1001 ACAD / 1000 Malgun Gothic / 1071 0`으로 TrueType 패밀리 지정. 폰트 파일은 넣지 않음. 모든 TEXT·MTEXT가 `7 ARCH-KR`. `Standard`는 `txt`(SHX)라 한글이 안 나오므로 `$TEXTSTYLE`도 ARCH-KR.
- 특수문자 `㎡`(U+33A1)·`×`는 UTF-8로 기록. 글꼴에 글리프가 없으면 대체 글꼴 표시(체크리스트).
- 제어 문자 제거(TEXT), MTEXT는 `\`·`{`·`}` 이스케이프 + 줄바꿈 `\P`, 서식 코드 미사용.
- ezdxf로 다시 읽어 한글이 깨지지 않음(렌더 PNG에서 확인). 윈도우 콘솔 출력은 코드페이지 문제로 깨져 보이나 파일은 정상(UTF-8, `PYTHONUTF8=1`로 확인 가능).

## 구현 중 발견한 문제(수정함)
- `$HANDSEED` 값이 그룹 코드 5라서 "핸들 유일·시드보다 작음" 검사가 자기 자신에 걸렸다(테스트 쪽 수정). 시드는 마지막 핸들+1.
- HATCH의 색(62)은 `AcDbHatch` 서브클래스 앞(`AcDbEntity` 구간)에 써야 한다(처음엔 뒤에 써서 위치 오류 → 수정).
- 대지를 도곽 밖에 놓는 좌표 실수는 렌더로 발견해 수정(SHIFT_X). 자동 "도곽 안 포함" 검사는 아직 없음(후속 제안).

## 사람 확인 체크리스트 (LibreCAD · AutoCAD) — `out/site1~3.dxf`
각 프로그램에서 파일마다:
1. 경고·오류 없이 열린다(AutoCAD: "복구" 대화상자 없음, 시작 시 `AUDIT` 실행 결과 0건).
2. 한글이 깨지지 않고 보인다: 표제란, "도로 폭 NNm", 주소, "건축면적 …㎡", MTEXT 4줄. `㎡`·`×` 글리프 확인. 글꼴이 맑은 고딕으로 보이는지, 대체 글꼴이면 어떤 글꼴인지 기록.
3. 레이어 16개+`0`이 보이고 색·선 종류(대지 경계 1점 쇄선 빨강, 이격 파선 초록)가 PRD 9.6절 표와 같다. DASHED 선 간격이 1:200 도곽 기준 읽을 만한지.
4. 단위 mm(`$INSUNITS=4`): 두 점 거리 측정이 도면 숫자와 일치(site1 대지 가로 20000). 대지 폴리라인 `AREA`/`LIST` 값이 도면 표기와 일치(site1 500.00㎡=500,000,000mm², 건축 174.00㎡).
5. INSERT(문 호·창)가 올바른 위치에서 블록으로 선택·분해되고 `EXPLODE` 가능.
6. HATCH(건축면적 구획)가 색 6으로 칠해지고 경계가 어긋나지 않는다. AutoCAD에서 `HATCHEDIT` 열림.
7. 열린 뒤 저장(`SAVEAS` DXF 2013)이 오류 없이 되고 다시 열린다. 가능하면 DWG로 저장도 시험(D-22 자료).
8. 레이아웃: AutoCAD 하단 탭에 Model·Layout1이 보이는지(설계 의도와 다르면 알려줄 것). 뷰가 전체 범위(`ZOOM E`)로 도곽 2장을 보여준다.
9. LibreCAD는 `$DWGCODEPAGE`를 `ANSI_1252`로 바꾼 파일과 비교해 한글이 같은지(코드페이지 영향 확인).
10. 확인 결과(버전·OS·통과/실패)를 이 파일 맨 아래에 추가 기록. 실패 항목이 있으면 020~022 착수 전에 보고.

## 남은 위험/후속
- AutoCAD·LibreCAD 열림은 사람 확인 전까지 미확정(핵심 통과 기준).
- DXF 크기: 시트 2장 약 19KB. 20MB 상한과는 거리 멀다. 해치 대량 사용 시 별도 측정 필요.
- PDF 성능: Edge 워커 6시트 1.0초(시트당 약 170ms) → "10장 10초 p95"는 여유 있어 보이나 큰 도면·압축 켠 경우는 미측정.
- svg2pdf.js를 쓰려면 Tauri 웹뷰 메인 스레드 실제 브라우저에서의 동작·`getBBox` 정확도(텍스트 정렬) 확인이 별도로 필요(이번엔 jsdom 스텁뿐).
