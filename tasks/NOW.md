# NOW — 재진입 스냅샷 (30줄 이내)

- 갱신: 2026-11-02 23:30. push 안 함(로컬 main만).
- 작업 표: 92개 중 완료 61 · 진행 3(038·039·056) · 대기 28.
- 오늘 완료·병합(2묶음 병렬): 050·053·073·086 / 054·049·072·051.
- 검사 상태(main): pnpm -r typecheck·lint·test, pnpm test:ai-routing 9, apps/api pytest 627(83 건너뜀=PENDING_ZOD). test:rls는 073 병합 때 143+9 통과(이후 DB 변경 없음).
- 051 숫자 차단: 블랙리스트 2회 우회 → advisor 진단 → parts[Text|Ref]·허용 문자 집합(음절만·NFC)·한글 수사 닫힌 집합·validate_free_text 단일 판정기. fable 재검증 2회. 잔여 위험(수사 없는 수량 "한도의 절반", 연결어 3개 이상)은 tasks/logs/AR-06-051.md.
- 사람 결정 대기(신규): 051 정량 템플릿 문구 카탈로그 작성 여부·AI 해석 문장 존치, 072 없는 프로젝트 저장 오류 코드(AR041 vs NOT_FOUND), arch.knowledge force=false 유지, 054 Dify 템플릿 이스케이프 실측.
- 후속(작업 표 '발견한 문제'): A-ANNO-USER v_std 마이그레이션, consume_credits inserted 반환, cloud_projects sha256 열, 업로드 고아 정리 크론, 051 그래프 서버 배선·스냅샷 IDOR 보안 리뷰, 054 운영 배선 3개·ai_messages, CI 연결(058), proposal_narrative 그래프 없음.
- 다음 후보: 071 웹 스튜디오 셸(높음, challenger 먼저 — 072 웹 어댑터 연결 포함), 077 로컬↔클라우드 업로드, 078 Excel/CSV, 055 AI 화면(051·053·054 완료로 해제).
- 사람 결정 대기(기존): 규칙 팩 법규 수치, 서명 키 C-3·운영 공개키, 가격 D-2·D-4, VWorld D-14, 083 면적 산입, 038 규칙 세트, 039 IFC 뷰어, 056 2단계, 032.
- 주의: 워크트리는 옛 커밋에서 생성될 수 있음 → 빌더에게 `git merge --ff-only main` 먼저 지시. builder는 커밋 금지 → 팀장 커밋. pnpm install은 CI=true 필요(no TTY).
- 환경: Docker Desktop 실행 중. Codex 한도 재개 2026-11-04 17:54.
