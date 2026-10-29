// 매스 제안 핸들러(AR-06-028) 테스트: 실제 규칙 팩 2026.10.0(전 항목 미확인)과 Node Manifold. 요청 검사·오류 격리·결과 모양.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { loadSolidKernel, type SolidKernel } from "@arch-studio/geometry";
import type { LaneRequest } from "./protocol.ts";
import { RulePackStore } from "./rulePacks.ts";
import { HandlerError, type HandlerContext } from "./runtime.ts";
import { createSuggestHandlers } from "./suggest.handlers.ts";

const PACK = JSON.parse(readFileSync(new URL("../../../../packages/rules/packs/2026.10.0/pack.json", import.meta.url), "utf8")) as unknown;
const ctx: HandlerContext = { checkpoint: () => Promise.resolve(), progress: () => undefined };

const model = (): DesignModelV1 => ({
  schema_version: 1,
  units: "mm",
  site: {
    boundary: { outer: [[0, 0], [18000, 0], [18000, 22000], [0, 22000]] },
    north_angle_deg: 0,
    roads: [{ edge_index: 0, width_mm: 6000 }],
    zoning: { use_district: "제1종일반주거지역", districts: [] },
    parcel: {},
  },
  rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-12-01", municipality_code: "41135", ordinance_applied: true },
  masses: [],
  floor_layouts: [],
  program: { checklist_answers: {}, targets: [], user_locked_rows: [] },
  meta: { created_by_engine_version: "test" },
});

const targets = { target_gfa_m2: 200, floors: null, floor_height_mm: 3000, use: "단독주택" };
const req = (over: Record<string, unknown> = {}): LaneRequest => ({ op: "suggest_mass", req_id: "r1", lane: "suggest", seq: 0, model: model(), targets, ...over }) as LaneRequest;

let kernel: SolidKernel;
before(async () => {
  kernel = await loadSolidKernel();
});

function handler(withPack = true) {
  const store = new RulePackStore();
  if (withPack) store.load("2026.10.0", "sha-test", PACK);
  let loads = 0;
  const h = createSuggestHandlers({
    store,
    loadKernel: async () => {
      loads++;
      return kernel;
    },
  });
  return { run: h.suggest_mass, loads: () => loads };
}

test("배포 팩(전 항목 미확인): 후보 3안 + 판정 동봉, PASS를 만들지 않고 안내가 붙는다", async () => {
  const { run, loads } = handler();
  const r = await run(req(), ctx);
  const res = r.result as { candidates: { judge: { result: { items: { verdict: string }[] } }; status: string }[]; notices: { code: string }[]; rule_pack_version: string; rule_pack_fallback: boolean };
  assert.equal(res.candidates.length, 3);
  assert.ok(res.candidates.every((c) => c.status === "check" && c.judge.result.items.every((i) => i.verdict !== "FAIL")));
  assert.ok(res.notices.some((n) => n.code === "LAW_UNVERIFIED"));
  assert.equal(res.rule_pack_version, "2026.10.0");
  await run(req({ req_id: "r2" }), ctx);
  assert.equal(loads(), 1, "커널은 한 번만 올린다");
});

test("같은 요청 → 같은 결과(바이트)", async () => {
  const { run } = handler();
  const a = JSON.stringify((await run(req(), ctx)).result);
  const b = JSON.stringify((await run(req({ req_id: "r2" }), ctx)).result);
  assert.equal(a, b);
});

test("목표·모델 형식이 틀리면 AR050(본문 값 없는 고정 문구)", async () => {
  const { run } = handler();
  for (const bad of [{ targets: { ...targets, floors: 0 } }, { targets: { ...targets, extra: 1 } }, { targets: null }, { model: { schema_version: 1 } }]) {
    await assert.rejects(
      () => Promise.resolve(run(req(bad), ctx)),
      (e: unknown) => e instanceof HandlerError && e.code === "AR050" && !e.message.includes("extra"),
    );
  }
});

test("규칙 팩이 없으면 AR063(042: AR050과 분리)", async () => {
  const { run } = handler(false);
  await assert.rejects(
    () => Promise.resolve(run(req(), ctx)),
    (e: unknown) => e instanceof HandlerError && e.code === "AR063",
  );
});
