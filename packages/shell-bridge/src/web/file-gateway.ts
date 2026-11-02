// 웹 FileGateway(AR-06-072): 가져오기 = `<input type=file>`, 내보내기 = File System Access API(있으면) 또는 다운로드 Blob.
// 크기 상한은 설치형과 같은 값을 **읽기 전에** `File.size`로 강제한다(assertImportSize 선행, 그 뒤에만 arrayBuffer()).
// 화면은 경로를 받지 않는다. 이름은 확장자 검사에만 쓰고 결과·오류에 남기지 않는다.
import { BridgeError } from "../adapters/errors.ts";
import { EXPORT_FORMATS, type ExportFormat, type ExportResult } from "../adapters/exporter.ts";
import {
  assertExportBody,
  assertExportFormat,
  assertImportKind,
  assertImportSize,
  extensionOf,
  type FileGateway,
  type ImportKind,
} from "../adapters/file-gateway.ts";
import { sha256Hex } from "./hash.ts";

export interface PickedFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 브라우저 파일 대화상자 경계(테스트는 fixture로 대체). */
export interface WebFileHost {
  /** 파일 하나 고르기. 취소면 null. `extensions`는 점 없는 소문자. */
  pickFile(extensions: readonly string[]): Promise<PickedFile | null>;
  /** 저장(대화상자 또는 다운로드). 사용자가 닫으면 "cancelled", 실패하면 던진다. */
  saveFile(format: ExportFormat, data: Uint8Array): Promise<"saved" | "cancelled">;
}

export class WebFileGateway implements FileGateway {
  readonly #host: WebFileHost;

  constructor(host: WebFileHost) {
    this.#host = host;
  }

  async openImport(kind: ImportKind): Promise<Uint8Array> {
    assertImportKind(kind);
    const file = await this.#host.pickFile([kind]);
    if (!file) throw new BridgeError("CANCELLED");
    if (extensionOf(file.name) !== kind) throw new BridgeError("INVALID_INPUT");
    assertImportSize(kind, file.size);
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      throw new BridgeError("READ_FAILED");
    }
    assertImportSize(kind, buffer.byteLength);
    return new Uint8Array(buffer);
  }

  async save(format: ExportFormat, data: Uint8Array): Promise<ExportResult> {
    assertExportFormat(format);
    assertExportBody(format, data);
    let outcome: "saved" | "cancelled";
    try {
      outcome = await this.#host.saveFile(format, data);
    } catch {
      throw new BridgeError("AR052");
    }
    if (outcome === "cancelled") throw new BridgeError("CANCELLED");
    const sha256 = await sha256Hex(data);
    // 웹에는 경로가 없다: 형식+내용 해시의 해시를 pathHash 자리에 쓴다(같은 내용 = 같은 값, 이름·경로 없음).
    const pathHash = await sha256Hex(new TextEncoder().encode(`web-download:${format}:${sha256}`));
    return { pathHash, bytes: data.byteLength, sha256 };
  }
}

const MIME: Readonly<Record<ExportFormat, string>> = {
  dxf: "application/dxf",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  png: "image/png",
  ifc: "application/x-step",
  gltf: "model/gltf+json",
  "3dm": "application/octet-stream",
};

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }> }>;
}

/** 브라우저 구현. 문서가 없는 환경(SSR·Node)에서 부르면 대화상자를 열 수 없어 실패한다. */
export function createBrowserFileHost(): WebFileHost {
  return {
    pickFile(extensions) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = extensions.map((e) => `.${e}`).join(",");
        input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => resolve(null), { once: true });
        input.click();
      });
    },
    async saveFile(format, data) {
      if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new Error("format");
      const name = `export.${format}`;
      const picker = (globalThis as SaveFilePickerWindow).showSaveFilePicker;
      if (picker) {
        try {
          const handle = await picker({ suggestedName: name, types: [{ description: format, accept: { [MIME[format]]: [`.${format}`] } }] });
          const w = await handle.createWritable();
          await w.write(data);
          await w.close();
          return "saved";
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
          throw e;
        }
      }
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[format] }));
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      return "saved";
    },
  };
}
