// 설치형 FileGateway: Rust `fs_open_import`(열기 대화상자 → 원시 바이트)·`export_save_file`(원시 본문 + `x-export-format` 헤더 → 저장 대화상자).
// 경로는 Rust만 안다. 크기 상한은 Rust가 읽기 전에 메타데이터로 강제하고(AR055), TS는 그 위에 두 번째 검사를 둔다:
// 내보내기는 IPC로 보내기 전에, 가져오기는 받은 길이를 다시 확인한다.
import { BridgeError, errorFrom, type FileErrorCode } from "../adapters/errors.ts";
import type { ExportFormat, ExportResult } from "../adapters/exporter.ts";
import {
  assertExportBody,
  assertExportFormat,
  assertImportKind,
  assertImportSize,
  type FileGateway,
  type ImportKind,
} from "../adapters/file-gateway.ts";
import type { InvokeFn } from "./invoke.ts";

/** Rust `export.rs` `FORMAT_HEADER`. */
export const EXPORT_FORMAT_HEADER = "x-export-format";

const OPEN_CODES: readonly FileErrorCode[] = ["AR055", "CANCELLED", "INVALID_INPUT", "READ_FAILED"];
const SAVE_CODES: readonly FileErrorCode[] = ["AR052", "AR055", "CANCELLED", "INVALID_INPUT"];
const HEX64 = /^[0-9a-f]{64}$/;

function bytesOf(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  // 일부 런타임은 원시 응답을 number[]로 준다.
  if (Array.isArray(raw) && raw.every((b) => typeof b === "number")) return Uint8Array.from(raw);
  return null;
}

export class TauriFileGateway implements FileGateway {
  readonly #invoke: InvokeFn;

  constructor(invoke: InvokeFn) {
    this.#invoke = invoke;
  }

  async openImport(kind: ImportKind): Promise<Uint8Array> {
    assertImportKind(kind);
    let raw: unknown;
    try {
      raw = await this.#invoke("fs_open_import", { kind });
    } catch (err) {
      throw errorFrom(err, OPEN_CODES, "READ_FAILED");
    }
    const bytes = bytesOf(raw);
    if (!bytes) throw new BridgeError("READ_FAILED");
    assertImportSize(kind, bytes.byteLength);
    return bytes;
  }

  async save(format: ExportFormat, data: Uint8Array): Promise<ExportResult> {
    assertExportFormat(format);
    assertExportBody(format, data);
    let raw: unknown;
    try {
      raw = await this.#invoke("export_save_file", data, { headers: { [EXPORT_FORMAT_HEADER]: format } });
    } catch (err) {
      throw errorFrom(err, SAVE_CODES, "AR052");
    }
    // Rust는 대화상자 취소를 Ok(None)으로 돌려준다. 계약(005 Exporter)은 CANCELLED 오류.
    if (raw === null || raw === undefined) throw new BridgeError("CANCELLED");
    const r = raw as Record<string, unknown>;
    if (typeof r.pathHash !== "string" || !HEX64.test(r.pathHash) || typeof r.sha256 !== "string" || !HEX64.test(r.sha256)) {
      throw new BridgeError("AR052");
    }
    return Object.freeze({
      pathHash: r.pathHash,
      bytes: typeof r.bytes === "number" ? r.bytes : data.byteLength,
      sha256: r.sha256,
    });
  }
}
