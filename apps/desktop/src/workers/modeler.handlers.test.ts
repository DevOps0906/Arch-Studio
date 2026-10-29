// 모델러 표시 핸들러(AR-06-036) 테스트: 매스 식(층고 묶음 extrude), mass_meshes 버퍼·실패 격리, mass_excess 엔벨로프 캐시·초과분·전송 목록,
// 런타임을 통한 preview 레인 최신만 유효, 규칙 팩 없음 오류. 실제 규칙 팩 2026.10.0과 Node Manifold로 돈다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { loadSolidKernel, type SolidKernel } from "@arch-studio/geometry";
import { createModelerHandlers, envelopeKeyOf, intMeshToRender, massSolidNode, MAX_MASSES } from "./modeler.handlers.ts";
import { parseRequest, type EngineResponse, type LaneRequest } from "./protocol.ts";
import { RulePackStore } from "./rulePacks.ts";
import { HandlerError, WorkerRuntime, type HandlerContext } from "./runtime.ts";

const PACK = JSON.parse(readFileSync(new URL("../../../../packages/rules/packs/2026.10.0/pack.json", import.meta.url), "utf8")) as unknown;
const ctx: HandlerContext = { checkpoint: () => Promise.resolve(), progress: () => undefined };
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const model = (masses: DesignModelV1["masses"]): DesignModelV1 => ({
  schema_version: 1,
  units: "mm",
  site: {
    boundary: { outer: rect(0, 0, 18000, 22000) },
    north_angle_deg: 0,
    roads: [{ edge_index: 0, width_mm: 6000 }],
    zoning: { use_district: "제1종일반주거지역", districts: [] },
    parcel: {},
  },
  rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-12-01", municipality_code: "41135", ordinance_applied: true },
  masses,
  floor_layouts: [],
  program: { checklist_answers: {}, targets: [], user_locked_rows: [] },
  meta: { created_by_engine_version: "test" },
});

const mass = (id: string, x0: number, y0: number, x1: number, y1: number, heights: number[]): DesignModelV1["masses"][number] => ({
  id,
  footprint: { outer: rect(x0, y0, x1, y1) },
  base_level_mm: 0,
  floors: heights.map((h, i) => ({ id: `${id}-f${i + 1}`, level: i + 1, height_mm: h, use: "단독주택" })),
  roof: { type: "flat" },
});

let kernel: SolidKernel;
before(async () => {
  kernel = await loadSolidKernel();
});

function handlers(withPack = true) {
  const store = new RulePackStore();
  if (withPack) store.load("2026.10.0", "sha-test", PACK);
  let loads = 0;
  const h = createModelerHandlers({
    store,
    loadKernel: async () => {
      loads++;
      return kernel;
    },
  });
  return { h, loads: () => loads };
}

test("massSolidNode: 층고가 같으면 extrude 1회(divisions = 층 − 1), 다르면 연속 묶음 union, 층 없으면 null", () => {
  const same = massSolidNode(mass("a", 0, 0, 10, 10, [3000, 3000, 3000]));
  assert.deepEqual(same && same.op === "extrude" ? [same.z0, same.z1, same.divisions] : null, [0, 9000, 2]);
  const mixed = massSolidNode(mass("b", 0, 0, 10, 10, [4000, 3000, 3000]));
  assert.equal(mixed?.op, "union");
  if (mixed?.op === "union") {
    assert.deepEqual(
      mixed.children.map((c) => (c.op === "extrude" ? [c.z0, c.z1, c.divisions] : null)),
      [
        [0, 4000, 0],
        [4000, 10000, 1],
      ],
    );
  }
  assert.equal(massSolidNode({ ...mass("c", 0, 0, 10, 10, []) }), null);
  // level 순서로 쌓는다(입력 순서와 무관), base_level에서 시작
  const shuffled = { ...mass("d", 0, 0, 10, 10, [3000, 3000]), base_level_mm: -3000 };
  shuffled.floors = [...shuffled.floors].reverse();
  const n = massSolidNode(shuffled);
  assert.deepEqual(n && n.op === "extrude" ? [n.z0, n.z1] : null, [-3000, 3000]);
});

test("intMeshToRender: 정수 메시 → 새 Float32/Uint32 버퍼", () => {
  const r = intMeshToRender({ vertices: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], triangles: [[0, 1, 2]] });
  assert.deepEqual([...r.positions], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual([...r.index], [0, 1, 2]);
});

test("mass_meshes: 매스마다 버퍼 1벌, 잘못된 바닥은 그 매스만 failed, 전송 목록 = 버퍼 전부", async () => {
  const { h, loads } = handlers();
  const bad = { ...mass("bad", 0, 0, 10, 10, [3000]), footprint: { outer: [[0, 0], [10, 0], [20, 0]] as [number, number][] } };
  const req = { op: "mass_meshes", req_id: "m1", lane: "mesh", seq: 0, masses: [mass("a", 0, 0, 10000, 8000, [3000, 3000]), bad] } as LaneRequest;
  const r = await h.mass_meshes(req, ctx);
  const res = r.result as { meshes: { id: string; positions: Float32Array; index: Uint32Array; failed: boolean }[] };
  assert.equal(res.meshes.length, 2);
  const [a, b] = res.meshes;
  assert.equal(a?.failed, false);
  assert.ok((a?.index.length ?? 0) >= 12 * 3);
  const zs = new Set<number>();
  for (let i = 2; i < (a?.positions.length ?? 0); i += 3) zs.add(a?.positions[i] as number);
  assert.deepEqual([...zs].sort((x, y) => x - y), [0, 3000, 6000], "층 경계 꼭짓점 유지");
  assert.equal(b?.failed, true);
  assert.equal(b?.index.length, 0);
  assert.equal(r.transfer?.length, 4);
  // 커널은 한 번만 로드
  await h.mass_meshes({ ...req, req_id: "m2", seq: 1 } as LaneRequest, ctx);
  assert.equal(loads(), 1);
});

test("mass_meshes: 형식 오류·상한 초과는 AR050", async () => {
  const { h } = handlers();
  await assert.rejects(Promise.resolve(h.mass_meshes({ op: "mass_meshes", req_id: "x", lane: "mesh", seq: 0, masses: [{ id: 1 }] } as unknown as LaneRequest, ctx)), HandlerError);
  const many = Array.from({ length: MAX_MASSES + 1 }, (_, i) => mass(`m${i}`, 0, 0, 10, 10, [3000]));
  await assert.rejects(Promise.resolve(h.mass_meshes({ op: "mass_meshes", req_id: "y", lane: "mesh", seq: 0, masses: many } as LaneRequest, ctx)), HandlerError);
});

test("mass_excess: 엔벨로프 표시 메시 + 매스별 초과분, 대지·규칙이 같으면 엔벨로프 캐시, 부분 요청", async () => {
  const { h } = handlers();
  // 안쪽 낮은 매스 + 높이 60m 넘는 탑(표시 상한 60m 위가 초과분)
  const inner = mass("in", 4000, 5000, 14000, 17000, [3000, 3000]);
  const tower = mass("tw", 5000, 6000, 8000, 9000, Array.from({ length: 22 }, () => 3000));
  const m = model([inner, tower]);
  const r1 = await h.mass_excess({ op: "mass_excess", req_id: "e1", lane: "preview", seq: 0, model: m, mass_ids: null, want_envelope: true } as LaneRequest, ctx);
  const res = r1.result as {
    envelope: { positions: Float32Array; index: Uint32Array; top_mm: number; key: string } | null;
    excess: { id: string; index: Uint32Array; positions: Float32Array }[];
    envelope_key: string;
    partial: boolean;
  };
  assert.ok(res.envelope && res.envelope.index.length > 0);
  assert.equal(res.envelope_key, envelopeKeyOf(m, "2026.10.0"));
  assert.equal(res.partial, false);
  const byId = new Map(res.excess.map((e) => [e.id, e]));
  assert.equal(byId.get("in")?.index.length, 0, "엔벨로프 안 매스는 초과분 없음");
  const tw = byId.get("tw");
  assert.ok(tw && tw.index.length > 0, "표시 상한 위는 초과분");
  for (let i = 2; i < tw.positions.length; i += 3) assert.ok((tw.positions[i] as number) >= (res.envelope?.top_mm ?? 0) - 1);
  assert.equal(r1.transfer?.length, 2 * 2 + 2);

  // 매스만 움직이면 같은 엔벨로프 키, want_envelope=false면 엔벨로프 버퍼 없음
  const moved = model([inner, { ...tower, footprint: { outer: rect(6000, 6000, 9000, 9000) } }]);
  const r2 = await h.mass_excess({ op: "mass_excess", req_id: "e2", lane: "preview", seq: 1, model: moved, mass_ids: ["tw"], want_envelope: false } as LaneRequest, ctx);
  const res2 = r2.result as { envelope: unknown; excess: { id: string }[]; envelope_key: string; partial: boolean };
  assert.equal(res2.envelope, null);
  assert.equal(res2.envelope_key, res.envelope_key);
  assert.deepEqual(res2.excess.map((e) => e.id), ["tw"]);
  assert.equal(res2.partial, true);

  // 대지가 바뀌면 키가 바뀐다
  const otherSite = { ...m, site: { ...m.site, north_angle_deg: 30 } };
  assert.notEqual(envelopeKeyOf(otherSite, "2026.10.0"), res.envelope_key);
});

test("mass_excess: 규칙 팩이 없으면 AR063(설치된 규칙 팩이 없습니다, AR-06-042), 모델 형식 오류도 AR050", async () => {
  const { h } = handlers(false);
  await assert.rejects(
    Promise.resolve(h.mass_excess({ op: "mass_excess", req_id: "z", lane: "preview", seq: 0, model: model([]), mass_ids: null, want_envelope: true } as LaneRequest, ctx)),
    (e: unknown) => e instanceof HandlerError && e.code === "AR063" && /규칙 팩/.test(e.message),
  );
  const { h: h2 } = handlers();
  await assert.rejects(Promise.resolve(h2.mass_excess({ op: "mass_excess", req_id: "z2", lane: "preview", seq: 0, model: { bad: true }, mass_ids: null, want_envelope: true } as unknown as LaneRequest, ctx)), HandlerError);
});

test("봉투: mass_meshes는 mesh 레인, mass_excess는 preview 레인, 둘 다 seq 필수", () => {
  assert.equal(parseRequest({ op: "mass_meshes", req_id: "a", lane: "mesh", seq: 0, masses: [] }).ok, true);
  assert.equal(parseRequest({ op: "mass_meshes", req_id: "a", lane: "judge", seq: 0, masses: [] }).ok, false);
  assert.equal(parseRequest({ op: "mass_excess", req_id: "a", lane: "preview" }).ok, false);
});

test("런타임: preview 레인은 최신만 유효(앞 요청 superseded), judge 레인과 독립, 결과 버퍼는 transfer로 넘긴다", async () => {
  const { h } = handlers();
  const posted: { msg: EngineResponse; transfer: ArrayBuffer[] | undefined }[] = [];
  const rt = new WorkerRuntime({
    lanes: ["judge", "mesh", "preview"],
    handlers: { ...h, judge: () => ({ result: "j", engine_version: "t" }) },
    post: (msg, transfer) => void posted.push({ msg, transfer }),
    now: () => 0,
    yieldFn: () => new Promise((r) => setImmediate(r)),
    log: () => undefined,
  });
  const m = model([mass("a", 4000, 5000, 9000, 9000, [3000])]);
  rt.receive({ op: "judge", req_id: "j1", lane: "judge", seq: 0, model_rev: "r", model: m });
  rt.receive({ op: "mass_excess", req_id: "p1", lane: "preview", seq: 0, model: m, mass_ids: null, want_envelope: true });
  rt.receive({ op: "mass_excess", req_id: "p2", lane: "preview", seq: 1, model: m, mass_ids: null, want_envelope: true });
  for (let i = 0; i < 50 && posted.filter((p) => "ok" in p.msg || "status" in p.msg).length < 3; i++) await new Promise((r) => setTimeout(r, 20));
  const byId = new Map(posted.map((p) => [p.msg.req_id, p]));
  assert.deepEqual(byId.get("p1")?.msg, { req_id: "p1", status: "superseded" });
  const p2 = byId.get("p2");
  assert.ok(p2 && "ok" in p2.msg && p2.msg.ok === true);
  assert.ok((p2.transfer?.length ?? 0) >= 2);
  assert.ok(byId.get("j1") && "ok" in (byId.get("j1")?.msg ?? {}), "judge 레인은 preview 요청에 밀리지 않는다");
});
