// 테스트 더블. `@arch-studio/shell-bridge/testing`로만 가져온다(루트 index는 내보내지 않음 → 릴리스 번들에 안 들어감).
import { BridgeError, type ExportErrorCode, type LicenseErrorCode } from "../adapters/errors.ts";
import type { ExportFormat, ExportResult, Exporter } from "../adapters/exporter.ts";
import { EXPORT_MAX_BYTES } from "../adapters/exporter.ts";
import type { LicenseClient, LicenseStatus } from "../adapters/license-client.ts";
import type { BridgeCommand, InvokeFn } from "../tauri/invoke.ts";

export { LEAK, runAdapterContract, testProjectId, type ContractFactory, type ContractSubject } from "./contract.ts";
export { createFileFixture, type FileFixture, type OfferedFile, type SaveTarget } from "./files.ts";
export {
  createMemoryAdapters,
  FakeEntitlementClient,
  fakePng,
  FakeFileGateway,
  FakeRasterizer,
  MemoryProjectStore,
  type MemoryAdapters,
} from "./memory.ts";
export { createRustInvoke, type RustInvoke, type RustInvokeCall } from "./rust-invoke.ts";
// 설치형 어댑터 묶음을 Rust 모킹 invoke에 바로 붙인다(기능 테스트가 런타임 판정 없이 쓰도록, AR-06-077).
export { createTauriAdapters } from "../tauri/adapters.ts";
// 웹 가짜 서버·IDB(AR-06-077: features/cloud-sync 테스트가 실제 WebProjectStore를 가짜 서버에 붙인다).
export { BASE as FAKE_CLOUD_BASE, createFakeCloud, createFakeIdb, type FakeCloud } from "../web/fakes.ts";

/** 가짜 Exporter: 저장 내역을 기록하고, `failWith`가 있으면 그 코드로 실패. 크기 상한은 실제와 같다. */
export class FakeExporter implements Exporter {
  readonly saved: { format: ExportFormat; bytes: number }[] = [];
  failWith: ExportErrorCode | null = null;

  async save(format: ExportFormat, data: Uint8Array): Promise<ExportResult> {
    if (this.failWith) throw new BridgeError(this.failWith);
    if (data.byteLength > EXPORT_MAX_BYTES[format]) throw new BridgeError("AR055");
    this.saved.push({ format, bytes: data.byteLength });
    return { pathHash: "0".repeat(64), bytes: data.byteLength, sha256: "0".repeat(64) };
  }
}

const NO_LICENSE: LicenseStatus = { state: "none", sku: null, offlineValidUntil: null, serialSuffix: null };

/** 가짜 LicenseClient: `valid` 목록의 시리얼만 활성화. */
export class FakeLicenseClient implements LicenseClient {
  #status: LicenseStatus = NO_LICENSE;
  failWith: LicenseErrorCode | null = null;

  readonly #valid: readonly string[];

  constructor(valid: readonly string[] = []) {
    this.#valid = valid;
  }

  async status(): Promise<LicenseStatus> {
    return this.#status;
  }

  async activate(serial: string): Promise<LicenseStatus> {
    if (this.failWith) throw new BridgeError(this.failWith);
    if (!this.#valid.includes(serial)) throw new BridgeError("LICENSE_INVALID");
    this.#status = { state: "active", sku: "perpetual", offlineValidUntil: null, serialSuffix: serial.slice(-5) };
    return this.#status;
  }

  async deactivate(): Promise<void> {
    this.#status = NO_LICENSE;
  }
}

export interface InvokeCall {
  cmd: BridgeCommand;
  args: Record<string, unknown>;
}

/**
 * Rust secrets.rs를 흉내 내는 invoke 모킹. `keychain` Map은 재시작(새 브리지)에도 남는 OS 키체인 역할.
 * `delay`로 호출마다 지연을 줘 순서 역전을 재현한다.
 */
export function createKeychainInvoke(
  keychain: Map<string, string> = new Map(),
  delay: (call: InvokeCall) => number = () => 0,
): { invoke: InvokeFn; keychain: Map<string, string>; calls: InvokeCall[] } {
  const calls: InvokeCall[] = [];
  const invoke: InvokeFn = async (cmd, raw) => {
    const args = raw as Record<string, unknown>;
    const call = { cmd, args };
    calls.push(call);
    const ms = delay(call);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const key = String(args.key);
    switch (cmd) {
      case "secret_get":
        return keychain.get(key) ?? null;
      case "secret_set":
        keychain.set(key, String(args.value));
        return null;
      case "secret_delete":
        keychain.delete(key);
        return null;
      default:
        // 비밀 명령만 흉내 낸다. 나머지 명령은 createRustInvoke를 쓴다.
        throw { code: "NOT_MOCKED", detail: cmd };
    }
  };
  return { invoke, keychain, calls };
}
