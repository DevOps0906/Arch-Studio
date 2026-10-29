# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-29
- 현재 작업: W0 — 001(d974e89)·003·009·010(db8697d)·013·066 완료. 004 Rust 미설치로 대기, 019 사람 확인 대기
- 마지막으로 한 일: 001 DB 기준선·변환기 골든·렌더 조직 잠금(2401)·자체 검사·타입, 010 토큰 확장·컴포넌트 39종·/dev/components
- 다음 한 걸음: Rust 설치 확인 → AR-06-004 데스크톱 셸 → 071a. W0-D 011(비주얼 검토, 사람 판정: /dev/components·.nomad/shots/ar010). W1 착수 가능: 002 RLS 스모크(높음), 014 지오메트리, 018 프로그램 엔진, 046, 048
- 열린 결정: 변환 규칙 문서(05장 "문자열 리터럴 제외") 정정 여부, test:db를 pnpm test에 넣을지, 생성 타입 prettier, [DECISION] task log 경로, OH Architecture 확인, 웹 인증 방식, DB 예외(073·074 계열), 보안 L2, 기간제 가격, 본인인증 제공자, 법규 범위, 앱 다크 색·밀도 수치(D-34), lucide-react 정식 의존성 여부
- 주의: 3000번 포트는 Windows 예약 범위 → dev는 `next dev -H 127.0.0.1 -p 3123` + 메모리 env(.env 없음, 파일 쓰기 금지). shot 도구 실패 → chrome --headless=new --screenshot 직접. 로컬 Supabase 포트 5532x, 컨테이너 supabase_db_Arch-Studio. DB 검사 `pnpm test:db`·`node scripts/db/check.mjs`. consume_credits 멱등 키는 코어 요청. 위임 기본 Opus, Codex astra 금지
- SDLC 단계: 06 구현(W0 → W1)
- 담당: 팀장 Opus 5.5 / builder·designer(Opus) → codex-reviewer, 고위험은 challenger + reviewer(security)
- 테스트 상태: pnpm -r lint·typecheck·test·web build 통과, convert 3/3, check.mjs 6/6
- 남은 작업: Rust 설치 → 004·071a, 사람 확인(DXF, 법규 대조, 011 비주얼 검토), W1
