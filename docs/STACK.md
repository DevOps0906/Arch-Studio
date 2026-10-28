# 스택과 명령 — Arch Studio

> `AGENTS.md`에서 옮긴 상세. 버전은 작업 시점 최신 stable 확인 후 lockfile(`pnpm-lock.yaml`, `Cargo.lock`)로 고정한다. 근거: 개발서 6장(`docs/source/develop/arch-studio/arch-studio_develop.md#6`).

## 1. 스택
| 영역 | 선택 | 위치 |
|---|---|---|
| 데스크톱 | Tauri 2.x · Rust stable(rusqlite bundled, 키체인, 서명 라이선스, updater, deep-link) · Vite + React 19 | `apps/desktop` (`src-tauri/`) |
| 웹 | Next.js 16.2 · React 19.2 · TypeScript strict · Tailwind CSS v4 · shadcn/ui · `@supabase/ssr` | `apps/web` |
| 엔진(순수 TS) | domain · geometry · rules · program · massing · layout, 3D는 three.js + R3F + Manifold WASM | `packages/*` |
| 도면 엔진 | 자체 DXF(AC1027)·SVG·PDF, 골든 테스트 + CI 전용 ezdxf audit | `packages/drafting` |
| DB·인증 | Supabase(Postgres 15 · pgvector · RLS · Auth). 로컬은 모놀리스 `public` | `supabase/` |
| API·AI | FastAPI · Python 3.12 · Pydantic v2 · LangGraph (LLM 키는 여기에만) / 워커 Node 20 | `apps/api` · `workers/arch-jobs` |

## 2. 명령
| 목적 | 명령 |
|---|---|
| 설치 | `pnpm install` · `cd apps/api && uv sync` |
| 개발 서버 | `pnpm --filter ./apps/web dev` · `pnpm --filter ./apps/desktop tauri dev` |
| 린트 · 타입 | `pnpm -r lint` · `pnpm -r typecheck` · `ruff check apps/api` |
| 테스트 | `pnpm -r test` · `pnpm --filter ./packages/drafting test:golden` · `cd apps/api && pytest -q -k arch` |
| Rust | `cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` |
| DB 초기화 · 타입 | `supabase db reset` · `supabase gen types typescript --local --schema public > apps/web/src/types/supabase.ts` |
| RLS 스모크 | `supabase/tests/rls_smoke.sql` (개발서 7.3절) |
| ERD 갱신 | `~/.claude/nomad/bin/sql2erd supabase/migrations -o docs/diagrams/erd.mmd` |

## 3. 문서 지도
| 문서 | 내용 |
|---|---|
| `docs/file/_index.md` | 근거 산출물 26개 목차 |
| `docs/file/02-요구사항/01_PRD.md` | 기능 AR-F-001~038, 도면 9장, 린 검증 9.10절 |
| `docs/file/03-설계/02~05_*.md` | 구조 · 화면 · API · 데이터 |
| `docs/file/03-설계/공용코어/` · `디자인/` | 공용 코어 규약 · 디자인 원칙(HERO_3D, LANDING_PERSUASION) |
| `docs/file/01-관리/06_AGENT_PLAN.md` | 작업 71개 · 웨이브 W0~W8 · 완료 정의 |
| `docs/source/` | platform-docs 원본(products·develop·develop_V2·Tauri) — 읽기 전용 |
| `docs/wiki/` | LLM 위키(sources 27) |
| `DESIGN.md` · `packages/ui/src/tokens.css` | 디자인 (정답은 토큰 파일) |
| `design/reference/landing/` · `dashboard/` | 확정 시안 원본: 랜딩(다크) · 대시보드(라이트, 트레이싱지) |
