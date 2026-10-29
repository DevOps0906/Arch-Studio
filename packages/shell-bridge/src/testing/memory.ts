// 메모리 어댑터 5종(화면·기능 테스트용 더블). 계약 하네스를 통과하므로 설치형·웹 구현과 같은 규칙으로 동작한다.
// 릴리스에 들어가면 안 된다: `@arch-studio/shell-bridge/testing`으로만 가져온다(eslint testDouble 묶음).
import { createHash } from "node:crypto";
import { WEB_CAPABILITIES, type PlatformCapabilities } from "../adapters/capabilities.ts";
import {
  ALLOW,
  assertEntitlementFeature,
  deny,
  type DenyReason,
  type EntitlementClient,
  type EntitlementDecision,
  type EntitlementFeature,
  type EntitlementStatus,
} from "../adapters/entitlement.ts";
import { BridgeError } from "../adapters/errors.ts";
import type { ExportFormat, ExportResult } from "../adapters/exporter.ts";
import {
  assertExportBody,
  assertExportFormat,
  assertImportKind,
  assertImportSize,
  extensionOf,
  type FileGateway,
  type ImportKind,
} from "../adapters/file-gateway.ts";
import type { PlatformAdapters } from "../adapters/index.ts";
import type { LicenseClient } from "../adapters/license-client.ts";
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
import { clearAllSecrets, MemorySecureStore } from "../adapters/secure-store.ts";
import type { Updater } from "../adapters/updater.ts";
import { createFileFixture, type FileFixture } from "./files.ts";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

interface Row {
  record: ProjectRecord;
  deleted: boolean;
}

/** 메모리 ProjectStore. 동시성 규칙은 Rust local_db.rs와 같다. */
export class MemoryProjectStore implements ProjectStore {
  readonly #rows = new Map<string, Row>();
  #tick = 0;

  #now(): string {
    return new Date(Date.UTC(2026, 0, 1) + ++this.#tick * 1000).toISOString();
  }

  async list(): Promise<readonly ProjectSummary[]> {
    return [...this.#rows.values()]
      .filter((r) => !r.deleted)
      .map(({ record: r }) => ({ id: r.id, name: r.name, siteLabel: r.siteLabel, updatedAt: r.updatedAt, version: r.version }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async open(id: string): Promise<ProjectRecord | null> {
    assertProjectId(id);
    const row = this.#rows.get(id);
    return row && !row.deleted ? row.record : null;
  }

  async save(input: SaveProjectInput): Promise<SaveProjectResult> {
    assertSaveProjectInput(input);
    try {
      const v: unknown = JSON.parse(input.designModel);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
    } catch {
      throw new BridgeError("INVALID_INPUT");
    }
    const row = this.#rows.get(input.id);
    if (!row && input.expectedVersion !== null) throw new BridgeError("NOT_FOUND");
    if (row?.deleted) throw new BridgeError("NOT_FOUND");
    if (row && input.expectedVersion !== row.record.version) throw new BridgeError("VERSION_CONFLICT");
    const now = this.#now();
    const version = row ? row.record.version + 1 : 1;
    const record: ProjectRecord = Object.freeze({
      id: input.id,
      name: input.name,
      siteLabel: input.siteLabel ?? null,
      clientName: input.clientName ?? null,
      clientContact: input.clientContact ?? null,
      createdAt: row?.record.createdAt ?? now,
      updatedAt: now,
      version,
      schemaVersion: input.schemaVersion,
      engineVersion: input.engineVersion,
      designModel: input.designModel,
      sha256: sha256(input.designModel),
    });
    this.#rows.set(input.id, { record, deleted: false });
    return { version, sha256: record.sha256 };
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    assertProjectId(id);
    assertExpectedVersion(expectedVersion);
    const row = this.#rows.get(id);
    if (!row || row.deleted) throw new BridgeError("NOT_FOUND");
    if (row.record.version !== expectedVersion) throw new BridgeError("VERSION_CONFLICT");
    row.deleted = true;
  }
}

/** 메모리 FileGateway(웹 구현이 따를 순서를 그대로 흉내: 확장자 → `File.size` 상한 → 읽기). */
export class FakeFileGateway implements FileGateway {
  readonly fixture: FileFixture;

  constructor(fixture: FileFixture = createFileFixture()) {
    this.fixture = fixture;
  }

  async openImport(kind: ImportKind): Promise<Uint8Array> {
    assertImportKind(kind);
    const file = this.fixture.takeImport();
    if (!file) throw new BridgeError("CANCELLED");
    if (extensionOf(file.name) !== kind) throw new BridgeError("INVALID_INPUT");
    assertImportSize(kind, file.size);
    return this.fixture.read(file);
  }

  async save(format: ExportFormat, data: Uint8Array): Promise<ExportResult> {
    assertExportFormat(format);
    assertExportBody(format, data);
    const target = this.fixture.takeSaveTarget(format);
    if (!target) throw new BridgeError("CANCELLED");
    if (target.failWith) throw new BridgeError(target.failWith);
    this.fixture.write(target.path, data);
    return { pathHash: sha256(`fake:${target.path}`), bytes: data.byteLength, sha256: sha256(data) };
  }
}

/** 가짜 EntitlementClient: `granted`에 있는 권리만 허용(view_export는 항상), 나머지는 `reason`으로 거부. */
export class FakeEntitlementClient implements EntitlementClient {
  readonly license: LicenseClient | null;
  granted: Set<EntitlementFeature>;
  reason: DenyReason;
  state: EntitlementStatus = { state: "none", offlineValidUntil: null };

  constructor(options: { granted?: Iterable<EntitlementFeature>; reason?: DenyReason; license?: LicenseClient | null } = {}) {
    this.granted = new Set(options.granted ?? []);
    this.reason = options.reason ?? "no_product";
    this.license = options.license ?? null;
  }

  async can(feature: EntitlementFeature): Promise<EntitlementDecision> {
    assertEntitlementFeature(feature);
    return feature === "view_export" || this.granted.has(feature) ? ALLOW : deny(this.reason);
  }

  async status(): Promise<EntitlementStatus> {
    return this.state;
  }
}

export interface MemoryAdapters extends PlatformAdapters {
  readonly projects: MemoryProjectStore;
  readonly files: FakeFileGateway;
  readonly entitlement: FakeEntitlementClient;
}

/** 메모리 어댑터 묶음. 기본 capabilities는 웹 값(덮어쓰기 가능, 단 불변식은 지켜야 계약 통과). */
export function createMemoryAdapters(
  options: {
    capabilities?: Partial<PlatformCapabilities>;
    entitlement?: FakeEntitlementClient;
    updater?: Updater | null;
    files?: FileFixture;
  } = {},
): MemoryAdapters {
  const secrets = new MemorySecureStore();
  return Object.freeze({
    capabilities: Object.freeze({ ...WEB_CAPABILITIES, ...options.capabilities }),
    projects: new MemoryProjectStore(),
    files: new FakeFileGateway(options.files),
    secrets,
    entitlement: options.entitlement ?? new FakeEntitlementClient(),
    updater: options.updater ?? null,
    clearSecrets: () => clearAllSecrets(secrets),
  });
}
