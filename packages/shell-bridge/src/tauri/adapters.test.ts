// 설치형 어댑터: 계약 하네스(invoke 모킹) + Rust 명령 이름·인자 계약 + 설치형 고유 방어.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BridgeError, createPlatformAdapters, createWebBridge, TAURI_CAPABILITIES } from "../index.ts";
import { createRustInvoke, runAdapterContract, testProjectId } from "../testing/index.ts";
import { errorSurface, TOKEN } from "../test-helpers.ts";
import { createTauriAdapters } from "./adapters.ts";
import { RASTER_QUEUE_LIMIT } from "./rasterizer.ts";

runAdapterContract("tauri", () => {
  const rust = createRustInvoke();
  return { adapters: createTauriAdapters(rust.invoke), files: rust.files };
});

test("tauri: 명령 이름·인자 모양이 Rust 계약(camelCase, input 래핑, 원시 본문+헤더)과 같다", async () => {
  const rust = createRustInvoke();
  const a = createTauriAdapters(rust.invoke);
  const id = testProjectId(1);
  await a.projects.save({
    id,
    name: "p",
    schemaVersion: 1,
    engineVersion: "0.1.0",
    designModel: "{}",
    expectedVersion: null,
  });
  await a.projects.list();
  await a.projects.open(id);
  await a.projects.delete(id, 1);
  rust.files.offerImport({ name: "a.dxf", size: 1 });
  await a.files.openImport("dxf");
  const body = new Uint8Array([1, 2, 3]);
  await a.files.save("dxf", body);
  assert.deepEqual(
    rust.calls.map((c) => c.cmd),
    [
      "local_db_save_project",
      "local_db_list_projects",
      "local_db_get_project",
      "local_db_delete_project",
      "fs_open_import",
      "export_save_file",
    ],
  );
  assert.deepEqual(rust.calls[0]!.args, {
    input: {
      id,
      name: "p",
      siteLabel: null,
      clientName: null,
      clientContact: null,
      schemaVersion: 1,
      engineVersion: "0.1.0",
      designModel: "{}",
      note: null,
      expectedVersion: null,
    },
  });
  assert.deepEqual(rust.calls[2]!.args, { id });
  assert.deepEqual(rust.calls[3]!.args, { id, expectedVersion: 1 });
  assert.deepEqual(rust.calls[4]!.args, { kind: "dxf" });
  assert.equal(rust.calls[5]!.args, body);
  assert.deepEqual(rust.calls[5]!.options, { headers: { "x-export-format": "dxf" } });
});

test("tauri: 입력 검사·상한 초과는 invoke 전에 거부(IPC로 값이 가지 않음)", async () => {
  const rust = createRustInvoke();
  const a = createTauriAdapters(rust.invoke);
  await assert.rejects(a.projects.open(TOKEN), BridgeError);
  await assert.rejects(a.projects.save({ id: testProjectId(1), name: "" } as never), BridgeError);
  await assert.rejects(a.files.save("dxf", new Uint8Array(20 * 1024 * 1024 + 1)), BridgeError);
  await assert.rejects(a.files.openImport("exe" as never), BridgeError);
  assert.deepEqual(rust.calls, []);
});

test("tauri: Rust 오류 detail(현재 version·경로·상한)은 버리고 코드만, 모르는 오류는 대체 코드", async () => {
  const leaky = async () => {
    throw { code: "VERSION_CONFLICT", detail: `7 ${TOKEN}` };
  };
  const a = createTauriAdapters(leaky);
  const id = testProjectId(1);
  const e1 = await a.projects.delete(id, 1).catch((e: unknown) => e);
  assert.ok(e1 instanceof BridgeError && e1.code === "VERSION_CONFLICT");
  assert.ok(!errorSurface(e1).includes("SECRET-TOKEN"));
  const b = createTauriAdapters(async () => {
    throw new Error(`C:/Users/kim/${TOKEN}.dxf: Permission denied`);
  });
  const e2 = await b.projects.list().catch((e: unknown) => e);
  assert.ok(e2 instanceof BridgeError && e2.code === "PROJECT_UNAVAILABLE");
  const e3 = await b.files.openImport("dxf").catch((e: unknown) => e);
  assert.ok(e3 instanceof BridgeError && e3.code === "READ_FAILED");
  const e4 = await b.files.save("pdf", new Uint8Array(1)).catch((e: unknown) => e);
  assert.ok(e4 instanceof BridgeError && e4.code === "AR052");
  for (const e of [e2, e3, e4]) assert.ok(!errorSurface(e).includes("SECRET-TOKEN"));
  // 다른 어댑터의 코드가 섞여 오면 버린다(가져오기 응답에 AR052가 오는 등).
  const c = createTauriAdapters(async () => {
    throw { code: "AR052", detail: "x" };
  });
  const e5 = await c.files.openImport("dxf").catch((e: unknown) => e);
  assert.ok(e5 instanceof BridgeError && e5.code === "READ_FAILED");
});

test("tauri: Rust가 상한보다 큰 바이트를 돌려줘도 TS가 다시 거부, 응답 모양이 틀리면 실패", async () => {
  const big = createTauriAdapters(async () => new ArrayBuffer(20 * 1024 * 1024 + 1));
  const e = await big.files.openImport("dxf").catch((x: unknown) => x);
  assert.ok(e instanceof BridgeError && e.code === "AR055");
  const odd = createTauriAdapters(async () => ({ path: "C:/x.dxf" }));
  const e2 = await odd.files.save("dxf", new Uint8Array(1)).catch((x: unknown) => x);
  assert.ok(e2 instanceof BridgeError && e2.code === "AR052");
  const e3 = await odd.files.openImport("dxf").catch((x: unknown) => x);
  assert.ok(e3 instanceof BridgeError && e3.code === "READ_FAILED");
  const e4 = await odd.projects.list().catch((x: unknown) => x);
  assert.ok(e4 instanceof BridgeError && e4.code === "PROJECT_UNAVAILABLE");
});

test("tauri: 엔타이틀먼트는 판정 근거(041·074) 전까지 실패 닫힘, 열람·내보내기만 허용", async () => {
  const { entitlement, capabilities } = createTauriAdapters(createRustInvoke().invoke);
  assert.equal(entitlement.license, null);
  assert.equal(capabilities.licenseActivation, false);
  assert.deepEqual(await entitlement.can("view_export"), { allowed: true });
  for (const f of ["desktop_edit", "web_edit", "ai_render", "ai_chat", "cloud_review"] as const) {
    assert.deepEqual(await entitlement.can(f), { allowed: false, reason: "unverified" }, f);
  }
});

test("createPlatformAdapters: Tauri 런타임이면 설치형, 아니면 주입된 웹 팩토리, 없으면 NOT_SUPPORTED", () => {
  const rust = createRustInvoke();
  const tauri = createPlatformAdapters({ scope: { __TAURI_INTERNALS__: {} }, invoke: rust.invoke });
  assert.equal(tauri.capabilities, TAURI_CAPABILITIES);
  assert.throws(
    () => createPlatformAdapters({ scope: {} }),
    (e: unknown) => e instanceof BridgeError && e.code === "NOT_SUPPORTED",
  );
  const marker = createTauriAdapters(rust.invoke);
  assert.equal(createPlatformAdapters({ scope: {}, web: () => marker }), marker);
  // 005 NativeBridge 4키는 그대로.
  assert.deepEqual(Object.keys(createWebBridge().capabilities), ["offline", "localFiles", "autoUpdate", "persistentSecrets"]);
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><title>SECRET-TOKEN-VALUE</title></svg>';

test("tauri rasterizer: 명령 이름 rasterize_svg, 인자 {svg, options}(검사한 키만), 원시 PNG 응답", async () => {
  const rust = createRustInvoke();
  const r = createTauriAdapters(rust.invoke).rasterizer!;
  const png = await r.rasterize(SVG, { widthPx: 840 });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  await r.rasterize(SVG, { dpi: 150 });
  assert.deepEqual(
    rust.calls.map((c) => c.cmd),
    ["rasterize_svg", "rasterize_svg"],
  );
  assert.deepEqual(rust.calls[0]!.args, { svg: SVG, options: { widthPx: 840 } });
  assert.deepEqual(rust.calls[1]!.args, { svg: SVG, options: { dpi: 150 } });
  assert.equal(rust.calls[0]!.options, undefined);
});

test("tauri rasterizer: 상한·옵션 오류는 invoke 전에 거부", async () => {
  const rust = createRustInvoke();
  const r = createTauriAdapters(rust.invoke).rasterizer!;
  await assert.rejects(r.rasterize("x".repeat(8 * 1024 * 1024 + 1), { widthPx: 10 }), BridgeError);
  await assert.rejects(r.rasterize(SVG, { widthPx: 10, dpi: 96 } as never), BridgeError);
  await assert.rejects(r.rasterize(SVG, {} as never), BridgeError);
  assert.deepEqual(rust.calls, []);
});

test("tauri rasterizer: Rust detail(SVG 조각)은 버리고 코드만, 모르는 오류·틀린 응답은 AR056", async () => {
  const leaky = createTauriAdapters(async () => {
    throw { code: "INVALID_INPUT", detail: `parse: ${TOKEN}` };
  }).rasterizer!;
  const e1 = await leaky.rasterize(SVG, { widthPx: 10 }).catch((e: unknown) => e);
  assert.ok(e1 instanceof BridgeError && e1.code === "INVALID_INPUT");
  assert.ok(!errorSurface(e1).includes("SECRET-TOKEN"));
  for (const [raw, code] of [
    [{ code: "AR052", detail: "x" }, "AR056"],
    [new Error(`C:/${TOKEN}.png`), "AR056"],
    [{ code: "BUSY", detail: "busy" }, "BUSY"],
    [{ code: "AR055", detail: "pixels" }, "AR055"],
  ] as const) {
    const r = createTauriAdapters(async () => {
      throw raw;
    }).rasterizer!;
    const e = await r.rasterize(SVG, { widthPx: 10 }).catch((x: unknown) => x);
    assert.ok(e instanceof BridgeError && e.code === code, String(code));
    assert.ok(!errorSurface(e).includes("SECRET-TOKEN"));
  }
  for (const bad of [null, { path: "C:/x.png" }, new Uint8Array([1, 2, 3]), [999]]) {
    const r = createTauriAdapters(async () => bad).rasterizer!;
    const e = await r.rasterize(SVG, { widthPx: 10 }).catch((x: unknown) => x);
    assert.ok(e instanceof BridgeError && e.code === "AR056", JSON.stringify(bad));
  }
  const huge = createTauriAdapters(async () => new ArrayBuffer(100 * 1024 * 1024 + 1)).rasterizer!;
  const e2 = await huge.rasterize(SVG, { widthPx: 10 }).catch((x: unknown) => x);
  assert.ok(e2 instanceof BridgeError && e2.code === "AR055");
});

test("tauri rasterizer: 동시 호출은 줄 세워 Rust BUSY를 피하고, 대기 상한을 넘으면 BUSY", async () => {
  const rust = createRustInvoke();
  rust.rasterDelayMs = 5;
  const r = createTauriAdapters(rust.invoke).rasterizer!;
  const many = Array.from({ length: RASTER_QUEUE_LIMIT }, () => r.rasterize(SVG, { widthPx: 10 }));
  const over = await r.rasterize(SVG, { widthPx: 10 }).catch((e: unknown) => e);
  assert.ok(over instanceof BridgeError && over.code === "BUSY");
  const done = await Promise.all(many);
  assert.equal(done.length, RASTER_QUEUE_LIMIT);
  // 앞 호출이 실패해도 줄이 멈추지 않는다.
  const bad = r.rasterize("<html/>", { widthPx: 10 }).catch((e: unknown) => e);
  const ok = r.rasterize(SVG, { widthPx: 10 });
  assert.ok((await bad) instanceof BridgeError);
  assert.ok((await ok) instanceof Uint8Array);
});
