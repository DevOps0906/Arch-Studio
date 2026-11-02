// IndexedDB 읽기 캐시(ADR-001 3.1, AR-06-072). 서버에서 읽은 프로젝트 목록·최신 리비전의 사본일 뿐이다:
// - 저장·삭제의 근거로 쓰지 않는다(서버로 올리는 값은 항상 화면이 준 입력). 편집 캐시·오프라인 큐 없음.
// - 토큰·비밀은 담지 않는다(SecureStore는 메모리만).
// - 로그아웃 때 `clear()`로 비운다. 실패하면 던진다(남아 있으면 안 되므로 호출자가 알아야 한다).
// - 그 밖의 쓰기·읽기 실패는 조용히 무시한다(캐시는 없어도 동작하는 보조 수단).
import type { ProjectRecord, ProjectSummary } from "../adapters/project-store.ts";

export interface ReadCache {
  getList(): Promise<readonly ProjectSummary[] | null>;
  /** `epoch`: 작업을 시작할 때 `epoch()`로 받은 값. 그 사이 clear()가 있었으면 쓰지 않는다(가드가 비교). */
  putList(list: readonly ProjectSummary[], epoch?: number): Promise<void>;
  getRecord(id: string): Promise<ProjectRecord | null>;
  putRecord(record: ProjectRecord, epoch?: number): Promise<void>;
  /** clear() 횟수. 요청을 보내기 전에 받아 두었다가 put에 넘긴다(로그아웃 경합 방어). */
  epoch(): number;
  deleteRecord(id: string): Promise<void>;
  /** 전부 삭제(로그아웃). 실패하면 던진다. */
  clear(): Promise<void>;
  /** 이 캐시를 채운 주체(sub+org 문자열). 없으면 null. 읽기 가드(guarded-cache.ts)가 쓴다. */
  getOwner(): Promise<string | null>;
  setOwner(owner: string): Promise<void>;
}

/** 캐시 없음(IndexedDB 미지원·비공개 모드). */
export const NO_READ_CACHE: ReadCache = Object.freeze({
  getList: async () => null,
  putList: async () => {},
  getRecord: async () => null,
  putRecord: async () => {},
  deleteRecord: async () => {},
  clear: async () => {},
  getOwner: async () => null,
  setOwner: async () => {},
  epoch: () => 0,
});

const DB_NAME = "arch-studio-read-cache";
const STORE = "kv";
const LIST_KEY = "list";
const OWNER_KEY = "owner";
const recordKey = (id: string) => `project:${id}`;

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("idb"));
  });
}

/** IndexedDB 구현. 연산마다 연결을 열고 닫아 다른 탭의 삭제·업그레이드를 막지 않는다. */
export function createIndexedDbReadCache(factory: IDBFactory | undefined = globalThis.indexedDB): ReadCache {
  if (!factory) return NO_READ_CACHE;

  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error("idb"));
    });

  async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    try {
      const tx = db.transaction(STORE, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("idb"));
        tx.onabort = () => reject(new Error("idb"));
      });
      done.catch(() => {}); // 요청이 먼저 실패해도 미처리 거부로 남기지 않는다(아래 await가 던진다).
      const result = await wrap(fn(tx.objectStore(STORE)));
      await done;
      return result;
    } finally {
      db.close();
    }
  }

  const quiet = async <T>(fallback: T, op: () => Promise<T>): Promise<T> => {
    try {
      return await op();
    } catch {
      return fallback;
    }
  };

  return {
    getList: () => quiet(null, async () => ((await run("readonly", (s) => s.get(LIST_KEY))) as ProjectSummary[] | undefined) ?? null),
    putList: (list) => quiet(undefined, () => run("readwrite", (s) => s.put(list, LIST_KEY)).then(() => undefined)),
    getRecord: (id) => quiet(null, async () => ((await run("readonly", (s) => s.get(recordKey(id)))) as ProjectRecord | undefined) ?? null),
    putRecord: (record) => quiet(undefined, () => run("readwrite", (s) => s.put(record, recordKey(record.id))).then(() => undefined)),
    deleteRecord: (id) => quiet(undefined, () => run("readwrite", (s) => s.delete(recordKey(id))).then(() => undefined)),
    clear: () => run("readwrite", (s) => s.clear()).then(() => undefined),
    epoch: () => 0,
    getOwner: () => quiet(null, async () => ((await run("readonly", (s) => s.get(OWNER_KEY))) as string | undefined) ?? null),
    // 주체 기록 실패는 던진다: 기록 없이 데이터만 남으면 다음 사용자에게 읽힐 수 있어 가드가 쓰기를 포기해야 한다.
    setOwner: (owner) => run("readwrite", (s) => s.put(owner, OWNER_KEY)).then(() => undefined),
  };
}
