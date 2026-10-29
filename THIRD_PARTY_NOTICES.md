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
