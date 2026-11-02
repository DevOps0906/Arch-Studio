# NOW — 재진입 스냅샷 (30줄 이내)

- 갱신: 2026-11-03 오전. 세션 마무리(사용자 요청). main 푸시 완료 상태로 종료.
- 작업 표: 92개 중 완료 63 · 진행 5(038·039·056·077·058 일부) · 대기 24.
- 이번 묶음: 071 웹 스튜디오 셸·055 AI 화면 완료, 077 로컬↔클라우드 전송 핵심 병합(일괄 zip·화면 연결 남음).
- 검사 상태(main): pnpm -r typecheck·lint, pnpm test(전 패키지+db·dev·ci), test:ai-routing, scan-secrets, convert --check, apps/api pytest 715 통과. test:rls 177+9(DB 변경 없음).
- 사람 확인: 071 Vercel 배포 후 실제 응답 헤더 curl·팝업 OAuth COOP·WebView2·워커/WASM 로드·next start CORS 헤더. 077 건축주 정보 업로드 기본 제외(05_DATA_MODEL 제안대로 팀장 결정) 유지 여부.
- 사람 작업: .env.example에 ARCH_AI_CHAT_ENABLED·ARCH_API_URL·STUDIO_ORIGIN 이름 추가(Claude 읽기 차단).
- 바로 할 후속: GET /api/cloud-projects/{id}/blob 서버 라우트(로컬 원본 브랜치 local/parallel-2026-11-02에 있음, 이식 누락) — 웹 어댑터가 지금 404. CI에 build:web+check:web 단계. 055 셸 채팅 패널 연결.
- 사람 결정: 051 정량 템플릿 문구·AI 해석 문장 존치, 채팅 숫자 검사 한글 수사, 054 일일 상한 장애 환불 턴 제외, playwright 의존성(3구간 캡처), arch.knowledge force=false, 기존 대기(법규 수치·서명 키·가격·D-14·083 면적 산입 등).
- 다음 후보: 위 blob 라우트 → 078 Excel/CSV(038 완료 후), 074 라이선스(결제 043 선행), 075 규칙 팩 서버 분리, 060·061 E2E.
- 주의: 착수 전 `git fetch` 후 origin/main·원격 브랜치 확인, 착수 작업을 작업표 '진행'으로 먼저 푸시. 워크트리는 옛 커밋에서 생길 수 있어 빌더에게 `git merge --ff-only main` 먼저. pnpm install은 CI=true. 로컬 DB는 npx supabase@2.122.0 db reset --local.
- 환경: Docker Desktop 실행 중. Codex 한도 재개 2026-11-04 17:54.
