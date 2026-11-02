// 웹 ProjectStore: 클라우드 사본(`arch.cloud_projects`, 04_API.md 2.1절 cloud-projects 행, ADR-001 3장) + IndexedDB 읽기 캐시(3.1절).
// 저장 순서(073 계약): `POST /api/cloud-projects/{id}/upload-url` → 서명 URL로 스냅숏 PUT → `POST /api/cloud-projects`(expected_version).
// 열기: `GET /api/cloud-projects/{id}/blob`(서명 다운로드 URL + version) → 캐시의 같은 version이면 그대로, 아니면 내려받아 검증 후 캐시.
// 삭제: `DELETE /api/cloud-projects/{id}?expected_version=N`(서버 라우트 미구현, 제안 — tasks/logs/AR-06-072.md).
// 동시성 규칙은 ProjectStore 계약과 같다: 새 프로젝트 expectedVersion null → 서버 expected_version 0. 409 `AR041` → VERSION_CONFLICT.
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
import { sha256Hex, type WebHttp } from "./http.ts";
import type { ProjectReadCache } from "./project-cache.ts";

/** 스냅숏 상한 = 서버 `project_snapshot` 상한(100MiB, uploads/policy). 넘으면 내려받기 전에 거부. */
export const SNAPSHOT_MAX_BYTES = 100 * 1024 * 1024;
export const SNAPSHOT_FORMAT = "arch-studio.project";
export const SNAPSHOT_FORMAT_VERSION = 1;
/** 목록 페이지 상한(서버 LIST_LIMIT 50 × 200 = 1만 건). 커서가 끝나지 않는 응답에 묶이지 않게. */
const MAX_LIST_PAGES = 200;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fail = (code: ProjectErrorCode): never => {
  throw new BridgeError(code);
};

/** HTTP 실패 → 코드. 402(web_edit 없음: 만료·미배정·회수·fallback)는 읽기 전용 AR061. */
function codeOfStatus(status: number, code: string | null): ProjectErrorCode {
  if (status === 409 || code === "AR041") return "VERSION_CONFLICT";
  if (status === 404) return "NOT_FOUND";
  if (status === 402) return "AR061";
  if (status === 422) return "INVALID_INPUT";
  return "PROJECT_UNAVAILABLE";
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

export class WebProjectStore implements ProjectStore {
  readonly #http: WebHttp;
  readonly #cache: ProjectReadCache | null;
  /** 이번 세션에 읽은 createdAt(저장 때 스냅숏에 유지). 설계 모델은 담지 않는다. */
  readonly #createdAt = new Map<string, string>();

  constructor(http: WebHttp, cache: ProjectReadCache | null) {
    this.#http = http;
    this.#cache = cache;
  }

  async #api(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
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
      if (!r.ok) fail("PROJECT_UNAVAILABLE");
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
    const r = await this.#api("GET", `/api/cloud-projects/${id}/blob`);
    if (r.status === 404) {
      await this.#cache?.delete(id);
      return null;
    }
    if (!r.ok) fail("PROJECT_UNAVAILABLE");
    const meta = obj(r.data);
    const version = meta.version;
    if (!Number.isSafeInteger(version) || (version as number) < 1) fail("PROJECT_UNAVAILABLE");

    const cached = this.#cache ? await this.#cache.get(id) : null;
    if (cached && cached.version === version) {
      this.#createdAt.set(id, cached.createdAt);
      return cached;
    }

    // 크기 상한은 내려받기 전에(메타 bytes → content-length → 실제 길이 순서로 세 번).
    if (!Number.isSafeInteger(meta.bytes) || (meta.bytes as number) <= 0 || (meta.bytes as number) > SNAPSHOT_MAX_BYTES) {
      fail("PROJECT_UNAVAILABLE");
    }
    if (typeof meta.url !== "string" || !meta.url.startsWith("https://")) fail("PROJECT_UNAVAILABLE");
    let bytes: Uint8Array;
    try {
      const res = await this.#http.signed("GET", meta.url as string);
      if (!res.ok) throw new Error("download");
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > SNAPSHOT_MAX_BYTES) throw new Error("too large");
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      return fail("PROJECT_UNAVAILABLE");
    }
    if (bytes.byteLength > SNAPSHOT_MAX_BYTES) fail("PROJECT_UNAVAILABLE");
    if (typeof meta.sha256 === "string" && meta.sha256 !== (await sha256Hex(bytes))) fail("PROJECT_UNAVAILABLE");

    const record = await parseSnapshot(bytes, id, version as number);
    this.#createdAt.set(id, record.createdAt);
    await this.#cache?.put(record);
    return record;
  }

  async save(input: SaveProjectInput): Promise<SaveProjectResult> {
    assertSaveProjectInput(input);
    try {
      const v: unknown = JSON.parse(input.designModel);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
    } catch {
      throw new BridgeError("INVALID_INPUT");
    }
    const expected = input.expectedVersion ?? 0;
    const now = new Date().toISOString();
    let createdAt = now;
    if (input.expectedVersion !== null) {
      createdAt = this.#createdAt.get(input.id) ?? (await this.open(input.id))?.createdAt ?? fail("NOT_FOUND");
    }
    const designSha = await sha256Hex(input.designModel);
    const record: ProjectRecord = Object.freeze({
      id: input.id,
      name: input.name,
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
    if (blob.byteLength > SNAPSHOT_MAX_BYTES) fail("INVALID_INPUT");
    const blobSha = await sha256Hex(blob);

    const signed = await this.#api("POST", `/api/cloud-projects/${input.id}/upload-url`, {
      ext: "arch",
      bytes: blob.byteLength,
      sha256: blobSha,
    });
    if (!signed.ok) fail(codeOfStatus(signed.status, signed.code));
    const target = obj(signed.data);
    if (
      typeof target.signed_upload_url !== "string" ||
      !target.signed_upload_url.startsWith("https://") ||
      typeof target.path !== "string"
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
      name: input.name,
      storage_path: target.path,
      expected_version: expected,
    });
    if (!saved.ok) fail(codeOfStatus(saved.status, saved.code));
    const out = obj(saved.data);
    if (out.project_uuid !== input.id || out.version !== expected + 1) fail("PROJECT_UNAVAILABLE");

    this.#createdAt.set(input.id, createdAt);
    // 서버가 받아들인 리비전 = 서버 정본과 같은 내용이라 읽기 캐시에 넣는다.
    await this.#cache?.put(record);
    return { version: record.version, sha256: designSha };
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    assertProjectId(id);
    assertExpectedVersion(expectedVersion);
    const r = await this.#api("DELETE", `/api/cloud-projects/${id}?expected_version=${expectedVersion}`);
    if (!r.ok) fail(codeOfStatus(r.status, r.code));
    this.#createdAt.delete(id);
    await this.#cache?.delete(id);
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
