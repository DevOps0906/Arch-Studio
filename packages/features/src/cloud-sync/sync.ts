// 설치형 로컬 ↔ 클라우드 수동 업로드·내려받기(AR-06-077, ADR-001 3장). 자동 양방향 동기화는 Phase 2(여기 없음).
// 규칙:
// - 최초 업로드: 새 project_uuid(UUIDv7)를 발급해 사본을 만들고 서버에 local_id를 함께 보낸다. 성공하면 로컬에 연결(project_uuid·서버 version)을 남긴다.
// - 다시 업로드: 연결된 project_uuid에 expected_version = 마지막으로 맞춘 서버 version → 같은 행 version+1.
// - 원본 로컬은 업로드로 바뀌지 않는다(로컬 리비전 0개 추가). 업로드 폴더 키는 항상 project_uuid(shell-bridge가 경로를 대조).
// - 건축주 정보(client_name·client_contact)는 업로드 사본에서 기본 제외(05_DATA_MODEL 2.16, 팀장 결정). `includeClientInfo: true`일 때만 보낸다.
// - 연결된 사본이 서버에 없으면(NOT_FOUND) 자동으로 새로 만들지 않고 needs_recreate_confirm → 화면 확인 뒤 `confirmRecreate: true`로 다시 부른다.
// - 충돌(서버 AR041, 또는 같은 local_id가 이미 다른 사본 23505): 저장하지 않고 2선택을 돌려준다. 병합하지 않는다.
//   · "내 변경을 사본으로 저장": 로컬 내용을 새 project_uuid 사본으로 올린다(local_id 없이 — 서버에서 local_id는 한 사본에만). 연결은 그대로.
//   · "서버 최신 열기": 서버 최신(이름·대지 라벨·설계 모델)을 연결된 로컬 프로젝트의 새 리비전으로 내려받는다.
//     설계 모델은 이력 보존(이전 로컬 리비전이 남는다), 건축주 정보는 로컬 값 유지. 연결 version을 서버 값으로.
// - 클라우드 모드 충돌(`resolveCloudConflict`, project_uuid 기준): 사본 저장 = 새 uuid, 서버 최신 = 다시 열기.
// - 클라우드 모드 오프라인(또는 서버 미도달로 읽기 캐시를 돌려받음): 읽기 전용 + "로컬로 복사해 편집" 안내. 저장·업로드는 네트워크를 부르지 않고 offline.
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
export const SERVER_LATEST_NOTICE = "서버 최신으로 바꿨습니다. 설계 모델은 이력에 보존되고, 건축주 정보는 로컬 값을 유지합니다.";
export const LINK_FAILED_MESSAGE = "로컬에 저장됐지만 클라우드 연결을 기록하지 못했습니다. 다음 업로드에서 충돌로 보이면 '서버 최신 열기'로 다시 연결하세요.";
export const RECREATE_CONFIRM_MESSAGE = "연결된 클라우드 사본을 찾을 수 없습니다(삭제됐거나 다른 조직). 새 클라우드 사본으로 다시 올릴까요?";

export interface UploadOptions {
  /** 건축주 이름·연락처를 사본에 포함(기본 false = 제외). */
  readonly includeClientInfo?: boolean;
  /** needs_recreate_confirm 뒤 사용자가 확인했을 때만 true: 새 project_uuid로 다시 만든다. */
  readonly confirmRecreate?: boolean;
}

export type SyncOutcome =
  | { readonly kind: "uploaded"; readonly projectUuid: string; readonly version: number; readonly created: boolean; readonly linked: boolean }
  | {
      readonly kind: "downloaded";
      readonly localId: string;
      readonly localVersion: number;
      readonly projectUuid: string;
      readonly version: number;
      /** 서버 최신 열기면 SERVER_LATEST_NOTICE. */
      readonly notice: string | null;
    }
  /** 로컬 저장은 됐고 연결 기록만 실패(사용자에게 LINK_FAILED_MESSAGE로 구분해 알린다). */
  | { readonly kind: "link_failed"; readonly localId: string; readonly localVersion: number; readonly projectUuid: string; readonly message: string }
  /** 연결된 사본이 서버에 없다: 확인을 받은 뒤 upload(localId, { confirmRecreate: true }). */
  | { readonly kind: "needs_recreate_confirm"; readonly projectUuid: string; readonly message: string }
  /** 클라우드 모드 충돌에서 "서버 최신 열기". */
  | { readonly kind: "opened"; readonly open: CloudOpenResult }
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
const NO_CLIENT = Object.freeze({ clientName: null, clientContact: null });

/** 업로드 사본의 건축주 정보: 기본 제외, 명시적으로 켰을 때만 로컬 값. */
const uploadClient = (rec: ProjectRecord, opts: UploadOptions) => (opts.includeClientInfo === true ? rec : NO_CLIENT);

const codeOf = (e: unknown): unknown => (typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined);

function defaultNewId(): string {
  return uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
}

function defaultOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** 리비전 → 다른 저장소 저장 입력. 건축주 정보는 `client`로 따로 받는다(업로드는 기본 null). */
function inputOf(
  rec: ProjectRecord,
  id: string,
  expectedVersion: number | null,
  note: string,
  client: { readonly clientName: string | null; readonly clientContact: string | null },
): SaveProjectInput {
  return {
    id,
    name: rec.name,
    siteLabel: rec.siteLabel,
    clientName: client.clientName,
    clientContact: client.clientContact,
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
  async upload(localId: string, opts: UploadOptions = {}): Promise<SyncOutcome> {
    if (!this.#online()) return { kind: "offline" };
    const rec = await this.#local.open(localId);
    if (!rec) return { kind: "not_found" };
    const client = uploadClient(rec, opts);
    const link = await this.#links.get(localId);
    if (link && opts.confirmRecreate !== true) {
      try {
        const saved = await this.#cloud.save(inputOf(rec, link.projectUuid, link.cloudVersion, "로컬에서 업로드", client));
        await this.#links.set(localId, { projectUuid: link.projectUuid, cloudVersion: saved.version });
        return { kind: "uploaded", projectUuid: link.projectUuid, version: saved.version, created: false, linked: true };
      } catch (e) {
        if (codeOf(e) === "VERSION_CONFLICT") return this.#conflict(link.projectUuid);
        // 서버 사본이 없다(삭제·조직 전환): 자동으로 만들지 않고 확인을 받는다.
        if (codeOf(e) === "NOT_FOUND") return { kind: "needs_recreate_confirm", projectUuid: link.projectUuid, message: RECREATE_CONFIRM_MESSAGE };
        throw e;
      }
    }
    const projectUuid = this.#newId();
    let saved: SaveProjectResult;
    try {
      saved = await this.#cloud.save(inputOf(rec, projectUuid, null, "로컬에서 업로드", client), { localId });
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
  async resolveConflict(localId: string, choice: ConflictChoice, opts: Pick<UploadOptions, "includeClientInfo"> = {}): Promise<SyncOutcome> {
    if (!this.#online()) return { kind: "offline" };
    if (choice === "save_as_copy") {
      const rec = await this.#local.open(localId);
      if (!rec) return { kind: "not_found" };
      const projectUuid = this.#newId();
      const saved = await this.#cloud.save(inputOf(rec, projectUuid, null, "충돌: 내 변경을 사본으로 저장", uploadClient(rec, opts)));
      return { kind: "uploaded", projectUuid, version: saved.version, created: true, linked: false };
    }
    const projectUuid = (await this.#links.get(localId))?.projectUuid ?? (await this.#cloud.findByLocalId(localId))?.projectUuid;
    if (!projectUuid) return { kind: "not_found" };
    const server = await this.#cloud.open(projectUuid);
    const mine = await this.#local.open(localId);
    if (!server || !mine) return { kind: "not_found" };
    // 이름·대지 라벨·설계 모델은 서버 값, 건축주 정보는 로컬 값(서버 사본에는 기본으로 없다).
    const saved = await this.#local.save(inputOf(server, localId, mine.version, "충돌: 서버 최신 열기(설계 모델 이력 보존, 건축주 정보 로컬 유지)", mine));
    if (!(await this.#linked(localId, projectUuid, server.version))) return this.#linkFailed(localId, saved.version, projectUuid);
    return { kind: "downloaded", localId, localVersion: saved.version, projectUuid, version: server.version, notice: SERVER_LATEST_NOTICE };
  }

  /** 연결 기록. 실패해도 로컬 저장은 이미 됐으므로 false만 돌려준다(오류 원문 버림). */
  async #linked(localId: string, projectUuid: string, cloudVersion: number): Promise<boolean> {
    try {
      await this.#links.set(localId, { projectUuid, cloudVersion });
      return true;
    } catch {
      return false;
    }
  }

  #linkFailed(localId: string, localVersion: number, projectUuid: string): SyncOutcome {
    return { kind: "link_failed", localId, localVersion, projectUuid, message: LINK_FAILED_MESSAGE };
  }

  /**
   * 클라우드 → 로컬 내려받기("로컬로 복사해 편집" 포함): 새 로컬 프로젝트로 복사하고 그 사본에 연결한다.
   * 오프라인이면 읽기 캐시에 있는 것만 복사된다. 권리(402) 검사 없음.
   */
  async download(projectUuid: string): Promise<SyncOutcome> {
    const server = await this.#cloud.open(projectUuid);
    if (!server) return { kind: "not_found" };
    const localId = this.#newId();
    const saved = await this.#local.save(inputOf(server, localId, null, "클라우드에서 내려받기", server));
    if (!(await this.#linked(localId, projectUuid, server.version))) return this.#linkFailed(localId, saved.version, projectUuid);
    return { kind: "downloaded", localId, localVersion: saved.version, projectUuid, version: server.version, notice: null };
  }

  /** 클라우드 모드 열기. 오프라인이면 읽기 캐시 + 읽기 전용. */
  async openCloud(projectUuid: string): Promise<CloudOpenResult | null> {
    const offline = !this.#online();
    const got = await this.#cloud.openSourced(projectUuid);
    if (!got) return null;
    // 서버에 닿지 못해 읽기 캐시를 받았으면 온라인 표시여도 읽기 전용.
    const readOnly = offline || got.cached;
    return { record: got.record, readOnly, notice: readOnly ? OFFLINE_NOTICE : null };
  }

  /** 클라우드 모드 충돌 2선택(project_uuid 기준). 사본 저장 = 새 uuid로 저장, 서버 최신 = 다시 열기. */
  async resolveCloudConflict(input: SaveProjectInput, choice: ConflictChoice): Promise<SyncOutcome> {
    if (choice === "save_as_copy") return this.saveCloud({ ...input, id: this.#newId(), expectedVersion: null });
    const open = await this.openCloud(input.id);
    return open ? { kind: "opened", open } : { kind: "not_found" };
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
