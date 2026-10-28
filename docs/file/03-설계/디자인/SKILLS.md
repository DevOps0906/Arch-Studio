# SKILLS — 개발 에이전트용 스킬 목록과 작업별 매핑

작성일 2026-10-12. 출처는 https://github.com/anthropics/skills (README, `.claude-plugin/marketplace.json`, 각 `skills/<이름>/SKILL.md` frontmatter)와 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (README, `scripts/search.py`)이다. 설치 명령은 두 저장소 README에 적힌 것만 옮겼다.

## 설치 (Claude Code)

### anthropics/skills

| 단계 | 명령 | 설명 |
|---|---|---|
| 1 | `/plugin marketplace add anthropics/skills` | 저장소를 플러그인 마켓플레이스로 등록한다. 마켓플레이스 이름은 `anthropic-agent-skills`다. |
| 2-a | `/plugin install document-skills@anthropic-agent-skills` | 문서 스킬 묶음(xlsx, docx, pptx, pdf) |
| 2-b | `/plugin install example-skills@anthropic-agent-skills` | 예시 스킬 묶음(frontend-design, webapp-testing, mcp-builder, skill-creator, web-artifacts-builder 등 12개) |
| 대안 | `/plugin` 실행 후 Browse and install plugins → anthropic-agent-skills → document-skills 또는 example-skills → Install now | README의 대화형 설치 절차 |
| 사용 | 스킬 이름을 언급해 호출 | README 예: "Use the PDF skill to extract the form fields from path/to/some-file.pdf" |

marketplace.json에는 `claude-api`, `academy-guide`, `discernment-nudge` 플러그인도 따로 있다. 이 문서의 개발 작업에는 필요하지 않다.

### ui-ux-pro-max-skill (UUPM)

| 방식 | 명령 | 비고 |
|---|---|---|
| 플러그인 마켓플레이스 | `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` 후 `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill` | README의 Claude Code 설치 방식 |
| CLI (README 권장) | `npm install -g ui-ux-pro-max-cli` 후 프로젝트 루트에서 `uipro init --ai claude` | `.claude/skills/ui-ux-pro-max/`에 설치된다. 이 경로 기준으로 `search.py`를 실행한다. |
| CLI 전역 설치 | `uipro init --ai claude --global` | `~/.claude/skills/`에 설치 |
| 설치 없이 실행 | `npx ui-ux-pro-max-cli init --ai claude` | - |
| 미리보기 | `uipro init --dry-run` | 파일을 쓰지 않는다 |
| 갱신/제거 | `uipro update`, `uipro uninstall` | 구버전 `uipro-cli` 패키지는 쓰지 않는다(README) |
| 전제 조건 | Python 3.x (표준 라이브러리만 사용, 네트워크 호출 없음) | 없으면 에이전트가 설치하지 말고 사용자에게 요청한다(README 규칙) |

이 저장소 권장: 제품 앱마다 CLI 방식(`uipro init --ai claude`)으로 설치해 스크립트 경로를 `.claude/skills/ui-ux-pro-max/scripts/search.py`로 고정한다. `DESIGN_PRINCIPLES.md` 3단계 명령이 이 경로를 전제로 한다.

## 스킬 목록

### anthropics/skills — 이 프로젝트에서 쓰는 스킬

| 스킬 | 묶음 | 하는 일 (SKILL.md 설명 요약) | 개발 에이전트가 쓰는 때 |
|---|---|---|---|
| frontend-design | example-skills | 템플릿처럼 보이지 않는 의도적인 시각 디자인 지침. 미적 방향, 타이포그래피, 기본값 회피 | 새 UI 구축, 기존 UI 재구성, 메인페이지/랜딩 구현 전 계획 단계. 모든 UI 작업의 기준 스킬 |
| webapp-testing | example-skills | Playwright로 로컬 웹앱과 상호작용하고 테스트. 프론트 기능 검증, UI 디버깅, 스크린샷, 브라우저 로그 확인 | E2E 시나리오 검증, 출시 전 체크리스트의 뷰포트 4종 스크린샷, 포커스와 reduced-motion 확인 |
| mcp-builder | example-skills | 외부 API/서비스를 LLM 도구로 연결하는 MCP 서버 작성 가이드(Python FastMCP 또는 Node/TypeScript MCP SDK) | 제품 기능을 MCP 서버로 노출할 때(예: sceneflow 파이프라인 제어, stock-dashboard 조회 도구) |
| skill-creator | example-skills | 스킬 생성, 수정, 평가(eval), 성능 벤치마크, description 최적화 | 반복되는 제품 작업(예: 제품별 디자인 시스템 생성 절차)을 프로젝트 전용 스킬로 묶을 때 |
| pdf | document-skills | PDF 읽기, 텍스트/표 추출, 병합/분할, 회전, 워터마크, 생성, 폼 채우기, 암호화, 이미지 추출, OCR | astro-ai 리포트 PDF, flora-publishing 인쇄용 PDF 결과물 검증, 생성된 PDF의 텍스트/폰트 임베드 확인 |
| docx | document-skills | Word 문서(.docx/.dotx) 생성, 읽기, 편집, 변경 추적, 템플릿 처리 | flora-publishing 원고 .docx 가져오기, admin-suite 보고서 .docx 내보내기 |
| web-artifacts-builder | example-skills | React, Tailwind CSS, shadcn/ui로 여러 컴포넌트를 가진 claude.ai HTML 아티팩트 작성(상태 관리, 라우팅이 필요한 복잡한 아티팩트용) | 구현 전 화면 시안이나 인터랙션 프로토타입을 빠르게 공유할 때. 실제 제품 코드는 Next.js 저장소에서 작성한다 |
| xlsx | document-skills | 스프레드시트(.xlsx/.csv 등) 생성, 편집, 수식, 서식, 차트, 형식 변환 | nomad-commerce 마켓 엑셀 업로드 파일, live-poll 결과 CSV, admin-suite 엑셀 내보내기 |
| pptx | document-skills | .pptx 덱 생성, 읽기, 편집 | 제품 소개 덱이 필요할 때만 |
| theme-factory | example-skills | 슬라이드, 문서, 보고서, HTML 랜딩에 테마(사전 정의 10종 또는 즉석 생성) 적용 | 내부 문서/보고서 스타일링에 한정. 제품 UI 테마 결정에는 쓰지 않는다(frontend-design 절차가 우선) |
| canvas-design | example-skills | 디자인 철학에 기반한 .png/.pdf 정적 비주얼(포스터, 아트) 제작 | 랜딩용 정적 키 비주얼 시안, 오픈그래프 이미지 초안 |
| brand-guidelines | example-skills | Anthropic 공식 브랜드 색과 서체 적용 | 사용하지 않는다. 이 프로젝트 제품은 Anthropic 브랜드가 아니다 |
| algorithmic-art | example-skills | p5.js 시드 기반 생성 예술 | astro-ai 랜딩의 생성형 배경을 검토할 때만(선택) |
| doc-coauthoring | example-skills | 문서/제안서/스펙 공동 작성 워크플로 | 기획 문서 보강 시 |
| internal-comms | example-skills | 상태 보고, 업데이트 등 사내 커뮤니케이션 작성 | 진행 보고 작성 시 |
| slack-gif-creator | example-skills | Slack용 애니메이션 GIF | 사용하지 않는다 |

### ui-ux-pro-max-skill (UUPM)

| 기능 | 명령/위치 | 쓰는 때 |
|---|---|---|
| 디자인 시스템 생성 | `search.py "<키워드>" --design-system -p "<이름>"` | 제품별 디자인 시스템 초안. 패턴, 스타일, 색, 서체, 효과, 안티패턴, 체크리스트를 한 번에 출력 |
| 저장 | `--persist` (+ `-o <앱 루트>`) | `design-system/<슬러그>/MASTER.md` 생성 |
| 페이지 오버라이드 | `--persist --page "<페이지>"` | `design-system/<슬러그>/pages/<페이지>.md` 생성. 페이지 파일이 있으면 MASTER보다 우선 |
| 다이얼 | `--density`, `--motion`, `--variance` (각 1~10, `--design-system`과 함께) | 대시보드 고밀도, 랜딩 저밀도 조정 |
| 영역 검색 | `--domain style/color/chart/landing/product/ux/typography/icons/gsap/react/web/google-fonts` | 차트 유형 선택, UX 가이드라인 확인, 아이콘 접근성 확인 |
| 스택 지침 | `--stack nextjs`, `--stack shadcn`, `--stack react` 등 22종 | Next.js + shadcn/ui 구현 규칙 확인 |
| 출시 전 체크리스트 | 디자인 시스템 출력 하단 PRE-DELIVERY CHECKLIST | `DESIGN_PRINCIPLES.md` 7단계에 병합됨 |
| 데이터 규모 | 스타일 79종(활성 50), 팔레트 192종, 폰트 페어링 74종, 차트 25종, UX 가이드라인 119개, 랜딩 패턴 34종 | README 기준 |

## 작업 유형별 스킬 매핑

| 작업 유형 | 주 스킬 | 보조 스킬 | 비고 |
|---|---|---|---|
| 메인페이지/랜딩 구현 | frontend-design | UUPM(`--design-system --page "landing"`), webapp-testing | Awwwards 레퍼런스 먼저(`REFERENCES.md`). frontend-design이 충돌 시 우선 |
| 대시보드/운영 화면 구현 | frontend-design | UUPM(`--density 7~9 --page "dashboard"`, `--domain chart`), webapp-testing | Dribbble 레퍼런스 먼저 |
| 디자인 시스템(MASTER.md) 작성 | UUPM(`--persist`) | frontend-design(토큰 계획, 기본값 검토) | `DESIGN_PRINCIPLES.md` 3~5단계 |
| 컴포넌트 구현(shadcn/ui) | frontend-design | UUPM(`--stack shadcn`, `--stack nextjs`) | 토큰은 MASTER.md에서 |
| 차트/KPI 시각화 | UUPM(`--domain chart`) | frontend-design | stock-dashboard, admin-suite, sceneflow 분석 화면 |
| 접근성/반응형 점검 | webapp-testing | UUPM(`--domain ux`) | 375/768/1024/1440 스크린샷, 포커스, reduced-motion, 대비 |
| E2E 테스트 | webapp-testing | - | 결제, 생성 잡, 실시간 투표 흐름 |
| PDF 결과물 생성/검증 | pdf | - | astro-ai 리포트, flora-publishing 인쇄용 PDF. 렌더는 WeasyPrint 서비스, 검증은 pdf 스킬 |
| Word 원고 입출력 | docx | - | flora-publishing 원고 가져오기, admin-suite 보고서 |
| 엑셀/CSV 입출력 | xlsx | - | nomad-commerce 마켓 업로드, live-poll 결과, admin-suite |
| MCP 서버 제작 | mcp-builder | - | 외부 서비스/내부 API를 에이전트 도구로 노출 |
| 프로젝트 전용 스킬 제작 | skill-creator | - | 반복 절차를 스킬로 굳힐 때 eval 포함 |
| 화면 시안/프로토타입 공유 | web-artifacts-builder | frontend-design | 시안 단계 전용. 제품 저장소 코드와 별개 |
| 정적 키 비주얼/OG 이미지 | canvas-design | frontend-design | 실사 사진, 실제 결과물 캡처가 있으면 그것을 우선 |

## 제품별 주 스킬 조합

| 제품 | 랜딩/메인 | 앱 화면 | 결과물/입출력 | 검증 |
|---|---|---|---|---|
| flora-publishing | frontend-design + UUPM | frontend-design + UUPM(dashboard) | pdf, docx | webapp-testing |
| astro-ai | frontend-design + UUPM | frontend-design + UUPM(dashboard) | pdf | webapp-testing |
| sceneflow | frontend-design + UUPM | UUPM(dashboard, chart) + frontend-design | - | webapp-testing |
| nomad-blog | frontend-design + UUPM | UUPM(dashboard) + frontend-design | - | webapp-testing |
| nomad-commerce | frontend-design + UUPM | UUPM(dashboard) + frontend-design | xlsx | webapp-testing |
| microweb-studio | frontend-design + UUPM | frontend-design(청첩장 템플릿은 모바일 우선) | - | webapp-testing(375px 우선) |
| admin-suite | 해당 없음(내부 시스템, 로그인 화면만) | UUPM(dashboard, chart, `--stack shadcn`) + frontend-design | xlsx, docx | webapp-testing |
| live-poll | frontend-design + UUPM | UUPM(dashboard) + frontend-design, OBS 오버레이는 별도 페이지 오버라이드 | xlsx(CSV) | webapp-testing |
| stock-dashboard | frontend-design(공개 랜딩은 법률 검토 후) | UUPM(dashboard, chart) + frontend-design | - | webapp-testing |
| toon-factory | frontend-design + UUPM | frontend-design(에디터 3패널) + UUPM | - | webapp-testing |
| study-note | frontend-design | frontend-design + UUPM(`--domain ux`) | - | webapp-testing |
| website-floria | frontend-design + UUPM(`--variance` 높게) | 해당 없음 | - | webapp-testing |

컴포넌트 단위 작업을 지시할 때는 `DESIGN_SYSTEM.md` 8장의 작업 지시 템플릿을 쓴다(스택 버전, 특히 Tailwind CSS v4를 명시).
