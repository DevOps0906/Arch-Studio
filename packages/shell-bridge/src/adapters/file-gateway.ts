// FileGateway: 가져오기(열기)·내보내기(저장) 파일 I/O(ADR-001 2.1). 설치형은 Rust가 연 OS 대화상자(`fs.rs`·`export.rs`),
// 웹은 072의 `<input type=file>`·File System Access API·다운로드 Blob. 화면은 경로를 주지도 받지도 않는다.
// 크기 상한은 두 구현이 같은 값을 **읽기 전에** 강제한다: 설치형은 Rust가 파일 메타데이터로, 웹은 `File.size`로 확인 후 읽는다.
import { BridgeError } from "./errors.ts";
import { EXPORT_FORMATS, EXPORT_MAX_BYTES, type ExportFormat, type Exporter } from "./exporter.ts";

/** 가져오기 종류(Rust `ImportKind`와 같은 값). */
export const IMPORT_KINDS = ["dxf", "ifc", "3dm"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

const MIB = 1024 * 1024;

/** 가져오기 상한(바이트): DXF 20MiB, IFC·.3dm 100MiB(ADR-001 2.1, Rust `DXF_MAX_BYTES`·`MODEL_MAX_BYTES`). */
export const IMPORT_MAX_BYTES: Readonly<Record<ImportKind, number>> = Object.freeze({
  dxf: 20 * MIB,
  ifc: 100 * MIB,
  "3dm": 100 * MIB,
});

export function isImportKind(kind: unknown): kind is ImportKind {
  return typeof kind === "string" && (IMPORT_KINDS as readonly string[]).includes(kind);
}

export function isExportFormat(format: unknown): format is ExportFormat {
  return typeof format === "string" && (EXPORT_FORMATS as readonly string[]).includes(format);
}

/** 종류 검사(오류에 입력값 없음). */
export function assertImportKind(kind: unknown): asserts kind is ImportKind {
  if (!isImportKind(kind)) throw new BridgeError("INVALID_INPUT");
}

export function assertExportFormat(format: unknown): asserts format is ExportFormat {
  if (!isExportFormat(format)) throw new BridgeError("INVALID_INPUT");
}

/**
 * 읽기 전 크기 검사. 웹 구현은 `File.size`로 이 함수를 부른 뒤에만 `arrayBuffer()`를 부른다.
 * 오류에는 크기·상한 값도 넣지 않는다(코드 AR055만).
 */
export function assertImportSize(kind: ImportKind, byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength < 0) throw new BridgeError("READ_FAILED");
  if (byteLength > IMPORT_MAX_BYTES[kind]) throw new BridgeError("AR055");
}

/** 내보내기 본문 검사: 비어 있으면 INVALID_INPUT, 상한 초과 AR055. 전송·쓰기 전에 부른다. */
export function assertExportBody(format: ExportFormat, data: unknown): asserts data is Uint8Array {
  if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new BridgeError("INVALID_INPUT");
  if (data.byteLength > EXPORT_MAX_BYTES[format]) throw new BridgeError("AR055");
}

/** 실제 확장자(소문자, 점 없음). 이름 원문은 어디에도 남기지 않는다. 웹 구현의 확장자 검사용. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * 파일 I/O. `save`는 005 `Exporter` 계약 그대로(설치형 결과의 `pathHash`는 경로 해시, 웹은 072가 정한다).
 * 실패는 BridgeError(FileErrorCode): CANCELLED 대화상자 닫음, AR055 상한 초과(읽기·전송 전), INVALID_INPUT 종류·확장자·빈 본문,
 * READ_FAILED 읽기 실패, AR052 쓰기 실패.
 */
export interface FileGateway extends Exporter {
  /** 열기 대화상자에서 `kind` 파일 하나를 골라 바이트를 돌려준다. 이름·경로는 돌려주지 않는다. */
  openImport(kind: ImportKind): Promise<Uint8Array>;
}
