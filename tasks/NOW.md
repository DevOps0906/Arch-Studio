# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-29
- 현재 작업: AR-06-019 도면 스파이크 — 상태: 사람 확인 대기(LibreCAD·AutoCAD로 `spikes/drafting/out/site1~3.dxf` 열기, 체크리스트 `spikes/drafting/log.md`)
- 마지막으로 한 일: Codex(sol) 분석 🔴 R1~R5 해소(검증 게이트·권리 합성·데이터 회수·웹 첫 여정·법규 체크리스트), 사용자 결정 D-H5·모바일·C6 반영, main push(35f5e6e)
- 다음 한 걸음: W0 나머지 — AR-06-003 모노레포 골격(보통) → AR-06-004 데스크톱 셸 → AR-06-071a 웹/설치형 공유 스파이크. AR-06-001(DB, 높음)은 challenger 먼저 + 이관된 🟡 2건(멱등 키 NULL 거부·렌더 동시성 잠금) 포함
- 열린 결정(사용자 확인 필요): 웹 스튜디오 인증 방식(Bearer vs 쿠키+CSRF), DB 수정 규칙 예외(073·074·074a·074b 새 마이그레이션), PRD 8.0 착수 차단 결정, 보안 S-1~S-14(L2 확정 등), 기간제 가격, 본인인증 제공자, 법규 지원 범위(11_LEGAL_RULE_REVIEW 3절)
- 주의(이번 작업에서 알게 된 함정): PRD 인용은 장 번호로(줄 번호 금지). `mmd-check`는 파일 단위. 적용된 마이그레이션 수정 금지 → 새 파일. `secscan license`는 pnpm lockfile 라이선스를 못 읽음 → `pnpm licenses list --prod`. 위임은 기본 Opus(사용자 지시), Codex astra 금지
- SDLC 단계: 05 기술 설계 완료 → 06 구현(W0)
- 담당 모델/역할: 팀장 · Opus 5.5 / 다음: builder(Opus) → codex-reviewer(code)
- 수정 파일: docs/file/**(PRD·00_LEAN·11_LEGAL·02~05·09·ADR-001·06), docs/reviews/*, docs/diagrams/web-first-journey.*, DESIGN.md, packages/ui/src/tokens.css, .claude/settings.json, tasks/*, README.md
- 테스트 상태: 스파이크 node --test 9건 통과·ezdxf audit 0. 문서는 mmd-check 통과
- 남은 작업: 사람 확인 2건(DXF 열기, 법규 원문 대조) → 결정 2건 수령 → W0 구현
