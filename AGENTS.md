# AGENTS.md — Arch Studio

> 모든 AI 코딩 도구가 읽는 **단일 정본**. 짧게 유지한다. 스택·명령·문서 지도 상세는 `docs/STACK.md`, 영역 규칙은 `.claude/rules/*.md`.

## 1. 무엇인가
소형 건축사사무소용 AI 설계실무 도구(웹 SaaS·Windows 설치형 동등, ADR-001): 대지 → 법규 엔벨로프 → 실시간 판정 → 도면 자동 작도.

## 2. 스택 · 명령
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
`tasks/README.md` 순서대로 하나씩(`/next`). 근거·완료 조건은 `06_AGENT_PLAN.md` 해당 행, 확인 후 커밋 `[AR-06-NNN] 요약`. 사람 판정 작업은 기다린다.

## 5. 영역 규칙
파일을 고치기 **전에** 해당 영역 규칙을 읽는다: `.claude/rules/{web,desktop,engine,api,db,docs}.md` (각 파일 머리의 `paths:`가 적용 경로. Claude Code는 자동 로드).
- 읽지 않음: `.env*`·lock·`node_modules`·`.next`·`dist`·`build`·`coverage`·`target`.
