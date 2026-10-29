# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-29
- 현재 작업: 없음 — AR-06-016 법규 엔벨로프 커밋·push 완료(2026-10-29)
- 완료(push됨): W0 8, W0-D 3, W1 002·006·014·018·048, W2 015·016·020·021 → 84개 중 20개
- 다음 한 걸음: W1 나머지 005·007·008·046·070·V2-01, W2 017·040·041·043·047 등. 016 팀장 확인 필요(로그): 한 변 4면 허용, 산정 가정 ①~⑤, sharp LGPL(036·058에서 검사)
- 결정됨(오늘): D-034 테마·밀도 사용자 선택형, D-071a Vite SPA+정적 호스팅·Bearer, AR-02-D1 정수 자체 구현, 형상 모든 엔진 바이트 동일·miter/square·압출은 016, S-5 평문 SQLite+OS 디스크 암호화, 스냅샷 실패 시 읽기 전용(AR061), AR060 DB 손상
- 열린 결정: OH Architecture 확인, DB 예외(073·074 계열), 보안 L2(S-1), 기간제 가격, 본인인증 제공자, 법규 범위, 규칙 세트·단가표 정본 위치(018), 면적표 같은 이름 실 허용 여부
- 주의: 3000번 포트 Windows 예약 → dev는 `next dev -H 127.0.0.1 -p 3123` + 메모리 env. 로컬 Supabase 5532x(컨테이너 supabase_db_Arch-Studio). 검사: `pnpm test`(db 변환 골든 포함)·`pnpm test:rls`(db reset 먼저)·`node scripts/db/check.mjs`. 결정 기록은 tasks/logs/AR-06-NNN.md. bash에서 cargo는 `export PATH="$HOME/.cargo/bin:$PATH"`. 위임 기본 Opus, 고난도 검증 Fable, Codex astra 금지
- 후속(작업 표 '발견한 문제'): reconcile refunded 전이 마이그레이션, CI 신설(S-7, test:rls·db:check 포함), ADR-001·071/072 문서 정정, 내부 API 경로·타임아웃(047), design-preview 랜딩 덮어쓰기 결함
- 테스트 상태: pnpm -r lint·typecheck·test 통과, RLS 129+9, db check 6/6
