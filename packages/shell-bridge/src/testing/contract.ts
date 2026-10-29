// 어댑터 5종 계약 하네스(AR-06-070). 같은 케이스를 설치형(`tauri/`, invoke 모킹)·웹(`web/`, 072)·메모리 더블에 돌린다.
//   runAdapterContract("web", () => ({ adapters: createWebAdapters(...), files: fixture }));
// 보안 결정(ADR-001·AR-06-005)도 계약에 포함한다: 오류에 값·경로·키 원문 없음, 크기 상한은 읽기·쓰기 전 거부, 허용 밖 비밀 키 거부.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { inspect } from "node:util";
import { CAPABILITY_KEYS } from "../adapters/capabilities.ts";
import { DENY_REASONS, ENTITLEMENT_FEATURES, type EntitlementFeature } from "../adapters/entitlement.ts";
import { BridgeError, type BridgeErrorCode } from "../adapters/errors.ts";
import { IMPORT_MAX_BYTES, type ImportKind } from "../adapters/file-gateway.ts";
import type { ExportFormat } from "../adapters/exporter.ts";
import type { PlatformAdapters } from "../adapters/index.ts";
import type { SaveProjectInput } from "../adapters/project-store.ts";
import { MAX_SECRET_BYTES, SECRET_KEYS, type SecretKey } from "../adapters/secure-store.ts";
import type { FileFixture } from "./files.ts";

export interface ContractSubject {
  readonly adapters: PlatformAdapters;
  /** 이 어댑터의 파일 대화상자·디스크 흉내(구현이 같은 fixture를 써야 한다). */
  readonly files: FileFixture;
}

export type ContractFactory = () => ContractSubject | Promise<ContractSubject>;

/** 누출 검사용 표식. 오류·결과·직렬화 어디에도 나오면 안 된다. */
export const LEAK = "SECRET-TOKEN-VALUE";
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${LEAK}.sig`;
const MIB = 1024 * 1024;

/** 결정적 UUIDv7(테스트용). */
export function testProjectId(n: number): string {
  return `0190a000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

function surface(value: unknown): string {
  const e = value as Error;
  let json = "";
  try {
    json = JSON.stringify(value);
  } catch {
    json = "";
  }
  return [String(value), e?.message, e?.stack, json, inspect(value, { depth: 6, showHidden: true })].join("\n");
}

/** `run`이 BridgeError(code)로 실패하고, 오류 어디에도 `secrets` 문자열이 없음을 확인. */
async function rejectsWith(run: () => Promise<unknown>, code: BridgeErrorCode, secrets: readonly string[] = [LEAK]) {
  const err = await run().then(
    () => assert.fail(`expected ${code}`),
    (e: unknown) => e,
  );
  assert.ok(err instanceof BridgeError, `BridgeError가 아님: ${String(err)}`);
  assert.equal(err.code, code);
  assert.equal("cause" in err, false, "cause 보존 금지");
  const s = surface(err);
  for (const v of secrets) assert.ok(!s.includes(v), `오류에 값 노출: ${v}`);
}

function input(n: number, patch: Partial<SaveProjectInput> = {}): SaveProjectInput {
  return {
    id: testProjectId(n),
    name: `프로젝트 ${n}`,
    siteLabel: "서울 마포구",
    schemaVersion: 1,
    engineVersion: "0.1.0",
    designModel: JSON.stringify({ site: { n }, note: "도면" }),
    expectedVersion: null,
    ...patch,
  };
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** 계약 케이스 전부를 node:test로 등록한다. `name`은 테스트 이름 접두. */
export function runAdapterContract(name: string, factory: ContractFactory): void {
  const t = (title: string, fn: (s: ContractSubject) => Promise<void> | void) =>
    test(`[계약:${name}] ${title}`, async () => fn(await factory()));

  // ---- capabilities -------------------------------------------------------------------------
  t("capabilities: 키 집합 고정·불리언·얼림, 어댑터 존재와 일치", ({ adapters }) => {
    const caps = adapters.capabilities;
    assert.deepEqual(Object.keys(caps).sort(), [...CAPABILITY_KEYS].sort());
    for (const k of CAPABILITY_KEYS) assert.equal(typeof caps[k], "boolean", k);
    assert.ok(Object.isFrozen(caps));
    assert.equal(adapters.updater !== null, caps.autoUpdate, "updater 존재 ⇔ autoUpdate");
    assert.equal(adapters.entitlement.license !== null, caps.licenseActivation, "license 존재 ⇔ licenseActivation");
    for (const k of ["projects", "files", "secrets", "entitlement"] as const) assert.ok(adapters[k], k);
  });

  // ---- ProjectStore -------------------------------------------------------------------------
  t("projects: 새로 저장 → 목록·열기 → expected_version으로 갱신", async ({ adapters: { projects } }) => {
    const first = await projects.save(input(1));
    assert.equal(first.version, 1);
    assert.match(first.sha256, /^[0-9a-f]{64}$/);
    const list = await projects.list();
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]!).sort(), ["id", "name", "siteLabel", "updatedAt", "version"]);
    const opened = await projects.open(testProjectId(1));
    assert.ok(opened);
    assert.equal(opened.version, 1);
    assert.equal(opened.designModel, input(1).designModel);
    assert.equal(opened.sha256, sha256(input(1).designModel));
    const second = await projects.save(input(1, { name: "이름 변경", expectedVersion: 1 }));
    assert.equal(second.version, 2);
    const reopened = await projects.open(testProjectId(1));
    assert.equal(reopened?.version, 2);
    assert.equal(reopened?.name, "이름 변경");
    assert.equal(reopened?.createdAt, opened.createdAt);
  });

  t("projects: version 충돌은 거절되고 저장되지 않음(오류에 값 없음)", async ({ adapters: { projects } }) => {
    await projects.save(input(2));
    await projects.save(input(2, { expectedVersion: 1 }));
    const stale = { designModel: JSON.stringify({ token: TOKEN }), name: `이름 ${LEAK}` };
    await rejectsWith(() => projects.save(input(2, { ...stale, expectedVersion: 1 })), "VERSION_CONFLICT");
    await rejectsWith(() => projects.save(input(2, { ...stale, expectedVersion: null })), "VERSION_CONFLICT");
    const now = await projects.open(testProjectId(2));
    assert.equal(now?.version, 2);
    assert.ok(!now?.designModel.includes(LEAK));
    await rejectsWith(() => projects.save(input(3, { expectedVersion: 1 })), "NOT_FOUND");
    assert.equal(await projects.open(testProjectId(3)), null);
  });

  t("projects: 삭제는 version 검사, 삭제 후 목록·열기에서 사라지고 다시 저장 불가", async ({ adapters: { projects } }) => {
    await projects.save(input(4));
    await rejectsWith(() => projects.delete(testProjectId(4), 2), "VERSION_CONFLICT");
    await projects.delete(testProjectId(4), 1);
    assert.equal(await projects.open(testProjectId(4)), null);
    assert.deepEqual(
      (await projects.list()).map((p) => p.id),
      [],
    );
    await rejectsWith(() => projects.delete(testProjectId(4), 1), "NOT_FOUND");
    await rejectsWith(() => projects.save(input(4)), "NOT_FOUND");
    await rejectsWith(() => projects.delete(testProjectId(99), 1), "NOT_FOUND");
  });

  t("projects: 잘못된 id·입력은 INVALID_INPUT(입력 원문 미포함)", async ({ adapters: { projects } }) => {
    const v4 = "0190a000-0000-4000-8000-000000000001";
    for (const id of ["", testProjectId(1).toUpperCase(), v4, `${testProjectId(1)}x`, TOKEN]) {
      const hidden = id ? [LEAK, id] : [LEAK];
      await rejectsWith(() => projects.open(id), "INVALID_INPUT", hidden);
      await rejectsWith(() => projects.delete(id, 1), "INVALID_INPUT", hidden);
    }
    const bad: Partial<SaveProjectInput>[] = [
      { id: TOKEN },
      { name: "  " },
      { name: "가".repeat(201) },
      { designModel: `[${JSON.stringify(TOKEN)}]` },
      { designModel: `{"broken": "${LEAK}"` },
      { schemaVersion: 0 },
      { engineVersion: "" },
      { expectedVersion: 0 },
      { siteLabel: "x".repeat(1001) },
    ];
    for (const patch of bad) await rejectsWith(() => projects.save(input(5, patch)), "INVALID_INPUT");
    assert.equal(await projects.open(testProjectId(5)), null);
    // 한도 정확히는 통과.
    assert.equal((await projects.save(input(5, { name: "가".repeat(200) }))).version, 1);
  });

  // ---- FileGateway --------------------------------------------------------------------------
  t("files: 열기는 고른 파일 바이트만 돌려주고, 취소는 CANCELLED", async ({ adapters: { files }, files: fx }) => {
    const bytes = new TextEncoder().encode("0\nSECTION\n");
    fx.offerImport({ name: `C:/Users/kim/${LEAK}/plan.DXF`, size: bytes.byteLength, bytes });
    const got = await files.openImport("dxf");
    assert.ok(got instanceof Uint8Array);
    assert.deepEqual([...got], [...bytes]);
    fx.offerImport(null);
    await rejectsWith(() => files.openImport("dxf"), "CANCELLED");
  });

  t("files: 상한 초과 파일은 읽기 전에 AR055(경로·크기 미포함), 상한 정확히는 통과", async ({ adapters: { files }, files: fx }) => {
    const cases: [ImportKind, number][] = [
      ["dxf", IMPORT_MAX_BYTES.dxf + 1],
      ["ifc", IMPORT_MAX_BYTES.ifc + 1],
      ["3dm", IMPORT_MAX_BYTES["3dm"] + 1],
    ];
    for (const [kind, size] of cases) {
      const before = fx.bytesRead();
      fx.offerImport({ name: `D:/${LEAK}/model.${kind}`, size });
      await rejectsWith(() => files.openImport(kind), "AR055", [LEAK, String(size)]);
      assert.equal(fx.bytesRead(), before, `${kind}: 상한 초과 파일을 읽음`);
    }
    assert.equal(IMPORT_MAX_BYTES.dxf, 20 * MIB);
    assert.equal(IMPORT_MAX_BYTES.ifc, 100 * MIB);
    assert.equal(IMPORT_MAX_BYTES["3dm"], 100 * MIB);
    fx.offerImport({ name: "edge.dxf", size: IMPORT_MAX_BYTES.dxf });
    assert.equal((await files.openImport("dxf")).byteLength, IMPORT_MAX_BYTES.dxf);
    // DXF 상한을 넘어도 IFC 상한 안이면 통과(종류별 상한).
    fx.offerImport({ name: "big.ifc", size: IMPORT_MAX_BYTES.dxf + 1 });
    assert.equal((await files.openImport("ifc")).byteLength, IMPORT_MAX_BYTES.dxf + 1);
  });

  t("files: 확장자가 종류와 다르거나 알 수 없는 종류면 INVALID_INPUT", async ({ adapters: { files }, files: fx }) => {
    fx.offerImport({ name: `${LEAK}.ifc`, size: 4 });
    await rejectsWith(() => files.openImport("dxf"), "INVALID_INPUT");
    fx.offerImport({ name: "setup.exe", size: 4 });
    await rejectsWith(() => files.openImport("dxf"), "INVALID_INPUT");
    await rejectsWith(() => files.openImport(LEAK as ImportKind), "INVALID_INPUT");
  });

  t("files: 저장 결과는 pathHash·bytes·sha256만(경로 원문 없음)", async ({ adapters: { files }, files: fx }) => {
    const data = new TextEncoder().encode("<svg/>");
    fx.setSaveTarget({ path: `C:/Users/${LEAK}/a.svg` });
    const r = await files.save("svg", data);
    assert.deepEqual(Object.keys(r).sort(), ["bytes", "pathHash", "sha256"]);
    assert.match(r.pathHash, /^[0-9a-f]{64}$/);
    assert.equal(r.bytes, data.byteLength);
    assert.equal(r.sha256, sha256(data));
    assert.ok(!surface(r).includes(LEAK));
    assert.deepEqual([...(fx.written.get(`C:/Users/${LEAK}/a.svg`) ?? [])], [...data]);
  });

  t("files: 저장 상한 초과·빈 본문·알 수 없는 형식은 쓰기 전에 거부, 취소·쓰기 실패 코드", async ({ adapters: { files }, files: fx }) => {
    const before = fx.written.size;
    await rejectsWith(() => files.save("dxf", new Uint8Array(20 * MIB + 1)), "AR055", [LEAK, String(20 * MIB)]);
    await rejectsWith(() => files.save("pdf", new Uint8Array(0)), "INVALID_INPUT");
    await rejectsWith(() => files.save(LEAK as ExportFormat, new Uint8Array(1)), "INVALID_INPUT");
    fx.setSaveTarget(null);
    await rejectsWith(() => files.save("pdf", new Uint8Array(1)), "CANCELLED");
    fx.setSaveTarget({ path: `E:/${LEAK}/x.png`, failWith: "AR052" });
    await rejectsWith(() => files.save("png", new Uint8Array(1)), "AR052");
    assert.equal(fx.written.size, before, "거부된 저장이 파일을 씀");
    // DXF 상한을 넘어도 IFC 상한 안이면 저장.
    fx.setSaveTarget({ path: "C:/m.ifc" });
    assert.equal((await files.save("ifc", new Uint8Array(20 * MIB + 1))).bytes, 20 * MIB + 1);
  });

  // ---- SecureStore --------------------------------------------------------------------------
  t("secrets: 허용 키 왕복·로그아웃 삭제", async ({ adapters }) => {
    await adapters.secrets.set("auth.session", TOKEN);
    await adapters.secrets.set("auth.pkce", "{}");
    assert.equal(await adapters.secrets.get("auth.session"), TOKEN);
    await adapters.clearSecrets();
    for (const k of SECRET_KEYS) assert.equal(await adapters.secrets.get(k), null);
  });

  t("secrets: 허용 밖 키·문자열 아닌 값·상한 초과는 원문 없이 거부", async ({ adapters: { secrets } }) => {
    for (const key of ["", "auth.session#0", "Auth.Session", "auth.session-user", "license.file", TOKEN]) {
      await rejectsWith(() => secrets.get(key as SecretKey), "SECRET_KEY_NOT_ALLOWED");
      await rejectsWith(() => secrets.set(key as SecretKey, TOKEN), "SECRET_KEY_NOT_ALLOWED");
    }
    await rejectsWith(() => secrets.set("auth.session", TOKEN + "x".repeat(MAX_SECRET_BYTES)), "SECRET_TOO_LARGE");
    await rejectsWith(() => secrets.set("auth.session", 5 as unknown as string), "SECRET_INVALID_VALUE");
  });

  // ---- EntitlementClient --------------------------------------------------------------------
  t("entitlement: 열람·내보내기는 항상 허용, 결정은 Allow/Deny(사유) 모양", async ({ adapters: { entitlement } }) => {
    assert.deepEqual(await entitlement.can("view_export"), { allowed: true });
    for (const f of ENTITLEMENT_FEATURES) {
      const d = await entitlement.can(f);
      if (d.allowed) assert.deepEqual(Object.keys(d), ["allowed"]);
      else assert.ok((DENY_REASONS as readonly string[]).includes(d.reason), `${f}: ${d.reason}`);
    }
    await rejectsWith(() => entitlement.can(LEAK as EntitlementFeature), "INVALID_INPUT");
    const st = await entitlement.status();
    assert.ok(["none", "active", "grace", "expired", "revoked"].includes(st.state));
    assert.ok(!surface(st).includes(LEAK));
  });

  // ---- Updater ------------------------------------------------------------------------------
  t("updater: 있으면 check()가 null 또는 버전 정보", async ({ adapters: { updater } }) => {
    if (!updater) return;
    const info = await updater.check();
    if (info) assert.equal(typeof info.version, "string");
  });

  // ---- 직렬화 -------------------------------------------------------------------------------
  t("직렬화: 비밀을 넣은 뒤 어댑터 묶음 JSON·inspect에 값 없음", async ({ adapters }) => {
    await adapters.secrets.set("auth.session", TOKEN);
    assert.ok(!surface(adapters).includes(LEAK));
    assert.ok(!surface(adapters.secrets).includes(LEAK));
  });
}
