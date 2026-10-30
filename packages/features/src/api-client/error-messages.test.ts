// 04_API.md 7장 코드 목록·03_SCREENS_UX.md 5.2절 문구를 문서에서 직접 파싱해 매핑 표가 전부 덮는지 검증한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_ERROR_INFO, ERROR_INFO, errorInfoFor, errorMessageFor } from "./index.ts";

const DOCS = new URL("../../../../docs/file/03-설계/", import.meta.url);
const api = readFileSync(new URL("04_API.md", DOCS), "utf8");
const ux = readFileSync(new URL("03_SCREENS_UX.md", DOCS), "utf8");

const CODE = /^(?:[A-Z]{2}\d{3}|[0-9A-Z]{5}|[a-z]+(?:_[a-z]+)+|[A-Z]+(?:_[A-Z]+)+)$/;

function section(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  const j = text.indexOf(to, i + from.length);
  assert.ok(i >= 0 && j > i, `절을 찾지 못함: ${from}`);
  return text.slice(i, j);
}

/** 7장의 표 첫 열과 "앱 코드(" 단락에서 코드를 뽑는다. */
function docCodes(): Set<string> {
  const s7 = section(api, "## 7. 오류 코드", "### 7.4");
  const found = new Set<string>();
  for (const line of s7.split("\n")) {
    if (line.startsWith("| ")) {
      const first = line.split("|")[1] ?? "";
      for (const m of first.matchAll(/`([^`]+)`/g)) if (CODE.test(m[1]!)) found.add(m[1]!);
    } else if (line.startsWith("앱 코드(")) {
      for (const m of line.matchAll(/`([^`]+)`/g)) if (CODE.test(m[1]!)) found.add(m[1]!);
    }
  }
  return found;
}

test("문서 파서 점검: 7장에서 코드를 충분히 읽었다", () => {
  const codes = docCodes();
  for (const c of ["AR001", "AR045", "AR050", "AR061", "CR001", "AI002", "42501", "P0002", "23514", "rate_limited", "AI_UNAVAILABLE", "VOICE_TOO_LONG"]) {
    assert.ok(codes.has(c), `파서가 ${c}를 못 읽음`);
  }
  assert.ok(codes.size >= 50, `읽은 코드 ${codes.size}개`);
});

test("04장 7장의 모든 코드가 문구 표에 있다", () => {
  const missing = [...docCodes()].filter((c) => !(c in ERROR_INFO));
  assert.deepEqual(missing, []);
});

test("모든 문구는 비어 있지 않은 한국어이고 서버 원문 자리표시자(<n> 등)가 없다", () => {
  for (const [code, i] of Object.entries(ERROR_INFO)) {
    assert.ok(/[가-힣]/.test(i.message), code);
    assert.ok(!/[<>{}]/.test(i.message), `${code} 자리표시자`);
  }
});

test("03장 5.2절 문구와 첫 문장이 같다(문서 정본과 동기)", () => {
  const s52 = section(ux, "### 5.2 서버 오류 코드 문구", "### 5.3");
  let checked = 0;
  for (const line of s52.split(/\r?\n/)) {
    const m = /^\| (`[^|]+?`(?: \/ `[^|]+?`)*) \| (.+) \|$/.exec(line);
    if (!m) continue;
    const codes = [...m[1]!.matchAll(/`([A-Z]{2}\d{3})`/g)].map((x) => x[1]!);
    if (codes.length === 0) continue;
    const texts = m[2]!.split(" / ");
    codes.forEach((code, idx) => {
      const doc = (texts[idx] ?? texts[0]!).replace(/\s*\[[^\]]+\]/g, "").trim();
      const firstSentence = doc.split(/(?<=\.)\s/)[0]!;
      if (/[<>]/.test(firstSentence)) return; // AR040의 <n>은 표에서 개수 없는 문구로 바꿈
      assert.ok(ERROR_INFO[code]!.message.includes(firstSentence), `${code}: 문서 "${firstSentence}"`);
      checked += 1;
    });
  }
  assert.ok(checked >= 20, `대조한 코드 ${checked}개`);
});

test("5.2절 버튼 라벨이 actions로 보존된다", () => {
  assert.deepEqual(ERROR_INFO["AR001"]!.actions, ["기기 목록"]);
  assert.deepEqual(ERROR_INFO["AR005"]!.actions, ["인증 메일 다시 보내기"]);
});

test("모르는 코드·코드 없음은 안전한 기본 문구", () => {
  assert.equal(errorMessageFor("ZZ999"), DEFAULT_ERROR_INFO.message);
  assert.equal(errorMessageFor(null), DEFAULT_ERROR_INFO.message);
  assert.equal(errorMessageFor("constructor"), DEFAULT_ERROR_INFO.message); // 프로토타입 키로 새지 않는다
  assert.equal(errorMessageFor("__proto__"), DEFAULT_ERROR_INFO.message);
});

test("entitled=false 사유별 문구(5.2절)와 AR045 사유", () => {
  assert.match(errorMessageFor("entitled_false", { reason: "expired" }), /이용 기간이 끝나/);
  assert.match(errorMessageFor("AR044", { reason: "seat_unassigned" }), /배정된 좌석이 없습니다/);
  assert.match(errorMessageFor("AR044", { reason: "seat_revoked" }), /배정이 해제/);
  assert.match(errorMessageFor("AR045", { reason: "cooldown" }), /7일/);
  assert.match(errorMessageFor("AR045", { reason: "reassign_limit" }), /2회/);
  assert.deepEqual(errorInfoFor("entitled_false", { reason: "expired" }).actions, ["프로젝트 내려받기"]);
});
