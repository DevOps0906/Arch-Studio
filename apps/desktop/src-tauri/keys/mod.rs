//! 운영 공개키(AR-06-041, 주입 방식은 AR-06-042 P12). **공개키만** 둔다(Ed25519 32바이트). 서명 쪽 비밀 값은
//! 저장소·설치 파일에 없다(AGENTS.md 3장, 09_SECURITY_PLAN.md 4장).
//!
//! - 키는 코드 상수가 아니라 **빌드 시 환경 변수**로 넣는다: `ARCH_LICENSE_PUBKEYS`·`ARCH_RULEPACK_PUBKEYS`
//!   (`kid:hex64[,kid:hex64…]`). build.rs가 `keys/parse.rs`로 검사해 `OUT_DIR/production_keys.rs`를 만든다.
//! - 비어 있으면 모든 파일이 `unknown_kid`(실패 닫힘). 릴리스 빌드(`PROFILE=release`)는 둘 중 하나라도 비면 빌드 실패.
//! - kid는 서버 `LICENSE_SIGNING_KID`·팩 서명 kid와 같은 값(`[A-Za-z0-9._-]{1,64}`). 두 고리에 같은 공개키는 빌드 실패.
//! - 교체(S-4): 새 kid를 **추가**한 빌드를 먼저 배포하고 서명 쪽 kid를 바꾼다. 옛 kid는 기존 파일 유효 기간 동안 둔 뒤 뺀다.
//!   유출 시에는 옛 kid를 즉시 뺀 빌드를 배포한다(규칙 팩은 같은 버전·같은 본문을 새 kid로 재서명하면 재설치된다).
//! - 테스트 키는 넣지 않는다. 테스트는 키 고리를 직접 만들어 주입한다. kid에 `test`가 들어가거나 테스트 공개키면 컴파일 실패.
//! - 운영 공개키 값 확정·주입은 사람 판정 대기(C-3, tasks/logs/AR-06-042.md).

include!(concat!(env!("OUT_DIR"), "/production_keys.rs"));
