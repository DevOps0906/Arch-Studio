// 설치형 ProjectStore: Rust `local_db_list_projects/get_project/save_project/delete_project`(SQLite, AR-06-006) 호출 래퍼.
// 입력은 invoke 전에 같은 규칙으로 검사하고(오류 경로에 값이 되풀이되지 않게), Rust 오류는 알려진 코드만 남긴다(`detail` 폐기).
import { errorFrom, type ProjectErrorCode } from "../adapters/errors.ts";
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
import type { InvokeFn, ProjectCommand } from "./invoke.ts";

const PROJECT_CODES: readonly ProjectErrorCode[] = [
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_INPUT",
  "AR060",
  "AR061",
];

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) ? v : 0);

function summaryOf(raw: unknown): ProjectSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  return Object.freeze({
    id: str(r.id),
    name: str(r.name),
    siteLabel: strOrNull(r.siteLabel),
    updatedAt: str(r.updatedAt),
    version: int(r.version),
  });
}

function recordOf(raw: unknown): ProjectRecord {
  const r = raw as Record<string, unknown>;
  return Object.freeze({
    id: str(r.id),
    name: str(r.name),
    siteLabel: strOrNull(r.siteLabel),
    clientName: strOrNull(r.clientName),
    clientContact: strOrNull(r.clientContact),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    version: int(r.version),
    schemaVersion: int(r.schemaVersion),
    engineVersion: str(r.engineVersion),
    designModel: str(r.designModel),
    sha256: str(r.sha256),
  });
}

export class TauriProjectStore implements ProjectStore {
  readonly #invoke: InvokeFn;

  constructor(invoke: InvokeFn) {
    this.#invoke = invoke;
  }

  async #call(cmd: ProjectCommand, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.#invoke(cmd, args);
    } catch (err) {
      throw errorFrom(err, PROJECT_CODES, "PROJECT_UNAVAILABLE");
    }
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const raw = await this.#call("local_db_list_projects", {});
    if (!Array.isArray(raw)) throw errorFrom(null, PROJECT_CODES, "PROJECT_UNAVAILABLE");
    return Object.freeze(raw.map(summaryOf));
  }

  async open(id: string): Promise<ProjectRecord | null> {
    assertProjectId(id);
    const raw = await this.#call("local_db_get_project", { id });
    return raw === null || raw === undefined ? null : recordOf(raw);
  }

  async save(input: SaveProjectInput): Promise<SaveProjectResult> {
    assertSaveProjectInput(input);
    // Rust는 deny_unknown_fields: 알려진 필드만 골라 보낸다.
    const payload = {
      id: input.id,
      name: input.name,
      siteLabel: input.siteLabel ?? null,
      clientName: input.clientName ?? null,
      clientContact: input.clientContact ?? null,
      schemaVersion: input.schemaVersion,
      engineVersion: input.engineVersion,
      designModel: input.designModel,
      note: input.note ?? null,
      expectedVersion: input.expectedVersion,
    };
    const raw = (await this.#call("local_db_save_project", { input: payload })) as Record<string, unknown> | null;
    return Object.freeze({ version: int(raw?.version), sha256: str(raw?.sha256) });
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    assertProjectId(id);
    assertExpectedVersion(expectedVersion);
    await this.#call("local_db_delete_project", { id, expectedVersion });
  }
}
