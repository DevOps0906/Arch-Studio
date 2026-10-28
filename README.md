# Arch Studio (가칭)

1~5인 건축사사무소와 전원주택 시공사를 위한 **AI 설계실무 도구**입니다.
대지를 불러오면 법규상 지을 수 있는 볼륨(법규 엔벨로프)이 3D로 생깁니다. 매스를 움직이면 건폐율·용적률·정북 일조사선·주차·이격을 근거 조항과 함께 실시간으로 판정합니다. 배치도·면적 산정도·일조사선 단면은 DXF·SVG·PDF로 자동 작도합니다.

- **제공 방식**: 웹(SaaS)과 설치형(Windows, Tauri)의 기능이 같습니다. 웹에서 바로 시작하거나, 랜딩에서 설치형을 내려받을 수 있습니다. 설치형은 여기에 오프라인 작업과 로컬 파일을 더합니다. → [ADR-001](docs/file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md)
- **라이선스**: 웹과 설치형 모두 영구 / 기간제 / 구독 3종입니다. 상품 구성과 가격은 결정 대기 중입니다.
- **크레딧**: 판정·도면·매스 제안은 0크레딧입니다. AI 렌더·클라우드 법규 검토·제안서 PDF·법규 채팅에는 크레딧이 듭니다.

## 진행 현황 (2026-10-28 기준)

| 영역 | 진행률 | 상태 |
|---|---|---|
| 환경·멀티에이전트 구성 | 약 95% | NOMAD Agent OS를 적용해 팀원 10명·훅·영역 규칙이 동작합니다. 점검 결과 ❌는 0개입니다 |
| 기획 | 약 90% | 재정비를 마쳤습니다(아래). 하이브리드 구조 ADR은 착수 전 검토 중이고, 착수를 막는 결정 15건이 남았습니다 |
| 디자인 | 약 35% | 토큰과 DESIGN.md 초안을 만들었습니다. 랜딩은 받은 시안(다크)을 정본으로 확정했습니다. 비주얼 판정(AR-06-011)과 화면 구현은 남았습니다 |
| 다이어그램 | 0% | 구성도·ERD·흐름도 모두 아직 없습니다 |
| 개발 | 0% | 작업 71개가 모두 대기 중입니다. 첫 작업은 AR-06-019(2일 도면 스파이크)입니다 |

진행률은 결과물이 있는지와 확정이 남았는지를 보고 추정한 값입니다. 측정한 수치가 아닙니다.

### 완료한 일
- [x] platform-docs에서 Arch Studio 자료를 이관했습니다. 근거 문서 26개, 위키, Supabase 마이그레이션·시드·RLS 테스트, 원본 기획서·개발서(`docs/source/`)입니다.
- [x] 멀티에이전트 구성을 마쳤습니다. `AGENTS.md`를 채웠고, 영역 규칙 6개(web·desktop·engine·api·db·docs)를 두었습니다. 상시 로드 규칙은 3191에서 2377 토큰으로 줄였습니다.
- [x] 디자인 시안 원본을 보관했습니다. 랜딩은 `design/reference/landing/`, 대시보드 셸(화면 21개)은 `design/reference/dashboard/`에 있습니다.
- [x] 디자인 토큰을 만들었습니다. `packages/ui/src/tokens.css`(Tailwind CSS v4, 앱 라이트 / 랜딩 다크)와 `DESIGN.md`입니다.
- [x] 작업 표를 만들었습니다. `tasks/README.md`에 71개 작업과 팀원 담당·위험도·웨이브를 정리했습니다.
- [x] 기획을 재정비했습니다.
  - 린 검증 문서를 새로 만들었습니다: [00_LEAN](docs/file/02-요구사항/00_LEAN.md)
  - 경쟁사 15곳을 벤치마킹했습니다: [08_BENCHMARK](docs/file/02-요구사항/08_BENCHMARK.md)
  - 보안 관리 계획을 세웠습니다. 보안 레벨 L2(제안)와 위협 분석 8건이 들어 있습니다: [09_SECURITY_PLAN](docs/file/03-설계/09_SECURITY_PLAN.md)
  - 웹·설치형 하이브리드 구조를 벤치마킹했습니다: [10_DELIVERY_BENCHMARK](docs/file/03-설계/10_DELIVERY_BENCHMARK.md)
  - PRD를 정비했습니다. 착수 차단 결정 표, 기능 ID 색인, 계측 이벤트, 보안 12장, 경쟁 대응 13장을 추가했습니다.
  - 화면·API·데이터 문서에 기능 ID 추적 열을 추가했습니다. 줄 번호 인용 155곳은 장 번호 인용으로 바꿨습니다.

### 진행 중 / 다음
- [ ] ADR-001(하이브리드 제공·라이선스 3종)을 착수 전에 검토(challenger)한 뒤 PRD·구조·화면·API·데이터·작업 표에 반영합니다.
- [ ] 랜딩에 다운로드 영역과 "웹에서 바로 시작" 버튼을 넣고, 화면 문서 4.3·4.4절을 다크 시안에 맞게 고칩니다.
- [ ] 결정을 받아야 할 항목: 착수 차단 결정 15건, 보안 결정 S-1~S-14, 라이선스 상품 구성·가격
- [ ] 다이어그램: 구성도, ERD(`sql2erd`), 도면 생성 흐름
- [ ] 개발 착수: W0 AR-06-019 도면 스파이크부터 시작합니다(`/next`).

## 폴더 구조

| 경로 | 내용 |
|---|---|
| `AGENTS.md` · `CLAUDE.md` | AI 도구 공통 규칙(정본) · Claude Code 전용 설정 |
| `docs/file/` | 기획·설계 정본입니다(PRD·구조·화면·API·데이터·보안·ADR·작업 계획) |
| `docs/source/` | platform-docs 원본 사본입니다. 읽기만 합니다 |
| `docs/wiki/` · `docs/reference/` | LLM 위키 · 이관 분석·리뷰 |
| `docs/STACK.md` | 스택·명령·문서 지도 |
| `design/` | 확정 시안 원본과 토큰 미리보기 |
| `packages/ui/src/tokens.css` · `DESIGN.md` | 디자인 토큰(정답) · 디자인 설명 |
| `supabase/` | 마이그레이션·시드·RLS 스모크 테스트 |
| `infra/dify/` | 법규 채팅(Dify) 메모 |
| `tasks/` | 작업 표(`README.md`) · 현재 상태(`NOW.md`) |

## 스택

Tauri 2 + Rust(설치형) · Next.js 16 + React 19 + Tailwind CSS v4(웹) · 순수 TS 엔진(지오메트리·판정·도면) · Supabase(Postgres·RLS·Auth) · FastAPI + LangGraph(AI). 상세는 [docs/STACK.md](docs/STACK.md)를 보세요.

## 작업 방식

[NOMAD Agent OS](https://github.com/DevOps0906/nomad-agent-os)의 팀 구성으로 진행합니다. 팀장은 Opus이고, scout·builder·planner·designer·diagrammer·tester·reviewer·challenger 등 팀원이 일을 나눠 맡습니다.
Claude Code에서 `/next`를 입력하면 작업 표의 다음 작업 하나를 끝까지 진행합니다.
