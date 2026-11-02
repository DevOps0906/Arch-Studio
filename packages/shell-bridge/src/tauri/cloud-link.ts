// 설치형 CloudLinkStore(AR-06-077): Rust `local_db_get_cloud_link`·`local_db_set_cloud_link` 래퍼. 입력은 invoke 전에 같은 규칙으로 검사하고
// Rust 오류는 알려진 코드만 남긴다(`detail` 폐기).
import { assertCloudLink, type CloudLink, type CloudLinkStore } from "../adapters/cloud-link.ts";
import { errorFrom, type ProjectErrorCode } from "../adapters/errors.ts";
import { assertProjectId, isProjectId } from "../adapters/project-store.ts";
import type { CloudLinkCommand, InvokeFn } from "./invoke.ts";

// AR060 = Rust code::DB_UNAVAILABLE, AR061 = code::DB_READ_ONLY(읽기 전용 모드에서 연결 기록 거부).
const CODES: readonly ProjectErrorCode[] = ["NOT_FOUND", "VERSION_CONFLICT", "INVALID_INPUT", "AR060", "AR061"];

export class TauriCloudLinkStore implements CloudLinkStore {
  readonly #invoke: InvokeFn;

  constructor(invoke: InvokeFn) {
    this.#invoke = invoke;
  }

  async #call(cmd: CloudLinkCommand, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.#invoke(cmd, args);
    } catch (err) {
      throw errorFrom(err, CODES, "PROJECT_UNAVAILABLE");
    }
  }

  async get(localId: string): Promise<CloudLink | null> {
    assertProjectId(localId);
    const raw = (await this.#call("local_db_get_cloud_link", { id: localId })) as Record<string, unknown> | null | undefined;
    if (raw === null || raw === undefined) return null;
    const { projectUuid, cloudVersion } = raw;
    if (!isProjectId(projectUuid) || typeof cloudVersion !== "number" || !Number.isSafeInteger(cloudVersion) || cloudVersion < 1) {
      throw errorFrom(null, CODES, "PROJECT_UNAVAILABLE");
    }
    return Object.freeze({ projectUuid, cloudVersion });
  }

  async set(localId: string, link: CloudLink): Promise<void> {
    assertProjectId(localId);
    assertCloudLink(link);
    // Rust는 deny_unknown_fields: 알려진 필드만 보낸다.
    await this.#call("local_db_set_cloud_link", { id: localId, link: { projectUuid: link.projectUuid, cloudVersion: link.cloudVersion } });
  }
}
