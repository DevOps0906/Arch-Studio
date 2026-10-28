# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-29
- 현재 작업: AR-06-003 완료(2558fb4) · AR-06-019 사람 확인 대기 — 다음: AR-06-004 데스크톱 셸(Rust 툴체인 확인 필요)
- 마지막으로 한 일: AR-06-003 모노레포·web 골격(ESLint 경로·순수성, env 기동 검증, 보안 헤더, 로거 재귀 마스킹), codex-reviewer 🟡 5 반영, Docker 미리보기(127.0.0.1:8088)
- 다음 한 걸음: W0 나머지 — AR-06-003 모노레포 골격(보통) → AR-06-004 데스크톱 셸 → AR-06-071a 웹/설치형 공유 스파이크. AR-06-001(DB, 높음)은 challenger 먼저 + 이관된 🟡 2건(멱등 키 NULL 거부·렌더 동시성 잠금) 포함
- 열린 결정(사용자 확인 필요): 웹 스튜디오 인증 방식(Bearer vs 쿠키+CSRF), DB 수정 규칙 예외(073·074·074a·074b 새 마이그레이션), PRD 8.0 착수 차단 결정, 보안 S-1~S-14(L2 확정 등), 기간제 가격, 본인인증 제공자, 법규 지원 범위(11_LEGAL_RULE_REVIEW 3절)
- 주의(이번 작업에서 알게 된 함정): PRD 인용은 장 번호로(줄 번호 금지). `mmd-check`는 파일 단위. 적용된 마이그레이션 수정 금지 → 새 파일. `secscan license`는 pnpm lockfile 라이선스를 못 읽음 → `pnpm licenses list --prod`. 위임은 기본 Opus(사용자 지시), Codex astra 금지
- SDLC 단계: 05 기술 설계 완료 → 06 구현(W0)
- 담당 모델/역할: 팀장 · Opus 5.5 / builder(Opus) → codex-reviewer(code)
- 수정 파일: docs/file/**(PRD·00_LEAN·11_LEGAL·02~05·09·ADR-001·06), docs/reviews/*, docs/diagrams/web-first-journey.*, DESIGN.md, packages/ui/src/tokens.css, .claude/settings.json, tasks/*, README.md
- 테스트 상태: pnpm -r lint·typecheck·test(8)·web build 통과, 스파이크 9건 통과
- 남은 작업: 사람 확인 2건(DXF 열기, 법규 원문 대조) → 결정 2건 수령 → W0 구현
