// 로고 Storage 읽기: Content-Type 확인·크기 선확인·상한까지만 읽고 끊기·download 서명(리뷰 #2·#3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectPng, LOGO_MAX_BYTES } from "./png.ts";
import { supabaseLogoStorage } from "./supabase-repo.ts";
import { pngBytes } from "./test-helpers.ts";

const PATH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc/arch/drafting-logo/99999999-9999-4999-8999-999999999999.png";

function setup(response: () => Response) {
  const signCalls: { path: string; ttl: number; options: unknown }[] = [];
  const service = {
    storage: {
      from: () => ({
        async createSignedUrl(path: string, ttl: number, options: unknown) {
          signCalls.push({ path, ttl, options });
          return { data: { signedUrl: "https://proj.supabase.co/storage/v1/object/sign/x?token=t" }, error: null };
        },
      }),
    },
  };
  const storage = supabaseLogoStorage(service as never, (async () => response()) as unknown as typeof fetch);
  return { storage, signCalls };
}

test("읽기 서명 URL과 검사용 다운로드 모두 download(attachment) 옵션", async () => {
  const a = setup(() => new Response(new Blob([pngBytes() as BlobPart]), { headers: { "content-type": "image/png" } }));
  await a.storage.createSignedReadUrl(PATH, 600);
  await a.storage.read(PATH, LOGO_MAX_BYTES);
  assert.equal(a.signCalls.length, 2);
  for (const c of a.signCalls) assert.deepEqual(c.options, { download: true });
});

test("정상 PNG는 바이트 그대로, Content-Type 파라미터·대소문자 허용", async () => {
  const src = pngBytes();
  const r = setup(() => new Response(new Blob([src as BlobPart]), { headers: { "content-type": "Image/PNG; charset=binary" } }));
  assert.deepEqual(await r.storage.read(PATH, LOGO_MAX_BYTES), src);
});

test("image/png가 아니면(SVG·HTML·없음) 본문을 읽지 않고 검사 실패 값을 돌려준다", async () => {
  for (const type of ["image/svg+xml", "text/html", "application/octet-stream", ""]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(10)), cancel: () => void (cancelled = true) });
    const r = setup(() => new Response(body, { headers: type ? { "content-type": type } : {} }));
    const out = await r.storage.read(PATH, LOGO_MAX_BYTES);
    assert.equal(inspectPng(out as Uint8Array).ok, false, type);
    assert.equal(cancelled, true, type);
  }
});

test("Content-Length가 상한 초과면 본문을 받지 않고 too_large", async () => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({ pull: (c) => (pulled++, c.enqueue(new Uint8Array(10))) });
  const r = setup(() => new Response(body, { headers: { "content-type": "image/png", "content-length": String(LOGO_MAX_BYTES + 1) } }));
  const out = await r.storage.read(PATH, LOGO_MAX_BYTES);
  assert.deepEqual(inspectPng(out as Uint8Array), { ok: false, reason: "too_large" });
  assert.ok(pulled <= 1, `pulled ${pulled}`);
});

test("Content-Length를 속이거나 없어도 상한 + 1바이트에서 끊는다(무한 스트림)", async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(256 * 1024));
    },
    cancel: () => void (cancelled = true),
  });
  const r = setup(() => new Response(body, { headers: { "content-type": "image/png", "content-length": "100" } }));
  const out = await r.storage.read(PATH, LOGO_MAX_BYTES);
  assert.deepEqual(inspectPng(out as Uint8Array), { ok: false, reason: "too_large" });
  assert.equal(cancelled, true);
  assert.ok(pulled <= 6, `pulled ${pulled}`);
});

test("객체 없음(404) -> null, 서명 실패 -> null", async () => {
  assert.equal(await setup(() => new Response("nf", { status: 404 })).storage.read(PATH, LOGO_MAX_BYTES), null);
  const failing = supabaseLogoStorage(
    { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error("x") }) }) } } as never,
    (async () => {
      throw new Error("no fetch");
    }) as unknown as typeof fetch,
  );
  assert.equal(await failing.read(PATH, LOGO_MAX_BYTES), null);
});
