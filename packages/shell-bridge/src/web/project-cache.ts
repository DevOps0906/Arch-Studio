// 웹 프로젝트 읽기 캐시(ADR-001 3.1: IndexedDB는 **읽기 캐시만**). 서버에서 받은(또는 서버가 방금 받아들인) 리비전만 넣고,
// ProjectStore.save는 이 캐시를 읽지 않는다(편집 캐시를 서버로 올리는 경로 0). 로그아웃(clearSecrets)에서 전부 지운다(공용 PC).
// 캐시는 최적화일 뿐이라 실패는 삼킨다(열기는 서버로 간다). IDBFactory는 주입받는다: 앱 조립부가 브라우저 전역을 넘긴다.
import type { ProjectRecord } from "../adapters/project-store.ts";

export interface ProjectReadCache {
  get(id: string): Promise<ProjectRecord | null>;
  put(record: ProjectRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /** 전부 삭제(로그아웃). */
  clear(): Promise<void>;
}

export const PROJECT_CACHE_DB = "arch-studio-read-cache";
const STORE = "projects";
const DB_VERSION = 1;

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("idb request failed"));
  });
}

function isRecord(v: unknown): v is ProjectRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.designModel === "string" &&
    typeof r.sha256 === "string" &&
    Number.isSafeInteger(r.version) &&
    Number.isSafeInteger(r.schemaVersion) &&
    typeof r.engineVersion === "string" &&
    typeof r.createdAt === "string" &&
    typeof r.updatedAt === "string"
  );
}

/** IndexedDB 구현. DB 하나·저장소 하나(keyPath `id`). */
export class IdbProjectCache implements ProjectReadCache {
  readonly #factory: IDBFactory;
  #db: Promise<IDBDatabase> | null = null;

  constructor(factory: IDBFactory) {
    this.#factory = factory;
  }

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.#factory.open(PROJECT_CACHE_DB, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error("idb open failed"));
    }).catch((err: unknown) => {
      this.#db = null;
      throw err;
    });
    return this.#db;
  }

  async #store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.#open()).transaction(STORE, mode).objectStore(STORE);
  }

  async get(id: string): Promise<ProjectRecord | null> {
    try {
      const v: unknown = await done((await this.#store("readonly")).get(id));
      return isRecord(v) && v.id === id ? v : null;
    } catch {
      return null;
    }
  }

  async put(record: ProjectRecord): Promise<void> {
    try {
      await done((await this.#store("readwrite")).put({ ...record }));
    } catch {
      // 캐시 실패는 무시(정본은 서버).
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await done((await this.#store("readwrite")).delete(id));
    } catch {
      // 위와 같다.
    }
  }

  /** 로그아웃 삭제는 실패를 알린다(남은 캐시를 조용히 두지 않는다). */
  async clear(): Promise<void> {
    await done((await this.#store("readwrite")).clear());
  }

  toJSON(): { redacted: true } {
    return { redacted: true };
  }
}
