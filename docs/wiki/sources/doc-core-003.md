# DOC-CORE-003 공용 코어: SECURITY_BASELINE

산출물 요약 페이지(초기 페이지, 기계 생성). 정본은 산출물이다: `docs/file/03-설계/공용코어/SECURITY_BASELINE.md`

## 장 구성
- 0. 적용 범위와 우선순위
- 1. 규칙 1: SECURITY DEFINER 안에서 호출자를 판정할 때는 `is_service_caller()`를 쓴다
- 2. 규칙 2: 역할 비교는 NULL-safe로 한다
- 3. 함수 권한: PUBLIC 기본 EXECUTE를 제거하고 허용 목록만 준다
- 4. 쓰기 경로: service_role 또는 SECURITY DEFINER RPC만
- 5. 비밀은 `core.encrypted_credentials`에만
- 6. 웹훅: 서명 검증 + 멱등
- 7. OAuth state는 서버가 발급하고 1회만 소비한다
- 8. 레이트 리밋
- 9. 특권 작업은 감사한다
- 10. 입력 검증, SSRF, sanitize
- 11. 클라이언트 경계
- 12. 개인정보와 데이터 보호
- 13. 배포와 운영
- 14. 복사 금지 패턴 (리뷰에서 발견된 것)
- 15. RLS/권한 회귀 테스트 (제품마다 필수)
- 16. AI, 음성 보안 규칙 (2026-10-13 추가)
- 17. 인증 단계 보안 규칙 (2026-10-14 추가, 확정 결정 22)

## 출처
- `docs/file/03-설계/공용코어/SECURITY_BASELINE.md`

## 관련
- [[index]]
