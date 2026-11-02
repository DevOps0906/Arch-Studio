# 작업 표

정본: `docs/file/01-관리/06_AGENT_PLAN.md` 2장(작업 상세)·3장(웨이브)·8장·9장(ADR-001 웹·설치형 하이브리드)·11장(화면 구조 개편). 이 표는 NOMAD 팀 구성(담당·위험도)으로 옮긴 실행 표다. 92개(기존 71 + ADR-001 신규 13 + 추가 1 [080] + 화면 개편 7 [081~087], 2026-11-02).
담당: `challenger→builder` = 착수 전 계획 공격 후 구현(원 모델 Fable). `사람` = 대표님 판정.
변경 후 검증(NOMAD v3.0, 2026-10-28): 낮음 = builder 자가 검증(`q`), 화면이면 `codex-reviewer(design)` · 보통 = `codex-reviewer(code)` · 높음 = 착수 전 `challenger` + `codex-reviewer(code)` + `reviewer(security/contract)` → 필요 시 `tester`. Codex 불가 시 codex-reviewer → reviewer, codex-designer → designer·planner.
`codex-designer⇄designer` = 공동 디자인(초안 한쪽, 상대는 변경분 교차 검토 1회). 기획 문서 작업은 `planner⇄codex-designer`.

| 번호 | 제목 | 웨이브 | 선행 | 위험도 | 담당 | 상태 |
|---|---|---|---|---|---|---|
| AR-06-001 | DB 조각 적용·모놀리스 변환·seed·타입 | W0 | — | 높음 | challenger→builder | 완료 |
| AR-06-003 | 모노레포·web 골격·린트 경계·env 검증 | W0 | — | 보통 | builder | 완료 |
| AR-06-004 | 데스크톱 셸 골격(Tauri·CSP·capability) | W0 | — | 보통 | builder | 완료 |
| AR-06-009 | 디자인 레퍼런스 확정(1단계) | W0 | — | 낮음 | codex-designer⇄designer | 완료 |
| AR-06-013 | 도메인 계약 zod(DesignModel 등) | W0 | — | 보통 | builder | 완료 |
| AR-06-019 | 도면 스파이크 2일(DXF·PDF, D-20·D-23) | W0 | — | 보통 | builder→사람(AutoCAD 확인) | 완료 |
| AR-06-066 | 주장 장부·V0 질문지·V1 측정 양식 | W0 | — (V1은 060 뒤) | 낮음 | builder(인터뷰는 사람) | 완료 |
| AR-06-071a | 웹 스튜디오 셸 Vite/Next 공유 스파이크 1주 | W0 | 003, 004 | 보통 | builder | 완료 |
| AR-06-010 | 디자인 시스템 2단계: 토큰·컴포넌트 | W0-D | 009 | 낮음 | codex-designer⇄designer | 완료 |
| AR-06-011 | 비주얼 검토(3단계, 판정은 사람) | W0-D | 010 | 낮음 | 사람 | 완료 |
| AR-06-012 | 디자인 정답 확정(4단계) | W0-D | 011 | 낮음 | codex-designer⇄designer | 완료 |
| AR-V2-01 | 공용 compliance 모듈 적용 | W1 | W0, compliance 출시 | 높음 | builder | 대기 |
| AR-06-002 | RLS·권한 회귀 스모크 | W1 | 001 | 높음 | challenger→builder | 완료 |
| AR-06-005 | shell-bridge·키체인·Supabase 클라이언트 | W1 | 004 | 높음 | builder | 완료 |
| AR-06-006 | Rust 로컬 명령(local_db·fs·export) | W1 | 004 | 보통 | builder | 완료 |
| AR-06-014 | 지오메트리 2D(합집합·오프셋·면적) | W1 | 013 | 높음 | builder | 완료 |
| AR-06-018 | 프로그램·개략 공사비 엔진 | W1 | 013 | 보통 | builder | 완료 |
| AR-06-046 | AI 서비스 설치·arch 스키마 동치 테스트 | W1 | 001, 013 | 높음 | builder | 완료 |
| AR-06-048 | 워커 골격(claim_jobs·실패·크론) | W1 | 001 | 보통 | builder | 완료 |
| AR-06-007 | 클라우드 API 클라이언트(재시도·오류 매핑) | W1 | 005 | 보통 | builder | 완료 |
| AR-06-008 | 인증 Stage A: Mock 로그인·온보딩 | W1 | 001, 003, 005 | 높음 | builder | 완료 |
| AR-06-070 | 플랫폼 어댑터 5종 인터페이스·설치형 구현 이전 | W1 | 005, 006 | 보통 | builder | 완료 |
| AR-06-015 | 판정 엔진·규칙 팩·골든 | W2 | 013, 014 | 보통 | builder | 완료 |
| AR-06-016 | 법규 엔벨로프(일조사선 신·구) | W2 | 014, 015 | 보통 | builder | 완료 |
| AR-06-020 | 시트 모델·표제란·레이어·치수 | W2 | 013, 014, 019 | 보통 | builder | 완료 |
| AR-06-021 | DXF 작성기·골든 하네스·CI audit | W2 | 019, 020 | 보통 | builder | 완료 |
| AR-06-040 | 라이선스 서버·서명 파일·기기 활성화 | W2 | 001, 003 | 높음 | challenger→builder | 완료 |
| AR-06-041 | Rust 라이선스 검증·규칙 팩 서명 | W2 | 006, 040 | 높음 | challenger→builder | 완료 |
| AR-06-043 | 결제: 체크아웃·Toss 웹훅·시리얼 메일 | W2 | 001, 003, 040 | 높음 | challenger→builder | 대기 |
| AR-06-017 | 엔진·도면 워커(레인·취소·재생성) | W2 | 004, 013 | 보통 | builder | 완료 |
| AR-06-047 | AI 게이트: 토큰·pricing·업로드 서명 | W2 | 003, 046 | 높음 | challenger→builder | 완료 |
| AR-06-050 | RAG 색인·평가셋·위키 설정 | W2 | 046 | 보통 | builder | 완료 |
| AR-06-058 | CI: 데스크톱 빌드·서명 릴리스·비밀 검사 | W2 | 001, 003, 004 | 높음 | builder | 대기 |
| AR-06-073 | 클라우드 프로젝트 blob 저장·RLS·expected_version 충돌 | W2 | 001, 002, 003 | 높음 | challenger→builder | 대기 |
| AR-06-071 | 웹 스튜디오 셸 (studio): 서브도메인·워커·CSP | W2 | 070, 071a, 003, 008 | 높음 | challenger→builder | 대기 |
| AR-06-072 | 웹 어댑터 구현(web/): 캐시·파일·세션·권한 | W2 | 070, 073 | 보통 | builder | 대기 |
| AR-06-022 | SVG·PNG·PDF 작성기, 글꼴 폭 표 | W3 | 020, 021 | 보통 | builder | 완료 |
| AR-06-023 | 배치도 뷰와 골든 | W3 | 016, 020 | 보통 | builder | 완료 |
| AR-06-024 | 면적 산정도·면적표 뷰와 골든 | W3 | 015, 020 | 보통 | builder | 완료 |
| AR-06-025 | 일조사선 단면 뷰와 골든 | W3 | 016, 020 | 보통 | builder | 완료 |
| AR-06-042 | 업데이트·규칙 팩·단가표 배포 | W3 | 040, 041 | 높음 | challenger→builder | 완료 |
| AR-06-049 | 라우팅 seed·AI 보안 테스트 | W3 | 046, 047 | 높음 | challenger→builder | 대기 |
| AR-06-051 | 클라우드 법규 검토 그래프·API | W3 | 015, 047, 048, 050 | 보통 | builder | 대기 |
| AR-06-053 | 음성: STT API·음성 UI·읽어 주기 | W3 | 012, 047, 048 | 보통 | builder | 대기 |
| AR-06-054 | Dify arch-chat·채팅 SSE 중계 | W3 | 047, 050 | 보통 | builder | 대기 |
| AR-06-074 | 라이선스 3종(영구·기간제·구독) 서버 판정·SKU | W3 | 040, 041, 043, 073 | 높음 | challenger→builder | 대기 |
| AR-06-074a | 좌석 관리(seats 컬럼·배정·초과 판정) | W3 | 074 | 높음 | challenger→builder | 대기 |
| AR-06-074b | 휴대폰 본인인증 크레딧(1인증 1회 지급) | W3 | 008, 074 | 높음 | challenger→builder | 대기 |
| AR-06-075 | 규칙 팩 서버 분리·웹 자격 게이트·CI 팩 0바이트 검사 | W3 | 015, 042, 071 | 높음 | challenger→builder | 대기 |
| AR-06-026 | 평면 개략도 뷰·layout 패키지 | W4 | 014, 020 | 보통 | builder | 완료 |
| AR-06-029 | DXF 가져오기 파서 | W4 | 013, 017 | 보통 | builder | 완료 |
| AR-06-031 | 설정: 표제란·레이어 매핑·일반 | W4 | 001, 003, 007, 012, 020 | 높음 | builder | 완료 |
| AR-06-033 | 랜딩 샘플 도면 /samples·다운로드 측정 | W4 | 003, 021, 023, 024 | 낮음 | builder | 완료 |
| AR-06-034 | 프로젝트 목록·로컬 버전·클라우드 사본 | W4 | 001, 006, 007, 012, 013 | 보통 | builder | 완료 |
| AR-06-035 | 대지 화면·VWorld 조회 중계 | W4 | 001, 007, 012, 013 | 높음 | builder | 완료 |
| AR-06-036 | 모델러: R3F 뷰포트·매스 편집 | W4 | 012, 016, 017 | 보통 | builder | 완료 |
| AR-06-037 | 판정 패널(근거·폴백 배너) | W4 | 012, 015, 017 | 보통 | builder | 완료 |
| AR-06-038 | 프로그램 화면·면적표·공사비 | W4 | 012, 018, 042 | 보통 | builder | 진행 |
| AR-06-044 | 라이선스·크레딧 화면(데스크톱·웹) | W4 | 007, 012, 040, 043 | 높음 | builder | 대기 |
| AR-06-080 | 설치형 PNG 래스터화(Rust resvg 명령, D-36) | W4 | 006, 022, 070 | 높음 | challenger→builder | 완료 |
| AR-06-069 | 마케팅 컴포넌트 8종 | W4 | 012 | 낮음 | codex-designer⇄designer | 완료 |
| AR-06-028 | 매스 자동 제안 3안 | W4 | 015, 016, 036 | 보통 | builder | 완료 |
| AR-06-027 | 평면 개략도 편집기 | W5 | 012, 017, 026 | 보통 | builder | 완료 |
| AR-06-030 | 도면 시트 화면·ExportDialog | W5 | 006, 012, 017, 021~025, 080 | 보통 | builder | 완료 |
| AR-06-032 | 제안서 PDF(도면 시트 포함) | W5 | 022, 046, 047, 048 | 보통 | builder | 대기 |
| AR-06-039 | 3D 입출력: glTF·IFC·.3dm | W5 | 013, 036 | 높음 | builder | 진행 |
| AR-06-052 | 대화형 설계 입력·상담 녹음 후보 | W5 | 038, 046, 047, 048, 053 | 보통 | builder | 대기 |
| AR-06-055 | AI 화면: 검토·채팅·위키 | W5 | 012, 051, 053, 054 | 보통 | builder | 대기 |
| AR-06-056 | AI 렌더: 캡처·fal 워커·렌더 화면 | W5 | 036, 047, 048 | 높음 | builder | 진행 |
| AR-06-057 | 랜딩·요금·다운로드·법적 고지 | W5 | 003, 012, 023 | 낮음 | codex-designer⇄designer | 완료 |
| AR-06-077 | 로컬↔클라우드 수동 업로드·내려받기 | W5 | 034, 072, 073 | 보통 | builder | 대기 |
| AR-06-078 | Excel/CSV 내보내기(AR-F-044) | W5 | 015, 038, 072 | 보통 | builder | 대기 |
| AR-06-081 | 통합 작업공간 셸·GNB 작업공간 메뉴(3구간) | W5 | 027, 030, 034, 036, 037 | 보통 | builder | 완료 |
| AR-06-082 | 대시보드 강화(프로젝트 카드·요약·오늘 할 일·크레딧 카드) | W5 | 081, 034 | 보통 | builder | 완료 |
| AR-06-083 | 모델러 코어·발코니(DesignModel 선택 필드) | W5 | 036, 081, 사람(면적 산입 규칙) | 높음 | challenger→builder | 대기 |
| AR-06-084 | 단면·측정 도구 | W5 | 036, 081 | 보통 | builder | 완료 |
| AR-06-085 | 3D 표시 품질(조명·그림자·재질·층 라벨·층 숨김/분해도) | W5 | 036, 081 | 보통 | builder | 완료 |
| AR-06-086 | 도면 주석 편집층(annotations[] 계약 변경·고아 주석 출력 제외) | W5 | 020, 021, 022, 030, 081 | 높음 | challenger→builder | 대기 |
| AR-06-087 | 새 프로젝트 지도 운영 연결(VWorld D-14·셸, 지금은 mock) | W5 | 035, 081, D-14(사람) | 높음 | challenger→builder | 대기 |
| AR-06-059 | 보안 점검(리뷰 전용, 위험 14건) | W6 | 005, 006, 040, 041, 042, 058 | 높음 | reviewer(security) | 대기 |
| AR-06-060 | 데스크톱 E2E 시나리오 5개+ | W6 | 030, 036, 041, 044 | 보통 | tester | 대기 |
| AR-06-061 | 웹 E2E 페르소나·잡 흐름 통합 | W6 | 008, 032, 051, 056 | 보통 | tester | 대기 |
| AR-V2-02 | V2 전환 점검: 모듈 계약 테스트 CI | W6 | AR-V2-01 | 보통 | tester | 대기 |
| AR-06-065 | 랜딩 설득 칸·판정표·화면 기록 | W6 | 057, 033, 036, 037, 069, 066, D-27·D-30 | 낮음 | codex-designer⇄designer | 대기 |
| AR-06-067 | 도입 단계 탭(/pricing) | W6 | 057, 069, D-29 | 낮음 | codex-designer⇄designer | 완료 |
| AR-06-045 | 결제 E2E(Toss 테스트 키) → G1 자료 | W6 | 043, 044, 061 | 높음 | tester | 대기 |
| AR-06-076 | /download 페이지·릴리스 채널(latest.json·체크섬) | W6 | 057, 058, 069 | 낮음 | codex-designer⇄designer | 대기 |
| AR-06-079 | 웹+설치형 E2E 동등성·브라우저 매트릭스 | W6 | 060, 061, 071, 072, 074 | 보통 | tester | 대기 |
| AR-06-062 | Stage B: Google·이메일·딥링크 로그인 | W7 | G1(사람), 008 | 높음 | challenger→builder | 대기 |
| AR-06-063 | Stage C1 카카오 로그인 | W8 | G2(사람), 062 | 높음 | builder | 대기 |
| AR-06-064 | Stage C2 네이버 로그인(스파이크) | W8 | G2(사람), 062 | 높음 | challenger→builder | 대기 |
| AR-06-068 | 제안 준비 시간 비교 계산기 | W8 | 057, 069, D-28 | 낮음 | codex-designer⇄designer | 대기 |

상태: 대기 / 진행 / 완료 / 보류
게이트(사람 판정): G1 = 베타 공개 전(W6 끝, 062 진입), G2 = P2 제공자 진입(W8 진입).

## 발견한 문제 (범위 밖 — 나중 작업 후보)
| 날짜 | 위치 | 내용 | 제안 |
|---|---|---|---|
| 2026-10-28 | `supabase/migrations/20261013000001_core_lite.sql` consume_credits | `p_idempotency_key` 기본값 null → 키 없이 호출 시 멱등 검사 생략(운영 경로는 키 전달, 현재 중복 차감 없음). `tests/rls_smoke.sql`도 키 생략 | **코어 요청으로 이관**(2026-10-29 사용자 결정, '코어 ALTER 0건'): platform 코어 0003에서 키 NULL·공백 거부(22023). 제품은 운영 경로가 항상 키를 넘기는지 테스트로만 고정 |
| 2026-10-28 | `supabase/migrations/20261013000002_arch_domain.sql` 동시 렌더 수 검사 | 잠금 전에 개수를 세어 동시 요청 2건이 모두 통과할 수 있음(미재현) | **AR-06-001에서** 조직 단위 잠금 후 검사 + 동시 요청 테스트 (Codex 리뷰 🟡) |
| 2026-10-29 | `03_SCREENS_UX.md` 4.3절 | "DESIGN.md 5절"을 가리키나 DESIGN.md는 4절까지 | 다음 문서 작업에서 참조 정정 |
| 2026-10-29 | `06_AGENT_PLAN.md` AR-06-013 행 | 근거 `04_API.md:276-366`이 실제 4.7절(306~393줄)과 어긋남 | 장 번호 인용으로 교체 |
| 2026-10-29 | `02_ARCHITECTURE.md` 위험 #2 ↔ AR-06-013 | 판정 필수값 누락: 위험 #2는 "입력 필요" 표시, 013은 스키마 검증 실패 | AR-06-037 판정 패널에서 검증 실패를 "입력 필요"로 표시해 양립 |
| 2026-10-29 | `04_API.md` 4.7.3 SheetSpec `dx_mm`·`dy_mm` | 모델 mm인지 용지 단위인지 모호(현재 number, 정수 강제 없음) | AR-06-020에서 확정 |
| 2026-10-29 | 기획 문서 전반 "task `log.md`" | `[DECISION]` 기록 경로가 저장소에 정해지지 않음 | `tasks/logs/AR-06-NNN.md` 사용 시작(071a·014) |
| 2026-10-29 | `~/.claude/nomad/bin/design-preview` | 글자 크기 표의 태블릿·데스크톱 열이 `[data-surface="landing"]` 미디어 블록 값으로 덮임. 컴팩트 밀도·`--line-dash-*`·`--chat-bubble-max`도 표에 없음 | NOMAD 도구 수정(저장소 밖). 앱 값 정본은 tokens.css, DESIGN.md 3.1에 주의 문구 |
| 2026-10-29 | ADR-001 2장 · 06_AGENT_PLAN AR-06-071·072 | D-071a(Vite SPA+정적 호스팅, Bearer) 채택으로 쓰기 경로·세션·CSP 서술이 낡음 | AR-06-071 착수 전 planner로 문서 정정(`tasks/logs/AR-06-071a.md`) |
| 2026-10-29 | AR-06-002 완료 조건 "두 대상, CI 잡" | 모놀리스만 통과(129건), 모듈러는 platform 코어 0000~0009 필요로 미검증, `.github/workflows` 없음 | 첫 CI는 보안 S-7(`/secure setup --ci`)과 함께 신설해 test:rls·test:db·db:check 포함 |
| 2026-10-29 | `reconcile_runs`(0002) | 최종 실패에서 fail_job 후 fail_ai_run 전에 워커가 죽으면 원장 환불은 끝났는데 실행이 failed로만 남아 refunded 전이 누락(이중 환불은 아님, codex 리뷰) | 새 마이그레이션으로 reconcile이 잡 원장 환불 여부를 보고 refunded 전이(2401 조각 방식) |
| 2026-10-29 | AR-06-048 워커 ↔ 04_API.md | 워커가 부르는 `POST /api/internal/ai-settle`·`/api/internal/ai-token`(Bearer 워커 키, `{job_id, scope}`→`{token}`)과 잡 타임아웃(intake·proposal_pdf 5분, stt 30분)은 builder가 정한 값 | AR-06-047 AI 게이트에서 04_API에 확정 |
| 2026-10-29 | AR-06-006 로컬 명령 | 내부 오류 코드 5개(CANCELLED·READ_FAILED·INVALID_INPUT·NOT_FOUND·VERSION_CONFLICT)가 04_API 7.3 AR 코드 밖, 저장 기본 파일명 export.<ext>(4.7.6 이름 규칙 미반영), 리비전 보존 정책 없음, 100MiB 내보내기 쓰기가 async 스레드를 잠시 점유, cargo audit 미설치 | 7.3 정식 코드화는 070 어댑터 때, 파일명은 030 ExportDialog, 보존 정책·cargo audit은 CI(S-7) |
| 2026-10-29 | AR-06-006 사람 확인 | 실제 Windows 열기·저장·덮어쓰기 대화상자, OneDrive·junction·260자+ 경로 미검증(테스트는 picker 대체) | 대표님 확인 후 tasks/logs/AR-06-006.md에 기록 |
| 2026-10-29 | 규칙 팩 2026.10.0 | 근거 문서에 조문이 붙은 법규 수치가 없어 10개 규칙 전부 `미확인`(판정 전부 WARN), 지원 지자체 0, 허가 도서 평가셋 30건 미측정 | 사용자: 법규 수치·조문·시행일 제공 또는 원문 표 작성 후 검수 → 팩 2026.10.1 |
| 2026-11-02 | AR-06-050 RAG | 하니스·예시(미확인) 코퍼스만 완성. 재현율 0.8은 해시 임베더로만 확인 | 사람: 실제 법규 코퍼스·평가셋 30문항 작성 후 운영 임베딩으로 재측정. 결정: 시행 범위 컬럼 승격(코어)·wiki confirmed_on 컬럼·index/log 페이지 lint 예외·D-14 후 attribution 필수·출처 구분자 `;` (tasks/logs/AR-06-050.md) |
## 교훈 (다음 작업에 그대로 적용할 것만, 20줄 이내 유지)
- 디자인 시안 확정: design/reference/landing(다크)·dashboard(라이트) — 009~012·057·065~069는 이 시안 기준
