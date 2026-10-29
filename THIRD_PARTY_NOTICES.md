# 제3자 고지 (Third-Party Notices)

배포물(설치 파일·웹 번들)에 포함되는 제3자 코드와 라이선스를 적는다. 새 런타임 의존성을 넣는 작업은 이 파일에 항목을 추가한다
(`secscan license` 확인, GPL·AGPL 거부 — AGENTS.md 3장). 개발 전용 의존성(테스트·빌드 도구)은 배포물에 들어가지 않아 적지 않는다.

## @arch-studio/geometry (AR-06-014)
- 제3자 코드 없음. 2D 다각형 합집합·오프셋·면적·최단거리는 자체 구현이다.
- 검토 후 채택하지 않은 후보: Clipper2 TypeScript 포트 `clipper2-ts@2.0.1`(Boost Software License 1.0, © Angus Johnson·Jeremy Tribby).
  코드를 복사하지 않았다. 오프셋의 구조(오목 꼭짓점 3점 삽입 후 positive 채움으로 정리, miter 한도 기준 `cos > 2/limit² − 1`,
  일직선 기준 `cos > 0.999`)는 Clipper2의 공개된 알고리즘 설명을 참고했다. 근거: `tasks/logs/AR-06-014.md` [DECISION] AR-02-D1.

## @arch-studio/domain
- zod 3.25.76 — MIT License, Copyright (c) Colin McDonnell. https://github.com/colinhacks/zod

## @arch-studio/shell-bridge (AR-06-005)
- @supabase/supabase-js 2.118.0 — MIT License, Copyright (c) Supabase. https://github.com/supabase/supabase-js
  전이: @supabase/auth-js·postgrest-js·realtime-js·storage-js·functions-js 2.118.0(MIT), @supabase/phoenix 0.4.5(MIT),
  iceberg-js 0.8.x(MIT), tslib 2.8.1(0BSD).
- @tauri-apps/api 2.12.4 — Apache License 2.0 OR MIT License, Copyright (c) Tauri Programme within The Commons Conservancy. https://github.com/tauri-apps/tauri

## 데스크톱 셸 Rust — 키체인 (AR-06-005)
- keyring 3.6.3 — MIT OR Apache-2.0, Copyright keyring-rs 기여자(배포 전 LICENSE 원문 대조). https://github.com/open-source-cooperative/keyring-rs
  플랫폼별 전이(`cargo tree -f "{l}"` 확인): Windows windows-sys 0.60·windows-targets 0.53(MIT OR Apache-2.0), byteorder 1.5(Unlicense OR MIT),
  zeroize 1.9(Apache-2.0 OR MIT) / macOS security-framework 3.7·core-foundation 0.10(MIT OR Apache-2.0) /
  Linux linux-keyutils 0.2.5(Apache-2.0 OR MIT). 공통 log 0.4(MIT OR Apache-2.0).

## @arch-studio/geometry — 솔리드 래퍼 (AR-06-016)
- manifold-3d 3.5.4 (`manifold.js` + `manifold.wasm`만 사용) — Apache License 2.0, Copyright Emmett Lalish 외 Manifold 기여자.
  https://github.com/elalish/manifold · tarball sha256 `cf57c91fcd33b6315bff28e424ac8c5f04acb5410e9dd8e9886838303910c568`.
  WASM 안에 포함된 Clipper2(BSL-1.0, © Angus Johnson)·oneTBB(Apache-2.0) 고지는 Manifold 저장소 LICENSE·README를 따른다(배포 전 원문 대조 필요).
- 설치 시 함께 깔리는 manifold-3d 전이 의존성(manifoldCAD·glTF 도구용, 엔진은 import하지 않아 웹 번들에 들어가지 않음):
  @gltf-transform/core·extensions·functions 4.5.1(MIT), @jscadui/3mf-export 0.5.0(MIT), fflate 0.8.3(MIT), commander 13.1.0(MIT),
  magic-string 0.30.21(MIT), fast-xml-parser 5.11.2(MIT), convert-source-map 2.0.0(MIT), @jridgewell/*(MIT), ndarray 계열(MIT),
  semver 7.8.5(ISC), detect-libc 2.1.2(Apache-2.0), sharp 0.35.5(Apache-2.0) + @img/sharp-* 네이티브 바이너리(Apache-2.0 AND **LGPL-3.0-or-later**, libvips).
  설치형(Tauri) 패키징에 node_modules를 넣지 않으면 배포물에 포함되지 않는다 — 포함 여부는 패키징 단계에서 확인한다.
