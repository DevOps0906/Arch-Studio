# arch-studio(Arch Studio, 가칭) 개발 방법

작성일 2026-10-16. 이 문서는 `D:\WorkSpace\platform\docs\products\arch-studio\`의 기획을 멀티에이전트 베이스(`D:\WorkSpace\DEV\MultiAgent-Service-Fullstack-Tree-Framwork`)로 옮겨 arch-studio 개발을 시작하는 방법을 처음부터 끝까지 안내합니다. 형식은 `develop/book-trailer/book-trailer_develop.md`와 같고, 이 제품에만 있는 부분(설치형 데스크톱 셸, 시리얼 라이선스·업데이터, 도면 엔진)을 더했습니다. 근거가 없는 값은 "제안", 확인하지 못한 값은 "미확인"으로 표시합니다.

## 0. 한눈에 보기

**시작은 setup 스크립트 1개 실행입니다.** 둘 중 하나만 실행하면 됩니다.

| 환경 | 명령 |
|---|---|
| Windows PowerShell | `pwsh -File D:\WorkSpace\platform\docs\develop\arch-studio\setup-arch-studio.ps1` |
| Git Bash / Linux | `bash /d/WorkSpace/platform/docs/develop/arch-studio/setup-arch-studio.sh` |

먼저 `-DryRun`(PowerShell) 또는 `--dry-run`(Git Bash)으로 실행해 할 일을 확인한 뒤 실제로 실행하시길 권합니다. 이 제품은 데스크톱 앱이라 스크립트가 Rust·Tauri CLI·WebView2를 추가로 확인합니다(없어도 경고만 하고 계속합니다).

```
D:\WorkSpace\platform\docs\develop\arch-studio\       platform에 남는 안내서, 도구, 재료
├── arch-studio_develop.md       이 문서(개발 폴더로 옮기지 않음)
├── setup-arch-studio.sh         설치 스크립트(Git Bash / Linux)
├── setup-arch-studio.ps1        설치 스크립트(Windows PowerShell)
└── arch-studio-root\            이 폴더 "안의 내용물"이 개발 폴더 루트에 들어갑니다
    ├── docs\  supabase\  infra\  .claude\
                │
                │ setup 스크립트가 복사(안의 내용물)
                ▼
D:\WorkSpace\DEV\arch-studio\                            베이스를 복사해 만든 개발 폴더
├── docs\  supabase\  infra\  .claude\skills\llm-wiki\  ← arch-studio-root에서 들어온 것
└── apps\  _shared\  _templates\  .claude\agents\  init-project.sh ...  ← 베이스에 원래 있던 것
```

| 항목 | 값 |
|---|---|
| 제품 | Arch Studio(가칭, D-1). 설치형 AI 설계실무 앱(Windows 데스크톱) + 클라우드 웹(라이선스·결제·AI) |
| 앱 id / 작업 접두어 | `arch` / `AR`(작업 `AR-06-001`~`064` + `AR-V2-01`, `AR-V2-02`) |
| 스키마 / 번호 / SQLSTATE | 모듈러 `arch`(2400~2499, 정본 `2400_arch.sql`), 이 묶음은 모놀리스(`public`). SQLSTATE `AR001`~`AR049`(서버), 로컬 화면 오류 `AR050`~`AR059` |
| 작업 수 | 71개(P0 62, P1 7, P2 2. 2026-10-17 설득형 랜딩 5개 포함), 웨이브 W0~W8 + 디자인 트랙 W0-D |
| 모델 | 주 Opus(41개), 부 Sonnet(13개), 고문 Fable(11개), Haiku 1개. 사람: 디자인 판정(AR-06-011), AutoCAD 확인(AR-06-019), G1·G2 판정, 인터뷰 |
| 이 제품만의 것 | (1) Tauri 2.x 데스크톱 셸 + Rust 코어(키체인, 로컬 SQLite, 서명 라이선스 검증, 업데이터, 딥링크) (2) 영구 라이선스(Ed25519 서명 파일, 기기 2대, 업데이트 기간·폴백) (3) 도면 엔진(`packages/drafting`, 결정적 DXF·SVG·PDF, 골든 + ezdxf audit CI) |

| 단계 | 내용 | 절 |
|---|---|---|
| 0.5 | 개발 전 린 검증(2일 도면 스파이크, 샘플 DXF 랜딩, 인터뷰) | 1.1 |
| 준비 | 도구 설치(Node·pnpm·Docker·Supabase CLI·Python 3.12·Rust·Tauri CLI·WebView2), 키·인증서 | 2 |
| 1~2 | setup 스크립트 실행(데스크톱 도구 확인, 베이스 복사, 초기화, 묶음 붙여넣기, docs/etc 삭제, 에이전트 모델 지정, 점검) | 3, 4 |
| 3 | 최종 트리 확인, 기획 경로 → 개발 경로 | 5 |
| 4 | project-profile 작성 | 6 |
| 5 | 로컬 DB 기동, SQL 적용, RLS 스모크 125항목 | 7 |
| 6 | 착수 전 결정 확정, 산출물 승인 | 8 |
| 7 | 작업(66개)을 task로 변환, W0 첫 지시(AR-06-019 스파이크) | 9 |
| 8 | 웨이브별 개발 사이클 | 10 |
| - | AI 계층, 도면 엔진, 데스크톱·라이선스, 디자인, 원본 이식·공용 모듈, 검증, 위험 | 11~17 |
| - | 체크리스트 | 18 |
| - | 인증 단계: Mock → Google + 이메일 → 카카오·네이버(P2) | 19 |

## 1. 개요

| 항목 | 내용 |
|---|---|
| 제품 | 소규모 건축사사무소·전원주택 시공사가 대지를 불러오면 법규 엔벨로프가 3D로 생기고, 매스를 움직이는 동안 건폐율·용적률·정북 일조사선·주차·이격이 실시간 판정되며, 배치도·면적 산정도·일조사선 단면 DXF와 AI 렌더·제안서 PDF까지 만드는 설치형 앱. 앱은 시리얼로 영구 소유, AI 기능은 크레딧 |
| 통합 원본 | 없음(신규 제품). 이식 원천: nomad-docs(결정적 엔진, 녹음 → 후보), flora-publishing(선차감·환불, WeasyPrint 소비), `_platform-core` AI 계층, `_design-guide` 3D 히어로, FortuneDocs 원칙(리뷰 1건) |
| 런타임 구성 | 데스크톱(`apps/desktop`: Vite + React 19 + Tauri 2.x, Web Worker 2개), web(`apps/web`: Next.js 16.2.x, Vercel, 랜딩·계정·결제·라이선스·업데이트 매니페스트·AI 게이트), AI 서비스(`apps/api`: FastAPI + LangGraph, Railway), 워커(`workers/arch-jobs`: Node 20, `core.jobs` 단일 소비자), 공용 Dify·WeasyPrint·GPU 서버 |
| 로컬(0크레딧, 오프라인) | 판정, 엔벨로프, 매스 제안, 도면 생성, DXF·SVG·PDF·PNG 출력, 파일 입출력. 잡이 아니고 서버를 거치지 않습니다 |
| 클라우드(크레딧) | AI 렌더(3/5/2), 클라우드 법규 검토(15), 대화형 입력(2, 상담 녹음 5), 제안서 PDF(10), STT 분당 1, 채팅 턴당 1 |
| AI 금지 범위 | LLM이 좌표·치수·면적·판정 값·금액을 만드는 것, 출처 없는 검토 문장, "허가 가능합니다"·"인허가 도면 자동 작성"·"CAD 대체" 같은 문구(`docs/file/04-구현/CLAUDE.md` 2장, `01_PRD.md` 6.1·9.7절) |
| 개발 근거 | `docs/file/`의 산출물 26개(등록부 `docs/file/_index.md`). 정본은 이 산출물입니다. 데스크톱 공통 규칙은 묶음 밖 `D:/WorkSpace/platform/docs/Tauri/README.md`(5.1절 주의) |

이 문서는 "어떻게 시작하고 진행하는가"를 다룹니다. "무엇을 만드는가"는 묶음 안의 산출물(`docs/file/`)이 정본입니다.

이름 주의: `arch`는 앱 id(가입 `signup_app='arch'`, 큐 `arch.render`·`arch.review`·`arch.intake`·`arch.proposal_pdf`·`arch.stt`, 서명 토큰 `aud=platform-ai:arch`)입니다. 제품 폴더 이름은 `arch-studio`, 데스크톱 딥링크 스킴은 `archstudio://`(제안)입니다.

### 1.1 개발 전 린 검증 (`01_PRD.md` 9.10절)

작업 66개 가운데 도면 블록(019~033)과 데스크톱·라이선스 블록이 크고, "DXF가 실제 CAD에서 열리는가"와 "샘플 도면이 사전예약으로 이어지는가"가 확인되지 않은 가정입니다. 아래 순서로 먼저 확인합니다.

| 순서 | 검증 | 방법 | 통과 기준 | 언제 |
|---|---|---|---|---|
| 1 | 기술: DXF 작성 가능성 | **AR-06-019 2일 스파이크**. 샘플 대지 3건(제안: 정형 대지, 꼭짓점 많은 부정형 대지, 정북 일조사선이 걸리는 전용주거 대지)의 배치도·면적 산정도 DXF를 TS 작성기로 만들어 ezdxf audit, LibreCAD, AutoCAD(사람)로 연다. jsPDF·svg2pdf.js 라이선스와 워커 동작도 확인(D-23) | 한글 포함 3건 모두 열림, audit 오류 0, 치수 일치. `[DECISION] D-20`, `D-23`, AC1027 필수 TABLES·OBJECTS 목록 기록 | W0(setup 직후 첫 작업) |
| 2 | 수요: 샘플 → 사전예약 | 사전예약 랜딩에 샘플 도면(DXF·PDF) 다운로드. 정식은 AR-06-033(W4, 골든 출력만 게시). 그 전에 검증을 앞당기려면 스파이크 출력 3건을 임시 랜딩 + 이메일 사전예약 신청(결제 없음) 폼으로 먼저 공개(제안, 정식 페이지로 교체) | 9.8절: 다운로드 → 사전예약 10% 이상(6주) | 스파이크 통과 후 |
| 3 | 실무 적합성 | 인터뷰 5건 이상(아래 질문) | D-22(DWG), D-24(레이어), D-12(macOS), D-2(얼리버드 가격) 판단 자료 | W2~W4 동안 사람 |
| 4 | MVP | 9.2절 MVP 범위 개발 | 9.3절 수용 기준 | W1~W7 |

**인터뷰 질문(제안, PRD 9.10절 3단계 + 열린 결정)**

| 질문 | 쓰는 결정 |
|---|---|
| 계약 전 무료 제안 1건에 배치도·면적 산정도·일조 검토를 그리는 데 몇 시간 걸리는가. 이것을 DXF로 받으면 얼마나 줄어드는가 | 9.8절 KPI, 가격 근거 |
| DWG가 꼭 필요한가, DXF로 받아 자기 CAD에서 저장하면 되는가. 쓰는 CAD는(AutoCAD, ZWCAD, BricsCAD, Rhino, SketchUp) | D-22, D-11 |
| 사무소 레이어 이름 규칙이 있는가(예시 파일을 받을 수 있는가) | D-24, 레이어 매핑 프리셋 |
| 사무소 PC가 모두 Windows인가 | D-12 |
| 영구 라이선스 490,000원(선착순 100개) + 연 290,000원 업데이트를 살 의향이 있는가, 월 49,000원 구독과 비교하면 | D-2, D-4 |
| 체험판 표제란에 "체험판"이 찍힌 도면을 건축주에게 보여 줄 수 있는가 | D-21 |
| 사무소 공용 이메일로 구매·세금계산서를 받는가 | D-19 |

**진행·중단 판단(go/no-go, 제안)**

| 결과 | 판단 |
|---|---|
| 스파이크 3건 중 하나라도 AutoCAD 또는 LibreCAD에서 안 열리거나 치수가 다름 | AR-06-020~022 착수 중단, 사람에게 보고(06장 019 수용 기준). 원인이 AC1027 구조면 1~2일 추가 스파이크, 한글이면 글꼴 전략 재검토 |
| 스파이크 통과 + 다운로드 → 사전예약 10% 이상 | 계획대로 진행 |
| 다운로드는 많은데 사전예약 5% 미만 | 가격(D-2·D-4)과 메시지 재검토. 도면 블록은 계속하되 W5 이후 범위(평면 편집기 027, 3D 입출력 039)를 미룸 |
| 인터뷰에서 "DWG 필수" 과반 | D-22 (b) ODA SDK 비용 확인 후 결정. DXF만으로 출시할지 사람이 판단 |
| 다운로드 자체가 적음(6주 100건 미만, 제안) | 랜딩 채널 문제인지 확인 후, 개발 범위를 도면 + 판정(v0, 9.1절)으로 줄이는 것을 검토 |

주의: 결제를 받는 사전예약 판매는 Stage B(Google + 이메일 로그인, W7)와 영구 라이선스 결제 종류(코어 요청 R-A1 = C-1) 뒤에만 열 수 있습니다(`01_PRD.md` 8.2절). 그 전에 하는 사전예약은 결제 없는 신청으로 둡니다.

## 2. 사전 준비

| 도구 | 용도 | 확인(Git Bash) | 확인(PowerShell) |
|---|---|---|---|
| Git for Windows(Git Bash) | 베이스의 `.sh` 스크립트 실행 | `bash --version` | `& "$env:ProgramFiles\Git\bin\bash.exe" --version` |
| git, jq | 저장소, 베이스 게이트·무결성 점검 | `git --version; jq --version` | 같음 |
| Python 3 | 베이스 self-test, setup의 모델 지정 단계 | `python --version` | 같음 |
| Node.js 20 LTS + pnpm(제안) | web, 데스크톱 화면, 엔진 패키지, 워커, SQL 체커 | `node -v; pnpm -v` | 같음 |
| Python 3.12 + uv(제안) | `apps/api`(FastAPI, LangGraph), CI 전용 ezdxf audit | `uv --version; python3.12 --version` | `py -3.12 --version` |
| Supabase CLI | 로컬 DB | `supabase --version` | 같음 |
| Docker Desktop | Supabase 로컬, Dify, 오픈소스 LLM·임베딩·음성 서버 | `docker version` | 같음 |
| Rust stable(MSVC 툴체인) + Visual Studio C++ Build Tools | `apps/desktop/src-tauri` 빌드, `cargo test`·`clippy`·`audit` | `rustc --version; cargo --version; rustup show active-toolchain` | 같음(툴체인 이름에 `msvc`) |
| Tauri CLI 2.x | `tauri dev`·`tauri build`. AR-06-004가 `apps/desktop`에 `@tauri-apps/cli` 2.x를 넣으면 `pnpm --filter ./apps/desktop tauri ...`로 쓰고, 그 전에는 `cargo install tauri-cli --version "^2" --locked`(선택) | `cargo tauri --version` | 같음 |
| WebView2 런타임 | 데스크톱 화면 실행(Windows 11 기본 포함) | (setup 스크립트가 레지스트리로 확인) | 같음 |
| cargo-audit | Rust 의존성 점검(06장 7장) | `cargo audit --version` | 같음 |
| LibreCAD(무료), AutoCAD(라이선스 보유 PC, 사람) | DXF 수동 확인(12.5절) | - | - |
| NVIDIA GPU + Container Toolkit(WSL2) | 오픈소스 LLM·음성 서버를 직접 띄울 때만 | `nvidia-smi` | 같음 |

**키·인증서**(서버 환경변수로만, `docs/file/03-설계/02_ARCHITECTURE.md` 8장)

| 키 | 위치 | 비고 |
|---|---|---|
| Anthropic, OpenAI, Google | `apps/api` 전용 | |
| fal(`FAL_KEY`), WeasyPrint(`RENDER_SERVICE_TOKEN`) | 워커 전용 | |
| `LICENSE_SIGNING_PRIVATE_KEY` + `LICENSE_SIGNING_KID` | web 서버 전용 | Ed25519. `AI_TOKEN_PRIVATE_KEY`와 다른 키. 생성 예: `openssl genpkey -algorithm ed25519 -out license.pem`(제안). 공개키는 `apps/desktop/src-tauri/keys/`에 상수로(AR-06-041) |
| `AI_TOKEN_PRIVATE_KEY`, `VWORLD_API_KEY`, Toss 키, `ARCH_WORKER_INTERNAL_KEY` | web 서버 전용(워커 키는 워커에도) | |
| `TAURI_SIGNING_PRIVATE_KEY`(+ 암호) | GitHub 환경 비밀만 | 업데이트 파일 서명. 라이선스 키·코드 서명과 분리. 생성은 Tauri CLI `signer generate`(구현 시 확인) |
| Windows 코드 서명 인증서 | GitHub 환경 비밀만 | 종류(OV·EV)·비용·발급 기간 미확인(Tauri 가이드 T-D5). 첫 공개 배포 3개월 전 발급 착수를 권합니다(제안). 없으면 SmartScreen 경고가 뜹니다 |

데스크톱 번들에 들어가는 값은 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`, `VITE_AUTH_MODE` 네 개뿐입니다. 그 밖의 `VITE_` 변수가 있으면 빌드가 실패해야 합니다(AR-06-004).

**공용 인프라 문서**

| 인프라 | 문서 |
|---|---|
| Dify(공용 1개) | `D:\WorkSpace\platform\docs\develop\_shared\dify\README.md` |
| 오픈소스 음성 서버 | `...\_shared\voice\README.md` |
| 오픈소스 LLM 서버·임베딩·상용 키 | `...\_shared\llm\README.md` |
| 로그인 공용 지시서 | `...\_shared\auth\README.md`(19장) |
| 데스크톱 공통 가이드 | `D:\WorkSpace\platform\docs\Tauri\README.md`(묶음에 들어가지 않음) |
| 공용모듈 V2 | `D:\WorkSpace\platform\docs\develop_V2\arch-studio\arch-studio_develop_v2.md`(compliance 채택, AR-V2-01·02) |

## 3. 1단계: 베이스 복사와 초기화 (setup 스크립트가 처리)

| 순서 | 동작 |
|---|---|
| 0 | 사전 확인(베이스·묶음 존재, 대상 없음, git·jq·Python) |
| 1 | 데스크톱 도구 확인(경고만): `rustc`, `cargo`, Tauri CLI 2.x, Windows면 MSVC 툴체인과 WebView2 |
| 2 | 베이스 원본을 `D:\WorkSpace\DEV\arch-studio`로 복사(대상이 있으면 중단) |
| 3 | **복사본 안의** `init-project.sh arch-studio --reset-git` 실행 |
| 4 | `arch-studio-root` 안의 내용물(`docs`, `supabase`, `infra`, `.claude`)을 복사본 루트에 붙여넣기 |
| 5 | 복사본의 `docs/etc`(베이스 설명서 PDF) 삭제 |
| 6 | 에이전트 모델 지정: `plan-challenger` → `claude-fable-5-1`(고문), `nextjs-expert`·`fastapi-expert`·`supabase-expert` → `sonnet`(부) |
| 7 | 무결성 점검(`_shared/check-invariants.sh`) |

setup 스크립트는 커밋, 원격 푸시, 의존성 설치, Rust·Tauri 설치, 원격 DB 변경을 하지 않습니다. **반드시 복사본 안의 `init-project.sh`를 실행합니다.** 베이스 원본에서 실행하면 원본이 초기화되고 `--reset-git`이면 git 이력이 지워집니다. 고문을 Opus로 쓰려면 setup 뒤 `.claude/agents/plan-challenger.md`를 `model: opus`로 되돌립니다.

베이스에는 Rust·Tauri 전용 서브 에이전트가 없습니다. Rust 작업(004, 006, 041, 042, 062)은 `claude-main`이 직접 구현하고 리뷰는 `review-expert` + 고문이 맡는 것을 기본으로 합니다(제안). 전용 에이전트가 필요하면 부록 A의 방법으로 사람이 추가합니다.

## 4. 2단계: 묶음 붙여넣기 (setup 스크립트가 처리)

- `arch-studio-root` 폴더 자체가 아니라 **그 안의 내용물**이 개발 폴더 루트에 들어갑니다. `docs`와 `supabase`는 베이스의 같은 폴더와 합쳐집니다.
- 덮어쓰는 파일은 `docs/file/_index.md` 하나뿐입니다(init이 만든 빈 등록부를 완성본으로 교체).
- 손으로 하는 방법은 부록 A에 있습니다.

## 5. 3단계: 이관 경로와 최종 트리

### 5.1 이관 경로 (원본 기준 `D:\WorkSpace\platform\`)

| 원본 | 개발 폴더 안 경로 | ID | 산출물명 |
|---|---|---|---|
| `docs/products/arch-studio/README.md` | `docs/file/01-관리/README.md` | DOC-MGT-001 | 제품 개요 |
| `docs/products/arch-studio/06_AGENT_PLAN.md` | `docs/file/01-관리/06_AGENT_PLAN.md` | DOC-MGT-002 | 작업 계획(WBS) |
| `docs/products/arch-studio/01_PRD.md` | `docs/file/02-요구사항/01_PRD.md` | DOC-REQ-001 | 요구사항정의서(9장 도면) |
| `docs/products/arch-studio/02_ARCHITECTURE.md` | `docs/file/03-설계/02_ARCHITECTURE.md` | DOC-DES-001 | 아키텍처설계서(2.3절 도면 엔진) |
| `docs/products/arch-studio/03_SCREENS_UX.md` | `docs/file/03-설계/03_SCREENS_UX.md` | DOC-DES-002 | 화면설계서(3.19절 디자인 시스템) |
| `docs/products/arch-studio/04_API.md` | `docs/file/03-설계/04_API.md` | DOC-DES-003 | 인터페이스설계서(4.7절 로컬 엔진 계약) |
| `docs/products/arch-studio/05_DATA_MODEL.md` | `docs/file/03-설계/05_DATA_MODEL.md` | DOC-DES-004 | 데이터설계서 |
| `docs/products/_platform-core/` 9개 | `docs/file/03-설계/공용코어/` | DOC-CORE-001~009 | 공용 코어 명세(009 `AUTH_ROADMAP.md`) |
| `docs/products/_design-guide/` 5개 + `DASHBOARD_PATTERNS.md` | `docs/file/03-설계/디자인/` | DOC-DSN-001~005, 008 | 디자인 기준 |
| (생성) DESIGN.md, COMPONENTS.md | `docs/file/03-설계/디자인/` | DOC-DSN-006~007 | 빈 초기 템플릿(이 제품은 `08_DESIGN_SYSTEM.md`가 없어 초기값 없음) |
| `docs/products/arch-studio/CLAUDE.md` | `docs/file/04-구현/CLAUDE.md` | DOC-IMP-001 | 개발지침 |
| `docs/products/arch-studio/07_SOURCE_MIGRATION.md` | `docs/file/04-구현/07_SOURCE_MIGRATION.md` | DOC-IMP-002 | 원본 이식 계획 |
| `docs/products/00_MERGE_ANALYSIS.md` | `docs/reference/00_MERGE_ANALYSIS.md` | 참고 | 통합 분석, 확정 결정 |
| `docs/reviews/FortuneDocs.md` | `docs/reference/reviews/FortuneDocs.md` | 참고 | 이식 원칙 리뷰 1건 |
| `.../arch-studio/supabase/monolith/migrations/0001_core_lite.sql` | `supabase/migrations/20261013000001_core_lite.sql` | - | 코어 축소판(SECTION 6-A, 6-B, 9 제거, 3,211줄) |
| `.../0002_arch_domain.sql` | `supabase/migrations/20261013000002_arch_domain.sql` | - | 도메인 변환본(1,852줄, 운영 상수 16행, 버킷 2개) |
| `.../monolith/seed.sql` | `supabase/seed.sql` | - | apps 1행, 플랜 3, 크레딧팩 3, 라이선스 상품 2, AI 라우팅 14행 |
| `.../monolith/tests/rls_smoke.sql` | `supabase/tests/rls_smoke.sql` | - | RLS·권한·RPC 회귀 125항목 |
| `docs/develop/_shared/llm-wiki/` | `docs/wiki/WIKI_SCHEMA.md`, `.claude/skills/llm-wiki/SKILL.md` | - | 개발 위키 |
| (생성) 위키 초기 페이지, Dify 앱 설명서 | `docs/wiki/`, `infra/dify/README.md` | - | 산출물 요약 26개, `arch-chat` 설정 |

- 묶음은 `D:\WorkSpace\platform\docs\develop\_shared\tools\build_root.py arch-studio`로 만들었습니다(산출물 26개, SQL 4개). 다시 만드는 방법은 부록 A 끝.
- 복사하지 않은 파일(`_supabase-modular/migrations/2400_arch.sql`, nomad-docs·flora-publishing 기획서 등)을 가리키는 참조는 `D:/WorkSpace/platform/...` 절대경로로 바뀌어 계속 열 수 있습니다.
- **주의**: `docs/Tauri/README.md`와 `docs/develop_V2/...` 참조는 묶음 안에서 바뀌지 않고 상대경로로 남아 있습니다(`build_root.py`가 두 폴더를 옮기지도, 절대경로로 바꾸지도 않음). 개발 폴더에서는 `D:/WorkSpace/platform/docs/Tauri/README.md`, `D:/WorkSpace/platform/docs/develop_V2/arch-studio/arch-studio_develop_v2.md`로 읽습니다. 요청 프롬프트에 이 두 경로를 함께 적습니다(9.4절).
- RLS 러너 `run-smoke.mjs`는 묶음에 들어가지 않습니다(platform 저장소 경로 전제). 개발 폴더 러너는 AR-06-002가 `scripts/test-rls/run.mjs`로 만들고, 그 전에는 7.3절 방법을 씁니다.

### 5.2 최종 트리 (W0~W2 스캐폴딩 후 `D:\WorkSpace\DEV\arch-studio\`)

```
D:\WorkSpace\DEV\arch-studio\
├── CLAUDE.md  init-project.sh  INSTALL.md  README.md      [베이스]
├── .claude\agents\  commands\  skills\                     [베이스] + skills\llm-wiki\ [묶음]
├── _shared\  _templates\                                   [베이스]
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs   [AR-06-003]
├── apps\
│   ├── desktop\                      [004] Vite + React 19, src\routes\, src\workers\(017), migrations\(006), e2e\(060)
│   │   └── src-tauri\                Cargo.toml, tauri.conf.json, capabilities\, keys\,
│   │                                 src\commands\{secrets,local_db,fs,export,license,device,updater,deeplink}.rs
│   ├── web\  api\                    [베이스] Next.js 16.2 / FastAPI(app\ai\graphs\arch_*.py, products\arch\)
├── packages\
│   ├── domain\ geometry\ rules\ program\ massing\ layout\   엔진(TS 순수 함수)
│   ├── drafting\                     도면 엔진: src\{sheet,titleblock,layers,annotate,views,writers}\, golden\, fonts\
│   ├── io\  shell-bridge\  features\  ui\(tokens.css, Tailwind CSS v4 @theme)
├── workers\arch-jobs\                [048] 큐 arch.* 단일 소비자
├── spikes\drafting\                  [019] 버리는 코드(패키지 import 금지)
├── e2e\ tests\ scripts\ .github\workflows\{golden,desktop-build,desktop-release,web,api}.yml
├── docs\reference\  docs\file\(26, 5.1절)  docs\wiki\(sources 26)   [묶음]
├── infra\dify\README.md              [묶음] DSL은 AR-06-054가 arch-chat\로 추가
├── supabase\migrations\(2), seed.sql, tests\rls_smoke.sql   [묶음]
└── tasks\  _local\                   [베이스]
```

### 5.3 기획서 경로 → 개발 경로

기획서는 경로 약어를 씁니다(`06_AGENT_PLAN.md` 머리말). task의 `write_scope`에는 오른쪽 값을 씁니다.

| 기획서 약어 | 개발 폴더 경로 |
|---|---|
| `web/` | `apps/web/` |
| `desk/` | `apps/desktop/` |
| `rust/` | `apps/desktop/src-tauri/` |
| `api/` | `apps/api/` |
| `wk/` | `workers/arch-jobs/` |
| `feat/` | `packages/features/src/` |
| `draft/` | `packages/drafting/` |
| `supabase/monolith/migrations/0001`, `0002` | `supabase/migrations/20261013000001_*`, `20261013000002_*` |
| `_supabase-modular/migrations/2400_arch.sql`(정본) | 개발 폴더 사본 `supabase/modular/2400_arch.sql`(제안, `migrations/`에 두면 `db reset`이 실패) |

모노레포 도구는 pnpm workspace(제안)입니다. `pnpm-workspace.yaml`에 `apps/*`, `workers/*`, `packages/*`를 넣고 `spikes/*`는 넣지 않습니다(제안: 스파이크가 워크스페이스 의존성으로 잡히지 않게).

## 6. 4단계: project-profile 작성

`_shared/project-profile.md`에 다음 값을 채웁니다.

| 항목 | 값 | 근거 |
|---|---|---|
| 적용 표준 | platform 통합 기획 규칙(DOC_TEMPLATE) | `docs/file/_index.md` |
| 데스크톱 | Tauri 2.x(구현 시 최신 2.x 고정, 2026-10-10 확인 2.12.3), Rust stable + `rusqlite`(bundled), 플러그인 deep-link·updater·dialog·single-instance, Vite + React 19 + React Router, WebView2 | `02_ARCHITECTURE.md` 1장, `CLAUDE.md` 5장 |
| 웹 | Next.js 16.2.x, React 19.2, TypeScript strict, Tailwind CSS v4(4.x 고정), shadcn/ui(Tailwind CSS v4 지원 버전), zod 3.x, lucide-react, `@supabase/ssr` | 같은 곳 |
| 3D·지오메트리 | three.js + React Three Fiber + drei(WebGL2), Manifold WASM, 2D 다각형 라이브러리(AR-02-D1, 미확정), web-ifc, rhino3dm(AR-02-D2, 미확정) | `02_ARCHITECTURE.md` 1장 |
| 도면 | 자체 `packages/drafting`(DXF AC1027·SVG·PDF·PNG), PDF 라이브러리 D-23 스파이크 결과, CI 전용 Python ezdxf(버전 고정, 런타임 미포함) | `01_PRD.md` 9장 |
| 워커 / AI | Node 20 LTS + TS(`workers/arch-jobs`) / FastAPI + Python 3.12 + LangChain/LangGraph, pgvector 0.8 이상 | `02_ARCHITECTURE.md` 1장 |
| DB | Supabase(PostgreSQL 15 + pgvector). 로컬은 모놀리스 `public`, `SUPABASE_DB_SCHEMA=public` | 7장 |
| 명령 | `pnpm -r lint / typecheck / test / build`, `pnpm --filter ./apps/web dev`, `pnpm --filter ./apps/desktop tauri dev / tauri build`, `pnpm --filter ./packages/drafting test:golden`, `pnpm --filter ./packages/rules test`, Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo audit`(`apps/desktop/src-tauri`), api: `uv sync`, `uvicorn app.main:app --reload`, `pytest apps/api -k arch`, `ruff check apps/api`, DB: `supabase start`, `supabase db reset`, `supabase gen types typescript --local --schema public > apps/web/src/types/supabase.ts` | `CLAUDE.md` 6장(pnpm·uv는 제안) |
| 모델 핀 | claude-main `claude-opus-5-5`, claude-reviewer `claude-sonnet-5-5`(변경하지 않음) | 베이스 `_shared/backends.json` |

버전은 `latest`로 두지 않고 lockfile(`pnpm-lock.yaml`, `Cargo.lock`)로 고정합니다. **Tailwind는 반드시 Tailwind CSS v4**입니다. `tailwind.config.js`와 v3 문법을 쓰지 않습니다. 새 의존성은 라이선스를 PR에 적고 GPL·AGPL은 거부합니다.

## 7. 5단계: 로컬 DB

### 7.1 기동과 적용

| 순서 | 명령 | 설명 |
|---|---|---|
| 1 | `supabase init` | `config.toml`이 없을 때만. 기존 `migrations`, `seed.sql`, `tests`는 그대로 |
| 2 | `supabase start` | Docker로 로컬 Supabase 기동 |
| 3 | `supabase db reset` | `migrations/`를 이름순으로 적용하고 `seed.sql`을 넣습니다 |
| 4 | `supabase gen types typescript --local --schema public > apps/web/src/types/supabase.ts` | 타입 생성. 같은 출력을 `packages/domain/src/db/supabase.gen.ts`에 복사(AR-06-001 스크립트) |

- 단독 Supabase 프로젝트(모놀리스, `public`)로 시작하는 것을 제안합니다. 클라우드 정본은 모듈러 `arch`이고(`README.md` 5장), 통합 DB로 옮길 때는 `SUPABASE_DB_SCHEMA=core`, 타입 `--schema core,arch`만 바뀝니다(`05_DATA_MODEL.md` 8장).
- `core_lite`는 SECTION 6-A(oauth_states), 6-B(encrypted_credentials), 9(affiliate)만 뺐습니다. `0002` 12절에 운영 상수 16행(크레딧 단가 10종, 동시 렌더 3, 보존 90일, 셀프 해제 30일 3회, 체험 14일 등)과 비공개 버킷 2개(`arch-releases` 빌드·규칙 팩·단가표, `arch-user` 사용자 업로드)가 있습니다.
- `seed.sql`은 라우팅 행이 14개가 아니거나 오픈소스 강제 행 체인에 상용 제공자가 있으면 스스로 예외를 냅니다.

**적용 후 확인 쿼리**

| 확인 | 쿼리 | 기대값 |
|---|---|---|
| 라우팅 기본값 | `select count(*) from public.ai_routing_settings where org_id is null and app_id = 'arch'` | 14 |
| 강제 오픈소스 | `select feature from public.ai_routing_settings where app_id = 'arch' and force_open_source order by 1` | `arch.intake_consult`, `consult_recording`, `dify.aux` 3행 |
| 플랜 | `select code, price_krw, billing_interval, monthly_credits, signup_credits from public.plans where app_id = 'arch' order by sort_order` | trial 0/none/0/30, updates_yearly 290,000/year/480/0, sub_monthly 49,000/month/150/0 |
| 크레딧팩 | `select code, credits, price_krw from public.credit_packs where app_id = 'arch' order by sort_order` | pack_100 10,000, pack_550 50,000, pack_1200 100,000 |
| 라이선스 상품 | `select code, price_krw, max_activations, max_quantity from public.license_skus order by sort_order` | perpetual_early 490,000/2/100, perpetual_standard 890,000/2/null |
| 운영 상수 | `select count(*) from public.runtime_config` | 16 |
| 버킷 | `select id from storage.buckets where id like 'arch-%' order by 1` | `arch-releases`, `arch-user` |
| pgvector | `select extname from pg_extension where extname = 'vector'` | 1행 |

### 7.2 SQL 체커(PGlite)로 다시 확인

기획 단계 검증 결과(2026-10-16, `05_DATA_MODEL.md` 9장): 모듈러 core 0000~0009 + seed + `2400_arch.sql` 정순·재적용 OK, 모놀리스 0001 + 0002 + seed OK, RLS 스모크 125/125(모듈러·모놀리스).

```
cd D:/WorkSpace/platform/docs/products/_tools-sqlcheck
npm ci
node check.mjs --vector mono \
  D:/WorkSpace/DEV/arch-studio/supabase/migrations/20261013000001_core_lite.sql \
  D:/WorkSpace/DEV/arch-studio/supabase/migrations/20261013000002_arch_domain.sql \
  D:/WorkSpace/DEV/arch-studio/supabase/seed.sql
```

- 파일마다 `[mono] OK <파일>`이면 통과입니다. AI 테이블(pgvector) 때문에 `--vector`가 필수입니다.
- 체커는 적용 가능 여부만 봅니다. RLS 판정은 7.3절 스모크가 맡습니다.

### 7.3 RLS 스모크(`supabase/tests/rls_smoke.sql`)

125개 검사가 한 파일에 있습니다. 스키마 자리표시자 `@S@`(제품, 모놀리스 `public` / 모듈러 `arch`), `@C@`(코어, `public` / `core`)를 씁니다.

| 머리 표시 | 의미 |
|---|---|
| `-- SETUP` ~ `-- END SETUP` | 관리 세션에서 사용자·조직·라이선스(oA 유효, oB 업데이트 만료 폴백)·프로젝트를 만듭니다 |
| `-- AS service` / `anon` / `A` / `B` / `C` / `M` / `V` | 이후 문장의 역할. A·B는 서로 다른 조직 owner(B는 폴백 상태), C는 엔타이틀먼트 없음, M·V는 A 조직의 member·viewer |
| `-- RUN` | 다음 한 문장을 기대값 없이 실행 |
| `-- TEST <이름> \| expect=...` | `rows:N`, `ok`, `sqlstate:CODE` |

주요 검사: service RPC(`start_ai_run`, `issue_license`, `activate_license`, `activate_plan_device`, `consume_credits`)를 authenticated로 부르면 42501, 다른 조직 `licenses`·`renders`·`cloud_projects` 0행, member의 `upsert_drafting_profile`은 `AR042`, 같은 `request_id` 재호출은 추가 차감 없음, 경로 조작(`..`) 23514, 표제란 건축주 이름 키 22023.

가장 빠른 확인은 platform 저장소의 러너입니다(Supabase 없이 PGlite).

```
cd D:/WorkSpace/platform/docs
node products/arch-studio/supabase/monolith/tests/run-smoke.mjs --target mono   # 125/125
node products/arch-studio/supabase/monolith/tests/run-smoke.mjs --target mod    # 125/125
```

개발 폴더의 SQL을 고친 뒤 실제 Supabase로 확인하려면 AR-06-002 러너(`node scripts/test-rls/run.mjs --target mono`)를 쓰고, 그 전에는 `sed -e 's/@S@/public/g' -e 's/@C@/public/g'`로 치환본을 만들어 psql에서 문장 단위로 실행합니다(역할 전환 방법은 `develop/nomad-docs/nomad-docs_develop.md` 7.3절과 같음). 파일 전체를 한 번에 넣으면 역할 전환과 기대 오류 판정이 되지 않습니다.

### 7.4 DB 변경 규칙

- 정본은 모듈러 `2400_arch.sql`이고 모놀리스 `0002`와 `seed.sql`은 변환 스크립트로만 다시 만듭니다(AR-06-001, `CLAUDE.md` 2장 "DB 변경"). 변환 `--check` diff 0이 조건입니다. compliance 변환본과 seed compliance 절만 AR-V2-01이 씁니다.
- 로컬 SQLite(데스크톱 B 분류 11테이블)는 Supabase가 아니라 `apps/desktop/migrations/**`(AR-06-006)이고 필드 추가만 허용합니다.
- DB·RLS를 바꾼 PR은 스모크 두 대상(mod·mono)이 통과해야 병합합니다. 원격 `supabase db push`는 에이전트가 실행하지 않고 사람이 확인 후 실행합니다.

## 8. 6단계: 착수 전 결정 확정

`docs/file/02-요구사항/01_PRD.md` 8장(D-1~D-14), 8.2절(D-15~D-19), 9.9절(D-20~D-26)과 `02_ARCHITECTURE.md` 1장(AR-02-D1·D2)의 결정을 확정합니다. 가정과 다르게 정하면 해당 산출물을 고치는 task를 따로 만듭니다. 굵게 표시한 것이 초기 웨이브를 막는 결정입니다.

| ID | 결정 | 권고 | 확정 시점(막는 작업) |
|---|---|---|---|
| D-1 | 브랜드명 | 가칭 유지, 폴더·app id는 브랜드와 무관 | 사전예약 랜딩(033, 057) 전 |
| D-2 | 얼리버드 가격·수량 | 490,000원 선착순 100개 | 사전예약 판매(W7) 전. seed는 제안값으로 진행 |
| **D-3** | 영구 라이선스 결제 방식 | (a) 코어 요청 C-1 = R-A1(`payment_orders.kind` 일회성 상품) | W2 착수 전 사람 결정, 코어 반영 전 043 영구 SKU 경로 머지 보류 |
| D-4 | 정가·단가·환불 | 사전예약 전환율 + 베타 2주 원가 후 | 베타 후. `pricing.ts`(047)는 제안값 |
| D-5, D-6 | 업데이트 만료 후 재가입 / 크레딧팩 유효기간·부가세 | 가입일부터 1년 / 소멸 없음, 부가세 포함 표시 | 043 전(D-6은 법무 확인) |
| D-7 | 영구 라이선스 오프라인 | 활성화 후 무기한 | 040·041 전(라이선스 파일 `offline_valid_until` null) |
| D-8 | 클라우드 검토 범위·양도 | 검토는 업데이트 플랜·구독 전용, 양도 1회 | 051 전 |
| D-9~D-13, D-25 | 로컬 GPU 렌더, BYOK(R-A2), .skp, macOS, 교육 라이선스, AI 실 배치 | 모두 MVP 제외(Phase 2) | 확인만(D-12는 인터뷰 후) |
| **D-14** | 공공 API 명세·이용 조건(VWorld, 건축HUB, 법령 DRF, 출처 표기) | 원문 확인 전 "직접 그리기"가 기본 경로 | 035(대지 조회)·050(RAG 출처 표기) 전. 미확인이면 035는 직접 그리기만으로 머지 |
| **D-15** | 데스크톱 로그인 방식 | (a) PKCE + `archstudio://auth/callback` 딥링크, 막히면 (b) 루프백 | 0.5일 스파이크(PRD 권고는 02 작성 전). 06장에서는 062 첫 단계 `[DECISION]`. W1(005·008)은 Mock이라 막히지 않지만 R-A8(Redirect URL 등록 가능 여부)은 G1 전 확인 |
| **D-16** | 시리얼과 계정 연결 | (a) 구매 계정 조직에 귀속, 활성화는 로그인 계정으로만 | 040·041 착수 전(W2). 05장 테이블이 이미 이 전제 |
| D-17 | 카카오 이메일 정책 | 비즈 앱 + `account_email` 필수 | 063 전(G2 후, 하기로 했을 때) |
| D-18 | 네이버 경로 | 스파이크로 결정 | 064 첫 단계 |
| D-19 | 이메일 가입 유지 | 유지 | 062 전(G1) |
| **D-20** | DXF 쓰기 구현 | (a) 자체 TS 작성기, ezdxf는 CI 전용 | 019 스파이크 `[DECISION]`. 020~022 진입 조건 |
| D-21 | 체험판 도면 표시 | (a) 표제란 "체험판" | 020 전 |
| D-22 | DWG 입출력 | (a) 미지원, 인터뷰로 재판단 | 인터뷰 후(W4) |
| **D-23** | 도면 PDF 생성 위치 | (a) 로컬(SVG → 벡터 PDF), 라이브러리 라이선스 확인 | 019 스파이크 `[DECISION]`. 022 진입 조건 |
| D-24 | 레이어 표준 | (a) 9.6절 자체 표준 + 사무소별 매핑 | 020(`layers`) 전. 인터뷰 결과로 프리셋 추가 |
| D-26 | 매스 제안 탐색 | (a) 결정적 격자 탐색 | 028 전 |
| AR-02-D1 | 2D 다각형 라이브러리·라이선스 | Clipper2 계열, 실패 시 정수 좌표 자체 구현 | 014 첫 단계 `[DECISION]` |
| AR-02-D2 | rhino3dm 라이선스 | 미확인이면 .3dm 보류 | 039 첫 단계 `[DECISION]` |

**코어 요청**(`06_AGENT_PLAN.md` 6장 R-A1~R-A14, 2026-10-16 모두 남음): 이 제품은 공용 코어 변경 없이는 끝까지 갈 수 없습니다. 개발 폴더에서는 코어를 고치지 않고, platform 쪽에서 반영되기를 기다리며 해당 경로 머지를 보류합니다.

| 막는 시점 | 요청 |
|---|---|
| W0(001) | R-A4 seed(C-4, 반영 전에는 조각 seed do nothing), R-A11 `DB_CONVENTIONS.md` 2400 행 |
| W1(007, 008) | R-A6 Bearer 세션(T-C1), R-A7 CORS(T-C2), R-A9 finishLogin(T-C8), R-A13 `AUTH_ROADMAP.md` 적용 순서 |
| W2(040~043) | R-A1 일회성 결제(C-1), R-A3 라이선스 서명 키 규격(C-3) |
| W3(032) | R-A5 WeasyPrint `app_id`에 `arch`(C-5) |
| W0-D(009, 057 전) | R-A12 `HERO_3D.md` 소재 행, R-A14 `REFERENCES.md` arch-studio 절 |
| G1 전(062) / W8(064) | R-A8 Redirect URL 앱 스킴(T-C6) / R-A10 네이버 브리지 교환 코드(T-C7) |

**산출물 승인 절차**: 결정을 반영하는 task → 반영 후 `docs/file/_index.md` 상태를 "초안"에서 "승인"으로, 변경 이력 기록 → 개발 task는 "승인" 산출물만 baseline으로 씁니다.

## 9. 7단계: 작업을 task로 변환

### 9.1 작업과 웨이브 (정본: `docs/file/01-관리/06_AGENT_PLAN.md` 2~3장)

작업은 AR-06-001~064와 AR-V2-01·02, 모두 66개입니다. AR-06-011은 사람이 판정하는 비주얼 검토, AR-06-019는 2일 스파이크(버리는 코드)입니다. P1은 026~029·052, P2는 063·064입니다.

| 웨이브 | 작업 ID | 진입 조건 | 산출물 |
|---|---|---|---|
| W0 | 001, 003, 004, 009, 013, 019 | 없음 | 로컬 DB, 모노레포·web 골격, 빈 셸 창, 디자인 레퍼런스, 도메인 계약, **도면 스파이크 결과**(`[DECISION] D-20`·`D-23`) |
| W0-D | 010 → 011(사람) → 012 | 009 | 디자인 시스템 2~4단계. 012가 W4 화면 작업의 진입 조건 |
| W1 | AR-V2-01, 002, 005, 006, 014, 018, 046, 048 → 007, 008 | W0. 007 Route Handler 호출 머지는 R-A6·R-A7 후 | RLS 스모크, shell-bridge·키체인, 로컬 명령, 2D 지오메트리, 프로그램 엔진, AI 서비스·워커 골격 → API 클라이언트, Mock 로그인 |
| W2 | 015 → 016, 020 → 021, 040 → (041, 043), 017, 047, 050, 058 | W1, **019 통과**(020·021) | 판정·엔벨로프, 시트 모델·DXF·골든 CI, 라이선스 서버·Rust 검증·결제, 엔진 워커, AI 게이트, RAG, CI |
| W3 | 022, 023, 024, 025, 042, 049, 051, 053, 054 | W2 | SVG·PNG·PDF, 배치도·면적도·일조 단면, 업데이트·규칙 팩 배포, 라우팅 검증, 법규 검토, 음성, 채팅 |
| W4 | 026, 029, 031, 033, 034, 035, 036, 037, 038, 044 → 028 | W3 + 012 | 평면 뷰, DXF 가져오기, 설정, **샘플 도면 `/samples`**, 프로젝트·대지·모델러·판정·프로그램·라이선스 화면 → 매스 제안 |
| W5 | 027, 030, 032, 039, 052, 055, 056, 057 | W4 | 평면 편집기, 도면 시트 화면, 제안서, 3D 입출력, 대화형 입력, AI 화면, 렌더, 랜딩 |
| W6 | 059, 060, 061, AR-V2-02 → 045 | W5 | 보안 점검, 데스크톱·웹 E2E, 통합 → 결제 E2E → G1 판정 자료 |
| W7 | 062 → 060·061 재실행 | G1(사람) | Google + 이메일 로그인 → 공개 베타, 사전예약 판매 |
| W8 | 063, 064 | G2(사람) | 카카오·네이버(P2 선택) |

**도면 우선 축소 릴리스 v0(제안)**: 린 검증(1.1절)을 빨리 돌리려면 001, 003, 004, 005, 006, 013, 014, 015, 016, 017, 019, 020, 021, 022, 023, 024, 025, 033과 화면 최소(036 일부, 030 일부)를 먼저 묶습니다. 결과물은 "대지 직접 그리기 → 엔벨로프 → 매스 → 판정 → 시트 3종 DXF·PDF"이고 클라우드 AI·결제·라이선스 화면은 뒤로 미룹니다. 라이선스 검증 전이라 이 빌드는 내부 시연·인터뷰용으로만 쓰고 배포하지 않습니다.

### 9.2 모델과 에이전트 매핑 (주 Opus, 부 Sonnet, 고문 Fable)

| 06장 권장 모델 | 작업 | 베이스에서 맡는 쪽 |
|---|---|---|
| Fable | DB·RLS(001, 002), 라이선스 서버·Rust 검증·업데이트 자격(040, 041, 042), 결제(043), AI 게이트·보안(047, 049), 보안 점검(059), 인증 B·C2(062, 064) | 오케스트레이터(Opus)가 설계, `plan-challenger`(고문)가 착수 전 검토, 구현은 도메인 expert(Sonnet) 또는 Rust는 `claude-main` 직접 |
| Opus | 모노레포, shell-bridge, 로컬 명령, API 클라이언트, Mock 로그인, 도메인 계약, 지오메트리·판정·엔벨로프·프로그램·매스·layout, 도면 블록 15개 중 13개(019~029, 031, 032), 3D 입출력, 화면 일부, AI 그래프·RAG·워커, E2E 통합 | `claude-main` 설계 → `nextjs-expert`·`fastapi-expert`(Sonnet) 구현. 엔진 패키지(순수 TS)는 `claude-main` 직접 또는 `nextjs-expert` |
| Sonnet | 디자인 시스템(009~012 중 3개), 도면 시트 화면(030), 샘플 도면(033), 판정 패널(037), 프로그램 화면(038), AI 화면(055), 랜딩(057), CI(058), 데스크톱 E2E(060), V2 2개 | `nextjs-expert` |
| Haiku | 셸 골격(004) | 오케스트레이터 직접 |
| 사람 | 비주얼 판정(011, 준비는 Sonnet), AutoCAD 확인(019), 인터뷰 5건, G1·G2 판정, 코드 서명 인증서 발급 | 대표님 |

작업 수 비율(71개, `06_AGENT_PLAN.md` 4장, 2026-10-17 설득형 랜딩 반영): Fable 11(15.5%), Opus 41(57.7%), Sonnet 17(23.9%), Haiku 2(2.8%). 규모 가중(S=1, M=2, L=3, 합계 157)은 Fable 16.6%, Opus 60.5%, Sonnet 21.0%, Haiku 1.9%입니다. Opus 비중이 book-trailer(56.7%)보다 높은 것은 도면·판정 엔진이 결정적 순수 함수 구현이기 때문입니다.

### 9.3 task 폴더 만들기

```
tasks/AR-06-019-drafting-spike/
├── task.md      baseline에 산출물 ID, workers_approved, write_scope
├── context.md
└── log.md       [APPROVAL], [DECISION] 기록(스파이크는 D-20, D-23, AC1027 목록)
```

```yaml
baseline:
  - id: DOC-REQ-001
    path: docs/file/02-요구사항/01_PRD.md        # 9장(9.3 AR-F-028·029·030·038, 9.6 레이어, 9.9 D-20·D-23, 9.10)
  - id: DOC-DES-001
    path: docs/file/03-설계/02_ARCHITECTURE.md   # 2.3절 DXF 작성기·결정성 규칙
  - id: DOC-DES-003
    path: docs/file/03-설계/04_API.md            # 4.7.3~4.7.6절
  - id: DOC-MGT-002
    path: docs/file/01-관리/06_AGENT_PLAN.md     # AR-06-019 수용 기준
```

`write_scope`는 06장 2장 "소유 파일/디렉토리" 열을 5.3절 경로 표로 바꿔 적습니다. 한 경로는 한 작업만 씁니다. 공용 설정 파일은 AR-06-003에 요청합니다.

### 9.4 요청 프롬프트 예시 (W0, AR-06-019 도면 스파이크)

```
D:/WorkSpace/DEV/arch-studio/docs/file 의 모든 파일(프로젝트 산출물)과
D:/WorkSpace/platform/docs/Tauri/README.md 를 최대한 자세히 읽고 분석한다.
(이미 읽은 파일은 skip. docs/file/_index.md 가 없으면 deliverable-first 스킬 절차로 산출물부터 추출한다.)
특히 01_PRD.md 9장(9.3, 9.6, 9.9, 9.10), 02_ARCHITECTURE.md 2.3절, 04_API.md 4.7절을 기준으로 한다.

[요구사항]
AR-06-019: 2일 도면 스파이크. 샘플 대지 3건(정형, 꼭짓점 많은 부정형, 정북 일조사선 대상 전용주거)의
배치도·면적 산정도 DXF 를 TypeScript 작성기로 생성한다. 완료 조건 =
① ASCII AC1027, $INSUNITS=4, \r\n, 엔티티는 LINE·LWPOLYLINE·ARC·CIRCLE·TEXT·MTEXT·HATCH·INSERT/BLOCK 만
② 9.6절 표준 레이어 이름·ACI 색·선 종류, 문자 스타일 ARCH-KR(한글 TTF 이름만 참조), 한글 실명·표제란 고지 포함
③ 같은 입력 두 번 생성 시 $TDCREATE·$TDUPDATE 값만 다르고 나머지 바이트 동일
④ ezdxf audit(버전 고정, spikes/drafting 안 Python 스크립트) 3건 오류 0, LibreCAD 에서 3건 열림(스크린샷)
⑤ 이격 치수 TEXT 가 같은 좌표로 계산한 거리와 1mm 단위로 일치
⑥ jsPDF·svg2pdf.js 라이선스와 Web Worker 안 동작 여부 확인(SVG 1장 → 벡터 PDF 1장)
⑦ log.md 에 [DECISION] D-20, [DECISION] D-23, AC1027 필수 TABLES·OBJECTS 목록, AutoCAD 확인 요청 항목을 남긴다.
AutoCAD 확인은 사람이 한다: 확인할 파일 경로와 점검표(12.5절)를 log.md 끝에 적고 멈춘다.
실패 항목이 있으면 AR-06-020~022 착수 전 사람에게 보고한다.

[작업의 특성]
버리는 코드. 작업 대상 경로: spikes/drafting/ 만. packages/ 와 공용 설정 파일은 만들거나 고치지 않는다.
npm 의존성은 spikes/drafting/package.json 안에서만, GPL·AGPL 금지. ezdxf 는 CI·검증 전용으로 런타임에 넣지 않는다.

이 요구와 근거 산출물(baseline)로 작업을 만들어 진행한다.
승인·결정 사항은 묻지 말고 먼저 진행한 뒤, 임의로 결정한 내용은 log.md 에 [DECISION] 으로 남기고 종료 시 [DECISION-SUMMARY] 로 정리한다.

main worker 는 claude-main 이 진행한다(서브 에이전트 없이 직접).
review role worker 는 claude-reviewer 가 진행한다.
review role worker 의 서브 에이전트는 plan-challenger, review-expert 가 병렬 진행한다.
```

W0의 다른 작업(001 DB, 003 모노레포, 004 셸 골격, 009 레퍼런스, 013 도메인 계약)은 서로 경로가 겹치지 않아 병렬로 지시합니다. 001은 book-trailer 개발서 9.4절 예시를 바탕으로 기대값만 7.1절 표(라우팅 14, 강제 3, 스모크 125)로 바꿉니다.

## 10. 8단계: 웨이브별 개발 사이클

| 순서 | 내용 | 도구 |
|---|---|---|
| 1 | 웨이브 시작 전 결정(8장)·코어 요청 상태 확인, 산출물 "승인" 확인 | `_index.md` |
| 2 | task 생성, baseline, `workers_approved`·`write_scope` | `_templates/task.md` |
| 3 | 착수 전 계획 검토 | `plan-challenger` |
| 4 | 구현 | 도메인 expert 또는 `claude-main`, `gate.sh`·`scope_check.sh` |
| 5 | 리뷰: 요구사항 → 설계 → 구현 → 테스트 추적성. 엔진 패키지 PR은 골든 CI, DB PR은 스모크 2대상 | `claude-reviewer`, `review-expert` |
| 6 | 개발 위키 갱신: task 완료마다 ingest(modules·decisions·log), 웨이브 끝에 lint. 스파이크·벤치 결과와 `[DECISION]`은 `docs/wiki/decisions/`에 | `llm-wiki` 스킬 |
| 7 | 완료 처리, 웨이브 종료 시 다음 웨이브 | - |

- **공개 베타 조건**: W6까지 녹색 + G1 판정 + W7(Stage B) + `06_AGENT_PLAN.md` 7장 완료 정의. P1(026~029, 052)은 MVP 출시 직후, P2(063, 064)는 G2 후.
- 화면 작업은 디자인 시스템 4단계(AR-06-012) 뒤에 시작합니다. 도면 작업 020~022는 019 통과 뒤에 시작합니다.
- 웨이브 시작마다 이식 원천 변경을 확인합니다: platform에서 `git diff 2f326c4..HEAD -- docs/products/{nomad-docs,flora-publishing,_platform-core,_design-guide} docs/reviews`(`07_SOURCE_MIGRATION.md` 5장).
- 구현이 산출물과 달라지면 코드를 조용히 맞추지 말고 산출물 갱신 task를 만듭니다.

## 11. AI 계층 구축 (arch-studio)

정본: `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md`, `VOICE_ARCHITECTURE.md`, `LLM_WIKI.md`, 제품 `02_ARCHITECTURE.md` 4·5장, `04_API.md` 2.2·4·6절

| 구성 | 내용 | 작업 |
|---|---|---|
| FastAPI AI 서비스 | 공용 ai-service + arch 확장(`app/ai/graphs/arch_{review,intake}.py`, `app/ai/products/arch/`, `app/ai/compliance/arch.py`). JWKS 검증 `aud=platform-ai:arch`. pydantic DesignModel 사본과 zod 동치 테스트 | 046 |
| AI 게이트 | 서명 토큰 발급, `POST /api/internal/ai-token`(워커 키), `pricing.ts` = seed, `arch.start_ai_run` 한 번으로 실행 행 + 잡 + 선차감, 업로드 경로 서버 생성 | 047 |
| 워커 | `core.claim_jobs` 루프, 실패 순서 `fail_job` → `arch.fail_ai_run`, 크론(reap 10분, 정산 5분, 녹음 삭제 1시간, 렌더 90일) | 048 |
| 라우팅 | seed 14행. 검토·intake·서술·채팅은 상용 우선, compliance·위키는 오픈소스 우선, `arch.intake_consult`·`consult_recording`·`dify.aux` 오픈소스 강제, 임베딩 `oss-embed` 고정. 국외 이전 미동의 조직은 oss-llm만 | 049 |
| RAG | `arch.knowledge`(법령·지구단위계획·질의회신, `application_date` 시행 범위 메타데이터), 평가셋 30문항 재현율 0.8(제안), 위키 출처·확인일 | 050 |
| 그래프 | `arch.review`(서버 재계산 → 항목 선택 → 검색 → 해석(숫자는 `{ref:}` 자리표시자) → 출처 검사(0문장이면 AR033) → 치환 → compliance), `arch.intake`(추출 → strict 검증 1회 재시도 → 정규화 → compliance, 좌표·면적 필드 없음) | 051, 052 |
| 제안서 서술 | 그래프가 아닌 단건 생성 `arch.proposal_narrative`, 수치는 엔진 스냅샷, HTML 조립은 워커, PDF는 공용 WeasyPrint | 032 |
| 렌더 | 워커 → fal(입력은 뷰포트 깊이·윤곽 이미지 + 프리셋만, 원본 모델·도면 전송 금지), 고품질 제공자 경로는 `[DECISION]` | 056 |
| 채팅·음성 | Dify `arch-chat` + `/tools/answer`(출처 필수, 없으면 "근거를 찾지 못했습니다"), 받아쓰기 60초, 상담 녹음은 오픈소스만·원본 24시간 삭제, 읽어 주기는 OS 음성 합성 0크레딧 | 053, 054 |

순서: 공용 인프라(Dify, 오픈소스 LLM·임베딩·음성 서버, 없으면 OpenAI 호환 모의 서버) → ai-service 설치(046) → 게이트(047)·워커(048) → 그래프. `OSS_VOICE_BASE_URL`, `OSS_LLM_BASE_URL`, `OSS_EMBED_BASE_URL`은 없으면 기동 실패입니다(`02_ARCHITECTURE.md` 8장).

## 12. 도면 엔진 개발 (이 제품 고유)

정본: `01_PRD.md` 9장, `02_ARCHITECTURE.md` 2.3·2.4절, `04_API.md` 4.7.3~4.7.6절, `07_SOURCE_MIGRATION.md` 4.5절. 이 장은 개발자가 매일 쓰는 절차만 정리합니다.

### 12.1 패키지 경계

| 패키지 | 책임 | 도면에서의 역할 | 작업 |
|---|---|---|---|
| `packages/domain` | DesignModel·SheetSpec·JudgmentResult·DraftingProfile zod, `schema_version` 이주 | 입력 계약. 다른 곳에서 형식을 다시 정의하지 않음 | 013 |
| `packages/geometry` | 2D 합집합·오프셋·면적·최단거리(mm 정수), 압출, Manifold 래퍼 | 도면과 판정이 같은 면적·거리 함수를 씀 | 014, 016 |
| `packages/rules` | 판정, 엔벨로프 한계, 규칙 팩 | JudgmentResult(근거 점 쌍, 면적 항목) 제공. 도면은 다시 계산하지 않음 | 015, 016 |
| `packages/layout` | 실 겹침·외곽 검사(AR051), 벽 두께, 문·창 위치 | `floor_plan` 입력 검증 | 026 |
| `packages/drafting` | `sheet/{validate,fit,assemble}`, `titleblock`, `layers`, `annotate`, `views/<kind>`, `writers/{dxf,svg,pdf,png}`, `golden/`, `fonts/` | 엔진 본체 | 020~026 |
| `packages/io` | DXF 가져오기(후보만), IFC·glTF·.3dm | 입력 경로 | 029, 039 |
| `apps/desktop/src/workers` | `engine.worker`(judge·suggest·layout), `drafting.worker`(sheet·export·import) | 레인별 최신만 유효, export는 끝까지 | 017 |
| `apps/desktop/src-tauri` `export.rs` | 저장 대화상자 경로에만 쓰기 | 바이트 저장(실패 AR052) | 006 |

엔진 패키지(`domain, geometry, rules, program, massing, layout, drafting`)에서는 `Date`, `Math.random`, `fetch`, `process.env`, `spikes/` import가 린트로 금지됩니다(AR-06-003). 작성일은 호출자가 `SheetSpec` 저장 시각의 날짜로 넘깁니다.

### 12.2 파이프라인

```
DesignModel + JudgmentResult + SheetSpec + DraftingProfile + license{drafting_watermark, fallback_revisions} + engine_version
  → 1 sheet/validate (AR050, 엔진 버전 다르면 AR059)
  → 2 views/<kind> (site_plan, area_plan, sunlight_section, floor_plan; 모델 mm 정수)
  → 3 sheet/fit (축척 [100,200,300,500,600] 큰 축척부터, 안 맞으면 AR058, 고정 축척도 조용히 바꾸지 않음)
  → 4 annotate (분해 치수, anno_id, overrides는 offset·hide·note만)
  → 5 titleblock (고정 고지, 체험판, "이후 개정 n건")
  → 6 sheet/assemble (정렬·key·input_hash) → SheetModel
  → 7 writers/dxf|svg|pdf|png (layer_map은 DXF만) → 바이트 → Exporter → export.rs
```

| 시트 | 데이터 출처 | 골든 접두어 | 작업 |
|---|---|---|---|
| 배치도 `site_plan` | 이격 치수 = rules의 근거 점 쌍, 주차 대수 = rules 값, 구획 배치는 결정적 | `site_plan-*` | 023 |
| 면적 산정도 `area_plan` | 면적표 = JudgmentResult 면적 항목(㎡ 소수 둘째 자리) | `area_plan-*` | 024 |
| 일조사선 단면 `sunlight_section` | 사선·초과 구간 = rules, 교차 = geometry, 기본 단면은 무게중심 | `sunlight_section-*` | 025 |
| 평면 개략도 `floor_plan`(P1) | `floor_layouts`(layout 통과분만), 실 면적 = geometry | `floor_plan-*` | 026 |

### 12.3 골든 테스트 운영

배치: `packages/drafting/golden/<case-id>/{input.json, judgment.json, sheet-<kind>.dxf, sheet-<kind>.svg, sheets.pdf, meta.json}`. `meta.json`에는 엔진 버전과 대상 기능 ID(AR-F-0xx)를 적습니다. 범위는 20건 이상: 샘플 대지 3종 x 시트 종류, 일조사선 신·구 경계 신청일 쌍, 한글 긴 실명, 1/600 큰 대지, AR058 실패 케이스, 체험판·폴백 표제란, 레이어 매핑 케이스.

**골든 케이스 추가 절차**(명령 이름은 제안, AR-06-021이 `scripts/golden/`에서 확정)

| 순서 | 할 일 | 확인 |
|---|---|---|
| 1 | 소유 확인: 뷰 케이스는 그 뷰 작업(023~026)의 `draft/golden/<kind>-*/`, 작성기 케이스는 021의 `writer-*/` | `write_scope` |
| 2 | 폴더 `golden/<kind>-<번호>-<설명>/` 생성, `input.json`(DesignModel + SheetSpec + DraftingProfile + 규칙 팩 버전) 작성. 좌표는 mm 정수 | zod 검증 통과 |
| 3 | `judgment.json`은 손으로 쓰지 않고 `rules.evaluate`로 생성(`pnpm --filter ./packages/drafting golden:judge <case>`, 제안) | 판정 행마다 근거 조항 |
| 4 | 출력 생성 `pnpm --filter ./packages/drafting golden:accept <case>`(제안) | 새 케이스만 쓰기. 기존 케이스 바이트가 바뀌면 거부 |
| 5 | 수동 확인 12.5절(LibreCAD, 필요하면 AutoCAD) 후 스크린샷·뷰어 버전을 task `log.md`에 | 사람 또는 에이전트 |
| 6 | `pnpm --filter ./packages/drafting test:golden` 로컬 통과 → PR | CI `golden.yml` 녹색 |

**골든 갱신 규칙**: 기존 케이스의 기대 바이트를 바꾸는 것은 엔진 버전(`engine_version`)을 올리는 PR에서만 합니다. 같은 PR에 변경 이유와 diff 요약을 적고, 옛 엔진 버전으로 저장된 시트는 화면에서 AR059 재생성 안내가 나오는지 확인합니다. 새 케이스 추가는 기존 바이트를 바꾸지 않으면 버전 올림 없이 허용합니다(제안).

**CI(`golden.yml`) 순서**(AR-06-021)

| 단계 | 내용 |
|---|---|
| 1 | Node 20 + pnpm, `packages/drafting` 빌드, 모든 케이스 출력 생성(임시 폴더) |
| 2 | Python 3.12 + `pip install ezdxf==<고정 버전>` → 모든 DXF에 `ezdxf.readfile` + `doc.audit()`, 오류가 하나라도 있으면 실패(`ezdxf audit <파일>` CLI도 가능, 구현 시 확인) |
| 3 | 바이트 비교: DXF는 헤더 `$TDCREATE`·`$TDUPDATE` 다음 값 줄만 가리고 비교, SVG는 그대로, PDF는 가린 바이트 또는 텍스트·벡터 추출 비교 |
| 4 | 수치 일치 속성 테스트(fast-check): 무작위 유효 DesignModel → `rules.evaluate` → `drafting.build` → `source_ref`가 있는 모든 TEXT = JudgmentResult 값의 표시 형식. 불일치 0 |
| 5 | 고지 존재 검사: 모든 출력에 "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다" 1개 이상 |
| 6 | 실패하면 머지 불가. ezdxf가 설치 파일·릴리스 산출물에 없는지는 릴리스 체크리스트(058)에서 확인 |

### 12.4 결정성 점검표 (PR마다)

- [ ] 모델 좌표 mm 정수, 용지 요소 0.01mm 정수, 반올림 half-away-from-zero는 geometry 한 곳에서만
- [ ] 숫자 출력: 지수 표기 없음, 소수 최대 3자리, 끝 0 제거, `-0` → `0`, 로캘 함수(`toLocaleString`, `Intl`) 0
- [ ] 정렬: 레이어 표 순서 → 뷰 순서 → 엔티티 종류 → `key` 사전순. `Map`·`Set`·객체 키 순회 순서 의존 0
- [ ] 핸들: TABLES → BLOCKS → ENTITIES → OBJECTS 순서로 고정 시작값부터 16진 순차, `$HANDSEED` = 다음 값
- [ ] `\r\n`, `$ACADVER = AC1027`, `$INSUNITS = 4`, 엔티티 8종만(DIMENSION·VIEWPORT 0)
- [ ] 시각은 `$TDCREATE`·`$TDUPDATE`만(SVG·PDF 메타데이터는 고정값 또는 비움), 글자 폭은 빌드 시 고정 폭 표만
- [ ] `input_hash` = 정규화 JSON(키 정렬) sha256, `exports` 기록에 형식·`engine_version`·`input_hash`
- [ ] 같은 입력 두 번 생성 비교 테스트, Windows·Linux CI 러너 출력 비교(제안), 수치 TEXT `source_ref`·덮어쓰기 값 변경 불가 테스트

### 12.5 CAD 뷰어 수동 확인 (스파이크, 새 시트 종류, 엔진 버전 올림 때)

| 점검 | LibreCAD(무료, 최신 안정판) | AutoCAD(사람, 라이선스 PC) |
|---|---|---|
| 열림 | 오류 대화상자 없이 열림 | 열림 + `AUDIT` 명령 오류 0 |
| 단위 | 1,000mm 기준선을 거리 측정해 1000 | `UNITS`가 밀리미터, `DIST`로 1000 |
| 레이어 | 9.6절 16개 중 쓰인 레이어 이름·색(ACI)·선 종류 일치 | `LAYER` 패널에서 같은 확인, 1점 쇄선·파선이 보이는지 |
| 치수 | 대지 경계 → 매스 최단 이격을 측정해 도면 치수 TEXT와 1mm 일치 | 같음 |
| 축척 도곽 | 도곽 크기 = 용지 크기 x 축척 분모(예: A3 1/200 → 84,000 x 59,400mm) | 같음 |
| 한글 | 실명·표제란 한글이 `?`나 네모로 깨지지 않음 | 글꼴 설치 PC와 미설치 PC 둘 다(미설치 시 대체 글꼴로 보이는지) |
| 블록 | 문·창 INSERT가 블록으로 선택됨(P1) | 같음 |
| 고지 | 표제란 고지 문구, 체험판 케이스는 "체험판" | 같음 |

결과는 뷰어 이름·버전, 파일 경로, 스크린샷과 함께 task `log.md`에 남깁니다. AutoCAD 한글 TTF 표시는 미확인이라 첫 확인 결과를 `docs/wiki/decisions/`에 기록합니다.

### 12.6 한글 글꼴 점검

| 순서 | 할 일 | 작업 |
|---|---|---|
| 1 | 재배포 가능 한글 글꼴 1종 선정(SIL OFL 등), 라이선스 파일을 `packages/drafting/fonts/`에 동봉, `THIRD_PARTY_NOTICES` 등록. 빌드 시 글자 폭 표 생성(`scripts/font-metrics/`: 한글 음절, 영숫자, `·`, `㎡`, 괄호) | 022 |
| 2 | DXF STYLE `ARCH-KR`은 TTF 파일 이름만 참조(경로·파일 미포함, 문자열 검사). MTEXT 이스케이프(`\`, `{`, `}`)·제어 문자 제거 테스트 | 021 |
| 3 | SVG·PDF는 동봉 글꼴로 출력, 못 찾으면 대체 글꼴 + AR057(내보내기는 진행) | 022 |
| 4 | 골든 "한글 긴 실명"(예: 다용도실·드레스룸 겸 서재)에서 표·라벨이 칸을 넘지 않음 | 024, 026 |
| 5 | 내보내기 대화상자에 "CAD에 같은 글꼴이 없으면 대체 글꼴로 보입니다" 표시 | 030 |

`㎡` 기호가 CAD 대체 글꼴에서 보이는지는 미확인입니다. 12.5절 확인에서 깨지면 면적 단위 표기 방식을 결정 task로 넘깁니다.

### 12.7 레이어 매핑 테스트 (AR-06-020 `layers`, 021 DXF 작성기, 031 설정)

| 케이스 | 기대 |
|---|---|
| `layer_map` 없음 | DXF·SVG 모두 표준 이름 16개 체계 |
| 표준 → 사무소 이름 | DXF LAYER 표와 엔티티 레이어가 사무소 이름, SVG `<g id>`는 표준 이름 그대로 |
| 금지 문자(`<>/\":;?*\|=,`) 포함 이름 | 표준 이름 유지 + 경고 |
| 두 표준 레이어를 한 이름으로 | 허용, 색·선 종류는 표 순서상 앞 레이어 |
| `A-TTLB` 이름 변경 | 이름만 바뀌고 고지 엔티티는 그대로 존재(고지 제거 경로 0) |
| 표준 밖 키 | 서버 저장 거부(031), 엔진은 무시 + 경고 |
| member가 저장 | 서버 `AR042`(스모크) |
| 오프라인 | `drafting_profile_cache`로 같은 매핑 적용 |

골든에 매핑 케이스를 1건 이상 넣어 바이트 비교로 고정합니다.

### 12.8 성능 예산 (`01_PRD.md` 9.5절, 권장 사양 실기)

| 작업 | 예산 | 측정 |
|---|---|---|
| 시트 1장 생성(매스 50, 실 200) | p95 1초(뷰 500ms, 축척 50ms, 주석 250ms, 조립 100ms) | 020 벤치 |
| DXF 쓰기 | 시트 1장 p95 2초, 20MB 이하(초과 시 쓰기 전 경고) | 021 |
| PDF 묶음 | 10장 p95 10초(시트별 SVG 재사용) | 022 |
| 평면 편집 반영 | p95 100ms(layout 검사·면적만) | 026 |
| 매스 자동 제안 | p95 3초(대지 꼭짓점 200개 이하) | 028 |
| 판정 갱신 / 엔벨로프 | p95 200ms / 2초 | 015 / 016 |

CI는 회귀만 기록하고 절대값은 실기에서 잽니다. 결과는 `docs/wiki/decisions/`에 기기 사양과 함께 남기고, 예산 초과가 2회 연속이면 성능 task를 만듭니다(제안).

### 12.9 "LLM은 좌표를 만들지 않는다" 규칙의 강제 지점

| 지점 | 장치 |
|---|---|
| `arch.intake` 출력 | pydantic strict, 좌표·면적 필드 없음, 추가 필드 거부. 데스크톱에서 zod로 재검증, 사용자가 항목별 채택해야 반영 |
| `arch.review` 문장 | 숫자는 `{ref:<판정 경로>}` 자리표시자만, `resolve_refs`가 엔진 값으로 치환, 엔진 값 집합 밖 숫자는 재작성 후 제거 |
| 제안서 서술 | 같은 자리표시자 규칙, 수치 섹션은 템플릿 + 엔진 스냅샷 |
| 클라우드 검토 입력 | 데스크톱 JudgmentResult를 믿지 않고 서버가 같은 `packages/rules`로 재계산 |
| 도면 | drafting은 LLM 결과를 입력으로 받지 않음. 수치 TEXT는 `source_ref` 필수 |
| Phase 2 `arch.layout` | 의도 JSON(실 인접·조닝)만, 배치는 결정적 솔버 |
| 테스트 | 049 AI 보안 테스트, 052 "좌표·면적 필드 0(strict)", 위험 #10 리뷰 |

## 13. 데스크톱 셸·라이선스·업데이터 (이 제품 고유)

정본: `D:/WorkSpace/platform/docs/Tauri/README.md`(3~11장, 13.4절 금지 패턴), `02_ARCHITECTURE.md` 2.2·7·9장, `04_API.md` 2.1·2.3·2.4절. Tauri 가이드 작업 템플릿 T-001~T-012는 06장 5.2절 표대로 `AR-06-###`에 흡수되어 있습니다(별도 `AR-T-###` 없음).

| 영역 | 내용 | 작업 |
|---|---|---|
| 셸 골격·bridge | Vite + React 19 + React Router, `feat/<기능>` 지연 로드, `VITE_` 허용 목록 4개, capability 최소, CSP(`script-src 'self' 'wasm-unsafe-eval'`, 원격 URL 금지). NativeBridge(Tauri + 웹 대체), SecureStore(키체인), 화면은 `@tauri-apps/api` 직접 import 금지 | 004, 005(T-001~003) |
| 로컬 DB·파일·API | `local_db_*` 이름 붙은 쿼리만, 업데이트 전 스냅샷, 파일은 OS 대화상자 경로만(DXF 20MB, IFC·.3dm 100MB, AR055). API 클라이언트는 Bearer·재시도 대기열, 금액·`org_id` 필드 금지(타입) | 006, 007(T-005·006) |
| 라이선스 서버 | `POST /api/license/{activate,deactivate,refresh}`, Ed25519 파일(`features`, `offline_valid_until`), 3대째 AR001, 다른 조직 AR006, IP당 10회/시간 | 040 |
| Rust 라이선스 | `kid`별 공개키 검증, `device_hash` 재계산, `app_id`, 시계 되돌림(최대 `issued_at`보다 이르면 만료), 규칙 팩 매니페스트 서명·`published_at <= updates_until` | 041(T-007) |
| 업데이터 | `GET /api/updates/{target}/{arch}/{current}`(Bearer) → `arch.eligible_build`, 서명 URL, 자격 없으면 204. 서명 불일치 거부, 마지막 자격 버전 유지 | 042(T-008) |
| 결제 화면 | 시스템 브라우저 결제 → Toss 웹훅 → Realtime 반영(딥링크 없이 1분), 결제 딥링크는 확정 근거 아님 | 043, 044(T-009) |
| CI·배포 | 태그 푸시 → NSIS + MSI → 코드 서명 → 업데이트 서명 → `arch-releases/builds/<channel>/<version>/` → `arch.builds` 등록. 산출물 비밀 문자열 검사, 릴리스 `VITE_AUTH_MODE=live` 강제 | 058(T-010) |
| 점검·E2E | Tauri 가이드 9장 + 위험 #1~#14 확인 근거(059). 설치 → Mock 로그인 → 대지 → 판정 → DXF·PDF → 오프라인 → 복귀, 3대째 거부, 폴백(060, WebDriver 도구 `[DECISION]`) | 059, 060(T-011·012) |

**로컬 실행 순서**(W1 이후)

| 순서 | 명령 | 확인 |
|---|---|---|
| 1 | `supabase start` → `supabase db reset` | 7장 |
| 2 | `pnpm install`(루트) | lockfile 고정 |
| 3 | `pnpm --filter ./apps/web dev` | Route Handler(라이선스·AI) 로컬 `http://localhost:3000`(제안) |
| 4 | `apps/desktop/.env.development.local`에 `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL=http://localhost:3000`, `VITE_AUTH_MODE=mock` | 커밋 금지 |
| 5 | `pnpm --filter ./apps/desktop tauri dev` | 창이 뜨고 CSP 위반 0(개발자 도구 콘솔) |
| 6 | 릴리스 빌드 확인 `VITE_AUTH_MODE=live pnpm --filter ./apps/desktop tauri build` | NSIS·MSI 생성, 200MB 이하, Mock 패널 문자열 0 |

**확인할 규칙**: 로컬 권한은 서명 라이선스 파일만(SQLite·`localStorage`·`local_settings`로 판정 금지), 클라우드 권한은 호출마다 서버 `arch.org_features`. 체험·월 구독 `offline_valid_until`은 발급 + 7일(제안), 영구는 null(D-7). 서명 키 3종(라이선스 Ed25519, Tauri 업데이트, Windows 코드 서명)은 서로 다른 키이고 다른 제품 키를 재사용하지 않습니다. 번들 구성요소는 `apps/desktop/THIRD_PARTY_NOTICES`에 이름·버전·라이선스를 적고, CI 라이선스 점검에서 GPL·AGPL·LGPL·비상업이면 실패합니다(`07_SOURCE_MIGRATION.md` 5장).

## 14. 메인 디자인과 디자인 시스템

정본: `docs/file/03-설계/디자인/DESIGN_SYSTEM.md`, 제품 선택은 `03_SCREENS_UX.md` 3.19절(앱)·4장(랜딩).

### 14.1 디자인 시스템 4단계

| 단계 | 작업 | 담당 |
|---|---|---|
| 1. 레퍼런스 확정 | 모델러·평면·도면 화면 Atlassian + Primer, 목록·라이선스·크레딧 Primer, 채팅·음성·위키 Astryx 패턴만(설치 안 함), 랜딩 4.1절 | AR-06-009, 고문 검토 |
| 2. 가진 것 위에서 | `packages/ui/tokens.css`(Tailwind CSS v4 `@theme`, 라이트·다크, 컴팩트·기본, 3D·도면 미리보기 색 토큰) + 기본 컴포넌트 + CAD형 컴포넌트 + `/dev/components` | AR-06-010 |
| 3. 비주얼은 사람이 | 라이트/다크 x 컴팩트/기본 스크린샷으로 수치 판정. `JudgmentBadge`가 색 + 아이콘 + 글자인지, 엔벨로프 청록이 한 화면에 한 곳인지 | AR-06-011(사람) |
| 4. 정답 한 곳 | 코드를 정답으로 `DESIGN.md`, `COMPONENTS.md` 갱신 | AR-06-012 |

- 토큰 위치가 다른 제품과 다릅니다: 웹·데스크톱이 공유하는 `packages/ui/tokens.css`입니다(Tauri 모노레포). 묶음의 `DESIGN.md` 템플릿 머리말은 기본 경로(`apps/web/src/styles/tokens.css`)로 생성되어 있어 AR-06-010에서 고칩니다. 두 문서는 빈 템플릿이라(이 제품은 `08_DESIGN_SYSTEM.md` 없음) 초기값을 `03_SCREENS_UX.md` 3.19절(컴포넌트)·4.3절(토큰 플랜)에서 가져옵니다.
- CAD형 컴포넌트(`LayerPanel`, `PropertyInspector`, `JudgmentBadge`, `RuleCitation`, `SheetPreview`, `ExportDialog`, `LayerMapTable` 등 3.19절 목록)는 기본 컴포넌트 뒤에 하나씩 맡깁니다. DXF 출력 색은 토큰이 아니라 ACI 번호로 고정, 이모지 아이콘 금지(Lucide).

### 14.2 메인 히어로 (정본: `HERO_3D.md`, `03_SCREENS_UX.md` 4.5절)

소재: 모눈 바닥 위에 예시 대지 1의 폴리곤 → 엔벨로프가 솟으며 정북 쪽이 일조사선으로 깎임(청록 반투명) → 매스가 층 단위로 쌓임(콘크리트) → 바닥에 배치도 선(대지 경계 1점 쇄선, 이격선 파선, 치수선, 방위표). 카메라가 위로 올라가 배치도 시점에서 멈춥니다. 의미는 "대지 정보 → 법규 볼륨 → 설계안 → 도면이 한 흐름"입니다.

| 기기 | 구성 |
|---|---|
| PC·태블릿 | 실시간 3D, 연출 1회(약 6초, 제안) 후 정지, 포인터로 시점 살짝 회전 |
| 모바일 | 엔벨로프 솟음 1회 + 매스 1개, 배치도 선은 2D SVG 겹침 |
| 정지 이미지 | WebGL 실패, 저사양, reduced-motion, 데이터 절약, `NEXT_PUBLIC_HERO3D_ENABLED=false` |
| 3D 영상 단계 | 채택하지 않음(코드 도형만이라 모바일 예산 안, 넘으면 재검토) |

형상은 엔진 실제 출력(예시 대지 1의 geometry·drafting 결과)을 빌드 시 정적 JSON으로 고정해 `/samples` DXF와 같은 형상을 씁니다(AR-06-057, 023 선행). 재질 색은 토큰만, 3D 안에 글자·숫자 없음. 공용 `HERO_3D.md` 5장에 이 소재 행이 아직 없습니다(R-A12).

### 14.3 시각 레퍼런스 (정본: `03_SCREENS_UX.md` 4.1절, `REFERENCES.md`)

| 구분 | 제목 | URL | 가져올 것 | 적용 화면 |
|---|---|---|---|---|
| 랜딩 | Kononenko Architectural Bureau | https://www.awwwards.com/sites/kononenko-architectural-bureau | 섹션을 도곽 안 격자처럼 같은 기준선에 정렬 | 랜딩 섹션 격자 |
| 랜딩 | Humbert & Poyet | https://www.awwwards.com/sites/humbert-poyet | 예시 대지별 시트 묶음을 여백 있게 하나씩 | `/samples` |
| 랜딩 | Runway Financial | https://www.awwwards.com/sites/runway-financial | 실제 제품 화면 한 장(판정 패널)을 크게 | "판정과 근거" 섹션 |
| 랜딩 | OH Architecture | https://www.awwwards.com/sites/oh-architecture | 업종 톤 대조(구체 포인트 미확인) | 랜딩 전체 |
| 앱 | Table data view for admin dashboard | https://dribbble.com/shots/22988094-Table-data-view-for-admin-dashboard | 행 선택 상태, 페이지네이션 | 크레딧 내역, 기기 목록, 내보내기 기록 |

- `REFERENCES.md`에 arch-studio 절이 없어(R-A14) 기존 절의 URL을 다른 참고 포인트로 씁니다. CAD·설계 도구 계열 레퍼런스는 URL을 확인해 그 절에 먼저 추가한 뒤 씁니다.
- 피할 인상: 청사진(파란 바탕 흰 선), 분양 광고형 렌더 사진, 보라 그라디언트 AI 툴, 큰 숫자 히어로, "허가 통과" 류 문구. 영감용이지 복제용이 아니며, 링크는 작업 전에 브라우저에서 한 번 엽니다.

## 15. 원본 이식과 공용 모듈 경계

### 15.1 원본 이식 (정본: `docs/file/04-구현/07_SOURCE_MIGRATION.md`)

- 전용 원본 저장소가 없습니다. 이식 원천 5개(nomad-docs, flora-publishing, `_platform-core` AI 계층, `_design-guide` 3D 히어로, FortuneDocs 원칙)는 모두 문서이고 **읽기 전용**이며 아카이브·코드 복사가 없습니다. 이식 기준 커밋 `2f326c4`(10장).
- 그대로 옮기는 것은 규칙 문장과 값뿐입니다(정액 크레딧 값, 선차감·정산·환불 규칙, 3D 히어로 수용 기준). 나머지는 패턴만 보고 새로 씁니다(효과 엔진 → `packages/program`, "숫자는 엔진이 계산" → rules·drafting, 녹음 → 후보). 폐기(ARX-*): 외주 문서 카탈로그, CRM·ERP 연동, 판형·ePub, 사주 도메인.
- 리뷰 "높음" 차단 설계는 `02_ARCHITECTURE.md` 6장(위험 #1~#14)과 `05_DATA_MODEL.md` 7장(보안·데이터)이고, 해당 task 리뷰에서 차단 여부를 확인합니다.

### 15.2 공용 모듈 경계

| 항목 | 규칙 |
|---|---|
| 코어 재정의 금지 | auth, org, credits, toss, webhooks, storage, audit, jobs, compliance, fal client, weasyprint render, ai-gateway, ai-service, dify, core-voice, llm-wiki는 import·호출만 |
| 쓰지 않음 | oauth(외부 계정 연동 없음), sns-uploader, affiliate, automation-core. V2 보류: media, search |
| V2 채택 | compliance(`@nomad/compliance`, `createModule({ appId: 'arch' })`, `profileKind: kr_ecommerce`) = AR-V2-01(W1 맨 앞), 점검 AR-V2-02(W6). 설치형 앱 안 오프라인 고지 문구는 제품에 남음 |
| 키 위치 | LLM 키는 `apps/api`에만. fal·WeasyPrint 토큰은 워커만. 라이선스·AI 서명 개인키·VWorld 키는 web 서버만. 업데이트 서명키·코드 서명 인증서는 CI 비밀만. 데스크톱 번들에는 공개값 4개뿐 |
| 데스크톱 | 코어 서버 패키지를 넣지 않음(`createAdminClient` 금지). Dify·FastAPI·fal·음성 서버 직접 호출 금지(`/api/ai/*`, `/api/voice/*`만) |
| 공용 요청 | R-A1~R-A14(8장 표). 모두 platform 쪽 변경이고 개발 폴더에서 고치지 않습니다 |

## 16. 검증과 완료 정의 (정본: `06_AGENT_PLAN.md` 7장)

| 조건 | 확인 |
|---|---|
| 빌드·타입·린트·단위 | `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`(웹 `pnpm --filter ./apps/web build`, 데스크톱 `pnpm --filter ./apps/desktop tauri build` 포함) |
| Rust | `apps/desktop/src-tauri`에서 `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo audit` 오류 0(변조 라이선스 파일 거부, 임의 경로·SQL 거부 포함) |
| Python | `pytest apps/api -k arch && ruff check apps/api`(그래프 평가셋, 출처 0건 차단, 토큰·조직 격리, 라우팅) |
| SQL | `supabase db reset` 오류 0, `check.mjs --vector mono 0001 0002 seed` OK, 모듈러는 platform에서 `node check.mjs --vector mod <0000~0009> seed.sql 2400_arch.sql` OK, 모놀리스 변환 `--check` diff 0 |
| RLS 스모크 | `node scripts/test-rls/run.mjs --target mod` / `--target mono` 125항목 |
| 도면 | `pnpm --filter ./packages/drafting test:golden` + `golden.yml` ezdxf audit 오류 0(골든 20건 이상), 수치 일치 불일치 0, 성능 예산 기록 |
| 판정 | `pnpm --filter ./packages/rules test`: 신·구 일조사선 신청일 쌍 골든, 근거 없는 판정 행 0, 평가셋 정량 98%(제안) 기록 |
| 결제 E2E | `npx playwright test e2e/billing`(Toss 테스트 키, AR-06-045) |
| 흐름 | `npx playwright test e2e/flows`(상태 페르소나 매트릭스, 실패 주입 환불, AR-06-061), 데스크톱 E2E 시나리오 5개 이상(AR-06-060) |
| 보안·배포 | AR-06-059 위반 0, AR-06-058 비밀·인증 금지 문자열 0건, 서명된 설치 파일·업데이트 매니페스트 생성 |
| 디자인 | 4단계 완료(011 사람 판정 기록), `DESIGN_PRINCIPLES.md` 체크리스트, `HERO_3D.md` 4절, `tailwind.config.js`·hex 하드코딩 0 |
| 법·문구 | PRD 6.1·9.7절 금지 문구 0건(랜딩·화면·제안서·표제란), 표제란 고지 제거 경로 0 |
| 인증 | Stage A 수용 기준(AR-06-008), G1 → Stage B `AUTH_ROADMAP.md` 5.3절 B-1~B-6(19장) |

P0 작업은 대응 테스트(`06_AGENT_PLAN.md` 7.1절)가 녹색이어야 완료입니다.

## 17. 위험과 주의

| 위험 | 대응 |
|---|---|
| DXF가 CAD에서 안 열림·한글 깨짐 | 019 스파이크를 W0에, 실패 시 020~022 중단·보고. 골든 CI ezdxf audit, 엔진 버전 올림 때 12.5절 수동 확인 |
| 도면 수치 ≠ 판정 수치 | drafting은 계산하지 않고 JudgmentResult·geometry만, `source_ref` 필수, 속성 테스트 불일치 0(위험 #9) |
| 인허가 도서 오인·건축사법 | 표제란 고지 상수(지우는 경로 0), 날인·서명란 없음, 금지 문구 FAIL. 건축사법상 관계는 미확인이라 보수적으로 둠 |
| 라이선스 위조·오프라인 우회·번들 비밀·Mock 혼입 | Rust Ed25519 + `device_hash` 검증, SQLite로 판정 금지, 시계 되돌림 검사, `VITE_` 허용 목록, 릴리스 CI 문자열 검사·`VITE_AUTH_MODE=live` 강제(위험 #6·#7·#8·#14), 059 점검 |
| 코어 요청 지연 | R-A1(일회성 결제)·R-A6/7(Bearer·CORS) 없이 결제·셸 API 경로를 머지할 수 없음. 8장 표 시점 전에 platform에 요청 |
| 코드 서명 인증서·라이선스 미확인 의존성 | 인증서가 없으면 SmartScreen 경고(출시 3개월 전 착수, 제안). 2D 다각형(AR-02-D1), rhino3dm(AR-02-D2), jsPDF·svg2pdf.js(D-23), 한글 글꼴은 `[DECISION]` 기록 전 머지 금지, GPL 번들 금지 |
| 공공 API 조건(D-14) | 확인 전 "직접 그리기"가 기본, 공공 API 값은 입력 후보이지 판정 기준이 아님(위험 #1) |
| 법령 개정·낡은 규칙 팩 | 판정·표제란·제안서에 팩 버전·기준일, 폴백 "이후 개정 n건", 30일 미확인 배너(위험 #11) |
| 3D 성능(저사양 PC) | 036 실기 측정(매스 50·삼각형 20만 60fps 권장 사양). 최소 사양 30fps 확인 작업이 06장에 따로 없어 036 수용 기준 측정 때 함께 기록(제안) |
| 작업 수 | 71개. 1.1절 린 검증과 9.1절 도면 우선 v0를 먼저 고려 |
| 비밀키 | `.env*` 커밋 금지, 키 값을 로그·위키에 쓰지 않음. 도면 좌표·표제란 정보·딥링크 `code`도 로그 금지 |

## 18. 체크리스트

- [ ] 2장 도구 설치 확인(Rust MSVC, Tauri CLI 2.x, WebView2, Python 3.12 포함), 코드 서명 인증서 발급 일정 확인
- [ ] setup 스크립트 dry-run → 실행, 데스크톱 도구 경고 0, 무결성 점검 PASS
- [ ] `_shared/project-profile.md` 작성(6장), `claude` 실행 후 `/agent-check`
- [ ] 공용 인프라: Dify, 오픈소스 LLM·임베딩·음성 서버(또는 모의 서버)
- [ ] `supabase db reset` 성공, 라우팅 14행·강제 3행·플랜·팩·상품·운영 상수 16·버킷 2 확인(7.1절)
- [ ] PGlite 체커 OK, RLS 스모크 125항목(7.2~7.3절)
- [ ] 굵은 결정(D-3, D-14, D-15, D-16, D-20, D-23) 확정 계획, 코어 요청 R-A1~R-A14 platform 접수(8장)
- [ ] W0 task 생성, **AR-06-019 스파이크 통과**(3건 열림, 치수 일치, AutoCAD 사람 확인) → `[DECISION] D-20`, `D-23`
- [ ] 1.1절 샘플 공개·사전예약 신청 측정 시작, 인터뷰 5건 일정
- [ ] 디자인 시스템 1~4단계(14.1), 화면 작업은 012 뒤
- [ ] 골든 CI 녹색(20건 이상), 수치 일치 0, 성능 예산 기록(12장)
- [ ] 라이선스·업데이터 변조 거부 테스트, 서명된 NSIS·MSI(13장)
- [ ] Stage A: 웹·데스크톱 개발 빌드에서 시드 페르소나 로그인(19.2절)
- [ ] W1~W6 → G1 판정, `[DECISION] G1 통과`(19.3절)
- [ ] W7 Stage B → 공개 베타, 사전예약 판매(R-A1 반영 확인)
- [ ] 베타 2주 원가 측정 → D-4 가격 확정, G2 판정 → W8(선택)

## 19. 인증 단계: Mock → Google + 이메일 → 카카오·네이버

정본: `docs/file/03-설계/공용코어/AUTH_ROADMAP.md`(확정 결정 22, 8장 매트릭스 arch 행). 제품 반영: `01_PRD.md` AR-F-027·8.2절(D-15~D-19), `02_ARCHITECTURE.md` 9장, `03_SCREENS_UX.md` 3.1절, `04_API.md` 2.1절, `06_AGENT_PLAN.md` 008·062·063·064, `07_SOURCE_MIGRATION.md` 4.2절, `CLAUDE.md` "인증 단계 규칙". 외부 콘솔 화면별 절차는 공용 지시서 `D:/WorkSpace/platform/docs/develop/_shared/auth/README.md`, 데스크톱 흐름은 Tauri 가이드 5장을 따릅니다.

### 19.1 단계 요약

| 단계 | 언제 | 웹 | 데스크톱 | 작업 | 끝나는 조건 |
|---|---|---|---|---|---|
| A Mock | W1~W6 | 로컬 시드 페르소나 원클릭(`POST /api/dev/login`, 원격·배포 404) | **개발 빌드에서만** 로컬 시드 계정 `signInWithPassword`. Mock 패널은 `import.meta.env.DEV`와 `VITE_AUTH_MODE=mock`이 모두 참일 때만 번들에 포함, 비밀번호는 번들에 넣지 않고 개발자가 입력해 키체인에 | AR-06-008(P0, Opus) | G1 |
| B Google + 이메일 | G1 후(W7) | Google + 이메일(가입·인증 메일·재설정, D-19), `GET /auth/callback`, 첫 로그인 뒤 약관 동의 | Google: 시스템 브라우저 + PKCE + 딥링크 `archstudio://auth/callback`(막히면 루프백, D-15), 이메일: 앱 안 폼. 교환 직후 `POST /api/auth/finish` | AR-06-062(P0, Fable) | G2 |
| C1 카카오 | G2 후(W8) | 카카오(D-17 이메일 정책) | B와 같은 시스템 브라우저 흐름 | AR-06-063(P2, Opus) | `AUTH_ROADMAP.md` 7.1.3절 |
| C2 네이버 | G2 후(W8) | 네이버(`custom:naver` 또는 브리지, D-18) | `custom:naver`면 B와 같음, 브리지면 R-A10 반영 전 데스크톱 미제공 | AR-06-064(P2, Fable) | `AUTH_ROADMAP.md` 7.2.4절 |

사전예약 판매(실결제)는 Stage B가 켜진 뒤에만 엽니다. 카카오·네이버는 P2 선택이며 베타 가입 전환 데이터로 P1 승격을 판단합니다.

### 19.2 Stage A 로컬 실행 순서

| 순서 | 명령·행동 | 설명 |
|---|---|---|
| 1 | `supabase start` → `supabase db reset` | 7.1절 |
| 2 | `apps/web/.env.local`에 `AUTH_MODE=mock`, `DEV_SEED_PASSWORD=<긴 임의 값>` | 커밋 금지, `NEXT_PUBLIC_*` 금지 |
| 3 | `node scripts/dev/seed-users.mjs --app arch` | 상태 페르소나: `owner`(체험 중), 체험 만료, 영구 + 업데이트 유효, 영구 + 업데이트 만료(폴백), 월 구독, 기기 2대 활성화 완료, `outsider`(`AUTH_ROADMAP.md` 8장 arch 행). 원격 URL이면 즉시 종료 |
| 4 | 웹: `pnpm --filter ./apps/web dev` 후 `/login` 개발용 패널 | 페르소나 버튼 |
| 5 | 데스크톱: `VITE_AUTH_MODE=mock`으로 `pnpm --filter ./apps/desktop tauri dev`, 로그인 화면 개발용 패널에서 시드 이메일 선택 + 비밀번호 입력 | 세션은 키체인에만(`localStorage` 0건) |
| 6 | E2E | Playwright `globalSetup`이 페르소나별 `storageState` 저장(AR-06-061), 데스크톱 E2E는 개발 빌드 Mock 패널(AR-06-060) |

확인 예: `owner`는 `session_context('arch')` `entitled=true`, 플랜 `trial`, 잔액 30이고 재로그인 3회 뒤에도 가입 크레딧 원장 1행. 체험 만료 페르소나는 새 프로젝트 불가·열람과 마지막 시트 다시 내보내기만. 폴백 페르소나는 판정 패널에 "이후 개정 n건" 배너, 클라우드 검토 `AR012`. `outsider`가 다른 조직 시리얼을 활성화하면 `AR006`. 기기 2대 페르소나가 3대째 활성화하면 `AR001`.

### 19.3 G1 체크리스트 (사람이 판정)

- [ ] MVP P0 기능 작업 완료(인증 B·C 제외)
- [ ] 통합·E2E(AR-06-060, 061) Mock 페르소나로 녹색
- [ ] RLS 스모크 125항목, `outsider` 거부, 결제 E2E(AR-06-045) 녹색
- [ ] CI(AR-06-058): 인증 모듈 밖 `AUTH_MODE`·`VITE_AUTH_MODE` 참조 0, `mock-auth`·`nomad_role`·`nomad_plan` 0, 릴리스 산출물 시드 이메일 0
- [ ] 외부 준비: 로그인용 Google Cloud 프로젝트·OAuth 동의 화면, `/legal/*` URL, Supabase Redirect URLs에 `archstudio://auth/callback`(또는 루프백) 등록 가능 확인(R-A8, D-15)
- [ ] `[DECISION] G1 통과` 기록

### 19.4 Stage B·C 외부 설정

`develop/nomad-docs/nomad-docs_develop.md` 19.4절(Google), 19.6절(카카오), 19.7절(네이버 스파이크)과 같은 순서입니다. 다른 점:

- 배포 env `AUTH_PROVIDERS=google,email`(C 단계에서 `,kakao`, `,naver`). 데스크톱 릴리스는 `VITE_AUTH_MODE=live`.
- Supabase Redirect URLs: `https://<도메인>/auth/callback`, `archstudio://auth/callback`(제안 스킴), 루프백(채택 시). 와일드카드 금지.
- 데스크톱 B 수용: 시작하지 않은 딥링크 콜백 무시(PKCE verifier 보유 시도 10분·1회만), `code`·토큰 로그 0, Rust `deeplink.rs`는 `auth/callback` 경로만 허용(위험 #12). 059 보안 점검을 062 완료 후 다시 합니다.
- Google·카카오·네이버 실로그인은 자동화하지 않고 사람이 수동 점검표로 확인합니다(B-5), 그 뒤 060·061 재실행.
- 통합 DB 제품끼리 제공자 앱을 1세트 공유하면(공용 지시서 AUTH-D1) Redirect URLs에 이 제품 도메인과 앱 스킴만 더합니다.

### 19.5 이 제품의 인증 작업 ID

A = AR-06-008(P0, M, Opus, W1), B = AR-06-062(P0, M, Fable, W7), C1 = AR-06-063(P2, S, Opus, W8), C2 = AR-06-064(P2, M, Fable, W8). B 단계 전환 지시문은 `develop/nomad-docs/nomad-docs_develop.md` 19.8절 예시에 D-15 스파이크(딥링크 → 루프백 대체)와 `deeplink.rs` 소유 경로를 더해 씁니다.

## 부록 A. 스크립트 없이 손으로 할 때

| 동작 | Git Bash / Linux | Windows PowerShell |
|---|---|---|
| 0 데스크톱 도구 | `rustc --version; cargo --version; cargo tauri --version` | 같음 |
| 1 복사 | `cp -r "D:/WorkSpace/DEV/MultiAgent-Service-Fullstack-Tree-Framwork" "D:/WorkSpace/DEV/arch-studio"` | `Copy-Item "D:\WorkSpace\DEV\MultiAgent-Service-Fullstack-Tree-Framwork" "D:\WorkSpace\DEV\arch-studio" -Recurse` |
| 2 이동 | `cd "D:/WorkSpace/DEV/arch-studio"` | `Set-Location "D:\WorkSpace\DEV\arch-studio"` |
| 3 초기화 | `bash init-project.sh arch-studio --reset-git` | `& "$env:ProgramFiles\Git\bin\bash.exe" init-project.sh arch-studio --reset-git` |
| 4 붙여넣기 | `cp -r "D:/WorkSpace/platform/docs/develop/arch-studio/arch-studio-root/." "D:/WorkSpace/DEV/arch-studio/"` | `Copy-Item "D:\WorkSpace\platform\docs\develop\arch-studio\arch-studio-root\*" "D:\WorkSpace\DEV\arch-studio" -Recurse -Force`(숨김 폴더 `.claude`도 같은 방법으로) |
| 5 docs/etc 삭제 | `rm -rf docs/etc` | `Remove-Item docs\etc -Recurse -Force` |
| 6 모델 지정 | `.claude/agents/plan-challenger.md`의 `model: opus` → `model: claude-fable-5-1`, `nextjs-expert.md`·`fastapi-expert.md`·`supabase-expert.md` frontmatter에 `model: sonnet` 추가 | 같음(편집기) |
| 7 점검 | `bash _shared/check-invariants.sh` | `& "$env:ProgramFiles\Git\bin\bash.exe" _shared/check-invariants.sh` |

Rust·Tauri 전용 서브 에이전트를 쓰고 싶으면(제안) `.claude/agents/nextjs-expert.md`를 본보기로 `tauri-expert.md`를 사람이 만들고(`model: sonnet`, 소유 경로 `apps/desktop/src-tauri/**`), 무결성 점검을 다시 돌린 뒤 task의 `workers_approved`에 넣습니다. 에이전트가 스스로 에이전트 설정을 바꾸지 않습니다.

묶음을 다시 만들 때(기획서가 바뀐 경우): `cd D:/ && PYTHONUTF8=1 python -I D:/WorkSpace/platform/docs/develop/_shared/tools/build_root.py arch-studio` → 마지막 줄 "묶음 안 누락 0, 절대경로 누락 0" 확인. 경로 검사만은 `build_root.py --check arch-studio`. 다시 만든 뒤 이미 만든 개발 폴더에는 `docs/file/`만 사람이 비교해 옮깁니다(개발 폴더의 승인 상태·변경 이력을 덮어쓰지 않게).
