---
paths:
  - "packages/drafting/**"
  - "packages/domain/**"
  - "packages/geometry/**"
  - "packages/rules/**"
  - "packages/program/**"
  - "packages/massing/**"
  - "packages/layout/**"
---
# 엔진·도면 영역 규칙 (순수 TS 패키지 작업 때만 로드)
- 근거: 개발서 12장(`docs/source/develop/arch-studio/arch-studio_develop.md#12`) · PRD 9장.
- 순수 함수만: I/O·시간·난수·전역 상태 금지. 같은 입력 → 같은 출력(바이트 단위).
- LLM 출력은 좌표·치수가 될 수 없다. AI는 파라미터 제안까지, 기하는 엔진이 만든다(12.9절).
- 판정 결과에는 근거 조항(법령·조문)을 함께 반환한다.
- 도면: 골든 파일 변경은 `test:golden` 갱신 + 커밋 본문에 이유. 결정성 점검표(12.4절)를 PR마다 확인.
- 한글 글꼴·레이어 매핑은 12.6~12.7절 테스트를 깨지 않는다. 성능 예산 12.8절.
