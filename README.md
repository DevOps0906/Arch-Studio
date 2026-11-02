# Arch Studio (가칭)

1~5인 건축사사무소와 전원주택 시공사를 위한 **AI 설계실무 도구**입니다.
대지를 불러오면 법규상 지을 수 있는 볼륨(법규 엔벨로프)이 3D로 생깁니다. 매스를 움직이면 건폐율·용적률·정북 일조사선·주차·이격을 근거 조항과 함께 실시간으로 판정합니다. 배치도·면적 산정도·일조사선 단면은 DXF·SVG·PDF로 자동 작도합니다.

- **제공 방식**: 웹(SaaS, `app.` 웹 스튜디오)과 설치형(Windows, Tauri)의 기능이 같습니다. 웹에서 바로 시작하거나, 랜딩에서 설치형을 내려받을 수 있습니다. 설치형은 여기에 오프라인 작업과 로컬 파일을 더합니다. → [ADR-001](docs/file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md)
- **라이선스**: 웹과 설치형 모두 영구 / 기간제 / 구독 3종이며, 좌석(사용자) 단위로 팝니다.
  - 영구 라이선스로 웹을 쓸 수 있는 기간은 업데이트 기간 동안입니다. 이 점을 구매 전에 고지합니다.
  - 체험 크레딧은 휴대폰 본인인증을 한 뒤에 지급합니다.
  - 새 상품(기간제 등)의 가격은 아직 정하지 않았습니다.
- **크레딧**: 판정·도면·매스 제안은 0크레딧입니다. AI 렌더·클라우드 법규 검토·제안서 PDF·법규 채팅에는 크레딧이 듭니다.

## 진행 현황 (2026-11-02 기준)

실행 작업표의 92개 항목 중 **61개 완료, 3개 진행, 28개 대기**입니다. 이는 작업 개수 기준이며 개발 시간이나 기능 완성률을 뜻하지 않습니다. 상태와 선행 관계는 [작업표](tasks/README.md), 결정과 상세 수용 기준은 [정본 계획](docs/file/01-관리/06_AGENT_PLAN.md)을 따릅니다.

| 영역 | 현재 상태 |
|---|---|
| 기반·디자인 | 모노레포, DB/RLS 기반, 도메인 계약, 디자인 토큰·공통 UI, Tauri 셸과 플랫폼 어댑터(설치형·웹)가 구현됐습니다 |
| 설계·도면 | 기하·프로그램 엔진, 규칙 판정과 엔벨로프, 매스 제안, DXF 가져오기·작성, SVG/PNG/PDF 작성, 배치도·면적표·단면·평면·시트 화면, 도면 주석 편집층(사용자 주석·고아 주석 출력 제외)이 구현됐습니다 |
| 앱 화면 | 통합 작업공간 셸, 대시보드, 프로젝트·대지·모델러(측정·단면·표시 옵션)·판정·평면 편집·도면 시트 화면이 있습니다. 프로그램 화면은 진행 중이고, AI 화면과 라이선스/크레딧 화면은 대기입니다 |
| 서버·웹·AI | 클라우드 프로젝트 저장(버전 충돌 거절·RLS)과 웹 어댑터(읽기 캐시·파일·세션), 음성 받아쓰기, Dify 채팅 중계, 클라우드 법규 검토(서버 재계산·출처 없는 문장 제거·숫자 차단), RAG 색인 하니스, AI 라우팅 보안 테스트가 구현됐습니다. 그래프 서버·Dify·색인 검색의 운영 배선, 웹 스튜디오 셸, 결제, 실제 로그인은 남아 있습니다 |
| 출시·검증 | 도면 골든 CI는 있으나 통합 릴리스 CI, 독립 보안 점검, 데스크톱·웹 E2E와 플랫폼 동등성 검증은 남아 있습니다 |

**제품 정확도 제한:** 초기 규칙 팩 2026.10.0의 10개 규칙은 모두 근거 수치 미확인 상태여서 판정은 WARN입니다. 지원 지자체는 아직 없고, 허가 도서 평가셋 30건과 RAG 평가셋 30문항도 실제 자료로 측정하기 전입니다(지금은 예시 자료로 하니스만 검증). 법규 원문·조문·시행일 검수 없이는 실제 법규 적합성을 확인했다고 볼 수 없습니다.

### 작업 진행률

| 웨이브 | 완료 | 미완료 | 주요 남은 작업 |
|---|---:|---:|---|
| W0 | 8/8 | 0 | 기반·도메인 계약·초기 스파이크 완료 |
| W0-D | 3/3 | 0 | 디자인 단계 완료 |
| W1 | 10/11 | 1 | 공용 compliance 모듈(출시 선행 조건 확인 필요) |
| W2 | 11/14 | 3 | 결제, CI/서명 릴리스, 웹 스튜디오 셸 |
| W3 | 9/13 | 4 | 라이선스 상품·좌석·본인인증 크레딧, 규칙 팩 서버 분리·자격 게이트 |
| W4 | 11/13 | 2 | 프로그램 화면(진행), 라이선스·크레딧 화면 |
| W5 | 8/17 | 9 | 제안서·3D 입출력(진행)·AI 렌더(진행)·AI 화면·대화형 설계·클라우드 전송·표 계산 내보내기·모델러 코어·지도 운영 연결 |
| W6 | 1/9 | 8 | 보안 점검·E2E·동등성·결제 E2E·출시 화면 |
| W7–W8 | 0/4 | 4 | G1/G2 사람 판정 후 실제 로그인 제공자·후속 도구 |

집계는 [실행 작업표](tasks/README.md)의 현재 상태를 기준으로 합니다. 범위 밖 후속 과제는 작업표의 '발견한 문제' 표에 있습니다.

### 구현된 주요 항목
- [x] platform-docs에서 Arch Studio 자료를 이관했습니다. 근거 문서 26개, 위키, Supabase 마이그레이션·시드·RLS 테스트, 원본 기획서·개발서(`docs/source/`)입니다.
- [x] 멀티에이전트 구성을 마쳤습니다. `AGENTS.md`를 채웠고, 영역 규칙 6개(web·desktop·engine·api·db·docs)를 두었습니다. 상시 로드 규칙은 3191에서 2377 토큰으로 줄였습니다.
- [x] 디자인 시안 원본을 보관했습니다. 랜딩은 `design/reference/landing/`, 대시보드 셸(화면 21개)은 `design/reference/dashboard/`에 있습니다.
- [x] 디자인 토큰을 만들었습니다. `packages/ui/src/tokens.css`(Tailwind CSS v4, 앱 라이트 / 랜딩 다크)와 `DESIGN.md`입니다.
- [x] 기획을 재정비했습니다.
  - 린 검증 문서를 새로 만들었습니다: [00_LEAN](docs/file/02-요구사항/00_LEAN.md)
  - 경쟁사 15곳을 벤치마킹했습니다: [08_BENCHMARK](docs/file/02-요구사항/08_BENCHMARK.md)
  - 보안 관리 계획을 세웠습니다. 보안 레벨 L2(제안)와 위협 분석 12건이 들어 있습니다: [09_SECURITY_PLAN](docs/file/03-설계/09_SECURITY_PLAN.md)
  - PRD를 정비했습니다. 착수 차단 결정 표, 기능 ID 색인, 계측 이벤트, 보안 12장, 경쟁 대응 13장을 추가했습니다.
  - 화면·API·데이터 문서에 기능 ID 추적 열을 추가했습니다. 줄 번호 인용 155곳은 장 번호 인용으로 바꿨습니다.
- [x] 하이브리드 제공 구조를 확정했습니다.
  - Fusion·Rhino·Onshape·SketchUp·AutoCAD Web·Figma를 벤치마킹했습니다: [10_DELIVERY_BENCHMARK](docs/file/03-설계/10_DELIVERY_BENCHMARK.md)
  - [ADR-001](docs/file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md)을 작성하고, challenger 검토에서 나온 🔴 2건을 해소했습니다.
  - 확정한 내용을 PRD·구조·화면·API·데이터·보안 문서에 반영했습니다. 웹 스튜디오 `app.`, 클라우드 단일 파일 저장, 좌석·기간제·본인인증 데이터 설계, 규칙 팩 서버 분리가 들어 있습니다.
  - 랜딩에 `/download` 페이지(OS 감지·서명·릴리스 노트)와 "웹에서 바로 시작" 버튼을 넣었습니다.
- [x] 작업 표를 갱신했습니다. `tasks/README.md`에 85개 작업과 담당·위험도·웨이브를 정리했습니다.
- [x] NOMAD v3.0 규칙을 적용했습니다(2026-10-28). Codex 팀원(codex-designer·codex-reviewer)과 위험도별 검증 규칙을 작업 표에 넣었고, 디자인 작업 9개는 공동 디자인으로 바꿨습니다. `tasks/NOW.md`에는 이관용 필드(SDLC 단계·담당 모델·수정 파일·테스트 상태·남은 작업)를 추가했습니다.

- [x] Codex(sol) 독립 분석과 🔴 5건을 해소했습니다(2026-10-28~29). 분석 문서는 [기획·디자인 분석](docs/file/05-검증/리뷰/codex-planning-design-2026-10-28.md)에 있습니다.
  - R1 검증 게이트: G0·G-베타·G-판매 단계를 두고, 의향·약정·구매 지표를 분리했습니다.
  - R2 권한 계약: 권리를 권리 단위로 합성하고 DB 함수에서 강제합니다. 좌석에 번호를 붙이고, 재배정은 7일 냉각·30일 2회로 제한합니다.
  - R3 웹 동등성: 웹 첫 여정 5단계, 설치형 화면 17개와의 대응, 반응형 3구간을 정했습니다. 모바일은 열람·판정 확인·내보내기·AI 요청만 됩니다.
  - R4 데이터 회수: 만료 후 90일 보존과 통지, 일괄 zip 내려받기(MVP)를 넣었습니다. 영구 폴백 조직의 클라우드 사본은 읽기 전용으로 보존합니다.
  - R5 법규 근거: [사람 법규 검토 체크리스트](docs/file/02-요구사항/11_LEGAL_RULE_REVIEW.md)를 만들었습니다.
- [x] 설계 엔진과 주요 화면을 구현했습니다: 프로젝트·대지·3D 모델러·판정 패널·매스 자동 제안 3안·평면 편집기·도면 시트 및 내보내기.
- [x] 도면 파이프라인을 구현했습니다: DXF 작성·가져오기, SVG·PDF와 PNG 래스터화, 배치도·면적표·일조사선 단면 뷰. 골든 데이터와 도면 검사 경로도 있습니다.
- [x] AI 서비스 기반과 규칙 팩 배포 경로를 구현했습니다: 워커 골격, AI 게이트, 서명 검증·설치·불러오기. 독립 보안 리뷰에서 나온 일부 개선도 반영했습니다.
- [x] 웹 스튜디오 스파이크에서 구조를 결정했습니다: Vite SPA 하나를 설치형과 웹이 공유하고, 웹 어댑터와 정적 호스팅을 사용합니다. 웹 스튜디오 본 구현은 남았습니다.
- [x] 2026-10-30 커밋에서 Windows 검증 호환성과 Rust PNG 순회 코드를 수정했습니다. 기록된 검증 명령과 결과는 해당 커밋을 기준으로 확인하세요.
- [x] 2026-11-02 병렬 진행으로 8개 작업을 완료했습니다. 위험도별로 착수 전 계획 검토와 독립 코드·보안 리뷰를 거쳤습니다.
  - 클라우드 프로젝트 저장(AR-06-073): 기존 테이블에 project_uuid를 더하고 버전 충돌 거절, 만료 조직 읽기 허용, 업로드 객체 재검사, 최신 1개 보존을 적용했습니다.
  - 웹 어댑터(AR-06-072): 클라우드 저장·읽기 캐시(사용자·조직 범위, 로그아웃 시 삭제)·파일 열기/저장·메모리 세션과 프로젝트 파일 내려받기 경로를 만들었습니다.
  - 도면 주석 편집층(AR-06-086): 사용자 주석·앵커·고아 주석 출력 제외와 저장 형식 v2 이행을 넣었습니다. 주석 없는 시트의 도면 바이트는 바뀌지 않습니다.
  - AI 기능: 음성 받아쓰기·읽어 주기(AR-06-053), Dify 채팅 중계(AR-06-054), 클라우드 법규 검토(AR-06-051), RAG 색인 하니스(AR-06-050)를 구현했습니다. 크레딧은 조직 범위 멱등 키와 원장 대조로 재사용을 막습니다.
  - 법규 검토의 숫자 차단은 금지어 목록 방식이 두 번 우회돼, 문장을 텍스트·참조 조각으로 나누고 허용 문자만 받는 구조로 바꿨습니다.
  - AI 보안 테스트(AR-06-049): 라우팅 표 대조, 국외 제공자·오픈소스 강제·다른 조직 검색 차단을 로컬 DB에서 검증하고, 강제 로직을 실제로 뒤집어 테스트가 실패하는지 확인했습니다.

### 다음 개발 단계
- [ ] 웹 스튜디오 셸에 웹 어댑터를 연결하고, 로컬↔클라우드 전송과 표 계산 내보내기를 구현합니다(AR-06-071·077·078).
- [ ] AI 화면(검토·채팅·위키)을 만들고 그래프 서버·Dify·색인 검색의 운영 배선을 완성합니다(AR-06-055 등).
- [ ] 결제, 라이선스 상품·좌석·본인인증 크레딧, 규칙 팩 서버 분리를 완성합니다(AR-06-043·074 계열·075).
- [ ] 릴리스 CI와 보안 점검, 웹·설치형 E2E 및 동등성 검증을 완료합니다(W6). G1·G2와 실제 로그인 제공자 단계는 사람 판정 이후 진행합니다.
- [ ] 법규 데이터의 조문·수치·시행일과 지원 지역을 원문 기준으로 검수하고 평가셋을 측정합니다.

현재 우선순위는 작업표의 미완료 선행 관계를 따릅니다. 사람 판정이 필요한 결정(법규 수치, 서명 키, 가격, VWorld 이용 조건, 면적 산입 규칙 등)은 임의로 채우지 않습니다.

## 콘텐츠 바로가기

설치형 앱 화면과 웹 화면별 기획 문서와 구현 코드입니다. 화면 경로는 앱 안 주소입니다(웹 스튜디오는 `app.` 아래 같은 경로). 화면 정의는 [화면설계서](docs/file/03-설계/03_SCREENS_UX.md)를 따릅니다.

| 콘텐츠 | 화면 경로 | 기획·명세 문서 | 구현 코드 |
|---|---|---|---|
| 로그인 | `/login` | [화면설계서 3.1절](docs/file/03-설계/03_SCREENS_UX.md) | [login](packages/features/src/login/) |
| 온보딩(약관·체험 시작) | `/onboarding` | [화면설계서 3.2절](docs/file/03-설계/03_SCREENS_UX.md) | [onboarding](packages/features/src/onboarding/) |
| 프로젝트 목록 | `/projects` | [화면설계서 3.3절](docs/file/03-설계/03_SCREENS_UX.md) | [projects](packages/features/src/projects/) |
| 대지 | `/projects/:id/site` | [화면설계서 3.4절](docs/file/03-설계/03_SCREENS_UX.md) | [site](packages/features/src/site/) |
| 모델러·실시간 판정 | `/projects/:id/model` | [화면설계서 3.5절](docs/file/03-설계/03_SCREENS_UX.md) | [모델러](packages/features/src/modeler/) · [판정](packages/features/src/judgment/) |
| 프로그램(면적표·공사비) | `/projects/:id/program` | [화면설계서 3.6절](docs/file/03-설계/03_SCREENS_UX.md) | [program](packages/features/src/program/) |
| 평면 개략도 | `/projects/:id/plans` | [화면설계서 3.7절](docs/file/03-설계/03_SCREENS_UX.md) | [plans](packages/features/src/plans/) |
| 도면 시트·내보내기 | `/projects/:id/sheets` | [화면설계서 3.8절](docs/file/03-설계/03_SCREENS_UX.md) | [sheets](packages/features/src/sheets/) |
| AI 렌더 | `/projects/:id/render` | [화면설계서 3.9절](docs/file/03-설계/03_SCREENS_UX.md) | [render](packages/features/src/render/) |
| 제안서 | `/projects/:id/proposal` | [화면설계서 3.10절](docs/file/03-설계/03_SCREENS_UX.md) | [proposal](packages/features/src/proposal/) |
| 클라우드 법규 검토 | `/projects/:id/review` | [화면설계서 3.11절](docs/file/03-설계/03_SCREENS_UX.md) | [review](packages/features/src/review/) |
| AI 채팅 | `/chat` | [화면설계서 3.12절](docs/file/03-설계/03_SCREENS_UX.md) | [chat](packages/features/src/chat/) |
| 법규 해설 위키 | `/wiki` | [화면설계서 3.13절](docs/file/03-설계/03_SCREENS_UX.md) | [wiki](packages/features/src/wiki/) |
| 설정(표제란·레이어·일반) | `/settings/drafting` · `/settings/general` | [화면설계서 3.14·3.15절](docs/file/03-설계/03_SCREENS_UX.md) | [settings](packages/features/src/settings/) |
| 라이선스·기기 | `/license` | [화면설계서 3.16절](docs/file/03-설계/03_SCREENS_UX.md) | [license](packages/features/src/license/) |
| 크레딧 | `/credits` | [화면설계서 3.17절](docs/file/03-설계/03_SCREENS_UX.md) | [credits](packages/features/src/credits/) |
| 랜딩·요금·다운로드·샘플 | 웹 `/` · `/pricing` · `/download` · `/samples` | [화면설계서 1.2·3.18·4장](docs/file/03-설계/03_SCREENS_UX.md) · [ADR-001](docs/file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md) | [apps/web (marketing)](apps/web/src/app/%28marketing%29/) |
| 법적 고지 | 웹 `/legal` | [PRD](docs/file/02-요구사항/01_PRD.md) 6장 | [legal](apps/web/src/app/legal/) |
| 판정·도면 엔진 | — | [PRD](docs/file/02-요구사항/01_PRD.md) 9장 · [구조](docs/file/03-설계/02_ARCHITECTURE.md) | [packages](packages/) (rules·geometry·drafting 등) |

전체 문서 목록은 [문서 안내](docs/README.md), 디자인 명세는 [DESIGN.md](docs/file/03-설계/디자인/DESIGN.md)·[COMPONENTS.md](docs/file/03-설계/디자인/COMPONENTS.md), 구현 현황은 [실행 작업표](tasks/README.md)에서 확인합니다.

## 연관·참고 저장소

- [Motion Studio](https://github.com/DevOps0906/Motion-Studio): Arch Studio와 연관된 프로젝트입니다. 관련 작업을 검토할 때 함께 참고합니다.

## 다이어그램

Mermaid 원본(`.mmd`)과 렌더링한 그림(`.svg`)을 `docs/diagrams/`(제품)와 `docs/diagrams/team/`(팀 운영)에 둡니다. 7개 모두 `mmd-check` 문법 검사를 통과했습니다.

### 제품 구조
| 다이어그램 | 내용 |
|---|---|
| [구성도](docs/diagrams/architecture.svg) ([원본](docs/diagrams/architecture.mmd)) | 랜딩·웹 스튜디오·설치형 셸 → 공유 엔진 패키지 → 플랫폼 어댑터 5종 → 서버·외부 서비스. 신뢰 경계도 표시합니다 |
| [도면 생성 흐름](docs/diagrams/drawing-flow.svg) ([원본](docs/diagrams/drawing-flow.mmd)) | 대지 → 법규 엔벨로프 → 매스·실시간 판정 → 도면 엔진 → 내보내기. "LLM은 좌표를 만들지 않는다"는 경계도 표시합니다 |
| [ERD](docs/diagrams/erd.svg) ([원본](docs/diagrams/erd.mmd)) | 현재 마이그레이션 기준 테이블 49개를 `sql2erd`로 자동 생성했습니다. 좌석·기간제·본인인증 테이블은 새 마이그레이션 작성 후 갱신합니다 |
| [웹 첫 여정](docs/diagrams/web-first-journey.svg) ([원본](docs/diagrams/web-first-journey.mmd)) | 가입부터 샘플 판정, 매스 편집, 클라우드 저장(권리 검사), 출력까지 이어지는 시퀀스입니다 |

![구성도](docs/diagrams/architecture.svg)

### 팀(멀티에이전트) 업무
| 다이어그램 | 내용 |
|---|---|
| [팀 조직도](docs/diagrams/team/team-org.svg) ([원본](docs/diagrams/team/team-org.mmd)) | 팀장(Opus)과 팀원 12명(Claude 10 + Codex 2)의 모델·역할, 작업 표 84개의 담당 분포 |
| [작업 흐름](docs/diagrams/team/team-workflow.svg) ([원본](docs/diagrams/team/team-workflow.mmd)) | SDLC 9단계와 작업 하나의 흐름: 위험도 판정 → challenger(고위험) → builder → codex-reviewer(+reviewer) → tester → advisor(2회 실패 시) → 팀장 커밋. Codex를 못 쓸 때의 대체 경로와 모델 한도 대응(`handoff`)도 그렸습니다 |
| [2026-10-28 세션](docs/diagrams/team/team-session-2026-10-28.svg) ([원본](docs/diagrams/team/team-session-2026-10-28.mmd)) | 오늘 팀원들이 실제로 한 일의 순서이고, 병렬 위임은 par 블록으로 표시했습니다. 순서는 위임 기록 기준이며 호출 시각으로 확인한 것은 아닙니다 |

![팀 작업 흐름](docs/diagrams/team/team-workflow.svg)

## 로컬 실행 (Docker)

앱 코드를 착수하기 전 단계라, 지금은 결과물을 보는 **미리보기 사이트** 하나만 실행됩니다. 웹 앱·API·Supabase 서비스는 W0 작업(AR-06-003·AR-06-001) 이후 `compose.yaml`에 추가합니다.

```bash
docker compose up -d      # 시작
docker compose ps         # 상태 확인
docker compose down       # 중지
```

| 서비스 | 접속 주소 | 내용 |
|---|---|---|
| 미리보기 홈 | http://localhost:8088 | 아래 항목으로 가는 목록 |
| 랜딩 시안(다크) | http://localhost:8088/design/reference/landing/landing.html | 확정 랜딩 시안 원본 |
| 디자인 토큰 미리보기 | http://localhost:8088/design/preview.html | 색·서체·반응형 3구간 |
| 다이어그램 | http://localhost:8088/diagrams/ | 구성도·웹 첫 여정·도면 흐름·ERD·팀 다이어그램(SVG) |
| 도면 스파이크 결과 | http://localhost:8088/drafting/ | AR-06-019 DXF·SVG·PDF |

- 포트는 **8088**입니다. 8080은 이 PC에서 다른 프로그램이 쓰고 있습니다. 외부에 열리지 않도록 `127.0.0.1`에만 바인딩했습니다.
- 파일은 읽기 전용으로 마운트됩니다. 문서·시안을 고치면 새로고침만 하면 반영됩니다.
- 대시보드 시안은 Claude Design 캔버스 형식이라 이 서버에서는 열리지 않습니다(원본: `design/reference/dashboard/`).

## 폴더 구조

문서별 위치와 용도는 [문서 안내](docs/README.md)에서 확인할 수 있습니다.

| 경로 | 내용 |
|---|---|
| `AGENTS.md` · `CLAUDE.md` | AI 도구 공통 규칙(정본) · Claude Code 전용 설정 |
| `docs/` | 문서 전체. 입구는 [docs/README.md](docs/README.md)입니다 |
| `docs/file/` | 기준 문서(정본): 01 관리 · 02 요구사항 · 03 설계 · 04 구현 · 05 검증 |
| `docs/diagrams/` · `docs/diagrams/team/` | 제품 도식(구성도·흐름도·ERD) · 팀 운영 도식(Mermaid + SVG) |
| `docs/reference/` · `docs/wiki/` · `docs/source/` | 참고: 이관 분석·외부 검토 · LLM 위키 · platform-docs 원본(읽기 전용) |
| `design/` | 확정 시안 원본과 토큰 미리보기 |
| `packages/ui/src/tokens.css` · `DESIGN.md` | 디자인 토큰(정답) · 디자인 설명 |
| `supabase/` | 마이그레이션·시드·RLS 스모크 테스트 |
| `infra/dify/` | 법규 채팅(Dify) 메모 |
| `tasks/` | 작업 표(`README.md`) · 현재 상태(`NOW.md`) |
| `compose.yaml` · `docker/` | 로컬 미리보기(nginx) 실행 설정 |

## 스택

Tauri 2 + Rust(설치형) · Next.js 16 + React 19 + Tailwind CSS v4(웹·웹 스튜디오) · 순수 TS 엔진(지오메트리·판정·도면, 웹과 설치형이 공유) · Supabase(Postgres·RLS·Auth) · FastAPI + LangGraph(AI). 상세는 [docs/STACK.md](docs/STACK.md)를 보세요.

## 작업 방식

[NOMAD Agent OS](https://github.com/DevOps0906/nomad-agent-os) v3.0의 팀 구성으로 진행합니다. 팀장(Opus 5.5)은 최종 판단과 승인을 맡고, 나머지 일은 팀원에게 나눕니다.

| 팀원 | 모델 | 맡는 일 |
|---|---|---|
| planner ⇄ codex-designer | Sonnet ⇄ Codex | 공동 기획(PRD·명세·ADR)과 공동 UX·IA·와이어. 한쪽이 초안을 쓰면 상대는 변경분만 교차 검토합니다 |
| designer ⇄ codex-designer | Sonnet ⇄ Codex | 공동 UI(토큰·DESIGN.md·미리보기) |
| diagrammer | Haiku | 구조도·흐름도·ERD(Mermaid) |
| builder · tester | Sonnet | 구현 · 테스트 |
| codex-reviewer | Codex | 독립 품질 검증(code·design·a11y·security). Codex를 못 쓰면 reviewer(Sonnet)가 대신합니다 |
| challenger | Opus | 결제·인증·RLS 같은 고위험 작업을 착수 전에 공격적으로 검토합니다 |
| scout · intern | Haiku | 탐색 · 반복 변환 |
| advisor | Fable | 같은 문제로 2회 실패했을 때만 부릅니다 |

- **SDLC 9단계**: 01 검증 → 02 기획 → 03 UX → 04 UI → 05 기술 설계 → 06 구현 → 07 QA → 08 배포 → 09 개선. 단계가 끝날 때마다 `tasks/NOW.md`를 갱신합니다.
- **모델 한도 대응**: 모델 한도에 걸리면 `handoff sonnet`, `handoff codex`로 다른 모델이 이어서 작업하고, 복귀할 때는 `handoff claude`를 씁니다.
- Claude Code에서 `/next`를 입력하면 작업 표의 다음 작업 하나를 끝까지 진행합니다.
