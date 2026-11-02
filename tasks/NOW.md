# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-02 저녁. 이전 스냅샷 상세는 git log·tasks/logs/AR-06-NNN.md에.
- 작업 표: 92개 중 완료 57 · 진행 3(038·039·056) · 대기 32. push 안 함(로컬 main만).
- 오늘 병렬 완료·병합: 050 RAG 하니스, 053 음성(보안 리뷰 🔴 수정 후 재확인), 073 클라우드 저장(마이그레이션 20261102000001·2402), 086 도면 주석 편집층.
- 검사 상태(main): pnpm -r typecheck·lint·test 통과, apps/api pytest 503 통과(83 건너뜀=PENDING_ZOD), test:rls TEST 143+RUN 9 통과.
- 주의: worktree에서는 packages/rules envelope 테스트 1건이 실패(원인 미확인), main에서는 통과. worktree는 node_modules 없어 pnpm install 필요. builder는 커밋 금지 규칙 → 팀장이 커밋.
- 후속(작업 표 '발견한 문제'에 기록): DB upsert_drafting_profile v_std에 A-ANNO-USER(높음), consume_credits inserted 반환(053 🟡 회복 불가), 업로드 고아 객체 정리 크론, 설치형 업로드 폴더 키 대조(077), voice 워커 토큰 경로, 050 실제 코퍼스·재현율 실측.
- 086 미구현 UI: 앵커 다시 고르기·사람 주석 그리기 도구·미리보기 위 고아 표시.
- 다음 후보(선행 완료·사람 결정 불필요): 072 웹 어댑터(073 완료로 해제) → 071 웹 스튜디오 셸(높음) → 077·078. 054 Dify 채팅(050 완료로 해제), 049 AI 보안 테스트(높음), 051 법규 검토 그래프(050 완료로 해제).
- 사람 결정 대기: 규칙 팩 법규 수치, 서명 키 C-3·운영 공개키, 가격 D-2·D-4, VWorld D-14, 083 면적 산입 규칙, 038 규칙 세트 정본, 039 IFC 뷰어 점검, 056 2단계 6건, 032 7건.
- 환경: Docker Desktop 실행 중(로컬 Supabase 5532x). Codex 한도 재개 2026-11-04 17:54 → 그전 리뷰는 reviewer(Opus).
