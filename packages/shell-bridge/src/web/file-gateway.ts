// 웹 FileGateway(ADR-001 2.1): 열기는 File System Access API(`showOpenFilePicker`, 가능 시) 또는 `<input type=file>`,
// 저장은 `showSaveFilePicker`(가능 시) 또는 다운로드 Blob. 크기 상한은 설치형과 같은 값을 **읽기 전에** `File.size`로 강제한다
// (assertImportSize → 통과해야 arrayBuffer). 이름·경로는 돌려주지 않는다: 저장 결과 pathHash = sha256("web:" + 파일 이름).
// 브라우저 API는 WebFileHost 뒤에 둔다(테스트는 계약 하네스 fixture를 host로 꽂는다).
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
import { sha256Hex } from "./http.ts";

/** 고른 파일(브라우저 File의 필요한 부분). 크기는 읽기 전에 안다. */
export interface PickedFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 저장 대상. write 실패는 throw(→ AR052). */
export interface SaveSink {
  readonly name: string;
  write(data: Uint8Array): Promise<void>;
}

/** 브라우저 파일 대화상자 경계. null = 사용자가 취소. */
export interface WebFileHost {
  pickOpen(kind: ImportKind): Promise<PickedFile | null>;
  pickSave(format: ExportFormat): Promise<SaveSink | null>;
}

export class WebFileGateway implements FileGateway {
  readonly #host: WebFileHost;

  constructor(host: WebFileHost) {
    this.#host = host;
  }

  async openImport(kind: ImportKind): Promise<Uint8Array> {
    assertImportKind(kind);
    let file: PickedFile | null;
    try {
      file = await this.#host.pickOpen(kind);
    } catch {
      throw new BridgeError("READ_FAILED");
    }
    if (!file) throw new BridgeError("CANCELLED");
    if (extensionOf(file.name) !== kind) throw new BridgeError("INVALID_INPUT");
    assertImportSize(kind, file.size);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new BridgeError("READ_FAILED");
    }
    assertImportSize(kind, bytes.byteLength);
    return bytes;
  }

  async save(format: ExportFormat, data: Uint8Array): Promise<ExportResult> {
    assertExportFormat(format);
    assertExportBody(format, data);
    let sink: SaveSink | null;
    try {
      sink = await this.#host.pickSave(format);
    } catch {
      throw new BridgeError("AR052");
    }
    if (!sink) throw new BridgeError("CANCELLED");
    try {
      await sink.write(data);
    } catch {
      throw new BridgeError("AR052");
    }
    return Object.freeze({
      pathHash: await sha256Hex(`web:${sink.name}`),
      bytes: data.byteLength,
      sha256: await sha256Hex(data),
    });
  }
}

// ---- 브라우저 기본 host ------------------------------------------------------------------------

const MIME: Readonly<Record<ExportFormat, string>> = Object.freeze({
  dxf: "application/dxf",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  png: "image/png",
  ifc: "application/x-step",
  gltf: "model/gltf+json",
  "3dm": "application/octet-stream",
});

interface FsWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  readonly name: string;
  getFile(): Promise<PickedFile>;
  createWritable(): Promise<FsWritable>;
}
interface FsAccessWindow {
  showOpenFilePicker?: (o: unknown) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FsFileHandle>;
}

const isAbort = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";

function inputPick(kind: ImportKind): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${kind}`;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

function downloadSink(format: ExportFormat): SaveSink {
  const name = `arch-studio-export.${format}`;
  return {
    name,
    async write(data) {
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[format] }));
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.rel = "noopener";
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    },
  };
}

/** 브라우저 host: File System Access API가 있으면 쓰고, 없으면 `<input type=file>`·다운로드. */
export function browserFileHost(): WebFileHost {
  const w = globalThis as unknown as FsAccessWindow;
  return {
    async pickOpen(kind) {
      if (!w.showOpenFilePicker) return inputPick(kind);
      try {
        const [handle] = await w.showOpenFilePicker({
          multiple: false,
          types: [{ description: kind.toUpperCase(), accept: { "application/octet-stream": [`.${kind}`] } }],
        });
        return handle ? await handle.getFile() : null;
      } catch (err) {
        if (isAbort(err)) return null;
        throw err;
      }
    },
    async pickSave(format) {
      if (!w.showSaveFilePicker) return downloadSink(format);
      let handle: FsFileHandle;
      try {
        handle = await w.showSaveFilePicker({
          suggestedName: `arch-studio-export.${format}`,
          types: [{ description: format.toUpperCase(), accept: { [MIME[format]]: [`.${format}`] } }],
        });
      } catch (err) {
        if (isAbort(err)) return null;
        throw err;
      }
      return {
        name: handle.name,
        async write(data) {
          const out = await handle.createWritable();
          await out.write(data);
          await out.close();
        },
      };
    },
  };
}
