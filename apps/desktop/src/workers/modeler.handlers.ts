// engine.worker 모델러 표시 핸들러(AR-06-036): mass_meshes(mesh 레인)·mass_excess(preview 레인).
// 02_ARCHITECTURE 2.4절 계약 추가 제안(tasks/logs/AR-06-036.md [DECISION 필요]). Manifold는 이 워커에서만 돈다(메인 스레드 금지).
// - 기하는 packages/geometry 솔리드 커널·packages/rules buildEnvelope(결정적 순수 함수)만 만든다. 여기서는 식을 조립하고 버퍼를 넘긴다.
// - 표시용 메시는 정수 정규화를 하지 않는다(Float32 Transferable, [DECISION] 1절). 판정·도면·면적은 원본 정수 기하로 따로 계산한다.
// - 매스 솔리드는 층고가 같은 연속 층 묶음마다 extrude 1회(divisions = 층 수 − 1). 층별 extrude → union은 20~70배 느리다.
// - 엔벨로프는 (대지·규칙 문맥·팩 버전) 키로 1개 캐시한다. 매스 편집과 무관하게 대지·규칙이 바뀔 때만 다시 만든다.
import { designModelV1Schema, massSchema, type DesignModelV1, type Polygon } from "@arch-studio/domain";
import type { IntMesh, RenderMesh, SolidKernel, SolidNode } from "@arch-studio/geometry";
import { ENVELOPE_ENGINE_VERSION, buildEnvelope, canonicalJson, type EnvelopeOutput } from "@arch-studio/rules";
import { z } from "zod";
import type { LaneRequest } from "./protocol.ts";
import type { RulePackStore } from "./rulePacks.ts";
import { HandlerError, type Handler, type HandlerResult } from "./runtime.ts";

export const MODELER_MESH_VERSION = "modeler-mesh-0.1.0";
/** 한 요청의 매스 수 상한(PRD 매스 50개의 4배 여유). 넘으면 AR050. */
export const MAX_MASSES = 200;
/** 매스 하나의 층 수 상한. */
export const MAX_FLOORS = 200;
/** 확정 높이 규칙이 없을 때 엔벨로프를 자르는 화면 표시 상한(법규 수치 아님). */
export const ENVELOPE_DISPLAY_CAP_MM = 60_000;

type Mass = DesignModelV1["masses"][number];

/** 매스 → 솔리드 식(순수). 층을 level 순으로 base_level_mm부터 쌓고, 층고가 같은 연속 묶음마다 extrude 1회. 층이 없으면 null. */
export function massSolidNode(mass: Mass): SolidNode | null {
  const floors = [...mass.floors].sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (floors.length === 0) return null;
  const region = { op: "polygons" as const, polygons: [mass.footprint as Polygon] };
  const runs: SolidNode[] = [];
  let z = mass.base_level_mm;
  let i = 0;
  while (i < floors.length) {
    const h = (floors[i] as Mass["floors"][number]).height_mm;
    let j = i;
    while (j + 1 < floors.length && (floors[j + 1] as Mass["floors"][number]).height_mm === h) j++;
    const count = j - i + 1;
    if (h <= 0) throw new HandlerError("AR050", "층고는 0보다 커야 합니다");
    runs.push({ op: "extrude", region, z0: z, z1: z + h * count, divisions: count - 1 });
    z += h * count;
    i = j + 1;
  }
  return runs.length === 1 ? (runs[0] as SolidNode) : { op: "union", children: runs };
}

/** 정수 메시 → 표시 버퍼(순수, 새 버퍼). */
export function intMeshToRender(mesh: IntMesh): RenderMesh {
  const positions = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach(([x, y, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  });
  const index = new Uint32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach(([a, b, c], i) => {
    index[i * 3] = a;
    index[i * 3 + 1] = b;
    index[i * 3 + 2] = c;
  });
  return { positions, index };
}

const massesSchema = z.array(massSchema).max(MAX_MASSES);
const idsSchema = z.array(z.string().max(200)).max(MAX_MASSES).nullable();

function checkFloors(masses: readonly Mass[]): void {
  for (const m of masses) if (m.floors.length > MAX_FLOORS) throw new HandlerError("AR050", `매스 하나의 층은 ${MAX_FLOORS}개까지입니다`);
}

export interface MassMeshOut {
  id: string;
  positions: Float32Array;
  index: Uint32Array;
  /** 이 매스의 기하가 틀려(자기교차·면적 0 등) 메시를 못 만들었으면 true(빈 버퍼). */
  failed: boolean;
}

export interface EnvelopeDisplay {
  key: string;
  positions: Float32Array;
  index: Uint32Array;
  top_mm: number;
  top_source: EnvelopeOutput["top_source"];
  constraints: { key: string; edge_class?: string; status: string; applied: boolean }[];
  warnings: { code: string; message: string }[];
  rule_pack_version: string;
}

export interface ModelerHandlerDeps {
  store: RulePackStore;
  /** 솔리드 커널 로더(워커: manifold.wasm URL, 테스트: Node). 첫 요청 때 한 번 부른다. */
  loadKernel: () => Promise<SolidKernel>;
}

const buffersOf = (items: readonly { positions: Float32Array; index: Uint32Array }[]): ArrayBuffer[] =>
  items.flatMap((m) => [m.positions.buffer as ArrayBuffer, m.index.buffer as ArrayBuffer]);

/** 대지·규칙 문맥이 같으면 같은 엔벨로프(매스는 엔벨로프에 영향 없음). */
export function envelopeKeyOf(model: DesignModelV1, packVersion: string): string {
  return canonicalJson({ site: model.site, rule_context: model.rule_context, pack: packVersion, cap: ENVELOPE_DISPLAY_CAP_MM, v: ENVELOPE_ENGINE_VERSION });
}

export function createModelerHandlers(deps: ModelerHandlerDeps): { mass_meshes: Handler; mass_excess: Handler } {
  let kernelP: Promise<SolidKernel> | null = null;
  const kernel = (): Promise<SolidKernel> => {
    kernelP ??= deps.loadKernel().catch((e: unknown) => {
      kernelP = null; // 다음 요청 때 다시 시도
      throw e;
    });
    return kernelP.catch(() => {
      throw new HandlerError("AR050", "솔리드 엔진을 시작하지 못했습니다");
    });
  };
  let envCache: { key: string; out: EnvelopeOutput; node: SolidNode } | null = null;

  function renderOne(k: SolidKernel, node: SolidNode | null): { positions: Float32Array; index: Uint32Array; failed: boolean } {
    if (node === null) return { positions: new Float32Array(0), index: new Uint32Array(0), failed: false };
    try {
      const [m] = k.renderMeshes([node]);
      return { positions: (m as RenderMesh).positions, index: (m as RenderMesh).index, failed: false };
    } catch (e) {
      if (e instanceof HandlerError) throw e;
      return { positions: new Float32Array(0), index: new Uint32Array(0), failed: true };
    }
  }

  const massMeshes: Handler = async (req: LaneRequest, ctx): Promise<HandlerResult> => {
    if (req.op !== "mass_meshes") throw new HandlerError("AR050", "잘못된 요청입니다");
    const parsed = massesSchema.safeParse(req.masses);
    if (!parsed.success) throw new HandlerError("AR050", "매스 형식이 올바르지 않습니다");
    checkFloors(parsed.data);
    const k = await kernel();
    await ctx.checkpoint();
    const meshes: MassMeshOut[] = [];
    for (const m of parsed.data) {
      let node: SolidNode | null;
      try {
        node = massSolidNode(m);
      } catch (e) {
        if (!(e instanceof HandlerError)) throw e;
        meshes.push({ id: m.id, positions: new Float32Array(0), index: new Uint32Array(0), failed: true });
        continue;
      }
      meshes.push({ id: m.id, ...renderOne(k, node) });
    }
    return { result: { meshes, mesh_version: MODELER_MESH_VERSION }, engine_version: MODELER_MESH_VERSION, transfer: buffersOf(meshes) };
  };

  const massExcess: Handler = async (req: LaneRequest, ctx): Promise<HandlerResult> => {
    if (req.op !== "mass_excess") throw new HandlerError("AR050", "잘못된 요청입니다");
    const parsed = designModelV1Schema.safeParse(req.model);
    if (!parsed.success) throw new HandlerError("AR050", "설계 모델 형식이 올바르지 않습니다");
    const ids = idsSchema.safeParse(req.mass_ids);
    if (!ids.success) throw new HandlerError("AR050", "매스 id 목록 형식이 올바르지 않습니다");
    const model = parsed.data;
    if (model.masses.length > MAX_MASSES) throw new HandlerError("AR050", `매스는 ${MAX_MASSES}개까지입니다`);
    checkFloors(model.masses);
    const selection = await deps.store.select(model.rule_context.rule_pack_version);
    const k = await kernel();
    await ctx.checkpoint();
    const key = envelopeKeyOf(model, selection.pack.version);
    if (envCache?.key !== key) {
      const out = buildEnvelope(model, selection.pack, k, { cap_height_mm: ENVELOPE_DISPLAY_CAP_MM });
      envCache = { key, out, node: { op: "mesh", mesh: out.solid } };
      await ctx.checkpoint();
    }
    const env = envCache;
    const wanted = ids.data === null ? model.masses : model.masses.filter((m) => (ids.data as string[]).includes(m.id));
    const excess: MassMeshOut[] = [];
    for (const m of wanted) {
      let node: SolidNode | null;
      try {
        node = massSolidNode(m);
      } catch (e) {
        if (!(e instanceof HandlerError)) throw e;
        excess.push({ id: m.id, positions: new Float32Array(0), index: new Uint32Array(0), failed: true });
        continue;
      }
      // 엔벨로프가 비었으면(EMPTY_ENVELOPE) 매스 전체가 초과분이다.
      const cut: SolidNode | null = node === null ? null : env.out.solid.triangles.length === 0 ? node : { op: "subtract", base: node, minus: [env.node] };
      excess.push({ id: m.id, ...renderOne(k, cut) });
    }
    let envelope: EnvelopeDisplay | null = null;
    if (req.want_envelope) {
      const r = intMeshToRender(env.out.solid);
      envelope = {
        key,
        positions: r.positions,
        index: r.index,
        top_mm: env.out.top_mm,
        top_source: env.out.top_source,
        constraints: env.out.constraints.map((c) => ({ key: c.key, ...(c.edge_class ? { edge_class: c.edge_class } : {}), status: c.status, applied: c.applied })),
        warnings: env.out.warnings.map((w) => ({ code: w.code, message: w.message })),
        rule_pack_version: env.out.rule_pack_version,
      };
    }
    const transfer = buffersOf(envelope ? [...excess, envelope] : excess);
    return {
      result: { envelope_key: key, envelope, excess, partial: ids.data !== null, rule_pack_fallback: selection.fallback, mesh_version: MODELER_MESH_VERSION },
      engine_version: ENVELOPE_ENGINE_VERSION,
      transfer,
    };
  };

  return { mass_meshes: massMeshes, mass_excess: massExcess };
}
