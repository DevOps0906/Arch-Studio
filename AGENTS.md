# AGENTS.md — Arch Studio

> 모든 AI 코딩 도구가 읽는 **단일 정본**. 짧게 유지한다. 스택·명령·문서 지도 상세는 `docs/STACK.md`, 영역 규칙은 `.claude/rules/*.md`.

## 1. 무엇인가
소규모 건축사사무소·전원주택 시공사용 설치형 AI 설계실무 앱(Windows, Tauri) + 클라우드 웹. 대지 → 법규 엔벨로프 3D → 매스 실시간 판정 → 도면(DXF/SVG/PDF) 자동 작도.
웹(SaaS)·설치형 기능 동등, 라이선스 3종(ADR-001). 문서 지도는 `docs/STACK.md` 3장.

## 2. 스택 · 명령 (상세 `docs/STACK.md`)
`apps/desktop` Tauri 2 + Rust · `apps/web` Next.js 16 + Tailwind CSS v4 · `packages/*` 순수 TS 엔진·`drafting` 도면 · `supabase/` · `apps/api` FastAPI.
검사: `pnpm -r lint` · `pnpm -r typecheck` · `pnpm -r test`. 긴 출력은 `~/.claude/nomad/bin/q <명령>`.

## 3. 절대 규칙 (위반 = 리뷰 🔴)
- 비밀(API 키 · service_role · 결제 키 · 라이선스 서명 개인키 · 코드 서명 인증서)은 저장소·클라이언트 번들·로그에 넣지 않는다. `.env.example`에 이름만.
- 모든 테이블 RLS. 적용된 마이그레이션 파일은 수정하지 않고 새 번호 파일로 추가한다. 정본 `2400_arch.sql`은 `supabase/modular/`(migrations 밖).
- 금액·크레딧은 정수(원). 결제·차감 요청에는 멱등 키.
- UI는 반응형 3구간(~767 / 768~1199 / 1200~), 색·크기는 토큰만(hex·px 직접 금지). 토큰 정본 `packages/ui/src/tokens.css`.
- 문서·커밋·화면 문구는 한국어, 코드 식별자는 영어.
- 새 의존성은 `secscan license`로 확인(GPL·AGPL 거부). 보안 레벨은 PRD 보안 절.
- **LLM은 좌표를 만들지 않는다.** 기하·판정·도면은 결정적 순수 함수만(개발서 12.9절).
- 도면 출력은 결정적: 같은 입력 → 같은 바이트. 골든 변경은 이유를 커밋 본문에 적는다.
- `spikes/*`는 버리는 코드: 패키지에서 import 금지, 워크스페이스에 넣지 않는다.

## 4. 작업 방식
`tasks/README.md` 웨이브 순서대로 하나씩(W0 첫 작업 AR-06-019 도면 스파이크). 근거·완료 조건은 `docs/file/01-관리/06_AGENT_PLAN.md`의 해당 행. 완료 조건을 실행으로 확인한 뒤 커밋: `[AR-06-NNN] 요약` + 본문(무엇을 · 확인 방법). 사람 판정 작업(011, 019, G1·G2)은 결과를 기다린다.

## 5. 영역 규칙
파일을 고치기 **전에** 해당 영역 규칙을 읽는다: `.claude/rules/{web,desktop,engine,api,db,docs}.md` (각 파일 머리의 `paths:`가 적용 경로. Claude Code는 자동 로드).
- 읽지 않는 파일: `.env*` · lock 파일 · `node_modules/` · `.next/` · `dist/` · `build/` · `coverage/` · `target/`.
- 도구별 설정: Claude `CLAUDE.md`·`.claude/` · Codex `.codex/config.toml` · Gemini `.gemini/`·`.geminiignore`.
