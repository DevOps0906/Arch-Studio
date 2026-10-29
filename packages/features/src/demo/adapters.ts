// 데모 인메모리 어댑터 5종(개발 전용). shell-bridge `testing` 더블은 node:crypto를 쓰고 프로덕션 코드 import가 막혀 있어(eslint testDouble)
// 쓰지 않고, 같은 동시성 규칙(070 project-store.ts 주석: 새 = null → v1, 버전 불일치 VERSION_CONFLICT, 삭제는 소프트)을 여기 다시 구현한다.
// 오류는 BridgeError와 같은 모양 `{ name: "BridgeError", code }`(화면은 shell/errors.ts bridgeErrorCode로 판별).
import type {
  BridgeErrorCode,
  EntitlementClient,
  EntitlementDecision,
  EntitlementFeature,
  EntitlementStatus,
  ExportFormat,
  ExportResult,
  FileGateway,
  PlatformCapabilities,
  ProjectRecord,
  ProjectStore,
  ProjectSummary,
  SaveProjectInput,
  SaveProjectResult,
  SecretKey,
  SecureStore,
} from "@arch-studio/shell-bridge";
import type { ShellAdapters } from "../shell/types.ts";
import { DEMO_PROJECTS } from "./samples.ts";

export class DemoBridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode) {
    super(`shell-bridge: ${code}`);
    this.name = "BridgeError";
    this.code = code;
  }
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Row {
  record: ProjectRecord;
  deleted: boolean;
}

/** 메모리 ProjectStore. 시계는 주입(기본: 샘플 최신 수정일 뒤로 1초씩 — 결정적). */
export class DemoProjectStore implements ProjectStore {
  readonly #rows = new Map<string, Row>();
  readonly #ready: Promise<void>;
  #tick = 0;

  constructor(seed = DEMO_PROJECTS) {
    this.#ready = (async () => {
      for (const p of seed) {
        const designModel = JSON.stringify(p.model);
        this.#rows.set(p.id, {
          deleted: false,
          record: {
            id: p.id,
            name: p.name,
            siteLabel: p.siteLabel,
            clientName: p.clientName,
            clientContact: null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            version: 1,
            schemaVersion: 1,
            engineVersion: p.model.meta.created_by_engine_version,
            designModel,
            sha256: await sha256Hex(designModel),
          },
        });
      }
    })();
  }

  #now(): string {
    return new Date(Date.UTC(2026, 9, 29) + ++this.#tick * 1000).toISOString();
  }

  async list(): Promise<readonly ProjectSummary[]> {
    await this.#ready;
    return [...this.#rows.values()]
      .filter((r) => !r.deleted)
      .map(({ record: r }) => ({ id: r.id, name: r.name, siteLabel: r.siteLabel, updatedAt: r.updatedAt, version: r.version }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async open(id: string): Promise<ProjectRecord | null> {
    await this.#ready;
    if (!UUID_V7.test(id)) throw new DemoBridgeError("INVALID_INPUT");
    const row = this.#rows.get(id);
    return row && !row.deleted ? row.record : null;
  }

  async save(input: SaveProjectInput): Promise<SaveProjectResult> {
    await this.#ready;
    if (!UUID_V7.test(input.id) || input.name.trim() === "" || !input.designModel.trimStart().startsWith("{")) {
      throw new DemoBridgeError("INVALID_INPUT");
    }
    const row = this.#rows.get(input.id);
    if (!row && input.expectedVersion !== null) throw new DemoBridgeError("NOT_FOUND");
    if (row?.deleted) throw new DemoBridgeError("NOT_FOUND");
    if (row && row.record.version !== input.expectedVersion) throw new DemoBridgeError("VERSION_CONFLICT");
    const version = row ? row.record.version + 1 : 1;
    const now = this.#now();
    const sha256 = await sha256Hex(input.designModel);
    this.#rows.set(input.id, {
      deleted: false,
      record: {
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
        sha256,
      },
    });
    return { version, sha256 };
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    await this.#ready;
    const row = this.#rows.get(id);
    if (!row || row.deleted) throw new DemoBridgeError("NOT_FOUND");
    if (row.record.version !== expectedVersion) throw new DemoBridgeError("VERSION_CONFLICT");
    row.deleted = true;
  }
}

/** 파일 대화상자 없음: 가져오기는 취소로, 내보내기는 바이트만 세고 버린다(경로 없음). */
export class DemoFileGateway implements FileGateway {
  readonly saved: { format: ExportFormat; bytes: number }[] = [];
  async openImport(): Promise<Uint8Array> {
    throw new DemoBridgeError("CANCELLED");
  }
  async save(format: ExportFormat, data: Uint8Array): Promise<ExportResult> {
    if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new DemoBridgeError("INVALID_INPUT");
    this.saved.push({ format, bytes: data.byteLength });
    const sha = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
    const hex = [...new Uint8Array(sha)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { pathHash: "0".repeat(64), bytes: data.byteLength, sha256: hex };
  }
}

const ALLOWED_SECRET_KEYS: readonly string[] = ["auth.session", "auth.pkce"];

export class DemoSecureStore implements SecureStore {
  readonly #items = new Map<SecretKey, string>();
  async get(key: SecretKey): Promise<string | null> {
    if (!ALLOWED_SECRET_KEYS.includes(key)) throw new DemoBridgeError("SECRET_KEY_NOT_ALLOWED");
    return this.#items.get(key) ?? null;
  }
  async set(key: SecretKey, value: string): Promise<void> {
    if (!ALLOWED_SECRET_KEYS.includes(key)) throw new DemoBridgeError("SECRET_KEY_NOT_ALLOWED");
    this.#items.set(key, value);
  }
  async delete(key: SecretKey): Promise<void> {
    this.#items.delete(key);
  }
}

/** 데모 라이선스 상태(ADR-001 4.7 표의 행). URL `?demo-license=trial|fallback|expired`로 고른다. */
export type DemoLicense = "trial" | "fallback" | "expired";

const ALLOW: EntitlementDecision = { allowed: true };
const RIGHTS: Readonly<Record<DemoLicense, Partial<Record<EntitlementFeature, EntitlementDecision>>>> = {
  trial: { view_export: ALLOW, desktop_edit: ALLOW, web_edit: ALLOW, ai_render: ALLOW, ai_chat: ALLOW, cloud_review: ALLOW },
  fallback: {
    view_export: ALLOW,
    desktop_edit: ALLOW,
    ai_render: ALLOW,
    web_edit: { allowed: false, reason: "fallback" },
    ai_chat: { allowed: false, reason: "fallback" },
    cloud_review: { allowed: false, reason: "fallback" },
  },
  expired: { view_export: ALLOW },
};

export class DemoEntitlementClient implements EntitlementClient {
  readonly license = null;
  readonly #profile: DemoLicense;
  constructor(profile: DemoLicense) {
    this.#profile = profile;
  }
  async can(feature: EntitlementFeature): Promise<EntitlementDecision> {
    return RIGHTS[this.#profile][feature] ?? { allowed: false, reason: "expired" };
  }
  async status(): Promise<EntitlementStatus> {
    return { state: this.#profile === "fallback" ? "active" : this.#profile === "expired" ? "expired" : "none", offlineValidUntil: null };
  }
}

/** 설치형과 같은 로컬 프로젝트 모드로 보이되, 브라우저라 OS 파일 대화상자·키체인·업데이트·시리얼 활성화는 없다. */
export const DEMO_CAPABILITIES: PlatformCapabilities = Object.freeze({
  offline: true,
  localFiles: false,
  autoUpdate: false,
  persistentSecrets: false,
  localProjects: true,
  licenseActivation: false,
});

export function createDemoAdapters(profile: DemoLicense = "trial"): ShellAdapters {
  const secrets = new DemoSecureStore();
  return Object.freeze({
    capabilities: DEMO_CAPABILITIES,
    projects: new DemoProjectStore(),
    files: new DemoFileGateway(),
    secrets,
    entitlement: new DemoEntitlementClient(profile),
    updater: null,
    clearSecrets: async () => {
      await secrets.delete("auth.session");
      await secrets.delete("auth.pkce");
    },
  });
}
