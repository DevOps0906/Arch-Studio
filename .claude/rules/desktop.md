---
paths:
  - "packages/shell-bridge/**"
  - "apps/desktop/**"
---
# 데스크톱 영역 규칙 (apps/desktop/** 작업 때만 로드)
- 근거: 개발서 13장(`docs/source/develop/arch-studio/arch-studio_develop.md#13`) · Tauri 공통 `docs/source/Tauri/README.md`.
- 프런트(Vite + React 19)는 `packages/shell-bridge`를 통해서만 Rust 명령을 부른다. `invoke` 직접 호출 금지.
- Tauri capabilities는 최소 권한. 새 명령·플러그인 권한 추가 = 위험도 높음(challenger + reviewer security).
- 비밀은 OS 키체인(`commands/secrets.rs`)에만. 로컬 SQLite·로그·설정 파일에 토큰·키 저장 금지.
- 라이선스 검증(Ed25519 공개키만 번들), 업데이터 서명 키·코드 서명 인증서는 저장소에 넣지 않는다.
- 완료 전: `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test` (src-tauri에서).
- 화면 디자인은 `design/reference/dashboard/`(라이트 트레이싱지 셸)와 `packages/ui/src/tokens.css`를 따른다.
