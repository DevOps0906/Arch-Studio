// 설치형 로컬 ↔ 클라우드 수동 업로드·내려받기(AR-06-077, ADR-001 3장). 자동 양방향 동기화는 Phase 2(여기 없음).
// 규칙:
// - 최초 업로드: 새 project_uuid(UUIDv7)를 발급해 사본을 만들고 서버에 local_id를 함께 보낸다. 성공하면 로컬에 연결(project_uuid·서버 version)을 남긴다.
// - 다시 업로드: 연결된 project_uuid에 expected_version = 마지막으로 맞춘 서버 version → 같은 행 version+1.
// - 원본 로컬은 업로드로 바뀌지 않는다(로컬 리비전 0개 추가). 업로드 폴더 키는 항상 project_uuid(shell-bridge가 경로를 대조).
// - 충돌(서버 AR041, 또는 같은 local_id가 이미 다른 사본 23505): 저장하지 않고 2선택을 돌려준다. 병합하지 않는다.
//   · "내 변경을 사본으로 저장": 로컬 내용을 새 project_uuid 사본으로 올린다(local_id 없이 — 서버에서 local_id는 한 사본에만). 연결은 그대로.
//   · "서버 최신 열기": 서버 최신을 연결된 로컬 프로젝트의 새 리비전으로 내려받는다(이전 로컬 리비전은 이력에 남는다). 연결 version을 서버 값으로.
// - 클라우드 모드 오프라인: 읽기 전용(읽기 캐시로 열기만) + "로컬로 복사해 편집" 안내. 저장·업로드는 네트워크를 부르지 않고 offline.
// - 내려받기는 권리(402) 검사를 하지 않는다: 만료·폴백 사용자도 클라우드 → 로컬 복사 가능(서버 GET도 402 예외).
// 오류는 코드만 본다(이름·모델 원문을 로그·결과에 넣지 않는다). shell-bridge는 타입으로만 가져온다.
import type {
  CloudLinkStore,
  CloudProjectStore,
  ProjectRecord,
  ProjectStore,
  SaveProjectInput,
  SaveProjectResult,
} from "@arch-studio/shell-bridge";
import { uuidV7 } from "../projects/new-project.ts";

export type ConflictChoice = "save_as_copy" | "open_server_latest";

/** 충돌 대화상자 2선택(화면 문구). 순서 고정. */
export const CONFLICT_CHOICES: readonly { readonly choice: ConflictChoice; readonly label: string }[] = Object.freeze([
  Object.freeze({ choice: "save_as_copy" as const, label: "내 변경을 사본으로 저장" }),
  Object.freeze({ choice: "open_server_latest" as const, label: "서버 최신 열기" }),
]);

export const CONFLICT_MESSAGE = "다른 곳에서 이 프로젝트가 먼저 저장되었습니다. 병합하지 않으며, 이번 업로드는 저장하지 않았습니다.";
export const OFFLINE_NOTICE = "오프라인에서는 클라우드 프로젝트를 읽기만 할 수 있습니다. 편집하려면 로컬로 복사하세요.";
export const OFFLINE_COPY_LABEL = "로컬로 복사해 편집";

export type SyncOutcome =
  | { readonly kind: "uploaded"; readonly projectUuid: string; readonly version: number; readonly created: boolean; readonly linked: boolean }
  | { readonly kind: "downloaded"; readonly localId: string; readonly localVersion: number; readonly projectUuid: string; readonly version: number }
  /** projectUuid: 충돌한 서버 사본(같은 local_id 사본을 못 찾으면 null). */
  | { readonly kind: "conflict"; readonly projectUuid: string | null; readonly choices: readonly ConflictChoice[] }
  | { readonly kind: "offline" }
  | { readonly kind: "not_found" };

export interface CloudOpenResult {
  readonly record: ProjectRecord;
  /** 오프라인이면 true: 편집·저장 금지, 로컬 복사만. */
  readonly readOnly: boolean;
  readonly notice: string | null;
}

export interface CloudSyncDeps {
  /** 설치형 로컬 ProjectStore(SQLite). */
  readonly local: ProjectStore;
  /** 로컬 id ↔ project_uuid 연결(설치형 `cloudLinksOf(adapters)`). */
  readonly links: CloudLinkStore;
  /** 클라우드 사본 저장소(`createCloudProjectStore`). */
  readonly cloud: CloudProjectStore;
  /** 새 project_uuid·로컬 id(UUIDv7). 테스트 주입. */
  readonly newId?: () => string;
  /** 네트워크 상태. 기본 navigator.onLine(없으면 온라인으로 본다). */
  readonly isOnline?: () => boolean;
}

const CHOICES = Object.freeze(CONFLICT_CHOICES.map((c) => c.choice));

const codeOf = (e: unknown): unknown => (typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined);

function defaultNewId(): string {
  return uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
}

function defaultOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** 리비전 → 다른 저장소 저장 입력(id·expectedVersion만 바꾼다). */
function inputOf(rec: ProjectRecord, id: string, expectedVersion: number | null, note: string): SaveProjectInput {
  return {
    id,
    name: rec.name,
    siteLabel: rec.siteLabel,
    clientName: rec.clientName,
    clientContact: rec.clientContact,
    schemaVersion: rec.schemaVersion,
    engineVersion: rec.engineVersion,
    designModel: rec.designModel,
    note,
    expectedVersion,
  };
}

export class CloudSync {
  readonly #local: ProjectStore;
  readonly #links: CloudLinkStore;
  readonly #cloud: CloudProjectStore;
  readonly #newId: () => string;
  readonly #online: () => boolean;

  constructor(deps: CloudSyncDeps) {
    this.#local = deps.local;
    this.#links = deps.links;
    this.#cloud = deps.cloud;
    this.#newId = deps.newId ?? defaultNewId;
    this.#online = deps.isOnline ?? defaultOnline;
  }

  #conflict(projectUuid: string | null): SyncOutcome {
    return { kind: "conflict", projectUuid, choices: CHOICES };
  }

  /** 수동 업로드(로컬 → 클라우드). 원본 로컬은 바꾸지 않는다. */
  async upload(localId: string): Promise<SyncOutcome> {
    if (!this.#online()) return { kind: "offline" };
    const rec = await this.#local.open(localId);
    if (!rec) return { kind: "not_found" };
    const link = await this.#links.get(localId);
    if (link) {
      try {
        const saved = await this.#cloud.save(inputOf(rec, link.projectUuid, link.cloudVersion, "로컬에서 업로드"));
        await this.#links.set(localId, { projectUuid: link.projectUuid, cloudVersion: saved.version });
        return { kind: "uploaded", projectUuid: link.projectUuid, version: saved.version, created: false, linked: true };
      } catch (e) {
        if (codeOf(e) === "VERSION_CONFLICT") return this.#conflict(link.projectUuid);
        // 서버 사본이 지워졌다: 사용자가 업로드를 눌렀으므로 새 사본을 만들고 다시 연결한다.
        if (codeOf(e) !== "NOT_FOUND") throw e;
      }
    }
    const projectUuid = this.#newId();
    let saved: SaveProjectResult;
    try {
      saved = await this.#cloud.save(inputOf(rec, projectUuid, null, "로컬에서 업로드"), { localId });
    } catch (e) {
      if (codeOf(e) !== "VERSION_CONFLICT") throw e;
      // 같은 local_id 사본이 이미 있다(연결 기록 유실 등, 서버 23505): 그 사본과의 충돌로 다룬다.
      const existing = await this.#cloud.findByLocalId(localId);
      return this.#conflict(existing?.projectUuid ?? null);
    }
    await this.#links.set(localId, { projectUuid, cloudVersion: saved.version });
    return { kind: "uploaded", projectUuid, version: saved.version, created: true, linked: true };
  }

  /** 업로드 충돌의 2선택 처리. */
  async resolveConflict(localId: string, choice: ConflictChoice): Promise<SyncOutcome> {
    if (!this.#online()) return { kind: "offline" };
    if (choice === "save_as_copy") {
      const rec = await this.#local.open(localId);
      if (!rec) return { kind: "not_found" };
      const projectUuid = this.#newId();
      const saved = await this.#cloud.save(inputOf(rec, projectUuid, null, "충돌: 내 변경을 사본으로 저장"));
      return { kind: "uploaded", projectUuid, version: saved.version, created: true, linked: false };
    }
    const projectUuid = (await this.#links.get(localId))?.projectUuid ?? (await this.#cloud.findByLocalId(localId))?.projectUuid;
    if (!projectUuid) return { kind: "not_found" };
    const server = await this.#cloud.open(projectUuid);
    const mine = await this.#local.open(localId);
    if (!server || !mine) return { kind: "not_found" };
    const saved = await this.#local.save(inputOf(server, localId, mine.version, "충돌: 서버 최신 열기"));
    await this.#links.set(localId, { projectUuid, cloudVersion: server.version });
    return { kind: "downloaded", localId, localVersion: saved.version, projectUuid, version: server.version };
  }

  /**
   * 클라우드 → 로컬 내려받기("로컬로 복사해 편집" 포함): 새 로컬 프로젝트로 복사하고 그 사본에 연결한다.
   * 오프라인이면 읽기 캐시에 있는 것만 복사된다. 권리(402) 검사 없음.
   */
  async download(projectUuid: string): Promise<SyncOutcome> {
    const server = await this.#cloud.open(projectUuid);
    if (!server) return { kind: "not_found" };
    const localId = this.#newId();
    const saved = await this.#local.save(inputOf(server, localId, null, "클라우드에서 내려받기"));
    await this.#links.set(localId, { projectUuid, cloudVersion: server.version });
    return { kind: "downloaded", localId, localVersion: saved.version, projectUuid, version: server.version };
  }

  /** 클라우드 모드 열기. 오프라인이면 읽기 캐시 + 읽기 전용. */
  async openCloud(projectUuid: string): Promise<CloudOpenResult | null> {
    const readOnly = !this.#online();
    const record = await this.#cloud.open(projectUuid);
    if (!record) return null;
    return { record, readOnly, notice: readOnly ? OFFLINE_NOTICE : null };
  }

  /** 클라우드 모드 저장. 오프라인이면 네트워크 없이 offline, 충돌은 2선택. */
  async saveCloud(input: SaveProjectInput): Promise<SyncOutcome> {
    if (!this.#online()) return { kind: "offline" };
    try {
      const saved = await this.#cloud.save(input);
      return { kind: "uploaded", projectUuid: input.id, version: saved.version, created: input.expectedVersion === null, linked: false };
    } catch (e) {
      if (codeOf(e) === "VERSION_CONFLICT") return this.#conflict(input.id);
      throw e;
    }
  }
}
