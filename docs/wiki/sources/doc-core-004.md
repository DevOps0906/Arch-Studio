# DOC-CORE-004 공용 코어: DB_CONVENTIONS

산출물 요약 페이지(초기 페이지, 기계 생성). 정본은 산출물이다: `docs/file/03-설계/공용코어/DB_CONVENTIONS.md`

## 장 구성
- 1. 이름 규칙
- 2. 모듈러 DB: 제품당 스키마 1개와 번호 범위
- 3. 표준 컬럼
- 4. 타임스탬프
- 5. updated_at 트리거
- 6. 열거형은 text + CHECK
- 7. RLS 기본값
- 8. 쓰기 경로와 `guard_privileged_write` 이중 잠금
- 9. 멱등 키
- 10. 상태 컬럼과 전이
- 11. `core.apps` 등록과 코어 참조
- 12. 모놀리스 vs 모듈러
- 13. 검증
- 14. pgvector와 ai_runtime 규약 (2026-10-13 추가)

## 출처
- `docs/file/03-설계/공용코어/DB_CONVENTIONS.md`

## 관련
- [[index]]
