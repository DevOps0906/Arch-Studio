# 문서 안내

Arch Studio 문서의 단일 입구입니다. 기준 문서(정본)는 `file/`, 실행 상태는 저장소 루트의 `tasks/`, 참고 자료는 `reference/`·`wiki/`·`source/`에 있습니다.

```
docs/
├─ README.md     이 문서
├─ STACK.md      스택·명령·문서 지도
├─ file/         기준 문서(정본): 01 관리 → 02 요구사항 → 03 설계 → 04 구현 → 05 검증
├─ diagrams/     제품 도식(Mermaid + SVG), team/ = 팀 운영 도식
├─ reference/    이관 분석·외부 프로젝트 검토
├─ wiki/         LLM 위키(원문으로 연결하는 요약)
└─ source/       platform-docs 원본 사본(읽기 전용)
```

## 처음 읽는 순서

1. [제품 개요](file/01-관리/README.md): 무엇을 만드는가
2. [PRD](file/02-요구사항/01_PRD.md): 기능 AR-F-001~038과 착수 차단 결정
3. [구조](file/03-설계/02_ARCHITECTURE.md)와 [ADR-001 제공 방식·라이선스](file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md)
4. [작업 계획](file/01-관리/06_AGENT_PLAN.md)과 [실행 작업표](../tasks/README.md)
5. [재진입 기록](../tasks/NOW.md): 지금 어디까지 왔는가

## 기준 문서 (`file/`)

| 단계 | 문서 |
|---|---|
| [01 관리](file/01-관리/) | [제품 개요](file/01-관리/README.md) · [작업 계획](file/01-관리/06_AGENT_PLAN.md) |
| [02 요구사항](file/02-요구사항/) | [린 검증](file/02-요구사항/00_LEAN.md) · [PRD](file/02-요구사항/01_PRD.md) · [경쟁 분석](file/02-요구사항/08_BENCHMARK.md) · [법규 검토](file/02-요구사항/11_LEGAL_RULE_REVIEW.md) |
| [03 설계](file/03-설계/) | [구조](file/03-설계/02_ARCHITECTURE.md) · [화면](file/03-설계/03_SCREENS_UX.md) · [API](file/03-설계/04_API.md) · [데이터](file/03-설계/05_DATA_MODEL.md) · [보안](file/03-설계/09_SECURITY_PLAN.md) · [ADR-001](file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md) · [제공 방식 비교](file/03-설계/10_DELIVERY_BENCHMARK.md) |
| └ [공용코어](file/03-설계/공용코어/) | 인증·DB·AI·위키·음성·보안·공유 모듈 규약 |
| └ [디자인](file/03-설계/디자인/) | [토큰 정의](file/03-설계/디자인/DESIGN.md) · [컴포넌트](file/03-설계/디자인/COMPONENTS.md) · [토큰 표(자동 생성)](file/03-설계/디자인/DESIGN_TOKENS.md) · 디자인 원칙·대시보드·랜딩 기준 |
| [04 구현](file/04-구현/) | [개발 지침](file/04-구현/CLAUDE.md) · [원본 이식 계획](file/04-구현/07_SOURCE_MIGRATION.md) |
| [05 검증](file/05-검증/README.md) | 기획·디자인 검토, 주장 장부, 인터뷰·시간 측정 양식 |

산출물 ID와 승인 상태는 [산출물 등록부](file/_index.md)에서 관리합니다.

## 디자인 자료

| 자료 | 위치 |
|---|---|
| 토큰(정답) | `packages/ui/src/tokens.css` |
| 브리프·의도 | [루트 DESIGN.md](../DESIGN.md) |
| 확정 시안 원본 | [design/reference/](../design/reference/) (랜딩 다크 · 대시보드 라이트) |
| 토큰 미리보기 | `design/preview.html` |

## 도식 (`diagrams/`)

| 구분 | 도식 |
|---|---|
| 제품 | [구성도](diagrams/architecture.svg) · [도면 생성 흐름](diagrams/drawing-flow.svg) · [ERD](diagrams/erd.svg) · [웹 첫 여정](diagrams/web-first-journey.svg) |
| 팀 운영 | [팀 조직도](diagrams/team/team-org.svg) · [작업 흐름](diagrams/team/team-workflow.svg) · [2026-10-28 세션](diagrams/team/team-session-2026-10-28.svg) |

## 참고 자료

| 분류 | 위치 | 내용 |
|---|---|---|
| 이관·외부 검토 | [reference](reference/README.md) | 통합 분석, 외부 프로젝트 검토 |
| 지식 요약 | [wiki](wiki/index.md) | 정본으로 연결하는 위키와 변경 이력 |
| 이관 원본 | [source](source/) | platform-docs 원본 사본(개발서·기획 원본·SQL) |
| 관련 저장소 | [Motion Studio](https://github.com/DevOps0906/Motion-Studio) | 관련 프로젝트 |

## 문서 추가·변경 기준

- 문서 성격에 맞는 폴더에 본문을 두고 이 안내 문서에 링크를 추가합니다. 작업 결과는 `tasks/logs/`에 기록합니다.
- 정책·기능 변경은 `file/`의 해당 문서를 고칩니다. `source/`는 수정·이동하지 않습니다.
- `file/0N-*` 경로는 코드·테스트·규칙 팩이 참조하므로 바꾸지 않습니다.
- 그림은 `diagrams/*.mmd`(Mermaid)로 만들고 `mmd-check`를 통과시킵니다. 팀 운영 도식은 `diagrams/team/`에 둡니다.
- `DESIGN_TOKENS.md`는 자동 생성 자료입니다(`design-preview packages/ui/src/tokens.css --md docs/file/03-설계/디자인/DESIGN_TOKENS.md`). 토큰 수치는 `packages/ui/src/tokens.css`를 따릅니다.
- 검증 보고서와 실험 양식은 구분합니다. 빈 양식이나 검증되지 않은 주장을 완료된 결과로 바꾸지 않습니다.
