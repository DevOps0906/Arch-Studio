// 도면 시트 화면(AR-06-030) 순수 로직 + 실제 드래프팅 워커 핸들러를 통한 통합 테스트.
// 통합: WorkerRuntime(스케줄러 포함) + createDraftingHandlers(실제 글꼴 자산) ↔ createSheetBuilder·runExport.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { designModelV1Schema } from "@arch-studio/domain";
import { createDraftingHandlers, type DraftingAssets } from "../../../../apps/desktop/src/workers/drafting.handlers.ts";
import { parseRequest } from "../../../../apps/desktop/src/workers/protocol.ts";
import { WorkerRuntime } from "../../../../apps/desktop/src/workers/runtime.ts";
import { buildSheet, buildSitePlanView } from "../../../drafting/src/index.ts";
import { buildPngSvg, writePng } from "../../../drafting/src/writers/png/index.ts";
import { writeSvg } from "../../../drafting/src/writers/svg/index.ts";
import { ENGINE_VERSION, judge, loadRulePack } from "../../../rules/src/index.ts";
import pack from "../../../rules/packs/2026.10.0/pack.json" with { type: "json" };
import { DEMO_PROJECTS } from "../demo/samples.ts";
import {
  fileCount,
  kindSupport,
  layoutFloors,
  missingInputs,
  newSpec,
  nextPaper,
  outputErrorText,
  parseModel,
  legacyStoreKey,
  orphanNotice,
  parseStored,
  parseStoredV1,
  readBuildResponse,
  readStoredSheets,
  storeKey,
  readWriteResponse,
  serializeStored,
  sheetAccess,
  sheetName,
  type SheetInput,
} from "./model.ts";
import { createSheetBuilder, runExport, type ExportDeps } from "./runner.ts";
import { nextSheetSeq } from "./seq.ts";

const house = DEMO_PROJECTS[0]!.model;
const PROFILE = { office_name: "나무건축사사무소", layer_map: { "A-MASS": "MASS-OUT" }, default_paper: "A3" as const, default_text_height_mm: 2.5, font_family: "Noto Sans KR" };
const JUDGMENT = judge(house, loadRulePack(pack)).result;
const FONT_DIR = new URL("../../../drafting/fonts/", import.meta.url);

/* ---------- 순수 로직 ---------- */

test("시트 목록 저장: 왕복, 깨진 값·추가 키·20장 초과·중복 id는 통째로 버린다", () => {
  const a = newSpec("site_plan", [], house, "A3");
  const b = newSpec("site_plan", [a], house, "A2");
  assert.equal(a.id, "site_plan-1");
  assert.equal(b.id, "site_plan-2");
  const ok = { engine_version: "1.0.0", specs: [a, b] };
  assert.deepEqual(parseStored(serializeStored(ok)), ok);
  assert.deepEqual(parseStored(null).specs, []);
  assert.deepEqual(parseStored("{").specs, []);
  assert.deepEqual(parseStored(JSON.stringify({ ...ok, extra: 1 })).specs, []);
  assert.deepEqual(parseStored(JSON.stringify({ engine_version: "1", specs: [a, a] })).specs, []);
  assert.deepEqual(parseStored(JSON.stringify({ engine_version: "1", specs: [{ ...a, paper: "A0" }] })).specs, []);
  assert.deepEqual(parseStored(JSON.stringify({ engine_version: "1", specs: Array.from({ length: 21 }, (_, i) => ({ ...a, id: `s${i}` })) })).specs, []);
  assert.deepEqual(parseStored(JSON.stringify({ engine_version: 5, specs: [] })).specs, []);
  assert.deepEqual(parseStored("x".repeat(300_000)).specs, []);
});

test("평면 개략도: 실 배치가 있는 층만, 새 시트는 첫 층, 이름에 층 표시", () => {
  const floors = layoutFloors(house);
  assert.deepEqual(floors.map((f) => f.label), ["1F", "2F"]);
  const fp = newSpec("floor_plan", [], house, "A3");
  assert.equal(fp.floor_id, "f1");
  assert.equal(sheetName(fp, [fp], house), "1F 평면");
});

test("입력 누락(AR050)과 지원 여부: 빈 모델은 대지·매스, 일조사선 단면은 아직 만들 수 없다", () => {
  assert.deepEqual(missingInputs(house, "site_plan"), []);
  const empty = { ...house, site: { ...house.site, boundary: { outer: [] } }, masses: [] } as typeof house;
  assert.deepEqual(missingInputs(empty, "site_plan").map((m) => m.id), ["site", "mass"]);
  assert.deepEqual(missingInputs({ ...house, floor_layouts: [] }, "floor_plan").map((m) => m.id), ["layout"]);
  assert.equal(kindSupport("site_plan").ok, true);
  assert.equal(kindSupport("sunlight_section").ok, false);
  assert.equal(nextPaper("A3"), "A2");
  assert.equal(nextPaper("A1"), null);
  assert.equal(parseModel("{").ok, false);
  assert.equal(parseModel(JSON.stringify(house)).ok, true);
});

test("권리 → 화면: 열람은 모든 상태에서 허용, 만료는 읽기 전용 + 체험판 표시 유지, 판정 실패는 닫힘", () => {
  const ALLOW = { allowed: true } as const;
  const active = { state: "active", offlineValidUntil: null } as const;
  // 유료 활성: 체험판 표시 없음
  assert.deepEqual(
    (({ edit, exportState, watermark, viewOnly }) => ({ edit, exportState, watermark, viewOnly }))(sheetAccess(ALLOW, ALLOW, active, "sub_monthly")),
    { edit: true, exportState: "allowed", watermark: false, viewOnly: false },
  );
  // 체험(서버 플랜 trial) / 라이선스 없음: 표시 있음
  assert.equal(sheetAccess(ALLOW, ALLOW, active, "trial").watermark, true);
  assert.equal(sheetAccess(ALLOW, ALLOW, { state: "none", offlineValidUntil: null }, null).watermark, true);
  // 만료: 편집 불가, 내보내기 가능, 표시 유지, 안내 문구
  const expired = sheetAccess({ allowed: false, reason: "expired" }, ALLOW, { state: "expired", offlineValidUntil: null }, null);
  assert.equal(expired.edit, false);
  assert.equal(expired.viewOnly, true);
  assert.equal(expired.exportState, "allowed");
  assert.equal(expired.watermark, true);
  assert.match(expired.editReason ?? "", /마지막으로 만든 시트는 다시 내보낼 수 있고/);
  // 판정 전: 대기. 상태를 모르면 표시를 켠다(실패 닫힘)
  const pending = sheetAccess(undefined, undefined, undefined, null);
  assert.equal(pending.editPending, true);
  assert.equal(pending.exportState, "pending");
  assert.equal(pending.watermark, true);
  // view_export 거부(권한 확인 실패)는 막고 이유를 보인다
  const denied = sheetAccess(ALLOW, { allowed: false, reason: "unverified" }, active, null);
  assert.equal(denied.exportState, "denied");
  assert.match(denied.exportReason ?? "", /권한/);
});

test("응답 해석: 내 req_id만, superseded·오류 코드·형식 오류", () => {
  assert.deepEqual(readBuildResponse({ req_id: "x", ok: true }, "r"), { kind: "ignore" });
  assert.deepEqual(readBuildResponse({ req_id: "r", status: "superseded" }, "r"), { kind: "superseded" });
  assert.deepEqual(readBuildResponse({ req_id: "r", ok: false, code: "AR051", detail: "d" }, "r"), { kind: "error", code: "AR051" });
  assert.deepEqual(readBuildResponse({ req_id: "r", ok: true, result: { sheet: {}, svg_preview: "<svg" }, engine_version: "1" }, "r"), { kind: "error", code: "invalid_response" });
  const bytes = new Uint8Array([1, 2]).buffer;
  assert.equal(readWriteResponse({ req_id: "r", ok: true, result: { files: [{ name: "a/b.dxf", bytes }] } }, "r").kind, "error");
  assert.equal(readWriteResponse({ req_id: "r", ok: true, result: { files: [{ name: "a.dxf", bytes: new ArrayBuffer(0) }] } }, "r").kind, "error");
  const ok = readWriteResponse({ req_id: "r", ok: true, result: { files: [{ name: "a.dxf", bytes, width_px: 10 }], warnings: [{ code: "AR057", detail: "d" }] } }, "r");
  assert.equal(ok.kind, "ok");
  assert.equal(fileCount(["dxf", "pdf", "svg", "png"], 3), 10);
  assert.equal(fileCount(["pdf"], 0), 0);
  for (const c of ["AR050", "AR051", "AR052", "AR055", "AR056", "BUSY", "NOT_SUPPORTED", "CANCELLED", "TIMEOUT", "zzz"]) assert.ok(outputErrorText(c, "pdf").length > 5);
  assert.match(outputErrorText("AR056", "pdf"), /PDF를 만들지 못했습니다\. DXF·SVG는 따로 내보낼 수 있습니다/);
});

test("sheet 레인 seq는 화면이 달라도 단조 증가", () => {
  const a = nextSheetSeq();
  const b = nextSheetSeq();
  assert.ok(b > a);
});

/* ---------- 실제 워커 핸들러 통합 ---------- */

function loadAssets(): Promise<DraftingAssets> {
  return Promise.resolve({
    font: { family: "NotoSansKR", ttf: new Uint8Array(readFileSync(new URL("NotoSansKR-Regular.subset.ttf", FONT_DIR))) },
    metrics: JSON.parse(readFileSync(new URL("NotoSansKR.metrics.json", FONT_DIR), "utf8")),
  });
}

function makeEngine(withAssets = true) {
  const listeners = new Set<(r: unknown) => void>();
  const sent: Array<{ op: string; format?: string }> = [];
  const rt = new WorkerRuntime({
    lanes: ["sheet", "export", "import"],
    ...createDraftingHandlers(withAssets ? { loadAssets } : {}),
    post: (m) => {
      for (const l of [...listeners]) l(m);
    },
    now: () => 0,
    yieldFn: () => new Promise((r) => setTimeout(r, 0)),
    log: () => {},
  });
  return {
    sent,
    send(req: { op: string; req_id: string }) {
      const parsed = parseRequest(req);
      if (!parsed.ok) throw new Error("envelope");
      sent.push({ op: req.op, ...("format" in req ? { format: (req as { format: string }).format } : {}) });
      rt.receive(req);
    },
    subscribe(l: (r: unknown) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function inputFor(kind: "site_plan" | "area_plan" | "floor_plan", watermark = false): SheetInput {
  const sheet = newSpec(kind, [], house, "A3");
  return {
    model: house,
    judgment: JUDGMENT,
    sheet,
    profile: PROFILE,
    license: { drafting_watermark: watermark },
    engine_version: "pending",
    project_name: "한남동 주택",
    date: "2026-10-29",
  };
}

test("미리보기 = 직접 writeSvg(buildSheet(...)) 와 같은 바이트(폭 표 포함), 두 번 만들어도 같고 엔진 버전은 워커가 정한다", async () => {
  const engine = makeEngine();
  const builder = createSheetBuilder(engine as never);
  const input = inputFor("site_plan");
  const r = await builder.build(input);
  assert.ok(r.ok, r.ok ? "" : r.code);
  const again = createSheetBuilder(makeEngine() as never);
  const r2 = await again.build(input);
  assert.ok(r2.ok);
  assert.equal(r.built.svg, r2.built.svg);
  assert.equal(r.built.engineVersion, ENGINE_VERSION);
  // 직접 호출과 비교
  const assets = await loadAssets();
  const direct = { ...input, engine_version: ENGINE_VERSION };
  const view = buildSitePlanView(direct as never, {});
  const built = buildSheet(direct as never, view);
  assert.equal(r.built.svg, writeSvg(built.sheet, { metrics: assets.metrics }));
  assert.equal(r.built.summary.title_block.sheet_title, "배치도");
  assert.match(r.built.svg, /기획설계 검토용 자료이며 인허가 설계도서가 아닙니다/);
  // 캐시: 같은 입력은 워커를 다시 부르지 않는다
  const before = engine.sent.length;
  await builder.build(input);
  assert.equal(engine.sent.length, before);
});

test("체험판 표시는 워터마크 입력일 때만 SVG에 들어가고, 고지는 항상 들어간다", async () => {
  const builder = createSheetBuilder(makeEngine() as never);
  const plain = await builder.build(inputFor("site_plan", false));
  const trial = await builder.build(inputFor("site_plan", true));
  assert.ok(plain.ok && trial.ok);
  assert.equal(plain.built.svg.includes("체험판"), false);
  assert.equal(trial.built.svg.includes("체험판"), true);
  assert.equal(trial.built.summary.title_block.watermark, true);
});

test("여러 시트를 동시에 요청해도 큐가 하나씩 보내 모두 완료된다(최신만 유효 레인에서 앞 요청이 버려지지 않는다)", async () => {
  const builder = createSheetBuilder(makeEngine() as never);
  const rs = await Promise.all([builder.build(inputFor("site_plan")), builder.build(inputFor("area_plan")), builder.build(inputFor("floor_plan"))]);
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(rs.map((r) => (r.ok ? r.built.summary.title_block.sheet_title : "")), ["배치도", "면적 산정도", "평면 개략도"]);
});

test("입력이 틀리면 AR050, 실이 겹치면 AR051로 만들지 않는다", async () => {
  const builder = createSheetBuilder(makeEngine() as never);
  const bad = await builder.build({ ...inputFor("site_plan"), model: { ...house, masses: [] } });
  assert.deepEqual(bad, { ok: false, code: "AR050" });
  const layout = house.floor_layouts.map((l) => (l.floor_id === "f1" ? { ...l, rooms: l.rooms.map((r) => ({ ...r, polygon: { outer: [[-9000, -9000], [-8000, -9000], [-8000, -8000], [-9000, -8000]] as [number, number][] } })) } : l));
  const overlap = await builder.build({ ...inputFor("floor_plan"), model: { ...house, floor_layouts: layout } });
  assert.deepEqual(overlap, { ok: false, code: "AR051" });
  assert.equal(designModelV1Schema.safeParse(house).success, true);
});

test("엔진이 없으면 ENGINE_UNAVAILABLE", async () => {
  assert.deepEqual(await createSheetBuilder(null).build(inputFor("site_plan")), { ok: false, code: "ENGINE_UNAVAILABLE" });
});

async function builtSheets(engine: ReturnType<typeof makeEngine>): Promise<unknown[]> {
  const builder = createSheetBuilder(engine as never);
  const out: unknown[] = [];
  for (const k of ["site_plan", "area_plan"] as const) {
    const r = await builder.build(inputFor(k));
    assert.ok(r.ok);
    out.push(r.built.sheet);
  }
  return out;
}

function deps(engine: ReturnType<typeof makeEngine>, over: Partial<ExportDeps> = {}) {
  const saved: Array<{ format: string; bytes: Uint8Array }> = [];
  let n = 0;
  const d: ExportDeps = {
    engine: engine as never,
    files: {
      save: async (format, bytes) => {
        saved.push({ format, bytes });
        return {};
      },
    },
    rasterizer: { rasterize: async (svg, o) => new TextEncoder().encode(`PNG:${o.widthPx}:${svg.length}`) },
    newReqId: () => `export-${++n}`,
    ...over,
  };
  return { d, saved };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

test("내보내기: DXF·PDF(묶음 1파일)·SVG·PNG 4형식을 만들어 저장 — 시트 2장 → 파일 7개, 형식 순서 고정", async () => {
  const engine = makeEngine();
  const sheets = await builtSheets(engine);
  const { d, saved } = deps(engine);
  const progress: string[] = [];
  const out = await runExport({ formats: ["png", "svg", "pdf", "dxf"], sheets, layerMap: PROFILE.layer_map, projectName: "한남동 주택", date: "2026-10-29" }, d, (p) => progress.push(`${p.format}:${p.phase}`));
  assert.equal(out.saved, 7);
  assert.deepEqual(out.failures, []);
  assert.deepEqual(saved.map((s) => s.format), ["dxf", "dxf", "pdf", "svg", "svg", "png", "png"]);
  assert.ok(text(saved[0]!.bytes).includes("AC1027"));
  assert.ok(text(saved[0]!.bytes).includes("MASS-OUT"), "사무소 레이어 이름");
  assert.ok(text(saved[2]!.bytes.subarray(0, 5)) === "%PDF-");
  assert.ok(text(saved[3]!.bytes).startsWith("<svg"));
  assert.match(text(saved[5]!.bytes), /^PNG:2480:/, "A3 가로 150dpi 폭");
  assert.ok(progress.includes("dxf:make") && progress.includes("png:save"));
  assert.equal(engine.sent.filter((s) => s.op === "write").length, 4);
});

test("내보내기 결정성: 같은 입력 → 같은 바이트(DXF·PDF·SVG), 표준 이름이면 사무소 이름이 없다", async () => {
  const run = async (layerMap: Record<string, string>) => {
    const engine = makeEngine();
    const sheets = await builtSheets(engine);
    const { d, saved } = deps(engine);
    await runExport({ formats: ["dxf", "pdf", "svg"], sheets, layerMap, projectName: "p", date: "2026-10-29" }, d);
    return saved;
  };
  const a = await run(PROFILE.layer_map);
  const b = await run(PROFILE.layer_map);
  assert.equal(a.length, b.length);
  a.forEach((f, i) => assert.deepEqual(f.bytes, b[i]!.bytes, `${f.format}#${i}`));
  const std = await run({});
  assert.equal(text(std[0]!.bytes).includes("MASS-OUT"), false);
});

test("PNG 입력 SVG는 writers/png 의 골든 경로(buildPngSvg)와 같다 — 같은 SVG를 래스터화기에 넘긴다", async () => {
  const engine = makeEngine();
  const sheets = await builtSheets(engine);
  let seen = "";
  const { d } = deps(engine, {
    rasterizer: {
      rasterize: async (svg) => {
        seen ||= svg;
        return new Uint8Array([1]);
      },
    },
  });
  await runExport({ formats: ["png"], sheets: [sheets[0]], layerMap: {}, projectName: "p", date: "2026-10-29" }, d);
  const assets = await loadAssets();
  const direct = writePng(sheets[0] as never, { dpi: 150, metrics: assets.metrics });
  const header = direct.bytes.subarray(0, 8);
  assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(seen, buildPngSvg(sheets[0] as never, assets.metrics));
  assert.equal(direct.width_px, 2480);
});

test("형식 하나가 실패해도 나머지는 계속한다(PNG 변환기 없음 → NOT_SUPPORTED, 래스터화 BUSY)", async () => {
  const engine = makeEngine();
  const sheets = await builtSheets(engine);
  const none = deps(engine, { rasterizer: undefined });
  const a = await runExport({ formats: ["dxf", "png"], sheets, layerMap: {}, projectName: "p", date: "2026-10-29" }, none.d);
  assert.equal(a.saved, 2);
  assert.deepEqual(a.failures, [{ format: "png", code: "NOT_SUPPORTED" }]);
  const busy = deps(engine, {
    rasterizer: {
      rasterize: async () => {
        throw Object.assign(new Error("x"), { name: "BridgeError", code: "BUSY" });
      },
    },
  });
  const b = await runExport({ formats: ["png", "svg"], sheets, layerMap: {}, projectName: "p", date: "2026-10-29" }, busy.d);
  assert.deepEqual(b.failures, [{ format: "png", code: "BUSY" }]);
  assert.equal(b.saved, 2);
});

test("PDF 글꼴 자산이 없으면 AR056(다른 형식은 계속), 취소는 거기서 멈추고, 쓰기 실패 AR052는 멈춘다", async () => {
  const noAssets = makeEngine(false);
  const sheets = await builtSheets(makeEngine());
  const a = deps(noAssets);
  const r = await runExport({ formats: ["pdf", "svg"], sheets, layerMap: {}, projectName: "p", date: "2026-10-29" }, a.d);
  assert.deepEqual(r.failures, [{ format: "pdf", code: "AR056" }]);
  assert.equal(r.saved, 2);

  const engine = makeEngine();
  const bridge = (code: string) => Object.assign(new Error("x"), { name: "BridgeError", code });
  let calls = 0;
  const cancel = deps(engine, {
    files: {
      save: async () => {
        calls++;
        if (calls === 2) throw bridge("CANCELLED");
        return {};
      },
    },
  });
  const c = await runExport({ formats: ["dxf", "svg"], sheets, layerMap: {}, projectName: "p", date: "2026-10-29" }, cancel.d);
  assert.equal(c.canceled, true);
  assert.equal(c.saved, 1);
  assert.equal(calls, 2);

  const disk = deps(engine, {
    files: {
      save: async () => {
        throw bridge("AR052");
      },
    },
  });
  const e = await runExport({ formats: ["dxf", "svg"], sheets, layerMap: {}, projectName: "p", date: "2026-10-29" }, disk.d);
  assert.deepEqual(e.failures, [{ format: "dxf", code: "AR052" }]);
  assert.equal(e.saved, 0);
});

test("엔진이 시간 안에 답하지 않으면 TIMEOUT", async () => {
  const silent = { send() {}, subscribe: () => () => {} };
  const out = await runExport(
    { formats: ["dxf"], sheets: [{}], layerMap: {}, projectName: "p", date: "2026-10-29" },
    { engine: silent as never, files: { save: async () => ({}) }, newReqId: () => "r", timeoutMs: 20 },
  );
  assert.deepEqual(out.failures, [{ format: "dxf", code: "TIMEOUT" }]);
});

test("없는 글자(부분 집합 밖)는 PDF·PNG 쓰기에서 AR057 경고로 모은다", async () => {
  const engine = makeEngine();
  const builder = createSheetBuilder(engine as never);
  const input = inputFor("site_plan");
  input.project_name = "龘龘 주택"; // 한자 부분 집합 밖
  const r = await builder.build(input);
  assert.ok(r.ok);
  const { d } = deps(engine);
  const out = await runExport({ formats: ["png", "pdf"], sheets: [r.built.sheet], layerMap: {}, projectName: "p", date: "2026-10-29" }, d);
  assert.ok(out.warnings.some((w) => w.code === "AR057"), JSON.stringify(out.warnings));
});

/* ---------- 도면 주석 편집층(AR-06-086) ---------- */

test("저장 키 v2, v1은 이행해 읽기만(지우지 않음): 시트·주석 1건이 틀려도 그 항목만 버리고 개수 보고", () => {
  assert.equal(storeKey("p1"), "arch.sheets.v2.p1");
  assert.equal(legacyStoreKey("p1"), "arch.sheets.v1.p1");
  const a = { ...newSpec("site_plan", [], house, "A3") } as Record<string, unknown>;
  delete a.annotations;
  const v1 = JSON.stringify({
    engine_version: "1.0.0",
    specs: [
      { ...a, annotation_overrides: [{ target: "label:road:edge0", dx_mm: 1.25 }, { target: "note:1", text: "메모", dx_mm: 30, dy_mm: 50 }, { target: 3 }] },
      { ...a, id: "site_plan-2", paper: "A0", annotation_overrides: [] },
      { ...a, id: "site_plan-3", annotation_overrides: [] },
    ],
  });
  const m = parseStoredV1(v1);
  assert.equal(m.dropped, 2);
  assert.deepEqual(m.stored.specs.map((x) => x.id), ["site_plan-1", "site_plan-3"]);
  assert.deepEqual(m.stored.specs[0]?.annotations, [
    { id: "ov-label:road:edge0", kind: "override", target: "label:road:edge0", dx_mm: 1.25 },
    { id: "ov-note:1", kind: "text", dx_mm: 30, dy_mm: 50, text: "메모" },
  ]);
  // v1 형식을 v2 파서에 넣으면 통째로 거부(v2는 엄격).
  assert.deepEqual(parseStored(v1).specs, []);
  const store: Record<string, string> = { [legacyStoreKey("p1")]: v1 };
  const r = readStoredSheets((k) => store[k] ?? null, "p1");
  assert.equal(r.migrated, true);
  assert.equal(r.stored.specs.length, 2);
  store[storeKey("p1")] = serializeStored({ engine_version: null, specs: [] });
  assert.deepEqual(readStoredSheets((k) => store[k] ?? null, "p1"), { stored: { engine_version: null, specs: [] }, migrated: false, dropped: 0 });
  assert.ok(store[legacyStoreKey("p1")] === v1);
});

test("워커 응답의 unapplied(고아 포함)를 BuiltSheet로 전달, 형식이 틀린 항목은 버린다", async () => {
  const input = inputFor("site_plan");
  input.sheet = {
    ...input.sheet,
    annotations: [
      { id: "u-gone", kind: "text", anchor: { ref: "no-such", part: "center", snap: [0, 0] }, dx_mm: 0, dy_mm: 0, text: "고아" },
      { id: "ov-dim:none", kind: "override", target: "dim:none", dx_mm: 1 },
    ],
  };
  const r = await createSheetBuilder(makeEngine() as never).build(input);
  assert.ok(r.ok, r.ok ? "" : r.code);
  assert.deepEqual(r.built.unapplied, [
    { id: "ov-dim:none", reason: "missing_target" },
    { id: "u-gone", reason: "orphan_missing" },
  ]);
  const odd = readBuildResponse({ req_id: "r", ok: true, engine_version: "1", result: { sheet: r.built.sheet, svg_preview: "<svg/>", unapplied: [{ id: 1 }, { id: "a", reason: "orphan_index" }] } }, "r");
  assert.ok(odd.kind === "ok");
  assert.deepEqual(odd.built.unapplied, [{ id: "a", reason: "orphan_index" }]);
});

test("내보내기 안내: 고른 시트의 고아 수 합(모르는 시트는 0), 0이면 문구 없음(막지 않음)", () => {
  assert.equal(orphanNotice({ s1: 2, s2: 1 }, ["s1", "s2", "s3"]), "고아 주석 3개는 출력에서 빠집니다.");
  assert.equal(orphanNotice({ s1: 2 }, ["s2"]), null);
  assert.equal(orphanNotice(undefined, ["s1"]), null);
});
