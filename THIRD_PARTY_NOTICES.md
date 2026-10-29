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

## 데스크톱 셸 Rust — 라이선스·규칙 팩 서명 검증 (AR-06-041)
- ed25519-dalek 2.2.0 — BSD-3-Clause, Copyright (c) 2017-2019 isis agora lovecruft 외 dalek-cryptography 기여자(배포 전 LICENSE 원문 대조). https://github.com/dalek-cryptography/curve25519-dalek
  기능 `std`·`fast`·`zeroize`만(서명·난수 기능 없음, 검증 전용). 전이(`cargo tree --target all -e normal,build -f "{p} {l}"` 확인):
  curve25519-dalek 4.1.3(BSD-3-Clause), subtle 2.6.1(BSD-3-Clause), ed25519 2.2.3·signature 2.2.0(Apache-2.0 OR MIT),
  fiat-crypto 0.2.9(MIT OR Apache-2.0 OR BSD-1-Clause, 일부 대상만), zeroize 1.9(Apache-2.0 OR MIT),
  sha2 0.10.9·digest 0.10·cpufeatures 0.2(MIT OR Apache-2.0, 기존 의존성 공유). 빌드 전용 curve25519-dalek-derive 0.1.1·rustc_version 0.4.1(MIT/Apache-2.0)은 배포물에 들어가지 않는다.
  GPL·AGPL 없음. BSD-3-Clause는 배포물 고지(저작권 표시·조건·면책 문구)를 요구한다.
- windows-sys 0.60.2 — MIT OR Apache-2.0, Copyright (c) Microsoft Corporation(배포 전 LICENSE 원문 대조). https://github.com/microsoft/windows-rs
  Windows 대상에서만 직접 의존(기능 `Win32_Foundation`·`Win32_System_Registry`): 기기 ID(`MachineGuid`)를 `RegGetValueW`로 읽는다
  (보안 리뷰: `reg.exe` 실행 제거). keyring(windows-native)이 이미 쓰는 같은 버전·같은 전이(windows-targets 0.53, MIT OR Apache-2.0)라 배포물에 새 크레이트가 늘지 않는다.
- 테스트 전용 dev-dependency curve25519-dalek 4.1.3(BSD-3-Clause, 위 전이와 같은 버전)은 작은 위수 R 서명 벡터 생성에만 쓰고 배포물 의존성은 바뀌지 않는다.

## @arch-studio/geometry — 솔리드 래퍼 (AR-06-016)
- manifold-3d 3.5.4 (`manifold.js` + `manifold.wasm`만 사용) — Apache License 2.0, Copyright Emmett Lalish 외 Manifold 기여자.
  https://github.com/elalish/manifold · tarball sha256 `cf57c91fcd33b6315bff28e424ac8c5f04acb5410e9dd8e9886838303910c568`.
  WASM 안에 포함된 Clipper2(BSL-1.0, © Angus Johnson)·oneTBB(Apache-2.0) 고지는 Manifold 저장소 LICENSE·README를 따른다(배포 전 원문 대조 필요).
- 설치 시 함께 깔리는 manifold-3d 전이 의존성(manifoldCAD·glTF 도구용, 엔진은 import하지 않아 웹 번들에 들어가지 않음):
  @gltf-transform/core·extensions·functions 4.5.1(MIT), @jscadui/3mf-export 0.5.0(MIT), fflate 0.8.3(MIT), commander 13.1.0(MIT),
  magic-string 0.30.21(MIT), fast-xml-parser 5.11.2(MIT), convert-source-map 2.0.0(MIT), @jridgewell/*(MIT), ndarray 계열(MIT),
  semver 7.8.5(ISC), detect-libc 2.1.2(Apache-2.0), sharp 0.35.5(Apache-2.0) + @img/sharp-* 네이티브 바이너리(Apache-2.0 AND **LGPL-3.0-or-later**, libvips).
  설치형(Tauri) 패키징에 node_modules를 넣지 않으면 배포물에 포함되지 않는다 — 포함 여부는 패키징 단계에서 확인한다.

## @arch-studio/drafting — 번들 글꼴 (AR-06-022)
- **Noto Sans KR Regular(400) 부분 집합** `packages/drafting/fonts/NotoSansKR-Regular.subset.ttf` — SIL Open Font License 1.1.
  Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. 라이선스 전문 `packages/drafting/fonts/OFL.txt`(글꼴 파일과 함께 배포물에 넣는다).
  출처: npm `@expo-google-fonts/noto-sans-kr@0.4.4`(Google Fonts notosanskr v40, 원본 sha256 `b4a747e78805bc25b610dcfc3003cb5fb2e2ec034763774b24216ed15889eef4`).
  수정: fonttools `pyftsubset`으로 현대 한글 음절 11,172자 + 기호만 남김(글리프 이름·이름 표는 원본 그대로; 예약 이름 'Source'는 글꼴 이름에 쓰이지 않음 — `fonts/README.md`). 수정본도 OFL로 배포한다. 글꼴 단독 판매 금지.
  jsPDF가 PDF에 글꼴을 임베드(쓴 글자만 부분 집합)하는 것도 OFL이 허용한다.

## @arch-studio/drafting — PDF (jsPDF, AR-06-022 갱신)
- jspdf 4.2.1 — MIT License, Copyright (c) 2010-2025 James Hall, yWorks GmbH 외. https://github.com/parallax/jsPDF
- 함께 설치되는 전이 의존성(drafting 런타임 트리, `pnpm licenses list --prod` 2026-10-29): fflate 0.8.3(MIT), fast-png(MIT)·pako(MIT AND Zlib)·iobuffer(MIT),
  @babel/runtime(MIT), 선택 의존성 canvg·core-js·html2canvas(MIT) 및 그 하위(raf, rgbcolor, stackblur-canvas, svg-pathdata, text-segmentation, utrie, css-line-break, base64-arraybuffer, performance-now, regenerator-runtime: MIT),
  dompurify(MPL-2.0 OR Apache-2.0 — Apache-2.0 선택). 엔진은 jsPDF의 html·canvas 기능을 쓰지 않는다.

## @arch-studio/drafting — PNG (resvg, AR-06-022)
- `@resvg/resvg-js` 2.6.2 + 플랫폼 네이티브 바이너리(`@resvg/resvg-js-<플랫폼>` 12종, 설치 때 현재 플랫폼 것만) — **MPL-2.0**(Mozilla Public License 2.0).
  Copyright (c) yisibl 외 resvg-js 기여자. 내부 Rust 렌더러 resvg 0.34.0(MPL-2.0, Copyright (c) Yevhenii Reizner)·tiny-skia 0.10.0(BSD-3-Clause)·fontdb 0.14.1(MIT)·rustybuzz 0.7.0(MIT)·ttf-parser 0.18.1(MIT OR Apache-2.0) 등을 정적 링크한 바이너리다.
- **MPL-2.0 고지·소스 위치**: 우리는 resvg·resvg-js를 수정하지 않고 npm 배포 바이너리를 그대로 쓴다. MPL-2.0은 파일 단위 카피레프트라 수정하지 않은 바이너리 배포는 라이선스 고지와 소스 위치 안내로 충족한다(법률 자문 아님).
  소스: https://github.com/yisibl/resvg-js (태그 v2.6.2) · resvg 원본 https://github.com/RazrFalcon/resvg (0.34.0; resvg-js는 `zimond/resvg` rev 3495d870 포크를 [patch.crates-io]로 사용) · MPL-2.0 전문 https://www.mozilla.org/MPL/2.0/ .
  우리가 resvg 소스를 수정하게 되면(후속 Rust 작업 포함) 수정한 MPL 파일의 소스를 같은 라이선스로 공개해야 한다.
- 배포 위치: **웹 서버·작업 워커·CI·샘플 생성만**(Node). 설치형(Tauri)에는 npm 바이너리가 들어가지 않는다 — 설치형은 후속 AR-06-080(Rust resvg 크레이트 직접 사용)에서 별도 고지한다.
- Rust 전이 크레이트 전체의 라이선스 목록(`cargo about` 등)은 이번에 만들지 않았다 — 설치형 Rust 작업(AR-06-080)에서 만든다. npm 쪽 조사: `pnpm licenses list --prod`에서 GPL·AGPL·LGPL 없음.
- 참고: 앞서 검토한 sharp(libvips LGPL-3.0)는 대표 결정으로 PNG에 쓰지 않는다. `@arch-studio/geometry`의 manifold-3d 전이 의존성으로만 설치되어 있다(위 항목).
