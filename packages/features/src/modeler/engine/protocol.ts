// 모델러 ↔ 엔진 워커 표시 메시 요청(AR-06-036 추가 op, apps/desktop/src/workers/protocol.ts와 같은 모양) — 순수.
// - seq는 레인마다 모듈 전체에서 단조 증가한다(화면을 다시 열어도 워커의 최신 seq보다 작아지지 않게 — 작아지면 superseded로 끝난다).
// - 워커 응답은 신뢰 경계 밖으로 본다: 버퍼 형식·길이·꼭짓점 번호 범위를 검사하고, 틀리면 버린다(null).
import type { Model, Mass } from "../state/commands.ts";
import type { MeshData } from "../viewport/geometry.ts";

export type MeshLane = "mesh" | "preview";

const seqs: Record<MeshLane, number> = { mesh: -1, preview: -1 };

/** 레인 seq 발급(모듈 단조 증가). */
export function nextSeq(lane: MeshLane): number {
  seqs[lane] += 1;
  return seqs[lane];
}

let reqN = 0;
export function nextReqId(lane: MeshLane): string {
  reqN += 1;
  return `modeler:${lane}:${reqN}`;
}

export function buildMassMeshesRequest(reqId: string, seq: number, masses: readonly Mass[]) {
  return { op: "mass_meshes" as const, req_id: reqId, lane: "mesh" as const, seq, masses };
}

export function buildMassExcessRequest(reqId: string, seq: number, model: Model, massIds: readonly string[] | null, wantEnvelope: boolean) {
  return { op: "mass_excess" as const, req_id: reqId, lane: "preview" as const, seq, model, mass_ids: massIds === null ? null : [...massIds], want_envelope: wantEnvelope };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** 표시 메시 상한(장면 상한 20만 삼각형의 2배 여유, [DECISION] 2절 L3). */
export const MAX_TRIANGLES = 400_000;

/** 버퍼 검사: Float32Array(3의 배수, 유한) + Uint32Array(3의 배수, 번호 < 꼭짓점 수). */
export function parseMeshData(v: unknown): MeshData | null {
  if (!isRecord(v)) return null;
  const { positions, index } = v;
  if (!(positions instanceof Float32Array) || !(index instanceof Uint32Array)) return null;
  if (positions.length % 3 !== 0 || index.length % 3 !== 0 || index.length / 3 > MAX_TRIANGLES) return null;
  const nv = positions.length / 3;
  for (let i = 0; i < index.length; i++) if ((index[i] as number) >= nv) return null;
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i] as number)) return null;
  return { positions, index };
}

export interface MassMeshResult {
  readonly id: string;
  readonly mesh: MeshData;
  readonly failed: boolean;
}

/** mass_meshes 결과 → 매스별 메시. 형식이 틀린 항목은 뺀다. */
export function parseMassMeshes(result: unknown): MassMeshResult[] | null {
  if (!isRecord(result) || !Array.isArray(result.meshes)) return null;
  const out: MassMeshResult[] = [];
  for (const m of result.meshes as unknown[]) {
    if (!isRecord(m) || typeof m.id !== "string") continue;
    const mesh = parseMeshData(m);
    if (!mesh) continue;
    out.push({ id: m.id, mesh, failed: m.failed === true });
  }
  return out;
}

export interface EnvelopeView {
  readonly mesh: MeshData;
  readonly topMm: number;
  readonly topSource: "height_rule" | "display_cap";
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly constraints: readonly { readonly key: string; readonly status: string; readonly applied: boolean; readonly edgeClass?: string }[];
  readonly rulePackVersion: string;
}

export interface MassExcessResult {
  readonly envelope: EnvelopeView | null;
  readonly envelopeKey: string;
  readonly excess: readonly MassMeshResult[];
  readonly partial: boolean;
  readonly rulePackFallback: boolean;
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseMassExcess(result: unknown): MassExcessResult | null {
  if (!isRecord(result) || typeof result.envelope_key !== "string" || !Array.isArray(result.excess)) return null;
  let envelope: EnvelopeView | null = null;
  if (isRecord(result.envelope)) {
    const e = result.envelope;
    const mesh = parseMeshData(e);
    if (!mesh || typeof e.top_mm !== "number" || !Number.isFinite(e.top_mm)) return null;
    envelope = {
      mesh,
      topMm: e.top_mm,
      topSource: e.top_source === "height_rule" ? "height_rule" : "display_cap",
      warnings: (Array.isArray(e.warnings) ? e.warnings : []).filter(isRecord).map((w) => ({ code: str(w.code, 60), message: str(w.message) })),
      constraints: (Array.isArray(e.constraints) ? e.constraints : []).filter(isRecord).map((c) => ({
        key: str(c.key, 40),
        status: str(c.status, 40),
        applied: c.applied === true,
        ...(typeof c.edge_class === "string" ? { edgeClass: str(c.edge_class, 20) } : {}),
      })),
      rulePackVersion: str(e.rule_pack_version, 40),
    };
  } else if (result.envelope !== null && result.envelope !== undefined) return null;
  const excess = parseMassMeshes({ meshes: result.excess }) ?? [];
  return { envelope, envelopeKey: result.envelope_key, excess, partial: result.partial === true, rulePackFallback: result.rule_pack_fallback === true };
}

/** 대지·규칙 문맥 키(화면 쪽). 바뀌면 엔벨로프를 다시 받는다(워커 키는 팩 버전까지 포함). */
export function envelopeInputKey(model: Model): string {
  return JSON.stringify([model.site, model.rule_context]);
}

/** 워커 오류 → 화면 문구. 워커 detail은 본문 값을 싣지 않는 고정 문구라 그대로 붙인다(길이 제한). */
export function engineErrorText(code: string, detail: unknown): string {
  const d = typeof detail === "string" && detail.length > 0 ? detail.slice(0, 120) : "";
  if (code === "ENGINE_UNAVAILABLE") return "엔진을 쓸 수 없는 환경입니다.";
  return d ? `${d}(${code.slice(0, 20)})` : `엔진 오류(${code.slice(0, 20)})`;
}
