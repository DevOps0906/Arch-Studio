// 데모 모드: 샘플 3개가 DesignModel v1 계약(packages/domain zod)을 만족하고, 인메모리 저장소가 070 동시성 규칙을 따르며,
// 데모 인증이 실제 api-client·finish 파서를 통과한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { designModelV1Schema } from "@arch-studio/domain";
import { createApiClient } from "../api-client/index.ts";
import { requestFinishLogin } from "../auth/index.ts";
import { bridgeErrorCode } from "../shell/errors.ts";
import { createDemoAdapters, createDemoRuntime, DEMO_PROJECTS, DemoProjectStore } from "./index.ts";

/** 신발끈 공식(mm² → ㎡). 외곽 반시계면 양수. */
function areaM2(outer: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 0; i < outer.length; i += 1) {
    const [x1, y1] = outer[i]!;
    const [x2, y2] = outer[(i + 1) % outer.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2 / 1e6;
}

test("샘플 3개: zod 계약 통과, id는 UUIDv7·중복 없음, 대지·매스·층·프로그램이 있다", () => {
  assert.equal(DEMO_PROJECTS.length, 3);
  assert.equal(new Set(DEMO_PROJECTS.map((p) => p.id)).size, 3);
  for (const p of DEMO_PROJECTS) {
    const r = designModelV1Schema.safeParse(p.model);
    assert.ok(r.success, `${p.name}: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
    assert.match(p.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(p.model.masses.length > 0 && p.model.masses.every((m) => m.floors.length > 0), p.name);
    assert.ok(p.model.program.targets.length > 0, p.name);
    assert.ok(p.model.site.roads.every((r) => r.edge_index < p.model.site.boundary.outer.length), p.name);
  }
});

test("샘플: 외곽 반시계(면적 양수), 매스가 대지 면적보다 작고 대지 라벨 면적과 맞다", () => {
  const labels = [396, 375, 475.5];
  DEMO_PROJECTS.forEach((p, i) => {
    const site = areaM2(p.model.site.boundary.outer);
    assert.equal(site, labels[i], p.name);
    assert.ok(p.siteLabel.includes(`${labels[i]}㎡`), p.name);
    for (const m of p.model.masses) {
      const a = areaM2(m.footprint.outer);
      assert.ok(a > 0 && a < site * 0.6, `${p.name} 건폐 ${a}/${site}`);
    }
  });
});

test("저장소: 목록 최신순, 새 저장 v1, 버전 불일치 VERSION_CONFLICT, 삭제 후 NOT_FOUND, 잘못된 id INVALID_INPUT", async () => {
  const store = new DemoProjectStore();
  const list = await store.list();
  assert.deepEqual(list.map((p) => p.name), ["운중동 단독주택", "송도 점포겸용 주택", "역삼동 다세대주택"]);
  const rec = await store.open(DEMO_PROJECTS[0]!.id);
  assert.equal(rec?.version, 1);
  assert.match(rec?.sha256 ?? "", /^[0-9a-f]{64}$/);
  const id = "0192f0a0-1c00-7a01-8a01-0000000000aa";
  const base = { id, name: "새 프로젝트", schemaVersion: 1, engineVersion: "0.0.0", designModel: "{}" };
  assert.equal((await store.save({ ...base, expectedVersion: null })).version, 1);
  await assert.rejects(store.save({ ...base, expectedVersion: null }), (e) => bridgeErrorCode(e) === "VERSION_CONFLICT");
  assert.equal((await store.save({ ...base, expectedVersion: 1 })).version, 2);
  await assert.rejects(store.delete(id, 1), (e) => bridgeErrorCode(e) === "VERSION_CONFLICT");
  await store.delete(id, 2);
  assert.equal(await store.open(id), null);
  await assert.rejects(store.save({ ...base, expectedVersion: 2 }), (e) => bridgeErrorCode(e) === "NOT_FOUND");
  await assert.rejects(store.open("not-a-uuid"), (e) => bridgeErrorCode(e) === "INVALID_INPUT");
});

test("데모 어댑터: 불변식(updater null ⇔ autoUpdate false, license null ⇔ licenseActivation false), 라이선스 상태별 권리", async () => {
  const trial = createDemoAdapters("trial");
  assert.equal(trial.updater === null, !trial.capabilities.autoUpdate);
  assert.equal(trial.entitlement.license === null, !trial.capabilities.licenseActivation);
  assert.deepEqual(await trial.entitlement.can("ai_chat"), { allowed: true });
  const fallback = createDemoAdapters("fallback");
  assert.deepEqual(await fallback.entitlement.can("cloud_review"), { allowed: false, reason: "fallback" });
  assert.deepEqual(await fallback.entitlement.can("desktop_edit"), { allowed: true });
  const expired = createDemoAdapters("expired");
  assert.deepEqual(await expired.entitlement.can("view_export"), { allowed: true });
  assert.equal((await expired.entitlement.can("desktop_edit")).allowed, false);
});

test("데모 인증: 실제 api-client + finish 파서 통과, 로그아웃 뒤 토큰 없음, URL로 시작 상태 고름", async () => {
  const rt = createDemoRuntime({ search: "?demo-onboarding=1&demo-role=member", engine: null });
  assert.equal(rt.demo, true);
  const api = createApiClient({ baseUrl: rt.api.baseUrl, getAccessToken: () => rt.auth.getAccessToken(), fetch: rt.api.fetch!, sleep: async () => {} });
  const r = await requestFinishLogin(api, "email", "k");
  assert.equal(r.needsOnboarding, true);
  assert.equal(r.session.org?.role, "member");
  assert.equal(r.session.credit_balance, 30);
  await rt.auth.signOut();
  assert.equal(await rt.auth.hasSession(), false);
  assert.equal(await rt.auth.getAccessToken(), null);
  const out = createDemoRuntime({ search: "?demo-session=none", engine: null });
  assert.equal(await out.auth.hasSession(), false);
  assert.deepEqual(await out.auth.signInWithPassword!("a@b.c", "x"), { ok: true });
  assert.equal(await out.auth.hasSession(), true);
});
