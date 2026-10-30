// 일반 설정: 국외 이전 동의 권한(P8)·미지원 저장소·고지 문구 정본·오픈소스 고지 원본 동기화.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { canChangeCrossBorder, consentView, unsupportedConsentStore } from "./consent.ts";
import { RECORDING_NOTICE } from "./texts.ts";
import { THIRD_PARTY_NOTICES } from "./third-party-notices.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");

test("P8 국외 이전 동의: owner·admin만 바꿀 수 있고, 저장소 미지원이면 아무도 못 바꾼다", async () => {
  for (const r of ["member", "viewer", null]) {
    const v = consentView({ kind: "unknown" }, r, true);
    assert.equal(v.changeable, false);
    assert.match(v.reason ?? "", /owner·admin만/);
    assert.equal(canChangeCrossBorder(r), false);
  }
  assert.equal(consentView({ kind: "unknown" }, "owner", true).changeable, true);
  const locked = consentView({ kind: "unknown" }, "owner", false);
  assert.equal(locked.changeable, false);
  assert.equal(locked.label, "확인할 수 없음");
  assert.equal(consentView({ kind: "not_acked" }, "admin", true).label, "동의하지 않음 — 오픈소스 경로만 씁니다");
  assert.deepEqual(await unsupportedConsentStore.crossBorder(), { kind: "unknown" });
  assert.equal(await unsupportedConsentStore.setCrossBorder(true), false);
  assert.equal(await unsupportedConsentStore.recordingNoticeVersion(), null);
});

test("녹음 고지 = PRD 6장 문구 그대로", () => {
  const prd = readFileSync(path.join(ROOT, "docs/file/02-요구사항/01_PRD.md"), "utf8");
  assert.ok(prd.includes(`"${RECORDING_NOTICE}"`));
});

test("오픈소스 고지 데이터 = 루트 THIRD_PARTY_NOTICES.md(UPDATE_NOTICES=1이면 다시 만든다)", () => {
  const src = readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8").replace(/\r\n/g, "\n");
  if (process.env.UPDATE_NOTICES === "1" && src !== THIRD_PARTY_NOTICES) {
    const file = path.join(import.meta.dirname, "third-party-notices.ts");
    const head = readFileSync(file, "utf8").split("export const THIRD_PARTY_NOTICES")[0];
    writeFileSync(file, `${head}export const THIRD_PARTY_NOTICES: string = ${JSON.stringify(src).replace(/@/g, "\\u0040")};\n`);
    return;
  }
  assert.equal(THIRD_PARTY_NOTICES, src);
  assert.match(THIRD_PARTY_NOTICES, /Apache License 2\.0/);
});
