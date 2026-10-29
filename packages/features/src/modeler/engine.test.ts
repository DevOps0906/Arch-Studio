// 모델러 엔진 어댑터·표시 기하 테스트(AR-06-036): 좌표 변환, 윤곽선(EdgesGeometry 없이 데이터로), 폴백 메시, 카메라 자세,
// 응답 검사(신뢰 경계), 합치기, 엔진 클라이언트(가짜 호스트: 기하 키 캐시·superseded 재요청·부분/전체 초과분·엔벨로프 오류·호스트 없음).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../demo/index.ts";
import type { EngineHost, EngineRequestLike, EngineResponseLike } from "../shell/types.ts";
import { moveMass, setFloorCount, type Model } from "./state/commands.ts";
import { ModelerEngineClient } from "./engine/client.ts";
import { idleCoalescer, nextJudgeInput, offer, settle } from "./engine/coalesce.ts";
import { buildMassExcessRequest, envelopeInputKey, nextSeq, parseMassExcess, parseMeshData } from "./engine/protocol.ts";
import {
  cameraPose,
  closesDraft,
  draftLine,
  floorLevels,
  massOutline,
  meshKey,
  modelToWorld,
  prismMesh,
  sceneBounds,
  siteLoop,
  worldToModel,
} from "./viewport/geometry.ts";

const house = DEMO_PROJECTS[0]?.model as DesignModelV1;
const mass = house.masses[0] as Model["masses"][number];

test("좌표: 모델 mm(Z 위) ↔ 월드 m(Y 위), 모델 +Y = 월드 −Z", () => {
  assert.deepEqual(modelToWorld(1000, 2000, 3000), [1, 3, -2]);
  assert.deepEqual(worldToModel(1, -2), [1000, 2000]);
});

test("윤곽선: 층 경계마다 바닥 변 + 꼭짓점 세로선(선분 수 = 변 × 층 경계 + 꼭짓점)", () => {
  assert.deepEqual(floorLevels(mass), [0, 3300, 6300]);
  const o = massOutline(mass);
  assert.equal(o.length / 6, 4 * 3 + 4);
  // 세로선 하나: 첫 꼭짓점 0 → 6300
  const last = Array.from(o.slice(o.length - 6));
  assert.deepEqual(last, [4000, 17000, 0, 4000, 17000, 6300]);
  assert.equal(massOutline({ ...mass, floors: [] }).length, 0);
});

test("폴백 메시: 바닥 × 전체 높이, 닫힌 각기둥(삼각형 = 2(n−2) + 2n), 구멍 지원, 같은 입력 같은 버퍼", () => {
  const p = prismMesh(mass);
  assert.ok(p);
  assert.equal(p.index.length / 3, 2 * 2 + 2 * 4);
  const zs = new Set<number>();
  for (let i = 2; i < p.positions.length; i += 3) zs.add(p.positions[i] as number);
  assert.deepEqual([...zs].sort((a, b) => a - b), [0, 6300]);
  const again = prismMesh(mass);
  assert.deepEqual([...(again?.index ?? [])], [...p.index]);
  const holed = prismMesh({
    ...mass,
    footprint: {
      outer: mass.footprint.outer,
      holes: [
        [
          [6000, 7000],
          [6000, 9000],
          [8000, 9000],
          [8000, 7000],
        ],
      ],
    },
  });
  assert.ok(holed && holed.index.length / 3 === 2 * 8 + 2 * 8);
  assert.equal(prismMesh({ ...mass, floors: [] }), null);
  // 모든 번호가 꼭짓점 안
  for (const i of p.index) assert.ok(i < p.positions.length / 3);
});

test("meshKey: 위치·층고가 같으면 같은 키, 이동·층 변경은 다른 키", () => {
  const moved = moveMass(house, "m-house", 100, 0);
  const more = setFloorCount(house, "m-house", 3);
  assert.equal(meshKey(mass), meshKey({ ...mass, id: "other" }));
  assert.notEqual(meshKey(mass), meshKey((moved as { model: Model }).model.masses[0]!));
  assert.notEqual(meshKey(mass), meshKey((more as { model: Model }).model.masses[0]!));
});

test("장면 상자·대지 선·그리기 선·닫힘 판정·카메라 자세", () => {
  assert.deepEqual(sceneBounds(house), { minX: 0, minY: 0, maxX: 18000, maxY: 22000 });
  assert.equal(siteLoop(house).length, 4 * 3);
  assert.equal(draftLine([[0, 0], [1000, 0]], [1000, 1000]).length, 9);
  assert.equal(closesDraft([[0, 0], [1000, 0], [1000, 1000]], [50, 50], 100), true);
  assert.equal(closesDraft([[0, 0], [1000, 0]], [0, 0], 100), false);
  const b = sceneBounds(house);
  const plan = cameraPose("plan", b, 6300, 0);
  assert.equal(plan.rotate, false);
  assert.ok(plan.position[1] > 10);
  // 정북 단면(정북 = +Y): 카메라는 동쪽(+X)에서 본다
  const sec = cameraPose("section", b, 6300, 0);
  assert.ok(sec.position[0] > sec.target[0]);
  assert.ok(Math.abs(sec.position[2] - sec.target[2]) < 1e-6);
  // 정북이 90°(모델 +X)면 동쪽은 모델 −Y = 월드 +Z
  const sec90 = cameraPose("section", b, 6300, 90);
  assert.ok(sec90.position[2] > sec90.target[2]);
});

test("응답 검사: 형식·번호 범위·NaN·상한 위반은 버린다", () => {
  assert.ok(parseMeshData({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]) }));
  assert.equal(parseMeshData({ positions: new Float32Array([0, 0, 0]), index: new Uint32Array([0, 1, 2]) }), null);
  assert.equal(parseMeshData({ positions: [0, 0, 0], index: new Uint32Array(0) }), null);
  assert.equal(parseMeshData({ positions: new Float32Array([0, Number.NaN, 0]), index: new Uint32Array(0) }), null);
  assert.equal(parseMeshData({ positions: new Float32Array(4), index: new Uint32Array(0) }), null);
  assert.equal(parseMassExcess({ envelope_key: "k", excess: [], envelope: "bad" }), null);
  const ok = parseMassExcess({
    envelope_key: "k",
    excess: [{ id: "a", positions: new Float32Array(0), index: new Uint32Array(0) }],
    envelope: { positions: new Float32Array(0), index: new Uint32Array(0), top_mm: 9000, top_source: "x", warnings: [{ code: "C", message: "m" }, 3], constraints: [] },
    partial: true,
  });
  assert.equal(ok?.envelope?.topSource, "display_cap");
  assert.deepEqual(ok?.envelope?.warnings, [{ code: "C", message: "m" }]);
  assert.equal(ok?.partial, true);
});

test("seq: 레인마다 모듈 단조 증가(화면을 다시 열어도 작아지지 않음), 요청 봉투", () => {
  const a = nextSeq("preview");
  const b = nextSeq("preview");
  assert.equal(b, a + 1);
  const req = buildMassExcessRequest("r", 3, house, ["m-house"], true);
  assert.deepEqual([req.op, req.lane, req.seq, req.mass_ids, req.want_envelope], ["mass_excess", "preview", 3, ["m-house"], true]);
});

test("합치기: 기다리는 동안 마지막 값만, 끝나면 한 번 보낸다", () => {
  let c = idleCoalescer<number>();
  let r = offer(c, 1);
  assert.equal(r.send, 1);
  c = r.state;
  for (const v of [2, 3, 4]) {
    r = offer(c, v);
    assert.equal(r.send, null);
    c = r.state;
  }
  r = settle(c);
  assert.equal(r.send, 4);
  r = settle(r.state);
  assert.equal(r.send, null);
  assert.equal(r.state.inFlight, false);
  assert.equal(nextJudgeInput("new", "old", true), "old");
  assert.equal(nextJudgeInput("new", "old", false), "new");
});

function fakeHost() {
  const sent: Record<string, unknown>[] = [];
  const listeners = new Set<(r: EngineResponseLike) => void>();
  const host: EngineHost = {
    send: (r: EngineRequestLike) => void sent.push(r as unknown as Record<string, unknown>),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose: () => undefined,
  };
  const reply = (r: Record<string, unknown>) => {
    for (const l of [...listeners]) l(r as unknown as EngineResponseLike);
  };
  return { host, sent, reply, listeners };
}

const mesh3 = () => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]) });

test("클라이언트 mass_meshes: 없는 기하 키만 요청, 응답을 키로 캐시, superseded 뒤 빠진 키 다시 요청, 기하 오류 키는 다시 묻지 않음", () => {
  const { host, sent, reply } = fakeHost();
  const c = new ModelerEngineClient(host);
  c.syncMeshes(house.masses);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.op, "mass_meshes");
  c.syncMeshes(house.masses);
  assert.equal(sent.length, 1, "대기 중인 키는 다시 보내지 않는다");
  const moved = (moveMass(house, "m-house", 100, 0) as { model: Model }).model;
  c.syncMeshes(moved.masses);
  assert.equal(sent.length, 2);
  reply({ req_id: sent[0]?.req_id, status: "superseded" });
  reply({ req_id: sent[1]?.req_id, ok: true, op: "mass_meshes", result: { meshes: [{ id: "m-house", ...mesh3(), failed: false }] }, engine_version: "t", elapsed_ms: 1 });
  assert.equal(c.getSnapshot().meshes.get(meshKey(moved.masses[0]!))?.index.length, 3);
  c.syncMeshes(moved.masses);
  assert.equal(sent.length, 2, "캐시에 있으면 요청 없음");
  c.syncMeshes(house.masses);
  assert.equal(sent.length, 3, "원래 위치는 superseded로 못 받았으니 다시 요청");
  reply({ req_id: sent[2]?.req_id, ok: true, op: "mass_meshes", result: { meshes: [{ id: "m-house", positions: new Float32Array(0), index: new Uint32Array(0), failed: true }] }, engine_version: "t", elapsed_ms: 1 });
  assert.ok(c.getSnapshot().failedKeys.has(meshKey(mass)));
  c.syncMeshes(house.masses);
  assert.equal(sent.length, 3);
});

test("클라이언트 mass_excess: 합치기, 엔벨로프는 대지·규칙이 바뀔 때만 요청, 부분은 병합·전체는 교체, 오류는 문구", () => {
  const { host, sent, reply } = fakeHost();
  const c = new ModelerEngineClient(host);
  let changes = 0;
  c.subscribe(() => changes++);
  c.requestExcess(house, null);
  assert.equal(c.getSnapshot().envelopeStatus, "loading");
  c.requestExcess(house, ["m-house"]);
  c.requestExcess(house, ["m-house"]);
  assert.equal(sent.length, 1, "응답 전에는 하나만");
  assert.equal(sent[0]?.want_envelope, true);
  reply({
    req_id: sent[0]?.req_id,
    ok: true,
    op: "mass_excess",
    result: { envelope_key: "k", envelope: { ...mesh3(), top_mm: 9000, top_source: "display_cap", warnings: [], constraints: [], rule_pack_version: "2026.10.0" }, excess: [{ id: "m-house", ...mesh3() }], partial: false },
    engine_version: "t",
    elapsed_ms: 1,
  });
  const s1 = c.getSnapshot();
  assert.equal(s1.envelopeStatus, "ready");
  assert.equal(s1.excess.get("m-house")?.index.length, 3);
  assert.equal(sent.length, 2, "기다리던 마지막 요청을 보냈다");
  assert.equal(sent[1]?.want_envelope, false, "같은 대지·규칙이면 엔벨로프는 다시 받지 않는다");
  assert.deepEqual(sent[1]?.mass_ids, ["m-house"]);
  reply({ req_id: sent[1]?.req_id, ok: true, op: "mass_excess", result: { envelope_key: "k", envelope: null, excess: [{ id: "m-house", positions: new Float32Array(0), index: new Uint32Array(0) }], partial: true }, engine_version: "t", elapsed_ms: 1 });
  assert.equal(c.getSnapshot().excess.has("m-house"), false, "부분 결과가 빈 초과분이면 지운다");
  assert.equal(c.getSnapshot().envelope?.topMm, 9000, "엔벨로프는 남는다");
  assert.equal(c.getSnapshot().excessBusy, false);
  // 대지가 바뀌면 엔벨로프 다시 요청
  const site2 = { ...house, site: { ...house.site, north_angle_deg: 10 } };
  assert.notEqual(envelopeInputKey(site2), envelopeInputKey(house));
  c.requestExcess(site2, null);
  assert.equal(sent[2]?.want_envelope, true);
  reply({ req_id: sent[2]?.req_id, ok: false, code: "AR050", detail: "규칙 팩이 없습니다" });
  const s3 = c.getSnapshot();
  assert.equal(s3.envelopeStatus, "error");
  assert.equal(s3.envelopeError, "규칙 팩이 없습니다(AR050)");
  assert.equal(s3.envelope, null);
  // 남의 응답·옛 응답은 무시
  reply({ req_id: "other", ok: true, result: {} });
  assert.equal(c.getSnapshot(), s3);
  assert.ok(changes > 0);
  c.dispose();
});

test("클라이언트: 엔진 호스트가 없으면 unavailable, 요청을 보내지 않는다. dispose는 대기 요청을 취소", () => {
  const none = new ModelerEngineClient(null);
  none.syncMeshes(house.masses);
  none.requestExcess(house, null);
  assert.equal(none.getSnapshot().envelopeStatus, "unavailable");
  const { host, sent, listeners } = fakeHost();
  const c = new ModelerEngineClient(host);
  c.syncMeshes(house.masses);
  c.requestExcess(house, null);
  c.dispose();
  assert.deepEqual(sent.slice(2).map((r) => r.op), ["cancel", "cancel"]);
  assert.equal(listeners.size, 0);
});
