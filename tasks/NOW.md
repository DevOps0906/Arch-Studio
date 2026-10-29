# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-29
- 현재 작업: AR-06-013(da40fc6)·009(07a0975)·066(a89d7b8) 완료 · AR-06-019 사람 확인 대기
- 마지막으로 한 일: 013 도메인 계약 zod(스키마 4종·이주 가드·mm/면적 유틸, 테스트 27, codex 🟡 3 반영), 009 DESIGN.md 1절(고문 Fable 통과), 066 주장 장부·V0·V1 양식
- 다음 한 걸음: AR-06-001 DB(높음, challenger 먼저 + 이관 🟡 2건) → Rust 설치 후 AR-06-004 → 071a. W0-D 010(디자인 토큰·컴포넌트) 착수 가능
- 열린 결정(사용자 확인 필요): [DECISION] task log 경로, OH Architecture 브라우저 확인 여부, 웹 인증 방식(Bearer vs 쿠키+CSRF), DB 수정 규칙 예외(073·074·074a·074b), PRD 8.0 착수 차단, 보안 S-1~S-14(L2), 기간제 가격, 본인인증 제공자, 법규 지원 범위
- 주의: PRD 인용은 장 번호로. 적용된 마이그레이션 수정 금지. `secscan license`는 pnpm lockfile 못 읽음 → `pnpm licenses list --prod`. 위임 기본 Opus, Codex astra 금지. Rust 미설치(rustc·cargo 없음). 엔진 패키지 테스트는 node --test + `.ts` import, node: import는 줄 단위 eslint 해제
- SDLC 단계: 06 구현(W0)
- 담당 모델/역할: 팀장 Opus 5.5 / builder·designer(Opus) → codex-reviewer, 고문 검토 Fable
- 테스트 상태: pnpm -r lint·typecheck·test 통과(domain 27 + web 8)
- 남은 작업: 사람 확인 2건(DXF 열기, 법규 원문 대조) + Rust 설치 → W0 나머지(001·004·071a·019), W0-D 010~012
