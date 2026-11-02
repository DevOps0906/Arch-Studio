// 웹 ProjectStore: 클라우드 사본(`arch.cloud_projects`, 04_API.md 2.1절 cloud-projects 행, ADR-001 3장) + IndexedDB 읽기 캐시(3.1절).
// 저장 순서(073 계약): `POST /api/cloud-projects/{id}/upload-url` → 서명 URL로 스냅숏 PUT → `POST /api/cloud-projects`(expected_version).
// 열기: `GET /api/cloud-projects/{id}/blob`(서명 다운로드 URL + org_id·version·bytes·sha256) → 캐시의 같은 version·sha256이면 그대로,
// 아니면 스트림으로 내려받아(누적 길이가 meta.bytes를 넘으면 중단) 길이·sha256·형식 검증 후 캐시.
// 삭제: 클라우드 사본 삭제 API가 계약(04_API)에 없어 NOT_SUPPORTED.
// 캐시 키 `${userId}:${orgId}:${id}`. 조직(또는 사용자)이 바뀌면 캐시 전체를 비운다. 로그아웃(`invalidate`)은 세대를 올려
// 그 전에 시작된 open·save가 늦게 끝나도 캐시에 다시 쓰지 않는다.
// save는 캐시를 읽지 않는다: 올리는 바이트는 언제나 호출자가 준 입력에서만 만든다(편집 캐시 업로드 0, ADR-001 3.1).
// 오류는 코드만(이름·설계 모델·버전·서버 문구 없음).
import { BridgeError, type ProjectErrorCode } from "../adapters/errors.ts";
import {
  assertExpectedVersion,
  assertProjectId,
  assertSaveProjectInput,
  type ProjectRecord,
  type ProjectStore,
  type ProjectSummary,
  type SaveProjectInput,
  type SaveProjectResult,
} from "../adapters/project-store.ts";
import { sha256Hex, type UserIdFn, type WebHttp } from "./http.ts";
import type { ProjectReadCache } from "./project-cache.ts";

/** 스냅숏 상한 = 서버 `project_snapshot` 상한(100MiB, uploads/policy). 넘으면 내려받기 전에 거부. */
export const SNAPSHOT_MAX_BYTES = 100 * 1024 * 1024;
export const SNAPSHOT_FORMAT = "arch-studio.project";
export const SNAPSHOT_FORMAT_VERSION = 1;
/** 클라우드 이름 한도(서버 zod·DB CHECK: btrim 1..120, 제어 문자 금지). ProjectStore 공통 한도(200)보다 좁다. */
export const CLOUD_NAME_MAX_CHARS = 120;
/** 목록 페이지 상한(서버 LIST_LIMIT 50 × 200 = 1만 건). 커서가 끝나지 않는 응답에 묶이지 않게. */
const MAX_LIST_PAGES = 200;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const fail = (code: ProjectErrorCode): never => {
  throw new BridgeError(code);
};

/**
 * HTTP 실패 → 코드(봉투 `error.code` 우선). 404는 `not_found`일 때만 NOT_FOUND(라우트 없음 404는 PROJECT_UNAVAILABLE).
 * 402(web_edit 없음·DB AR044: 만료·미배정·회수·fallback)는 읽기 전용 AR061.
 */
function codeOfStatus(status: number, code: string | null): ProjectErrorCode {
  if (code === "AR041") return "VERSION_CONFLICT";
  if (code === "23505") return "ALREADY_EXISTS";
  if (code === "AR040") return "QUOTA_EXCEEDED";
  if (code === "AR031" || status === 413) return "TOO_LARGE";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 402) return "AR061";
  if (status === 404 && code === "not_found") return "NOT_FOUND";
  if (status === 422) return "INVALID_INPUT";
  return "PROJECT_UNAVAILABLE";
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** 응답 본문을 스트림으로 읽되 누적 길이가 `limit`을 넘는 순간 중단한다. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) throw new Error("too large");
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.byteLength > limit) throw new Error("too large");
    return all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export class WebProjectStore implements ProjectStore {
  readonly #http: WebHttp;
  readonly #cache: ProjectReadCache | null;
  readonly #userId: UserIdFn;
  /** 이번 세션에 읽은 createdAt(저장 때 스냅숏에 유지). 설계 모델은 담지 않는다. */
  readonly #createdAt = new Map<string, string>();
  /** 로그아웃 세대. 올라가면 그 전에 시작한 작업은 캐시·createdAt에 쓰지 않는다. */
  #gen = 0;
  /** 지금 캐시 범위 `${userId}:${orgId}`. */
  #scope: string | null = null;

  constructor(http: WebHttp, cache: ProjectReadCache | null, userId: UserIdFn) {
    this.#http = http;
    this.#cache = cache;
    this.#userId = userId;
  }

  /** 로그아웃: 세대를 올리고 메모리 상태를 비운다(캐시 삭제는 조립부가 이어서 한다). */
  invalidate(): void {
    this.#gen++;
    this.#createdAt.clear();
    this.#scope = null;
  }

  /** 캐시 키. 사용자를 모르거나 세대가 바뀌었으면 null(캐시 안 씀). 범위가 바뀌면 캐시 전체를 비운다. */
  async #key(orgId: string, id: string, gen: number): Promise<string | null> {
    if (!this.#cache || gen !== this.#gen) return null;
    const userId = await this.#userId();
    if (!userId || gen !== this.#gen) return null;
    const scope = `${userId}:${orgId}`;
    if (this.#scope !== scope) {
      if (this.#scope !== null) {
        this.#createdAt.clear();
        await this.#cache.clear().catch(() => undefined);
      }
      if (gen !== this.#gen) return null;
      this.#scope = scope;
    }
    return `${scope}:${id}`;
  }

  async #api(method: "GET" | "POST", path: string, body?: unknown) {
    try {
      return await this.#http.api(method, path, body);
    } catch {
      return fail("PROJECT_UNAVAILABLE");
    }
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const q: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const r = await this.#api("GET", `/api/cloud-projects${q}`);
      if (!r.ok) {
        const code = codeOfStatus(r.status, r.code);
        fail(code === "UNAUTHENTICATED" || code === "RATE_LIMITED" ? code : "PROJECT_UNAVAILABLE");
      }
      const data = obj(r.data);
      if (!Array.isArray(data.items)) fail("PROJECT_UNAVAILABLE");
      for (const raw of data.items as unknown[]) {
        const it = obj(raw);
        if (
          typeof it.project_uuid !== "string" ||
          !UUID.test(it.project_uuid) ||
          typeof it.name !== "string" ||
          !Number.isSafeInteger(it.version) ||
          typeof it.updated_at !== "string"
        )
          continue;
        // 목록 API에는 대지 표시가 없다(073 응답 모양). 화면은 열기 후 값을 쓴다.
        out.push(
          Object.freeze({ id: it.project_uuid, name: it.name, siteLabel: null, updatedAt: it.updated_at, version: it.version as number }),
        );
      }
      cursor = typeof data.next === "string" && data.next !== "" ? data.next : null;
      if (!cursor) return out;
    }
    return out;
  }

  async open(id: string): Promise<ProjectRecord | null> {
    assertProjectId(id);
    const gen = this.#gen;
    const r = await this.#api("GET", `/api/cloud-projects/${id}/blob`);
    if (!r.ok) {
      const code = codeOfStatus(r.status, r.code);
      if (code === "NOT_FOUND") {
        if (this.#cache && this.#scope && gen === this.#gen) await this.#cache.delete(`${this.#scope}:${id}`);
        return null;
      }
      return fail(code === "VERSION_CONFLICT" || code === "INVALID_INPUT" ? "PROJECT_UNAVAILABLE" : code);
    }
    const meta = obj(r.data);
    const version = meta.version as number;
    const bytes = meta.bytes as number;
    const blobSha = meta.sha256 as string;
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > SNAPSHOT_MAX_BYTES ||
      typeof blobSha !== "string" ||
      !HEX64.test(blobSha) ||
      typeof meta.org_id !== "string" ||
      !UUID.test(meta.org_id) ||
      typeof meta.url !== "string" ||
      !meta.url.startsWith("https://")
    )
      fail("PROJECT_UNAVAILABLE");

    const key = await this.#key(meta.org_id as string, id, gen);
    const hit = key ? await this.#cache!.get(key) : null;
    if (hit && hit.record.id === id && hit.record.version === version && hit.blobSha256 === blobSha) {
      if (gen === this.#gen) this.#createdAt.set(id, hit.record.createdAt);
      return hit.record;
    }

    let body: Uint8Array;
    try {
      const res = await this.#http.signed("GET", meta.url as string);
      if (!res.ok) throw new Error("download");
      body = await readCapped(res, bytes);
    } catch {
      return fail("PROJECT_UNAVAILABLE");
    }
    if (body.byteLength !== bytes || (await sha256Hex(body)) !== blobSha) fail("PROJECT_UNAVAILABLE");

    const record = await parseSnapshot(body, id, version);
    // 로그아웃(세대 변경) 뒤에 끝난 내려받기는 캐시·메모리에 남기지 않는다.
    if (gen === this.#gen) {
      this.#createdAt.set(id, record.createdAt);
      if (key) await this.#cache!.put(key, { record, blobSha256: blobSha });
    }
    return record;
  }

  async save(input: SaveProjectInput): Promise<SaveProjectResult> {
    assertSaveProjectInput(input);
    const name = input.name.trim();
    if (Array.from(name).length > CLOUD_NAME_MAX_CHARS || CONTROL.test(name)) fail("INVALID_INPUT");
    try {
      const v: unknown = JSON.parse(input.designModel);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
    } catch {
      throw new BridgeError("INVALID_INPUT");
    }
    const gen = this.#gen;
    const expected = input.expectedVersion ?? 0;
    const now = new Date().toISOString();
    let createdAt = now;
    if (input.expectedVersion !== null) {
      createdAt = this.#createdAt.get(input.id) ?? (await this.open(input.id))?.createdAt ?? fail("NOT_FOUND");
    }
    const designSha = await sha256Hex(input.designModel);
    const record: ProjectRecord = Object.freeze({
      id: input.id,
      name,
      siteLabel: input.siteLabel ?? null,
      clientName: input.clientName ?? null,
      clientContact: input.clientContact ?? null,
      createdAt,
      updatedAt: now,
      version: expected + 1,
      schemaVersion: input.schemaVersion,
      engineVersion: input.engineVersion,
      designModel: input.designModel,
      sha256: designSha,
    });
    const blob = encodeSnapshot(record, input.note ?? null);
    if (blob.byteLength > SNAPSHOT_MAX_BYTES) fail("TOO_LARGE");
    const blobSha = await sha256Hex(blob);

    const signed = await this.#api("POST", `/api/cloud-projects/${input.id}/upload-url`, {
      ext: "arch",
      bytes: blob.byteLength,
      sha256: blobSha,
    });
    if (!signed.ok) fail(codeOfStatus(signed.status, signed.code));
    const target = obj(signed.data);
    const orgId = typeof target.path === "string" ? target.path.split("/")[0] : undefined;
    if (
      typeof target.signed_upload_url !== "string" ||
      !target.signed_upload_url.startsWith("https://") ||
      typeof orgId !== "string" ||
      !UUID.test(orgId)
    )
      fail("PROJECT_UNAVAILABLE");
    try {
      const put = await this.#http.signed("PUT", target.signed_upload_url as string, blob);
      if (!put.ok) throw new Error("upload");
    } catch {
      fail("PROJECT_UNAVAILABLE");
    }

    const saved = await this.#api("POST", "/api/cloud-projects", {
      project_uuid: input.id,
      name,
      storage_path: target.path,
      expected_version: expected,
    });
    if (!saved.ok) fail(codeOfStatus(saved.status, saved.code));
    const out = obj(saved.data);
    if (out.project_uuid !== input.id || out.version !== expected + 1) fail("PROJECT_UNAVAILABLE");

    // 서버가 받아들인 리비전 = 서버 정본과 같은 내용이라 읽기 캐시에 넣는다(로그아웃 뒤에 끝났으면 넣지 않음).
    if (gen === this.#gen) {
      this.#createdAt.set(input.id, createdAt);
      const key = await this.#key(orgId as string, input.id, gen);
      if (key && gen === this.#gen) await this.#cache!.put(key, { record, blobSha256: blobSha });
    }
    return { version: record.version, sha256: designSha };
  }

  /** 클라우드 사본 삭제 API가 계약에 없다(04_API 2.1). 입력 검사 후 NOT_SUPPORTED. */
  async delete(id: string, expectedVersion: number): Promise<void> {
    assertProjectId(id);
    assertExpectedVersion(expectedVersion);
    throw new BridgeError("NOT_SUPPORTED");
  }
}

/** 스냅숏(.arch) = UTF-8 JSON. version은 서버 행이 정본이라 넣지 않는다. */
export function encodeSnapshot(record: ProjectRecord, note: string | null): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: SNAPSHOT_FORMAT,
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      project: {
        id: record.id,
        name: record.name,
        siteLabel: record.siteLabel,
        clientName: record.clientName,
        clientContact: record.clientContact,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        schemaVersion: record.schemaVersion,
        engineVersion: record.engineVersion,
        note,
        designModel: record.designModel,
        sha256: record.sha256,
      },
    }),
  );
}

async function parseSnapshot(bytes: Uint8Array, id: string, version: number): Promise<ProjectRecord> {
  let root: Record<string, unknown>;
  try {
    root = obj(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return fail("PROJECT_UNAVAILABLE");
  }
  const p = obj(root.project);
  if (
    root.format !== SNAPSHOT_FORMAT ||
    root.formatVersion !== SNAPSHOT_FORMAT_VERSION ||
    p.id !== id ||
    typeof p.name !== "string" ||
    typeof p.designModel !== "string" ||
    typeof p.engineVersion !== "string" ||
    !Number.isSafeInteger(p.schemaVersion) ||
    typeof p.createdAt !== "string" ||
    typeof p.updatedAt !== "string" ||
    typeof p.sha256 !== "string" ||
    !HEX64.test(p.sha256)
  )
    fail("PROJECT_UNAVAILABLE");
  const sha = await sha256Hex(p.designModel as string);
  if (sha !== p.sha256) fail("PROJECT_UNAVAILABLE");
  return Object.freeze({
    id,
    name: p.name as string,
    siteLabel: textOrNull(p.siteLabel),
    clientName: textOrNull(p.clientName),
    clientContact: textOrNull(p.clientContact),
    createdAt: p.createdAt as string,
    updatedAt: p.updatedAt as string,
    version,
    schemaVersion: p.schemaVersion as number,
    engineVersion: p.engineVersion as string,
    designModel: p.designModel as string,
    sha256: sha,
  });
}
