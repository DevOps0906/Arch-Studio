// 금지 문구 검사: PRD 6.1절·9.7절 점검표의 "금지 예" 문구가 /samples 화면 소스·카탈로그 문구에 없어야 한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** 출처: docs/file/02-요구사항/01_PRD.md 6.1절(타사·보증 표현) · 9.7절(도면 표현) 금지 예. 공백 제거 후 비교. */
export const FORBIDDEN_PHRASES = [
  "허가100%통과",
  "반려걱정없음",
  "모든법규자동검토",
  "법규완벽반영",
  "건축사없이설계",
  "설계사무소가필요없습니다",
  "국토부인증",
  "세움터공식연동",
  "공식파트너",
  "SketchUp대체",
  "실제완공모습그대로",
  "건축사1,000명",
  "제안시간90%단축",
  "웹무제한",
  "인허가도면자동작성",
  "허가도서완성",
  "오토캐드가필요없습니다",
  "CAD대체",
  "도면그릴사람이필요없습니다",
  "치수100%정확",
  "인허가보장",
  "통과보장",
];

const SOURCES = [
  "../../app/(marketing)/samples/page.tsx",
  "../../app/(marketing)/samples/DownloadButton.tsx",
  "../../app/(marketing)/samples/loading.tsx",
  "../../app/(marketing)/samples/error.tsx",
  "./catalog.ts",
  "../../../../../scripts/samples/build.ts",
];

const squash = (s: string) => s.replace(/\s+/g, "");

for (const rel of SOURCES) {
  test(`금지 문구 0: ${rel}`, () => {
    const text = squash(readFileSync(new URL(rel, import.meta.url), "utf8"));
    for (const phrase of FORBIDDEN_PHRASES) assert.ok(!text.includes(phrase), `금지 문구 "${phrase}" 발견: ${rel}`);
  });
}

test("검사기 자체 확인: 금지 문구를 넣으면 잡힌다", () => {
  assert.ok(squash("이 도구는 허가 100% 통과 를 약속").includes(FORBIDDEN_PHRASES[0] as string));
});

test("필수 고지: 체험용 예시, 인허가 설계도서 아님, 법규 판정 아님", () => {
  const page = squash(readFileSync(new URL(SOURCES[0] as string, import.meta.url), "utf8"));
  for (const must of ["체험용예시도면", "법규판정이아니고", "인허가설계도서가아닙니다"]) assert.ok(page.includes(must), must);
});
