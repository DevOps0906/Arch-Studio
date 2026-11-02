// AR-06-077 수동 업로드·내려받기: 실제 설치형 어댑터(Rust 모킹 invoke) + 실제 클라우드 저장소(가짜 서버)로 끝까지 돌린다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudLinksOf,
  createCloudProjectStore,
  createIndexedDbReadCache,
  type SaveProjectInput,
} from "@arch-studio/shell-bridge";
import { createFakeCloud, createFakeIdb, createRustInvoke, createTauriAdapters, FAKE_CLOUD_BASE, testProjectId, type FakeCloud } from "@arch-studio/shell-bridge/testing";
import { CloudSync, CONFLICT_CHOICES, OFFLINE_NOTICE } from "./index.ts";

let seq = 100;
const nextId = () => testProjectId(seq++);

async function harness(opts: { online?: () => boolean; cloud?: FakeCloud } = {}) {
  const rust = createRustInvoke();
  const adapters = createTauriAdapters(rust.invoke);
  const links = cloudLinksOf(adapters)!;
  const cloud = opts.cloud ?? createFakeCloud();
  const cloudStore = createCloudProjectStore({
    baseUrl: FAKE_CLOUD_BASE,
    getAccessToken: async () => cloud.token,
    fetch: cloud.fetch,
    cache: createIndexedDbReadCache(createFakeIdb().factory),
  });
  const sync = new CloudSync({ local: adapters.projects, links, cloud: cloudStore, newId: nextId, ...(opts.online ? { isOnline: opts.online } : {}) });
  return { rust, local: adapters.projects, links, cloud, cloudStore, sync };
}

const localInput = (id: string, patch: Partial<SaveProjectInput> = {}): SaveProjectInput => ({
  id,
  name: "주택 A",
  siteLabel: "서울 마포구",
  schemaVersion: 1,
  engineVersion: "0.1.0",
  designModel: JSON.stringify({ v: "local-1" }),
  expectedVersion: null,
  ...patch,
});

const posts = (cloud: FakeCloud) =>
  cloud.calls
    .filter((c) => c.method === "POST" && new URL(c.url).pathname === "/api/cloud-projects")
    .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);

test("최초 업로드: 새 project_uuid 사본 + local_id, 원본 로컬은 그대로, 연결 기록", async () => {
  const { local, links, cloud, sync } = await harness();
  const localId = testProjectId(1);
  await local.save(localInput(localId));
  const before = await local.open(localId);

  const r = await sync.upload(localId);
  assert.equal(r.kind, "uploaded");
  assert.ok(r.kind === "uploaded" && r.created && r.version === 1);
  const projectUuid = r.kind === "uploaded" ? r.projectUuid : "";
  assert.notEqual(projectUuid, localId, "사본은 새 project_uuid");

  const after = await local.open(localId);
  assert.deepEqual(after, before, "업로드는 로컬 리비전·내용을 바꾸지 않는다");
  assert.deepEqual(await links.get(localId), { projectUuid, cloudVersion: 1 });
  const [body] = posts(cloud);
  assert.equal(body!.local_id, localId);
  assert.equal(body!.project_uuid, projectUuid);
});

test("다시 업로드: 같은 행 version+1(새 행 없음), local_id는 다시 보내지 않음", async () => {
  const { local, links, cloud, sync } = await harness();
  const localId = testProjectId(2);
  await local.save(localInput(localId));
  const first = await sync.upload(localId);
  assert.equal(first.kind, "uploaded");
  await local.save(localInput(localId, { designModel: JSON.stringify({ v: "local-2" }), expectedVersion: 1 }));
  const second = await sync.upload(localId);
  assert.equal(second.kind, "uploaded");
  assert.ok(first.kind === "uploaded" && second.kind === "uploaded");
  assert.equal(second.projectUuid, first.projectUuid);
  assert.equal(second.version, 2);
  assert.equal(second.created, false);
  assert.equal(cloud.rows.size, 1);
  assert.deepEqual(await links.get(localId), { projectUuid: first.projectUuid, cloudVersion: 2 });
  assert.equal("local_id" in posts(cloud)[1]!, false);
  assert.equal((await local.open(localId))?.version, 2, "로컬은 사용자가 저장한 만큼만");
});

test("폴더 키: 모든 업로드 경로(최초·재업로드·사본 저장)의 프로젝트 폴더는 project_uuid, local_id 폴더 0", async () => {
  const { local, cloud, cloudStore, sync } = await harness();
  const localId = testProjectId(3);
  await local.save(localInput(localId));
  const up = await sync.upload(localId);
  assert.ok(up.kind === "uploaded");
  await sync.upload(localId);
  // 다른 기기가 먼저 저장 → 충돌 → 사본으로 저장.
  await cloudStore.save({ ...localInput(up.projectUuid), expectedVersion: 2 });
  assert.equal((await sync.upload(localId)).kind, "conflict");
  await sync.resolveConflict(localId, "save_as_copy");
  const bodies = posts(cloud);
  assert.ok(bodies.length >= 4);
  for (const b of bodies) {
    const folder = String(b.storage_path).split("/")[3];
    assert.equal(folder, b.project_uuid);
    assert.notEqual(folder, localId);
  }
  const signed = cloud.calls.filter((c) => c.url.endsWith("/upload-url")).map((c) => new URL(c.url).pathname.split("/")[3]);
  assert.ok(signed.length >= 4 && !signed.includes(localId));
});

test("충돌: 서버가 앞서 있으면 저장하지 않고 2선택 → '서버 최신 열기'는 로컬 새 리비전 + 연결 갱신", async () => {
  const { local, links, cloud, cloudStore, sync } = await harness();
  const localId = testProjectId(4);
  await local.save(localInput(localId));
  const up = await sync.upload(localId);
  assert.ok(up.kind === "uploaded");
  await cloudStore.save({ ...localInput(up.projectUuid), designModel: JSON.stringify({ v: "other-device" }), expectedVersion: 1 });
  await local.save(localInput(localId, { designModel: JSON.stringify({ v: "mine" }), expectedVersion: 1 }));

  const r = await sync.upload(localId);
  assert.deepEqual(r, { kind: "conflict", projectUuid: up.projectUuid, choices: ["save_as_copy", "open_server_latest"] });
  assert.deepEqual(
    CONFLICT_CHOICES.map((c) => c.label),
    ["내 변경을 사본으로 저장", "서버 최신 열기"],
  );
  assert.equal(cloud.rows.get(up.projectUuid)?.version, 2, "충돌 업로드는 저장되지 않는다");

  const opened = await sync.resolveConflict(localId, "open_server_latest");
  assert.deepEqual(opened, { kind: "downloaded", localId, localVersion: 3, projectUuid: up.projectUuid, version: 2 });
  assert.equal((await local.open(localId))?.designModel, JSON.stringify({ v: "other-device" }));
  assert.deepEqual(await links.get(localId), { projectUuid: up.projectUuid, cloudVersion: 2 });
  // 이후 업로드는 같은 행 version+1.
  const again = await sync.upload(localId);
  assert.ok(again.kind === "uploaded" && again.projectUuid === up.projectUuid && again.version === 3);
});

test("충돌: '내 변경을 사본으로 저장'은 새 project_uuid 사본(local_id 없음), 서버 원본·로컬·연결은 그대로", async () => {
  const { local, links, cloud, cloudStore, sync } = await harness();
  const localId = testProjectId(5);
  await local.save(localInput(localId));
  const up = await sync.upload(localId);
  assert.ok(up.kind === "uploaded");
  await cloudStore.save({ ...localInput(up.projectUuid), expectedVersion: 1 });
  assert.equal((await sync.upload(localId)).kind, "conflict");

  const copy = await sync.resolveConflict(localId, "save_as_copy");
  assert.ok(copy.kind === "uploaded" && copy.created && !copy.linked);
  assert.notEqual(copy.projectUuid, up.projectUuid);
  assert.equal(cloud.rows.size, 2);
  assert.equal(cloud.rows.get(up.projectUuid)?.version, 2);
  assert.equal(cloud.rows.get(copy.projectUuid)?.localId, null);
  assert.deepEqual(await links.get(localId), { projectUuid: up.projectUuid, cloudVersion: 1 });
  assert.equal((await local.open(localId))?.version, 1);
});

test("연결 기록이 없는데 같은 local_id 사본이 서버에 있으면(23505) 그 사본과의 충돌로 2선택", async () => {
  const cloud = createFakeCloud();
  const a = await harness({ cloud });
  const localId = testProjectId(6);
  await a.local.save(localInput(localId));
  const up = await a.sync.upload(localId);
  assert.ok(up.kind === "uploaded");
  // 같은 local_id의 로컬 DB를 새로 만든 상황(연결 유실): 새 설치에 같은 id로 저장.
  const b = await harness({ cloud });
  await b.local.save(localInput(localId));
  const r = await b.sync.upload(localId);
  assert.deepEqual(r, { kind: "conflict", projectUuid: up.projectUuid, choices: ["save_as_copy", "open_server_latest"] });
  assert.equal(cloud.rows.size, 1);
  const opened = await b.sync.resolveConflict(localId, "open_server_latest");
  assert.equal(opened.kind, "downloaded");
  assert.deepEqual(await b.links.get(localId), { projectUuid: up.projectUuid, cloudVersion: 1 });
});

test("서버 사본이 지워졌으면 업로드가 새 project_uuid로 다시 만들고 다시 연결", async () => {
  const { local, links, cloud, cloudStore, sync } = await harness();
  const localId = testProjectId(7);
  await local.save(localInput(localId));
  const up = await sync.upload(localId);
  assert.ok(up.kind === "uploaded");
  await cloudStore.delete(up.projectUuid, 1);
  const again = await sync.upload(localId);
  assert.ok(again.kind === "uploaded" && again.created && again.projectUuid !== up.projectUuid);
  assert.deepEqual(await links.get(localId), { projectUuid: again.projectUuid, cloudVersion: 1 });
  assert.equal(cloud.rows.size, 1);
});

test("오프라인 클라우드 모드: 읽기 전용(캐시로 열기 + 안내), 저장·업로드는 네트워크 0, 로컬로 복사해 편집은 가능", async () => {
  let online = true;
  const { local, links, cloud, cloudStore, sync } = await harness({ online: () => online });
  const projectUuid = testProjectId(8);
  await cloudStore.save(localInput(projectUuid));
  const live = await sync.openCloud(projectUuid);
  assert.equal(live?.readOnly, false);
  assert.equal(live?.notice, null);

  online = false;
  cloud.online = false;
  const before = cloud.calls.length;
  const offline = await sync.openCloud(projectUuid);
  assert.equal(offline?.readOnly, true);
  assert.equal(offline?.notice, OFFLINE_NOTICE);
  assert.equal(offline?.record.version, 1);
  const mutatingBefore = cloud.mutating().length;
  assert.deepEqual(await sync.saveCloud({ ...localInput(projectUuid), expectedVersion: 1 }), { kind: "offline" });
  assert.deepEqual(await sync.upload(testProjectId(9)), { kind: "offline" });
  assert.equal(cloud.mutating().length, mutatingBefore, "오프라인 저장·업로드는 쓰기 요청 0");

  const copied = await sync.download(projectUuid);
  assert.equal(copied.kind, "downloaded");
  assert.ok(copied.kind === "downloaded");
  assert.equal((await local.open(copied.localId))?.designModel, JSON.stringify({ v: "local-1" }));
  assert.deepEqual(await links.get(copied.localId), { projectUuid, cloudVersion: 1 });
  assert.ok(cloud.calls.length > before);
});

test("내려받기: 권리 만료(web_edit 거부)여도 클라우드 → 로컬 복사는 된다, 이후 업로드는 같은 사본 version+1", async () => {
  const cloud = createFakeCloud({ rights: { view_export: true, desktop_edit: true, web_edit: false, ai_render: false, cloud_review: false } });
  const { local, sync, cloudStore } = await harness({ cloud });
  const projectUuid = testProjectId(10);
  await cloudStore.save(localInput(projectUuid));
  const r = await sync.download(projectUuid);
  assert.ok(r.kind === "downloaded");
  assert.equal((await local.open(r.localId))?.name, "주택 A");
  const up = await sync.upload(r.localId);
  assert.ok(up.kind === "uploaded" && up.projectUuid === projectUuid && up.version === 2 && !up.created);
  assert.equal(await sync.download(testProjectId(11)).then((x) => x.kind), "not_found");
});

test("소스: shell-bridge는 타입으로만 가져온다(런타임 의존 0)", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("./sync.ts", import.meta.url), "utf8");
  for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"(@arch-studio\/shell-bridge[^"]*)"/gms)) assert.ok(m[1], m[2]);
});
