//! 운영 공개키 상수(AR-06-041). **공개키만** 둔다(Ed25519 32바이트). 개인키는 web 서버 환경 변수(`LICENSE_SIGNING_PRIVATE_KEY`)
//! 와 규칙 팩 서명 담당 쪽에만 있다(AGENTS.md 3장, 09_SECURITY_PLAN.md 3장).
//!
//! - 아직 운영 키가 없어 두 슬롯 모두 비어 있다. 비어 있으면 모든 파일이 `unknown_kid`(실패 닫힘).
//! - 키 추가: `(kid, 공개키 32바이트)` 한 줄. kid는 서버 `LICENSE_SIGNING_KID`와 같은 값(`[A-Za-z0-9._-]{1,64}`).
//! - 교체(S-4): 새 kid를 **추가**한 빌드를 먼저 배포하고 서버 kid를 바꾼다. 옛 kid는 기존 파일 유효 기간 동안 둔 뒤 뺀다.
//!   유출 시에는 옛 kid를 즉시 빼고 재발급(refresh)을 안내한다.
//! - 테스트 키는 여기 넣지 않는다. 테스트는 키 고리를 직접 만들어 주입한다. kid에 `test`가 들어가면 컴파일이 실패한다.

/// 라이선스 파일 서명 공개키(`arch-license-v1\n` 도메인).
pub const LICENSE_KEYS: &[(&str, [u8; 32])] = &[];

/// 규칙 팩 매니페스트 서명 공개키(`arch-rulepack-v1\n` 도메인). 라이선스 키와 같은 키를 넣지 않는다(심층 방어).
pub const RULEPACK_KEYS: &[(&str, [u8; 32])] = &[];
