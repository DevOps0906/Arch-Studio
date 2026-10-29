// 로컬 버전 이력(model_revisions, 006 로컬 DB: 저장마다 리비전 덧붙이기). 순수 로직(node --test 대상).
// 070 ProjectStore에는 리비전 목록·열기 메서드가 아직 없다(list·open·save·delete 4개). 그래서:
// 1) 저장소가 `listRevisions(id)`·`openRevision(id, version)`을 구조적으로 갖고 있으면 그것을 쓴다(006·070 후속 요청: Rust `local_db_list_revisions`).
// 2) 없으면 이력은 "지금 버전만" + 안내 문구(조용히 빈 목록처럼 보이지 않게).
// 3) 데모 모드(개발 전용)는 이 세션에서 본·저장한 리비전을 기억하는 SessionHistory 픽스처를 쓴다(데모 어댑터는 셸 소유라 고치지 않는다).
// 복원은 항상 "새 버전으로 저장"이다(expectedVersion = 지금 버전, 조용한 덮어쓰기 0). 버전이 다르면 VERSION_CONFLICT.
import type { ProjectRecord, ProjectStore, SaveProjectInput } from "@arch-studio/shell-bridge";

export interface RevisionSummary {
  readonly version: number;
  /** ISO 8601. */
  readonly savedAt: string;
  readonly sha256: string;
  readonly note: string | null;
}

export interface RevisionBody {
  readonly version: number;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly designModel: string;
}

export interface RevisionSource {
  /** 최근 버전이 먼저. */
  list(id: string): Promise<readonly RevisionSummary[]>;
  open(id: string, version: number): Promise<RevisionBody | null>;
}

type MaybeRevisions = {
  listRevisions?: unknown;
  openRevision?: unknown;
};

/** 저장소가 리비전 메서드를 구조적으로 가지면 RevisionSource로 감싼다. 없으면 null. */
export function revisionSourceOf(store: ProjectStore): RevisionSource | null {
  const s = store as ProjectStore & MaybeRevisions;
  if (typeof s.listRevisions !== "function" || typeof s.openRevision !== "function") return null;
  const listFn = s.listRevisions as (id: string) => Promise<readonly RevisionSummary[]>;
  const openFn = s.openRevision as (id: string, version: number) => Promise<RevisionBody | null>;
  return {
    list: (id) => listFn.call(store, id).then(sortRevisions),
    open: (id, version) => openFn.call(store, id, version),
  };
}

export function sortRevisions(items: readonly RevisionSummary[]): RevisionSummary[] {
  return [...items].sort((a, b) => b.version - a.version);
}

/**
 * 복원 저장 입력: 고른 리비전 본문 + 지금 메타(이름·대지·건축주) + expectedVersion = 지금 버전.
 * 지금 버전과 같은 리비전은 복원할 것이 없어 null.
 */
export function restoreInput(current: ProjectRecord, rev: RevisionBody, note: string): SaveProjectInput | null {
  if (rev.version === current.version) return null;
  return {
    id: current.id,
    name: current.name,
    siteLabel: current.siteLabel,
    clientName: current.clientName,
    clientContact: current.clientContact,
    schemaVersion: rev.schemaVersion,
    engineVersion: rev.engineVersion,
    designModel: rev.designModel,
    note,
    expectedVersion: current.version,
  };
}

/** 이름 바꾸기 저장 입력: 본문은 그대로, expectedVersion = 사용자가 목록에서 본 버전(최신으로 바꿔 끼우지 않는다). */
export function renameInput(current: ProjectRecord, seenVersion: number, name: string): SaveProjectInput {
  return {
    id: current.id,
    name,
    siteLabel: current.siteLabel,
    clientName: current.clientName,
    clientContact: current.clientContact,
    schemaVersion: current.schemaVersion,
    engineVersion: current.engineVersion,
    designModel: current.designModel,
    note: "이름 바꾸기",
    expectedVersion: seenVersion,
  };
}

/** 개발 데모 전용: 이 세션에서 본·저장한 리비전을 메모리에 기억한다(앱을 닫으면 사라진다). */
export class SessionHistory implements RevisionSource {
  readonly #store: ProjectStore;
  readonly #items = new Map<string, Map<number, RevisionSummary & RevisionBody>>();

  constructor(store: ProjectStore) {
    this.#store = store;
  }

  remember(record: ProjectRecord, note: string | null = null): void {
    let byVersion = this.#items.get(record.id);
    if (!byVersion) this.#items.set(record.id, (byVersion = new Map()));
    if (byVersion.has(record.version)) return;
    byVersion.set(record.version, {
      version: record.version,
      savedAt: record.updatedAt,
      sha256: record.sha256,
      note,
      schemaVersion: record.schemaVersion,
      engineVersion: record.engineVersion,
      designModel: record.designModel,
    });
  }

  async list(id: string): Promise<readonly RevisionSummary[]> {
    const current = await this.#store.open(id);
    if (current) this.remember(current);
    const items = [...(this.#items.get(id)?.values() ?? [])].map(({ version, savedAt, sha256, note }) => ({ version, savedAt, sha256, note }));
    return sortRevisions(items);
  }

  async open(id: string, version: number): Promise<RevisionBody | null> {
    const hit = this.#items.get(id)?.get(version);
    return hit ? { version: hit.version, schemaVersion: hit.schemaVersion, engineVersion: hit.engineVersion, designModel: hit.designModel } : null;
  }
}
