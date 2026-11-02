# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-02. 85개 중 완료 53(050·051·053 포함). 053 음성 받아쓰기·UI·읽어 주기 완료(ARCH_VOICE_STT_ENABLED 기본 off, 상담 녹음은 052로 이관). 진행: 054. 이전 스냅샷은 git 이력, 작업별 결정은 tasks/logs/AR-06-NNN.md.
- 방금 완료: 051 클라우드 법규 검토(api 그래프·웹 서버 재계산+팩 서명 검증·워커 중계). **과금 경로 기본 off**(ARCH_AI_REVIEW_ENABLED). 켜기 전: 실제 LLM 제공자·Postgres 지식 저장소·공유 레이트리밋·FastAPI 실행 저장소 영속화.
- .env.example에 추가 필요(에이전트 읽기 차단): ARCH_AI_REVIEW_ENABLED, ARCH_API_URL, ARCH_RULEPACK_PUBKEYS(웹 서버), ARCH_VOICE_STT_ENABLED. 이전분 AI_TOKEN_JWKS_URL 등 5개도.

## main CI (저장소 public 전환됨, 익명 API로 실행 상태 조회 가능)
- 통과: api·db·golden·supply-chain(SBOM cdxgen 12.9.0, 3ea0493). 실패: guard·web·desktop-build(Windows rustup) — 058a 이후 한 번도 통과 안 함, 로컬 재현 안 됨.
- 로그는 인증 필요 → 사용자가 scratchpad\gh_token.txt(fine-grained, Actions Read)에 토큰 저장 대기. 사용 후 파일 삭제·토큰 폐기 안내.

## 병합 대기 (기능 브랜치는 CI 미실행 — 워크플로가 PR·main만. PR 생성 필요)
- `feat/ar-06-073`(blob·RLS) → 먼저. 그다음 `feat/ar-06-072`(799df22)·`feat/ar-06-049`(d167753). `feat/ar-06-086` 독립. `feat/ar-06-032` R-A5 전 보류.
- 병합 후 071 착수(서버 GET /api/cloud-projects/{id}/blob·/api/entitlement 라우트 먼저).

## 다음 후보 (선행 끝난 대기)
- 054 Dify arch-chat(047·050, 진행), 043 결제(사용자 보류), 077·078(072·073 뒤).

## 사람 확정 대기
- 051: 단가 15, 레이트리밋 조직×사용자 분당 10, 검토 대상 선택 규칙. 050: 위키 제안값 4개. D-14, 규칙 팩 수치, 서명 키 C-3·운영 공개키, OFL RFN, 가격 D-2·D-4, GPU fps, 038 규칙 세트, 039 IFC 뷰어, 056·032 결정.

## 환경 (이 PC)
- docker·pnpm·gh·WSL 없음. pnpm은 `npx -y pnpm@10.34.8`, python은 `PATH="$HOME/AppData/Local/Programs/Python/Python312:$PATH"`, api 도구는 scratchpad venv.
- lock·.env*·node_modules 읽기 차단. 확인 안 된 npx 패키지 실행은 자동 모드가 막음.
- Codex 한도 2026-11-04 17:54 재개, 그 전 리뷰는 reviewer. 위험 높음 작업은 challenger 먼저.
