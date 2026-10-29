// 모델러 엔진 클라이언트(어댑터): 엔진 워커(useEngine 호스트)에 표시 메시를 요청하고 결과를 모아 둔다. React와 무관(테스트는 가짜 호스트).
// - mass_meshes(mesh 레인): 캐시에 없는 기하 키의 매스만 보낸다. 결과는 기하 키로 캐시(위치가 같으면 다시 계산하지 않는다).
// - mass_excess(preview 레인): 합치기(coalesce)로 한 번에 하나만 보낸다. 드래그 중 = 움직인 매스 1개(부분), 놓은 뒤 = 전체.
// - 워커가 없거나 실패하면 화면은 TS 폴백 메시(viewport/geometry.ts prismMesh)로 그린다. 초과분·엔벨로프는 워커가 있어야 보인다.
// Manifold는 여기서 부르지 않는다(워커 전용). 응답 버퍼는 protocol.ts 검사를 통과한 것만 쓴다.
import type { EngineHost, EngineRequestLike, EngineResponseLike } from "../../shell/types.ts";
import type { Mass, Model } from "../state/commands.ts";
import { meshKey, type MeshData } from "../viewport/geometry.ts";
import { idleCoalescer, offer, settle, type Coalescer } from "./coalesce.ts";
import {
  buildMassExcessRequest,
  buildMassMeshesRequest,
  engineErrorText,
  envelopeInputKey,
  nextReqId,
  nextSeq,
  parseMassExcess,
  parseMassMeshes,
  type EnvelopeView,
} from "./protocol.ts";

export type EnvelopeStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

export interface EngineSnapshot {
  /** 기하 키 → 워커 메시. */
  readonly meshes: ReadonlyMap<string, MeshData>;
  /** 워커가 기하 오류로 못 만든 기하 키. */
  readonly failedKeys: ReadonlySet<string>;
  readonly envelope: EnvelopeView | null;
  readonly envelopeStatus: EnvelopeStatus;
  readonly envelopeError: string | null;
  /** 매스 id → 엔벨로프 밖 초과분 메시(비었으면 항목 없음). */
  readonly excess: ReadonlyMap<string, MeshData>;
  readonly excessBusy: boolean;
}

interface ExcessJob {
  readonly model: Model;
  readonly ids: readonly string[] | null;
}

const MESH_CACHE_SLACK = 64;

export class ModelerEngineClient {
  private readonly host: EngineHost | null;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private snap: EngineSnapshot;
  /** 보낸 mass_meshes: req_id → (매스 id → 기하 키). */
  private readonly meshReqs = new Map<string, Map<string, string>>();
  private readonly pendingKeys = new Set<string>();
  private excessReq: { reqId: string; envKey: string; partial: boolean } | null = null;
  private coalescer: Coalescer<ExcessJob> = idleCoalescer();
  private receivedEnvKey: string | null = null;

  constructor(host: EngineHost | null) {
    this.host = host;
    this.snap = {
      meshes: new Map(),
      failedKeys: new Set(),
      envelope: null,
      envelopeStatus: host ? "idle" : "unavailable",
      envelopeError: host ? null : engineErrorText("ENGINE_UNAVAILABLE", null),
      excess: new Map(),
      excessBusy: false,
    };
    if (host) this.unsubscribe = host.subscribe((r) => this.onResponse(r));
  }

  getSnapshot = (): EngineSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<EngineSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private send(req: EngineRequestLike): boolean {
    if (!this.host) return false;
    try {
      this.host.send(req);
      return true;
    } catch {
      return false;
    }
  }

  /** 매스 메시 동기화: 캐시·대기·실패에 없는 기하 키만 요청한다. 캐시는 지금 키 + 여유분만 남긴다. */
  syncMeshes(masses: readonly Mass[]): void {
    const current = new Map<string, string>();
    for (const m of masses) current.set(m.id, meshKey(m));
    const keys = new Set(current.values());
    if (this.snap.meshes.size > keys.size + MESH_CACHE_SLACK) {
      const meshes = new Map([...this.snap.meshes].filter(([k]) => keys.has(k)));
      this.set({ meshes });
    }
    if (!this.host) return;
    const want: Mass[] = [];
    const idToKey = new Map<string, string>();
    const seen = new Set<string>();
    for (const m of masses) {
      const k = current.get(m.id) as string;
      if (this.snap.meshes.has(k) || this.snap.failedKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      want.push(m);
      idToKey.set(m.id, k);
    }
    // 빠진 키가 모두 이미 요청 중이면 보내지 않는다. 하나라도 새것이면 빠진 키 전부를 한 요청으로 보낸다(앞 요청은 superseded).
    if (want.length === 0 || [...idToKey.values()].every((k) => this.pendingKeys.has(k))) return;
    const reqId = nextReqId("mesh");
    if (!this.send(buildMassMeshesRequest(reqId, nextSeq("mesh"), want))) return;
    // 최신만 유효 레인: 앞 요청은 superseded로 끝나므로 그 키들은 이번 요청에 다시 들어가야 한다 → 대기 키를 이번 요청 것으로 바꾼다.
    for (const ids of this.meshReqs.values()) for (const k of ids.values()) this.pendingKeys.delete(k);
    this.meshReqs.clear();
    this.meshReqs.set(reqId, idToKey);
    for (const k of idToKey.values()) this.pendingKeys.add(k);
  }

  /** 초과분·엔벨로프 요청. ids = null이면 전체. 응답을 기다리는 중이면 마지막 요청만 남긴다. */
  requestExcess(model: Model, ids: readonly string[] | null): void {
    if (!this.host) return;
    const r = offer(this.coalescer, { model, ids });
    this.coalescer = r.state;
    if (r.send) this.dispatchExcess(r.send);
  }

  private dispatchExcess(job: ExcessJob): void {
    const envKey = envelopeInputKey(job.model);
    const want = envKey !== this.receivedEnvKey;
    const reqId = nextReqId("preview");
    if (!this.send(buildMassExcessRequest(reqId, nextSeq("preview"), job.model, job.ids, want))) {
      this.coalescer = idleCoalescer();
      this.set({ envelopeStatus: "error", envelopeError: engineErrorText("ENGINE_UNAVAILABLE", null), excessBusy: false });
      return;
    }
    this.excessReq = { reqId, envKey, partial: job.ids !== null };
    this.set({ excessBusy: true, ...(want ? { envelopeStatus: "loading" as const } : {}) });
  }

  private finishExcess(): void {
    this.excessReq = null;
    const r = settle(this.coalescer);
    this.coalescer = r.state;
    if (r.send) this.dispatchExcess(r.send);
    else this.set({ excessBusy: false });
  }

  private onResponse(raw: EngineResponseLike): void {
    const r = raw as unknown as Record<string, unknown>;
    if (typeof r.req_id !== "string") return;
    const meshIds = this.meshReqs.get(r.req_id);
    if (meshIds) {
      if ("status" in r && r.status === "progress") return;
      this.meshReqs.delete(r.req_id);
      for (const k of meshIds.values()) this.pendingKeys.delete(k);
      if (r.ok !== true) return; // 실패·superseded: 폴백 메시로 남는다(다음 동기화 때 다시 요청)
      const parsed = parseMassMeshes(r.result);
      if (!parsed) return;
      const meshes = new Map(this.snap.meshes);
      const failedKeys = new Set(this.snap.failedKeys);
      for (const m of parsed) {
        const k = meshIds.get(m.id);
        if (!k) continue;
        if (m.failed) failedKeys.add(k);
        else meshes.set(k, m.mesh);
      }
      this.set({ meshes, failedKeys });
      return;
    }
    const ex = this.excessReq;
    if (!ex || ex.reqId !== r.req_id) return;
    if ("status" in r && r.status === "progress") return;
    if (r.ok === true) {
      const parsed = parseMassExcess(r.result);
      if (!parsed) {
        this.set({ envelopeStatus: "error", envelopeError: engineErrorText("INVALID_RESPONSE", "엔진 응답 형식이 올바르지 않습니다") });
      } else {
        const excess = parsed.partial ? new Map(this.snap.excess) : new Map<string, MeshData>();
        for (const e of parsed.excess) {
          if (e.mesh.index.length > 0) excess.set(e.id, e.mesh);
          else excess.delete(e.id);
        }
        const patch: Partial<EngineSnapshot> = { excess };
        if (parsed.envelope) {
          this.receivedEnvKey = ex.envKey;
          Object.assign(patch, { envelope: parsed.envelope, envelopeStatus: "ready", envelopeError: null });
        } else if (this.snap.envelopeStatus === "loading") Object.assign(patch, { envelopeStatus: this.snap.envelope ? "ready" : "idle" });
        this.set(patch);
      }
    } else if (r.ok === false) {
      this.receivedEnvKey = null;
      this.set({ envelope: null, excess: new Map(), envelopeStatus: "error", envelopeError: engineErrorText(typeof r.code === "string" ? r.code : "UNKNOWN", r.detail) });
    }
    // 성공·실패·superseded·canceled: 다음 대기 요청을 보낸다.
    this.finishExcess();
  }

  /** 다시 시도(엔벨로프 오류 뒤). */
  retry(model: Model): void {
    this.receivedEnvKey = null;
    this.requestExcess(model, null);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const id of [...this.meshReqs.keys(), ...(this.excessReq ? [this.excessReq.reqId] : [])]) this.send({ op: "cancel", req_id: id });
    this.meshReqs.clear();
    this.pendingKeys.clear();
    this.excessReq = null;
    this.listeners.clear();
  }
}
