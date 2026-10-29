// 클라우드 사본 목록(`GET /api/cloud-projects`, 04_API 2.1절) 응답 검사와 로컬 행 매핑. 순수 함수(node --test 대상).
// 업로드·내려받기 버튼은 AR-06-077 소유(수동 업로드·내려받기). 이 화면은 "클라우드 사본" 표시와 충돌 대화상자 골격까지만.
// features에는 zod 의존이 없어 손으로 검사한다: 모르는 필드는 버리고, 형식이 틀린 행은 통째로 버린다(이름·경로를 로그에 남기지 않는다).

export interface CloudCopy {
  readonly projectUuid: string;
  /** 설치형에서 올린 사본이면 로컬 프로젝트 id. 웹에서 만든 프로젝트는 null. */
  readonly localId: string | null;
  readonly name: string;
  readonly version: number;
  readonly bytes: number;
  readonly updatedAt: string;
}

export interface CloudList {
  readonly items: readonly CloudCopy[];
  readonly next: string | null;
  /** 조직 상한(cloud_projects_max). */
  readonly max: number | null;
  readonly retentionUntil: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function row(raw: unknown): CloudCopy | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.project_uuid)) return null;
  if (!(r.local_id === null || r.local_id === undefined || isUuid(r.local_id))) return null;
  if (typeof r.name !== "string" || r.name.length === 0 || r.name.length > 480) return null;
  if (!isCount(r.version) || r.version < 1 || !isCount(r.bytes)) return null;
  if (typeof r.updated_at !== "string" || Number.isNaN(Date.parse(r.updated_at))) return null;
  return {
    projectUuid: r.project_uuid,
    localId: (r.local_id as string | null | undefined) ?? null,
    name: r.name,
    version: r.version,
    bytes: r.bytes,
    updatedAt: r.updated_at,
  };
}

/** api-client `parse` 훅. 봉투의 data를 받는다. 모양이 틀리면 던진다(api-client가 invalid_response로 바꾼다). */
export function parseCloudList(data: unknown): CloudList {
  if (typeof data !== "object" || data === null) throw new TypeError("cloud list");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) throw new TypeError("cloud list items");
  const items = d.items.slice(0, 500).map(row).filter((x): x is CloudCopy => x !== null);
  return {
    items,
    next: typeof d.next === "string" && d.next.length <= 200 ? d.next : null,
    max: isCount(d.max) ? d.max : null,
    retentionUntil: typeof d.retention_until === "string" && d.retention_until.length <= 40 ? d.retention_until : null,
  };
}

/**
 * 로컬 id → 클라우드 사본 버전. 같은 local_id가 여러 행이면 버전이 큰 쪽(최근 올린 사본).
 * 클라우드 정보를 못 얻었으면 null을 돌려 화면이 "확인 안 됨"(undefined)으로 둔다.
 */
export function cloudVersionByLocalId(list: CloudList | null): ReadonlyMap<string, number> | null {
  if (!list) return null;
  const out = new Map<string, number>();
  for (const c of list.items) {
    if (!c.localId) continue;
    const prev = out.get(c.localId);
    if (prev === undefined || c.version > prev) out.set(c.localId, c.version);
  }
  return out;
}

/** 목록 행의 cloudVersion: 확인된 사본 버전, 확인했지만 없음(null), 확인 못 함(undefined). */
export function cloudVersionOf(map: ReadonlyMap<string, number> | null, localId: string): number | null | undefined {
  if (!map) return undefined;
  return map.get(localId) ?? null;
}
