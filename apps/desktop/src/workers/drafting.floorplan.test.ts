// build_sheet 핸들러의 floor_plan 분기(AR-06-027): 정상 모델은 SVG 미리보기, AR051 위반은 AR051 오류.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PROJECTS } from "@arch-studio/features/demo";
import { createDraftingHandlers } from "./drafting.handlers.ts";
import { HandlerError, type HandlerContext } from "./runtime.ts";
import type { LaneRequest } from "./protocol.ts";

const model = (DEMO_PROJECTS[0] as (typeof DEMO_PROJECTS)[number]).model;
const ctx: HandlerContext = { checkpoint: () => Promise.resolve(), progress: () => undefined };
const handler = createDraftingHandlers().handlers.build_sheet!;

const input = (m: typeof model, floor_id = "f1") => ({
  model: m,
  judgment: { engine_version: "t", rule_pack_version: "2026.10.0", application_date: "2026-12-01", items: [{ key: "coverage", verdict: "NA", unit: "pct", basis: [] }], pending_changes: 0 },
  sheet: { id: "s", kind: "floor_plan", paper: "A3", orientation: "landscape", scale: "auto", floor_id, annotation_overrides: [], include_in_proposal: false },
  profile: { office_name: "", layer_map: {}, default_paper: "A3", default_text_height_mm: 2.5, font_family: "Noto Sans KR" },
  license: { drafting_watermark: false },
  engine_version: "t",
  project_name: "시험",
  date: "2026-10-29",
});
const req = (i: unknown) => ({ op: "build_sheet", req_id: "r", lane: "sheet", seq: 0, input: i }) as unknown as LaneRequest;

test("floor_plan: 정상 배치는 svg_preview를 돌려주고 같은 입력은 같은 바이트", async () => {
  const a = (await handler(req(input(model)), ctx)) as { result: { svg_preview: string } };
  const b = (await handler(req(input(model)), ctx)) as { result: { svg_preview: string } };
  assert.ok(a.result.svg_preview.startsWith("<svg"));
  assert.equal(a.result.svg_preview, b.result.svg_preview);
});

test("floor_plan: 겹침(AR051)은 AR051, 실 배치가 없는 층은 AR050", async () => {
  const layout = model.floor_layouts[0]!;
  const overlapped = { ...model, floor_layouts: [{ ...layout, rooms: layout.rooms.map((r, i) => (i === 1 ? { ...r, polygon: (layout.rooms[0] as (typeof layout.rooms)[number]).polygon } : r)) }, ...model.floor_layouts.slice(1)] };
  await assert.rejects(async () => handler(req(input(overlapped)), ctx), (e: unknown) => e instanceof HandlerError && e.code === "AR051");
  await assert.rejects(async () => handler(req(input(model, "zz")), ctx), (e: unknown) => e instanceof HandlerError && e.code === "AR050");
});
