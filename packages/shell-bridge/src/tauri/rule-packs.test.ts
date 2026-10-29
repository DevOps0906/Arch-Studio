// AR-06-042: 설치형 RulePackStore(IPC 계약·실패 닫힘)와 내려받기(출처·크기·스트림 상한) 테스트.
// 실제 서명·해시·자격·롤백 판정은 src-tauri `cargo test`(tests/rule_pack.rs)가 확인한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRulePackUrl, downloadAndInstallRulePack, fetchRulePackText, RulePackDownloadFailure, type FetchedResponse, type RulePackFetch } from "../adapters/rule-packs.ts";
import { createTauriAdapters } from "./adapters.ts";
import type { InvokeFn } from "./invoke.ts";
import { TauriRulePackStore } from "./rule-packs.ts";

const ORIGIN = "https://proj.supabase.co";
const URL_OK = `${ORIGIN}/storage/v1/object/sign/arch-releases/rule-packs/2026.10.0/pack.json?token=t`;

function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++] as Uint8Array);
      else c.close();
    },
  });
}

function fetchOf(chunks: Uint8Array[], headers: Record<string, string> = {}, ok = true): { fn: RulePackFetch; calls: unknown[] } {
  const calls: unknown[] = [];
  const fn: RulePackFetch = async (url, init) => {
    calls.push([url, init]);
    const res: FetchedResponse = { ok, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, body: stream(chunks) };
    return res;
  };
  return { fn, calls };
}

const enc = (s: string) => new TextEncoder().encode(s);

test("다운로드 URL: https·설정된 저장소 출처만(P5)", () => {
  assert.equal(assertRulePackUrl(URL_OK, ORIGIN).host, "proj.supabase.co");
  for (const bad of [
    "http://proj.supabase.co/x",
    "https://evil.example/x",
    "https://proj.supabase.co.evil.example/x",
    "https://user:pw@proj.supabase.co/x",
    "file:///etc/passwd",
    "not a url",
  ]) {
    assert.throws(() => assertRulePackUrl(bad, ORIGIN), RulePackDownloadFailure, bad);
  }
  assert.throws(() => assertRulePackUrl(URL_OK, "http://proj.supabase.co"), RulePackDownloadFailure);
});

test("내려받기: 정확한 바이트 수, 스트림 상한에서 끊기, Content-Length 불일치·UTF-8 오류 거부(P6)", async () => {
  const body = '{"a":"가"}';
  const n = enc(body).byteLength;
  const ok = fetchOf([enc(body.slice(0, 3)), enc(body.slice(3))], { "content-length": String(n) });
  assert.equal(await fetchRulePackText(ok.fn, URL_OK, ORIGIN, n), body);
  assert.deepEqual((ok.calls[0] as unknown[])[1], { redirect: "error", credentials: "omit", cache: "no-store" });
  // 해제 후 바이트가 기대보다 많으면(압축 폭탄) 중단.
  let pulled = 0;
  const bomb: RulePackFetch = async () => ({
    ok: true,
    headers: { get: (h) => (h === "content-encoding" ? "gzip" : null) },
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024));
      },
    }),
  });
  await assert.rejects(fetchRulePackText(bomb, URL_OK, ORIGIN, 4096), (e: RulePackDownloadFailure) => e.reason === "too_large");
  assert.ok(pulled < 10, "상한 직후 읽기를 멈춘다");
  await assert.rejects(fetchRulePackText(fetchOf([enc(body)], { "content-length": "999" }).fn, URL_OK, ORIGIN, n), (e: RulePackDownloadFailure) => e.reason === "size_mismatch");
  await assert.rejects(fetchRulePackText(fetchOf([enc("{}")]).fn, URL_OK, ORIGIN, n), (e: RulePackDownloadFailure) => e.reason === "size_mismatch");
  await assert.rejects(fetchRulePackText(fetchOf([new Uint8Array([0xff, 0xfe])]).fn, URL_OK, ORIGIN, 2), (e: RulePackDownloadFailure) => e.reason === "not_utf8");
  await assert.rejects(fetchRulePackText(fetchOf([], {}, false).fn, URL_OK, ORIGIN, 2), (e: RulePackDownloadFailure) => e.reason === "http_error");
  await assert.rejects(fetchRulePackText(ok.fn, URL_OK, ORIGIN, 9 * 1024 * 1024), (e: RulePackDownloadFailure) => e.reason === "too_large");
  // BOM은 지우지 않는다(바이트 그대로 Rust 해시와 맞아야 한다).
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
  assert.equal(await fetchRulePackText(fetchOf([bom]).fn, URL_OK, ORIGIN, 5), "﻿{}");
});

test("tauri RulePackStore: 명령 이름·인자, 알려진 상태만 받고 모양이 틀리면 실패 닫힘", async () => {
  const calls: [string, unknown][] = [];
  let reply: unknown = { state: "ok", pack: { version: "2026.10.0", sha256: "a".repeat(64), basis_date: "2026-10-14", published_at: "2026-10-20T00:00:00Z", text: "{}" } };
  const invoke: InvokeFn = async (cmd, args) => {
    calls.push([cmd, args]);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const s = new TauriRulePackStore(invoke);
  const ok = await s.load("LIC");
  assert.equal(ok.state, "ok");
  assert.equal(ok.state === "ok" && ok.pack.basisDate, "2026-10-14");
  assert.deepEqual(calls[0], ["rule_pack_load", { licenseFile: "LIC" }]);
  for (const r of [{ state: "missing" }, { state: "not_entitled" }, { state: "invalid" }]) {
    reply = r;
    assert.equal((await s.load(null)).state, r.state);
  }
  for (const r of [null, { state: "valid" }, { state: "ok", pack: { version: "../x" } }, { state: "ok" }, new Error("ipc")]) {
    reply = r;
    assert.equal((await s.load(null)).state, "invalid", JSON.stringify(r));
  }
  reply = { state: "installed", version: "2026.10.0" };
  assert.deepEqual(await s.install(null, "M", "P"), { state: "installed", version: "2026.10.0" });
  assert.deepEqual(calls.at(-1), ["rule_pack_install", { licenseFile: null, signedManifest: "M", pack: "P" }]);
  reply = { state: "rooted" };
  assert.equal((await s.install(null, "M", "P")).state, "malformed");
  const before = calls.length;
  assert.equal((await s.install(null, "x".repeat(9000), "P")).state, "too_large");
  assert.equal(calls.length, before, "상한 초과는 IPC 전에 거부");
});

test("내려받기 → 설치, 설치형 어댑터에 rulePacks가 있다", async () => {
  const seen: unknown[] = [];
  const store = {
    load: async () => ({ state: "missing" as const }),
    install: async (lic: string | null, m: string, p: string) => {
      seen.push([lic, m, p]);
      return { state: "installed" as const, version: "2026.10.0" };
    },
  };
  const r = await downloadAndInstallRulePack({ ticket: { url: URL_OK, bytes: 2, signed_manifest: "SM" }, fetch: fetchOf([enc("{}")]).fn, allowedOrigin: ORIGIN, store, licenseFile: "L" });
  assert.equal(r.state, "installed");
  assert.deepEqual(seen, [["L", "SM", "{}"]]);
  assert.ok(createTauriAdapters(async () => null).rulePacks instanceof TauriRulePackStore);
});
