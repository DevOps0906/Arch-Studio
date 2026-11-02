// 읽기 캐시 가드(AR-06-072 리뷰): ① 주체 일치 ② 로그아웃 경합.
// ① 캐시에는 채운 주체(sub+org)를 함께 기록한다. 읽을 때 현재 토큰의 주체와 다르면(계정 전환·세션 만료 후 다른 사용자) 캐시를
//    통째로 폐기하고 빈 값을 돌려준다. 주체를 알 수 없으면(토큰 없음) 읽기·쓰기 모두 하지 않는다.
// ② `clear()`는 epoch를 올리고 진행 중인 쓰기가 끝나길 기다린 뒤 비운다. 쓰기는 시작 전·실제 put 직전에 epoch를 비교해 다르면 생략한다.
//    (로그아웃 중에 끝난 요청이 지운 캐시를 다시 채우지 못한다.)
import type { ReadCache } from "./read-cache.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * JWT payload에서 주체 문자열(`sub|org`)을 꺼낸다. 서명은 검증하지 않는다 — 캐시 구분 용도일 뿐 권한 판단에 쓰지 않는다
 * (서버가 매 요청 토큰을 검증). org는 `app_metadata.org_id` 또는 `org_id` 클레임이 있을 때만.
 */
export function principalFromToken(token: string | null): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    if (!isRecord(payload) || typeof payload.sub !== "string" || payload.sub === "") return null;
    const meta = isRecord(payload.app_metadata) ? payload.app_metadata : {};
    const org = typeof meta.org_id === "string" ? meta.org_id : typeof payload.org_id === "string" ? payload.org_id : "";
    return `${payload.sub}|${org}`;
  } catch {
    return null;
  }
}

export function createGuardedCache(inner: ReadCache, getPrincipal: () => Promise<string | null>): ReadCache {
  let epoch = 0;
  const pending = new Set<Promise<unknown>>();

  /** 현재 주체가 캐시 주인과 같을 때만 true. 다른 주인의 데이터가 있으면 폐기한다. */
  async function ownsCache(): Promise<boolean> {
    const principal = await getPrincipal();
    if (!principal) return false;
    const owner = await inner.getOwner();
    if (owner === principal) return true;
    if (owner !== null) await inner.clear().catch(() => {});
    return false;
  }

  async function read<T>(fallback: T, op: () => Promise<T>): Promise<T> {
    return (await ownsCache()) ? op() : fallback;
  }

  function write(op: () => Promise<void>, from?: number): Promise<void> {
    const startedAt = from ?? epoch;
    if (startedAt !== epoch) return Promise.resolve();
    const job = (async () => {
      const principal = await getPrincipal();
      if (!principal || epoch !== startedAt) return;
      const owner = await inner.getOwner();
      if (owner !== principal) {
        if (owner !== null) await inner.clear();
        if (epoch !== startedAt) return;
        await inner.setOwner(principal);
      }
      if (epoch !== startedAt) return;
      await op();
    })().catch(() => {}); // 캐시 쓰기는 보조 수단: 실패해도 호출자는 계속
    pending.add(job);
    void job.finally(() => pending.delete(job));
    return job;
  }

  return {
    getList: () => read(null, () => inner.getList()),
    getRecord: (id) => read(null, () => inner.getRecord(id)),
    putList: (list, from) => write(() => inner.putList(list), from),
    putRecord: (record, from) => write(() => inner.putRecord(record), from),
    epoch: () => epoch,
    deleteRecord: (id) => inner.deleteRecord(id),
    async clear() {
      epoch++;
      await Promise.allSettled([...pending]);
      await inner.clear();
    },
    getOwner: () => inner.getOwner(),
    setOwner: (owner) => inner.setOwner(owner),
  };
}
