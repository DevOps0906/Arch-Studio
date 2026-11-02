// 설치형 로컬 프로젝트 ↔ 클라우드 사본 연결(AR-06-077, ADR-001 3장). 설치형만 채운다(Rust `local_db_get_cloud_link`·`local_db_set_cloud_link`).
// 서버 정본 키·업로드 폴더 키는 `projectUuid`(05_DATA_MODEL 2.9절)이고 로컬 id는 서버에 `local_id`로만 보낸다.
// 연결 규칙(Rust와 같다): 없는·삭제된 로컬 프로젝트는 NOT_FOUND, 같은 사본의 cloudVersion을 줄이면 VERSION_CONFLICT.
import { BridgeError } from "./errors.ts";
import { assertProjectId, type ProjectRecord, type ProjectStore, type SaveProjectInput, type SaveProjectResult } from "./project-store.ts";

export interface CloudLink {
  /** 서버 `arch.cloud_projects.project_uuid`(UUIDv7). */
  readonly projectUuid: string;
  /** 이 로컬 프로젝트가 마지막으로 맞춘 서버 version(≥1). 다음 업로드의 expected_version. */
  readonly cloudVersion: number;
}

export interface CloudLinkStore {
  /** 연결이 없거나 로컬 프로젝트가 없으면 null. */
  get(localId: string): Promise<CloudLink | null>;
  /** 업로드·내려받기 성공 뒤에만 부른다. 로컬 리비전은 만들지 않는다. */
  set(localId: string, link: CloudLink): Promise<void>;
}

export function assertCloudLink(link: unknown): asserts link is CloudLink {
  if (typeof link !== "object" || link === null) throw new BridgeError("INVALID_INPUT");
  const l = link as Record<string, unknown>;
  assertProjectId(l.projectUuid);
  if (typeof l.cloudVersion !== "number" || !Number.isSafeInteger(l.cloudVersion) || l.cloudVersion < 1) {
    throw new BridgeError("INVALID_INPUT");
  }
}

/** 어댑터 묶음에서 연결 저장소를 꺼낸다. 웹(연결 개념 없음)은 null. */
export function cloudLinksOf(adapters: { readonly cloudLinks?: CloudLinkStore }): CloudLinkStore | null {
  return adapters.cloudLinks ?? null;
}

/** 서버 사본 참조(목록 행에서 꺼낸 값). */
export interface CloudCopyRef {
  readonly projectUuid: string;
  readonly version: number;
}

export interface CloudUploadOptions {
  /**
   * 설치형 로컬 프로젝트 id. 새 사본(`expectedVersion: null`)일 때만 서버에 `local_id`로 보낸다(기존 사본은 서버가 값을 유지하고 바꾸면 22023).
   * 폴더 키가 아니다: 업로드 경로는 항상 `input.id`(= project_uuid) 폴더.
   */
  readonly localId?: string;
}

/**
 * 클라우드 사본 저장소(웹 ProjectStore + 설치형 업로드에 필요한 두 가지). `id`는 항상 서버 project_uuid.
 * 서버 409 중 AR041(버전 불일치)과 23505(같은 local_id가 이미 다른 사본)는 둘 다 VERSION_CONFLICT.
 */
export interface CloudProjectStore extends ProjectStore {
  save(input: SaveProjectInput, options?: CloudUploadOptions): Promise<SaveProjectResult>;
  /** 이 조직 사본 중 `local_id`가 같은 행. 없으면 null. */
  findByLocalId(localId: string): Promise<CloudCopyRef | null>;
  /** open과 같고, 서버에 닿지 못해 읽기 캐시로 돌려준 것인지(`cached`)를 함께 알린다(클라우드 모드 읽기 전용 판정). */
  openSourced(id: string): Promise<SourcedRecord | null>;
}

export interface SourcedRecord {
  readonly record: ProjectRecord;
  /** true = 서버 미도달로 읽기 캐시에서 꺼냄(최신 여부 모름). */
  readonly cached: boolean;
}
