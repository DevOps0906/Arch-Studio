# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-29
- 현재 작업: 없음 — 1단계(도면 뷰 023·024·025) 병합 완료(2026-10-29), 2단계 022·033 병합 완료, 다음 057 랜딩. 사람 확인: 번들 한글 글꼴(나눔고딕/Noto Sans KR), PNG 래스터화 방식(sharp=LGPL 여부), 샘플에 SVG·PDF 추가
- 완료(push됨): W0 8, W0-D 3, W1 002·006·014·018·048, W2 015·016·017·020·021, W3 022·023·024·025, W4 033 → 85개 중 26개
- 다음 한 걸음: W1 나머지 005·007·008·046·070·V2-01, W2 017·040·041·043·047 등. 016 팀장 확인 필요(로그): 한 변 4면 허용, 산정 가정 ①~⑤, sharp LGPL(036·058에서 검사)
- 결정됨(오늘): D-35 번들 글꼴 Noto Sans KR(OFL), D-36 PNG 래스터화 resvg 단일 렌더러(설치형 Rust 크레이트·웹 resvg-js, sharp 기각) → 신규 AR-06-080(85개로 증가), D-034 테마·밀도 사용자 선택형, D-071a Vite SPA+정적 호스팅·Bearer, AR-02-D1 정수 자체 구현, 형상 모든 엔진 바이트 동일·miter/square·압출은 016, S-5 평문 SQLite+OS 디스크 암호화, 스냅샷 실패 시 읽기 전용(AR061), AR060 DB 손상
- 열린 결정: OH Architecture 확인, DB 예외(073·074 계열), 보안 L2(S-1), 기간제 가격, 본인인증 제공자, 법규 범위, 규칙 세트·단가표 정본 위치(018), 면적표 같은 이름 실 허용 여부
- 주의: 3000번 포트 Windows 예약 → dev는 `next dev -H 127.0.0.1 -p 3123` + 메모리 env. 로컬 Supabase 5532x(컨테이너 supabase_db_Arch-Studio). 검사: `pnpm test`(db 변환 골든 포함)·`pnpm test:rls`(db reset 먼저)·`node scripts/db/check.mjs`. 결정 기록은 tasks/logs/AR-06-NNN.md. bash에서 cargo는 `export PATH="$HOME/.cargo/bin:$PATH"`. 위임 기본 Opus, 고난도 검증 Fable, Codex astra 금지
- 뷰 후속(023~025 보고): rules가 면적 분해(건축면적·연면적·층별·용도별 ㎡)·최단 이격 점 쌍·장애인 주차 대수·일조사선 초과 구간을 JudgmentResult/envelope로 내보내야 뷰가 값을 재계산하지 않음(현재 구조적 입력 extras/area_breakdown으로 대체)
- 수정됨: geometry offset 안쪽 오프셋 바늘 꼭짓점 결함(014 잠복) — 판정을 정수 외적 부호로 교체, 회귀 테스트 추가(tasks/logs/AR-06-014.md [FIX])
- 017 후속: 워커 호스트 연결(new Worker, src/routes)·실제 RulePackProvider·엔벨로프 op(솔리드 wasm)·suggest_mass/validate_layout/import_dxf는 해당 패키지 구현 후 연결. export·import 레인은 문서(마지막 1건만)와 달리 응답 못 받은 요청을 모두 순서대로 재전송(출력 유실 방지) — 04_API/02_ARCH 2.4절 정정 필요
- 040 병합됨(상태=진행): 보안 리뷰 전·C-3(서명 키 규격) 미결이라 완료 처리 안 함. 운영 전 필수: 레이트리밋 저장소 메모리→DB/Redis, 세션 조직 불일치(RPC 변경)·기기 한도 단위(074a), TRUSTED_PROXY_HOPS를 deps.ts에 연결(env 스키마에는 추가됨), 로컬 Supabase 통합 테스트 S1~S9, canonicalJson ↔ Rust 041 규칙 일치
- 후속(작업 표 '발견한 문제'): reconcile refunded 전이 마이그레이션, CI 신설(S-7, test:rls·db:check 포함), ADR-001·071/072 문서 정정, 내부 API 경로·타임아웃(047), design-preview 랜딩 덮어쓰기 결함
- 테스트 상태: pnpm -r lint·typecheck·test 통과, RLS 129+9, db check 6/6
