# NOW — 재진입 스냅샷 (30줄 이내, 매 작업 끝에 덮어쓴다)

- 갱신: 2026-10-28
- 현재 작업: AR-06-019 도면 스파이크(spikes/drafting, 버리는 코드) — 상태: 진행(계획 → 구현 위임)
- 마지막으로 한 일: NOMAD v3.0 규칙 적용(Codex 팀원 2명·SDLC 9단계·handoff), 다이어그램 6종, ADR-001(웹·설치형 하이브리드·라이선스 3종) 반영 후 main push
- 다음 한 걸음: builder 결과 → ezdxf audit 0 확인 → codex-reviewer(code) → 사람 LibreCAD·AutoCAD 확인
- 열린 결정(사용자 확인 필요): PRD 8.0 착수 차단 결정, 보안 S-1~S-14, 기간제 세부(ADR 4.5)·신규 가격, 본인인증 제공자·`ci_hash` 보존, 스튜디오 인증 방식, DB 수정 규칙 예외
- 주의(이번 작업에서 알게 된 함정): 019의 AutoCAD 확인·011 비주얼 판정은 사람. PRD 인용은 줄 번호 금지(장 번호로). `mmd-check`는 폴더가 아니라 파일 단위로 실행. 신규 테이블은 적용된 마이그레이션 수정 금지 → 새 파일
- SDLC 단계: 06 구현 (W0 스파이크)
- 담당 모델/역할: builder · Sonnet 5.5 → 검증 codex-reviewer(code)
- 수정 파일: spikes/drafting/**
- 테스트 상태: 미실행
- 남은 작업: 결정 수령 → 신규 마이그레이션(좌석·기간제·본인인증·cloud_projects 키) → ERD 갱신 → W0 스파이크 2건
