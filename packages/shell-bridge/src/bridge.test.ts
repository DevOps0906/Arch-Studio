// NativeBridge·SecureStore: 같은 화면 코드를 웹 대체·Tauri(invoke 모킹) 양쪽에서 돌린다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import * as root from "./index.ts";
import {
  BridgeError,
  createNativeBridge,
  createTauriBridge,
  createWebBridge,
  MAX_SECRET_BYTES,
  MemorySecureStore,
  type NativeBridge,
  type SecretKey,
} from "./index.ts";
import { createKeychainInvoke, FakeExporter, FakeLicenseClient } from "./testing/index.ts";
import { errorSurface, spyConsole, spyWebStorage, TOKEN } from "./test-helpers.ts";

/** 화면 코드 흉내: 플랫폼 이름 없이 capabilities와 secrets만 쓴다. */
async function screenFlow(bridge: NativeBridge): Promise<{ restored: string | null; afterLogout: string | null }> {
  await bridge.secrets.set("auth.session", TOKEN);
  await bridge.secrets.set("auth.pkce", "verifier-123");
  const restored = await bridge.secrets.get("auth.session");
  await bridge.clearSecrets();
  const afterLogout = await bridge.secrets.get("auth.session");
  return { restored, afterLogout };
}

const variants: [string, () => NativeBridge][] = [
  ["web", () => createWebBridge()],
  ["tauri", () => createTauriBridge(createKeychainInvoke().invoke)],
];

for (const [name, make] of variants) {
  test(`${name}: 같은 화면 코드가 저장·복원·로그아웃 삭제까지 동작`, async () => {
    const storage = spyWebStorage();
    const out = spyConsole();
    try {
      const result = await screenFlow(make());
      assert.equal(result.restored, TOKEN);
      assert.equal(result.afterLogout, null);
    } finally {
      storage.restore();
      out.restore();
    }
    assert.deepEqual(storage.writes, []);
    assert.ok(!out.text().includes("SECRET-TOKEN"));
  });

  test(`${name}: 허용 밖 키·잘못된 값·상한 초과는 원문 없이 거부`, async () => {
    const { secrets } = make();
    for (const key of ["", "auth.session#0", "Auth.Session", "auth.session-user", TOKEN]) {
      const err = await secrets.get(key as SecretKey).catch((e: unknown) => e);
      assert.ok(err instanceof BridgeError);
      assert.equal(err.code, "SECRET_KEY_NOT_ALLOWED");
      assert.ok(!errorSurface(err).includes("SECRET-TOKEN"));
    }
    const big = await secrets.set("auth.session", TOKEN + "x".repeat(MAX_SECRET_BYTES)).catch((e: unknown) => e);
    assert.ok(big instanceof BridgeError && big.code === "SECRET_TOO_LARGE");
    assert.ok(!errorSurface(big).includes("SECRET-TOKEN"));
    const notString = await secrets.set("auth.session", 5 as unknown as string).catch((e: unknown) => e);
    assert.ok(notString instanceof BridgeError && notString.code === "SECRET_INVALID_VALUE");
    // 상한 정확히는 통과(다중 바이트 기준).
    await secrets.set("auth.session", "가".repeat(Math.floor(MAX_SECRET_BYTES / 3)));
  });
}

test("capabilities: 설치형은 영속 비밀·로컬 파일, 웹 대체는 둘 다 없음", () => {
  assert.equal(createTauriBridge(createKeychainInvoke().invoke).capabilities.persistentSecrets, true);
  assert.equal(createTauriBridge(createKeychainInvoke().invoke).capabilities.localFiles, true);
  assert.deepEqual(createWebBridge().capabilities, {
    offline: false,
    localFiles: false,
    autoUpdate: false,
    persistentSecrets: false,
  });
});

test("팩토리: Tauri 런타임이면 항상 키체인 구현, 아니면 웹 대체", async () => {
  const kc = createKeychainInvoke();
  const tauri = createNativeBridge({ scope: { __TAURI_INTERNALS__: {} }, invoke: kc.invoke });
  assert.equal(tauri.capabilities.persistentSecrets, true);
  await tauri.secrets.set("auth.session", TOKEN);
  assert.equal(kc.keychain.get("auth.session"), TOKEN);
  const web = createNativeBridge({ scope: {} });
  assert.equal(web.capabilities.persistentSecrets, false);
});

test("Tauri: 재시작(새 브리지) 후에도 키체인 값으로 복원", async () => {
  const keychain = new Map<string, string>();
  await createTauriBridge(createKeychainInvoke(keychain).invoke).secrets.set("auth.session", TOKEN);
  const restarted = createTauriBridge(createKeychainInvoke(keychain).invoke);
  assert.equal(await restarted.secrets.get("auth.session"), TOKEN);
  await restarted.clearSecrets();
  assert.equal(keychain.size, 0);
});

test("Tauri: 지연이 뒤섞여도 보낸 순서대로 적용(동시 갱신 경쟁)", async () => {
  let n = 0;
  const kc = createKeychainInvoke(new Map(), () => [30, 0, 15, 0][n++ % 4] ?? 0);
  const { secrets } = createTauriBridge(kc.invoke);
  const ops = [
    secrets.set("auth.session", "v1"),
    secrets.set("auth.session", "v2"),
    secrets.delete("auth.session"),
    secrets.set("auth.session", "v3"),
  ];
  const read = secrets.get("auth.session");
  await Promise.all(ops);
  assert.equal(await read, "v3");
  assert.deepEqual(
    kc.calls.map((c) => `${c.cmd}:${String(c.args.value ?? "")}`),
    ["secret_set:v1", "secret_set:v2", "secret_delete:", "secret_set:v3", "secret_get:"],
  );
});

test("Tauri: invoke 오류의 원 메시지(토큰 포함 가능)는 버리고 코드만 남김, 실패 뒤에도 대기열 계속", async () => {
  let fail = true;
  const invoke = async () => {
    if (fail) {
      fail = false;
      throw { code: "SECRET_UNAVAILABLE", detail: `keychain said ${TOKEN}` };
    }
    return null;
  };
  const { secrets } = createTauriBridge(invoke);
  const err = await secrets.set("auth.session", TOKEN).catch((e: unknown) => e);
  assert.ok(err instanceof BridgeError);
  assert.equal(err.code, "SECRET_UNAVAILABLE");
  assert.ok(!errorSurface(err).includes("SECRET-TOKEN"), errorSurface(err));
  assert.equal("cause" in err, false);
  // 알 수 없는 오류 모양(문자열 오류·Error)도 같은 처리.
  const { secrets: s2 } = createTauriBridge(async () => {
    throw new Error(`invalid args value ${TOKEN}`);
  });
  const err2 = await s2.get("auth.session").catch((e: unknown) => e);
  assert.ok(err2 instanceof BridgeError && err2.code === "SECRET_UNAVAILABLE");
  assert.ok(!errorSurface(err2).includes("SECRET-TOKEN"));
  // 첫 실패 뒤 다음 호출은 정상.
  assert.equal(await secrets.get("auth.session"), null);
});

test("Tauri: 로그아웃 삭제는 하나가 실패해도 나머지 키를 지운다", async () => {
  const kc = createKeychainInvoke(new Map([["auth.session", TOKEN], ["auth.pkce", "v"]]));
  let first = true;
  const bridge = createTauriBridge(async (cmd, args) => {
    if (first && cmd === "secret_delete") {
      first = false;
      throw { code: "SECRET_UNAVAILABLE" };
    }
    return kc.invoke(cmd, args);
  });
  await assert.rejects(bridge.clearSecrets(), BridgeError);
  assert.deepEqual([...kc.keychain.keys()], ["auth.session"]);
  await bridge.clearSecrets();
  assert.equal(kc.keychain.size, 0);
});

test("웹 대체: 메모리 저장소 값이 직렬화·inspect에 드러나지 않음", async () => {
  const store = new MemorySecureStore();
  await store.set("auth.session", TOKEN);
  const bridge = createWebBridge();
  await bridge.secrets.set("auth.session", TOKEN);
  for (const subject of [store, bridge, bridge.secrets, createTauriBridge(createKeychainInvoke().invoke)]) {
    assert.ok(!JSON.stringify(subject).includes("SECRET-TOKEN"));
    assert.ok(!inspect(subject, { depth: 10, showHidden: true }).includes("SECRET-TOKEN"));
  }
});

test("테스트 더블은 루트 index에서 내보내지 않음(릴리스 번들 유입 방지)", () => {
  const names = Object.keys(root);
  for (const banned of ["FakeExporter", "FakeLicenseClient", "createKeychainInvoke", "spyWebStorage", "TOKEN"]) {
    assert.ok(!names.includes(banned), banned);
  }
});

test("테스트 더블: Exporter·LicenseClient 계약", async () => {
  const exporter = new FakeExporter();
  const r = await exporter.save("dxf", new Uint8Array(10));
  assert.equal(r.bytes, 10);
  const tooBig = await exporter.save("dxf", new Uint8Array(20 * 1024 * 1024 + 1)).catch((e: unknown) => e);
  assert.ok(tooBig instanceof BridgeError && tooBig.code === "AR055");
  exporter.failWith = "CANCELLED";
  await assert.rejects(exporter.save("pdf", new Uint8Array(1)), (e: unknown) => e instanceof BridgeError && e.code === "CANCELLED");

  const serial = "ARCH-AAAA-BBBB-CCCC-12345";
  const license = new FakeLicenseClient([serial]);
  assert.equal((await license.status()).state, "none");
  const bad = await license.activate("ARCH-WRONG-SERIAL").catch((e: unknown) => e);
  assert.ok(bad instanceof BridgeError && bad.code === "LICENSE_INVALID");
  assert.ok(!errorSurface(bad).includes("WRONG"));
  const st = await license.activate(serial);
  assert.equal(st.serialSuffix, "12345");
  assert.ok(!JSON.stringify(st).includes("AAAA"));
  await license.deactivate();
  assert.equal((await license.status()).state, "none");
});
