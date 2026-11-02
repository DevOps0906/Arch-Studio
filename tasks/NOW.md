# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-11-02. 85개 중 완료 51(050 포함). 이전 스냅샷 전문은 git 이력(5237e18 이전 tasks/NOW.md)과 tasks/logs/AR-06-NNN.md.
- 방금 완료: 050 RAG 색인·평가셋·위키 설정(예시 데이터 선구현, main 병합). 사람 확정 대기: 위키 제안값(ingest 10분·lint 7일·크레딧 상한 200/100·stale 365일).

## 병합 대기 (PR CI 확인 필요 — 비공개 저장소+gh 없음 → 사람이 PR 생성·CI 결과 전달)
- `feat/ar-06-073`(클라우드 blob·RLS): db 잡 test:rls 통과 → main 병합이 다음 모든 병합의 선행.
- `feat/ar-06-072`(799df22, 웹 어댑터, 리뷰 🟠2 반영) · `feat/ar-06-049`(d167753, AI 라우팅, 보안 리뷰 🟠2 반영, SQL 미실행·강등 테스트 `returning 1` 집계 CI 확인) → 073 뒤 병합.
- `feat/ar-06-086`(annotations, ACCEPT) 독립 병합. `feat/ar-06-032`(제안서 PDF) R-A5 전 보류.
- 병합 후: 071 착수(결정 tasks/logs/AR-06-071.md, 서버에 GET /api/cloud-projects/{id}/blob·/api/entitlement 라우트 먼저 필요).

## 다음 후보 (선행 끝난 대기)
- 043 결제(R-A1·가격 미정으로 사용자가 미룸), 071(073·072 병합 뒤), 077·078(072·073 뒤), 051·054(050 완료로 일부 해제, 047·048 완료 확인).
- 사람 판정 대기: D-14(VWorld·국가법령정보 이용 조건), 규칙 팩 법규 수치, 서명 키 규격 C-3·운영 공개키, OFL RFN 법무, 가격 D-2·D-4, 실기 GPU fps(036·085), 038 규칙 세트 정본, 039 IFC 뷰어 점검, 056 2단계 6건·032 7건.

## 운영 전 차단(누적, 상세는 각 로그)
- 공용 레이트리밋 저장소(040·042·047·008), ai-settle 501(047), 약관 동의 서버 강제(008), 080 래스터화 시간 초과 후 지속, 코어 match_ai_chunks 가드 결함(049 후속), 058b 서명·릴리스(인증서 대기).

## 환경 (이 PC)
- docker·pnpm·gh·python PATH 없음. pnpm은 `npx -y pnpm@10`, nomad 도구는 `PATH="$HOME/AppData/Local/Programs/Python/Python312:$PATH"`.
- api pytest는 scratchpad venv(세션별) 또는 새로 `pip install -e ".[dev]"`. 워크트리는 pnpm 미설치라 contract/test_zod_equivalence 실패(환경).
- dev 포트 `next dev -H 127.0.0.1 -p 3123`(3000 예약). bash cargo는 `export PATH="$HOME/.cargo/bin:$PATH"`.
- Codex 한도 → 2026-11-04 17:54 재개, 그 전 리뷰는 reviewer(Opus). Codex astra 금지.
- 테스트 상태: main pnpm -r lint·typecheck·test 통과(최근 확인 058a), api 159건(050 워크트리).
- (2026-11-02) main CI: api 수정(mypy)·SBOM cdxgen 12.9.0 교체(3ea0493). guard·web·desktop-build(Windows)는 058a 이후 계속 실패 — 로그 토큰(scratchpad/gh_token.txt, Actions Read) 대기. 051 착수: challenger 검토 중(위험 높음, ai-settle 501 의존).
