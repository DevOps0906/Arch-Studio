// Exporter 인터페이스(005). 070부터 FileGateway가 이 계약을 포함한다(설치형 `tauri/file-gateway.ts` → Rust `export_save_file`,
// 웹은 072 다운로드 Blob). 실패는 BridgeError(ExportErrorCode)로 던진다: AR052 쓰기 실패, AR055 크기 초과, CANCELLED 사용자가 대화상자를 닫음.

export const EXPORT_FORMATS = ["dxf", "svg", "pdf", "png", "ifc", "gltf", "3dm"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 본문 상한(바이트): DXF 20MiB, 나머지 100MiB(ADR-001 2.1, Rust export.rs와 같다). 넘으면 쓰기·전송 전에 AR055. */
export const EXPORT_MAX_BYTES: Readonly<Record<ExportFormat, number>> = Object.freeze({
  dxf: 20 * 1024 * 1024,
  svg: 100 * 1024 * 1024,
  pdf: 100 * 1024 * 1024,
  png: 100 * 1024 * 1024,
  ifc: 100 * 1024 * 1024,
  gltf: 100 * 1024 * 1024,
  "3dm": 100 * 1024 * 1024,
});

/** 저장 결과. 경로 원문은 돌려주지 않는다(`pathHash`만, exports 테이블 기록용). */
export interface ExportResult {
  readonly pathHash: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Exporter {
  /** 저장 대화상자를 열고 바이트를 쓴다. 경로는 구현이 정하고 화면은 받지 않는다. */
  save(format: ExportFormat, data: Uint8Array): Promise<ExportResult>;
}
