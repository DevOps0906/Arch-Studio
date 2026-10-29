// 표제란 미리보기 = 엔진 출력(같은 바이트·결정성), 고정 고지·체험판 워터마크 포함, 응답 해석.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftingHandlers } from "../../../../../apps/desktop/src/workers/drafting.handlers.ts";
import { parseRequest } from "../../../../../apps/desktop/src/workers/protocol.ts";
import { buildSheet, buildSitePlanView, DISCLAIMER, validateDraftingInput, WATERMARK_TEXT } from "../../../../drafting/src/index.ts";
import { writeSvg } from "../../../../drafting/src/writers/svg/index.ts";
import { ENGINE_VERSION } from "../../../../rules/src/index.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import { buildSheetRequest, previewInput, readPreviewResponse } from "./preview.ts";
import { DISCLAIMER_TEXT } from "./texts.ts";

const profile = { ...DEFAULT_PROFILE, office_name: "나무건축사사무소 <&>", layer_map: { "A-TTLB": "TB" } };
const ctx = { checkpoint: async () => {}, progress: () => {} };

async function viaWorker(watermark: boolean): Promise<string> {
  const req = buildSheetRequest("r1", 1, previewInput(profile, watermark, "2026-10-29"));
  const parsed = parseRequest(JSON.parse(JSON.stringify(req)));
  assert.ok(parsed.ok, "봉투 검사 통과");
  const handler = createDraftingHandlers().handlers.build_sheet;
  assert.ok(handler);
  const out = await handler(parsed.request as never, ctx);
  return (out.result as { svg_preview: string }).svg_preview;
}

function direct(watermark: boolean): string {
  const v = validateDraftingInput(previewInput(profile, watermark, "2026-10-29"));
  assert.ok(v.ok, v.ok ? "" : v.issues.join(";"));
  const input = { ...v.input, engine_version: ENGINE_VERSION }; // 워커가 엔진 버전을 정한다
  const built = buildSheet(input, buildSitePlanView(input, {}));
  return writeSvg(built.sheet);
}

test("견본 입력이 엔진 검증(validateDraftingInput)을 통과한다", () => {
  for (const paper of ["A3", "A2", "A1"] as const) {
    const v = validateDraftingInput(previewInput({ ...profile, default_paper: paper }, false, "2026-10-29"));
    assert.ok(v.ok, paper);
  }
});

test("미리보기 = 워커 build_sheet svg_preview = 직접 writeSvg(buildSheet) — 같은 바이트, 두 번 실행해도 같다", async () => {
  const a = await viaWorker(false);
  const b = await viaWorker(false);
  const c = direct(false);
  assert.equal(a, b);
  assert.equal(a, c);
  assert.ok(a.startsWith("<svg"));
});

test("고정 고지는 항상, 체험판 표시는 워터마크일 때만. 사무소명은 XML 이스케이프", async () => {
  const plain = await viaWorker(false);
  const trial = await viaWorker(true);
  assert.equal(DISCLAIMER_TEXT, DISCLAIMER);
  assert.ok(plain.includes(DISCLAIMER));
  assert.ok(trial.includes(DISCLAIMER));
  assert.equal(plain.includes(`>${WATERMARK_TEXT}<`), false);
  assert.ok(trial.includes(`>${WATERMARK_TEXT}<`));
  assert.ok(plain.includes("나무건축사사무소 &lt;&amp;&gt;"));
  assert.equal(plain.includes("<&>"), false);
});

test("응답 해석: 내 req_id만, superseded, 오류 코드, svg가 아니면 오류", () => {
  assert.deepEqual(readPreviewResponse({ req_id: "x", ok: true, result: { svg_preview: "<svg/>" } }, "r"), { kind: "ignore" });
  assert.deepEqual(readPreviewResponse({ req_id: "r", ok: true, result: { svg_preview: "<svg/>" } }, "r"), { kind: "ok", svg: "<svg/>" });
  assert.deepEqual(readPreviewResponse({ req_id: "r", status: "superseded" }, "r"), { kind: "superseded" });
  assert.deepEqual(readPreviewResponse({ req_id: "r", ok: false, code: "AR050", detail: "x" }, "r"), { kind: "error", code: "AR050" });
  assert.deepEqual(readPreviewResponse({ req_id: "r", ok: true, result: { svg_preview: "<script>" } }, "r"), { kind: "error", code: "invalid_response" });
  assert.deepEqual(readPreviewResponse(null, "r"), { kind: "ignore" });
});
