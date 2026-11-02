// 웹 ProjectStore(AR-06-072, ADR-001 3.1): 정본은 서버 `arch.cloud_projects`(073) + Storage blob(.arch = 아래 JSON).
// 흐름: 저장 = (사전 확인) → POST /{id}/upload-url → PUT 서명 URL → POST /api/cloud-projects. 열기 = GET /{id}/blob → 서명 URL 내려받기.
// IndexedDB는 읽기 캐시뿐이다: list·open이 읽은 결과를 넣고, 서버에 닿지 못할 때만 되돌려 준다. save·delete는 캐시를 읽지 않는다.
// 서버가 사본을 하드 삭제하므로 "삭제된 id로 다시 저장 = NOT_FOUND"는 이 인스턴스(세션) 안에서만 지킨다(메모리 묘비).
// 오류에는 코드만(이름·모델·버전 값 없음). 입력 검사는 070 공용 함수(Rust와 같은 한도).
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
import { sha256Hex } from "./hash.ts";
import type { ApiResult, WebApi } from "./http.ts";
import type { ReadCache } from "./read-cache.ts";

/** 서버 project_snapshot 상한(버킷 100MB, 04_API 업로드 정책). 넘는 blob은 올리기 전에 거부. */
export const WEB_BLOB_MAX_BYTES = 100 * 1024 * 1024;
const NAME_MAX_CHARS = 120;
const MAX_LIST_PAGES = 100;
const BLOB_KIND = "arch-cloud-project";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

interface BlobMeta {
  readonly url: string;
  readonly version: number;
  readonly bytes: number;
}

interface BlobBody {
  readonly kind: typeof BLOB_KIND;
  readonly v: 1;
  readonly name: string;
  readonly siteLabel: string | null;
  readonly clientName: string | null;
  readonly clientContact: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly note: string | null;
  readonly designModel: string;
}

/** 서버에 닿지 못함(네트워크·5xx). 읽기 캐시 대체 판단용 내부 표식(코드는 PROJECT_UNAVAILABLE 그대로). */
class Unreachable extends BridgeError {
  constructor() {
    super("PROJECT_UNAVAILABLE");
  }
}

const fail = (code: ProjectErrorCode): never => {
  throw new BridgeError(code);
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

/** 서버 오류 → 도메인 코드. 상태·코드만 본다. */
function projectError(r: ApiResult): BridgeError {
  if (r.status === 404) return new BridgeError("NOT_FOUND");
  if (r.status === 409 && r.code === "AR041") return new BridgeError("VERSION_CONFLICT");
  if (r.status === 413 || r.status === 422) return new BridgeError("INVALID_INPUT");
  return new BridgeError("PROJECT_UNAVAILABLE");
}

/** 서버 이름 규칙(1..120자, 제어 문자 없음)에 맞춘 목록용 이름. 전체 이름은 blob에 있다. */
function listName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return Array.from(cleaned).slice(0, NAME_MAX_CHARS).join("").trim() || "-";
}

function parseBlob(bytes: Uint8Array): BlobBody {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes));
  } catch {
    return fail("PROJECT_UNAVAILABLE");
  }
  if (!isRecord(raw) || raw.kind !== BLOB_KIND || raw.v !== 1) return fail("PROJECT_UNAVAILABLE");
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : fail("PROJECT_UNAVAILABLE"));
  const opt = (k: string) => (raw[k] === null ? null : str(k));
  if (!isVersion(raw.schemaVersion)) return fail("PROJECT_UNAVAILABLE");
  return {
    kind: BLOB_KIND,
    v: 1,
    name: str("name"),
    siteLabel: opt("siteLabel"),
    clientName: opt("clientName"),
    clientContact: opt("clientContact"),
    createdAt: str("createdAt"),
    updatedAt: str("updatedAt"),
    schemaVersion: raw.schemaVersion,
    engineVersion: str("engineVersion"),
    note: opt("note"),
    designModel: str("designModel"),
  };
}

export interface WebProjectStoreOptions {
  readonly api: WebApi;
  readonly cache: ReadCache;
  readonly now?: () => Date;
}

export class WebProjectStore implements ProjectStore {
  readonly #api: WebApi;
  readonly #cache: ReadCache;
  readonly #now: () => Date;
  /** 이 인스턴스에서 지운 id(하드 삭제 서버에서 NOT_FOUND 계약을 지키기 위한 메모리 묘비). */
  readonly #deleted = new Set<string>();
  /** 이 인스턴스가 서버에서 읽은 createdAt(저장 때 blob 재다운로드를 피함. 캐시가 아니라 메모리). */
  readonly #createdAt = new Map<string, string>();

  constructor(options: WebProjectStoreOptions) {
    this.#api = options.api;
    this.#cache = options.cache;
    this.#now = options.now ?? (() => new Date());
  }

  /** 로그아웃: 메모리 상태 비움(캐시는 어댑터 묶음이 비운다). */
  reset(): void {
    this.#deleted.clear();
    this.#createdAt.clear();
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const epoch = this.#cache.epoch();
    const items: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const q: string = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      const r = await this.#api.call("GET", `/api/cloud-projects${q}`);
      if (r.status !== 200 || !isRecord(r.data) || !Array.isArray(r.data.items)) return this.#listFallback(r);
      for (const it of r.data.items) if (isRecord(it)) items.push(it);
      cursor = typeof r.data.next === "string" ? r.data.next : null;
      if (cursor === null) break;
    }
    const previous = new Map((await this.#cache.getList())?.map((s) => [s.id, s]) ?? []);
    const out: ProjectSummary[] = [];
    for (const it of items) {
      const id = it.project_uuid;
      if (typeof id !== "string" || typeof it.name !== "string" || typeof it.updated_at !== "string" || !isVersion(it.version)) continue;
      const before = previous.get(id);
      out.push({
        id,
        name: it.name,
        // 서버 목록에는 대지 라벨이 없다: 같은 버전을 이미 읽었으면 그 값, 아니면 null.
        siteLabel: before && before.version === it.version ? before.siteLabel : null,
        updatedAt: it.updated_at,
        version: it.version,
      });
    }
    await this.#cache.putList(out, epoch);
    return out;
  }

  async #listFallback(r: ApiResult): Promise<readonly ProjectSummary[]> {
    // 서버에 닿지 못했을 때만 읽기 캐시를 돌려준다(인증·권한 오류는 캐시로 가리지 않는다).
    if (r.status === 0 || r.status >= 500) {
      const cached = await this.#cache.getList();
      if (cached) return cached;
    }
    throw projectError(r);
  }

  async #blobMeta(id: string): Promise<{ meta: BlobMeta | null; result: ApiResult }> {
    const r = await this.#api.call("GET", `/api/cloud-projects/${id}/blob`);
    if (r.status === 404) return { meta: null, result: r };
    if (r.status === 0 || r.status >= 500) throw new Unreachable();
    if (r.status !== 200 || !isRecord(r.data)) throw projectError(r);
    const { url, version, bytes } = r.data;
    if (!this.#api.isSafeSignedUrl(url) || !isVersion(version) || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) {
      return fail("PROJECT_UNAVAILABLE");
    }
    return { meta: { url, version, bytes }, result: r };
  }

  async #download(meta: BlobMeta): Promise<BlobBody> {
    if (meta.bytes > WEB_BLOB_MAX_BYTES) return fail("PROJECT_UNAVAILABLE");
    const got = await this.#api.transfer(meta.url, { method: "GET", maxBytes: WEB_BLOB_MAX_BYTES });
    if (!(got instanceof Uint8Array) || got.byteLength > WEB_BLOB_MAX_BYTES) return fail("PROJECT_UNAVAILABLE");
    return parseBlob(got);
  }

  async open(id: string): Promise<ProjectRecord | null> {
    const epoch = this.#cache.epoch();
    assertProjectId(id);
    if (this.#deleted.has(id)) return null;
    let meta: BlobMeta | null;
    try {
      ({ meta } = await this.#blobMeta(id));
    } catch (e) {
      // 서버에 닿지 못할 때만 읽기 캐시(읽기 전용). 그 밖의 오류는 그대로.
      if (e instanceof Unreachable) {
        const cached = await this.#cache.getRecord(id);
        if (cached) return cached;
      }
      throw e;
    }
    if (!meta) {
      await this.#cache.deleteRecord(id);
      return null;
    }
    const cached = await this.#cache.getRecord(id);
    if (cached && cached.version === meta.version) {
      this.#createdAt.set(id, cached.createdAt);
      return cached;
    }
    const blob = await this.#download(meta);
    const record: ProjectRecord = {
      id,
      name: blob.name,
      siteLabel: blob.siteLabel,
      clientName: blob.clientName,
      clientContact: blob.clientContact,
      createdAt: blob.createdAt,
      updatedAt: blob.updatedAt,
      version: meta.version,
      schemaVersion: blob.schemaVersion,
      engineVersion: blob.engineVersion,
      designModel: blob.designModel,
      sha256: await sha256Hex(encoder.encode(blob.designModel)),
    };
    this.#createdAt.set(id, record.createdAt);
    await this.#cache.putRecord(record, epoch);
    return record;
  }

  async save(input: SaveProjectInput): Promise<SaveProjectResult> {
    const epoch = this.#cache.epoch();
    assertSaveProjectInput(input);
    // 설계 모델은 JSON 객체여야 한다(저장소가 최종 판정, 070 계약).
    try {
      if (!isRecord(JSON.parse(input.designModel))) return fail("INVALID_INPUT");
    } catch {
      return fail("INVALID_INPUT");
    }
    const { id, expectedVersion } = input;
    if (this.#deleted.has(id)) return fail("NOT_FOUND");

    // 사전 확인(업로드 전에 충돌·없음을 가려 고아 blob을 만들지 않는다). 서버 RPC가 마지막 판정이다.
    const { meta } = await this.#blobMeta(id);
    if (expectedVersion === null) {
      if (meta) return fail("VERSION_CONFLICT");
    } else {
      if (!meta) return fail("NOT_FOUND");
      if (meta.version !== expectedVersion) return fail("VERSION_CONFLICT");
    }
    let createdAt = this.#createdAt.get(id);
    if (meta && createdAt === undefined) createdAt = (await this.#download(meta)).createdAt;

    const now = this.#now().toISOString();
    const body: BlobBody = {
      kind: BLOB_KIND,
      v: 1,
      name: input.name,
      siteLabel: input.siteLabel ?? null,
      clientName: input.clientName ?? null,
      clientContact: input.clientContact ?? null,
      createdAt: createdAt ?? now,
      updatedAt: now,
      schemaVersion: input.schemaVersion,
      engineVersion: input.engineVersion,
      note: input.note ?? null,
      designModel: input.designModel,
    };
    const bytes = encoder.encode(JSON.stringify(body));
    if (bytes.byteLength > WEB_BLOB_MAX_BYTES) return fail("INVALID_INPUT");

    const sign = await this.#api.call("POST", `/api/cloud-projects/${id}/upload-url`, {
      ext: "arch",
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
    if (sign.status !== 200 || !isRecord(sign.data)) throw projectError(sign);
    const { signed_upload_url: uploadUrl, path } = sign.data;
    if (!this.#api.isSafeSignedUrl(uploadUrl) || typeof path !== "string") return fail("PROJECT_UNAVAILABLE");
    if ((await this.#api.transfer(uploadUrl, { method: "PUT", body: bytes })) !== true) return fail("PROJECT_UNAVAILABLE");

    const saved = await this.#api.call("POST", "/api/cloud-projects", {
      project_uuid: id,
      name: listName(input.name),
      storage_path: path,
      expected_version: expectedVersion ?? 0,
    });
    if (saved.status !== 200 || !isRecord(saved.data)) throw projectError(saved);
    const version = saved.data.version;
    // 서버가 저장했으므로 version이 expected+1과 달라도 실패로 보지 않는다: 캐시를 서버 값으로 갱신하고 서버 값을 돌려준다.
    if (saved.data.project_uuid !== id || !isVersion(version) || version <= (expectedVersion ?? 0)) {
      return fail("PROJECT_UNAVAILABLE");
    }

    const sha256 = await sha256Hex(encoder.encode(input.designModel));
    this.#createdAt.set(id, body.createdAt);
    await this.#cache.putRecord({
      id,
      name: body.name,
      siteLabel: body.siteLabel,
      clientName: body.clientName,
      clientContact: body.clientContact,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
      version,
      schemaVersion: body.schemaVersion,
      engineVersion: body.engineVersion,
      designModel: body.designModel,
      sha256,
    }, epoch);
    return { version, sha256 };
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    assertProjectId(id);
    assertExpectedVersion(expectedVersion);
    if (this.#deleted.has(id)) return fail("NOT_FOUND");
    const r = await this.#api.call("DELETE", `/api/cloud-projects/${id}?expected_version=${expectedVersion}`);
    if (r.status !== 200) throw projectError(r);
    this.#deleted.add(id);
    this.#createdAt.delete(id);
    await this.#cache.deleteRecord(id);
  }
}
