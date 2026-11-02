// Rust 명령(build.rs APP_COMMANDS 중 화면용 10개)을 흉내 내는 invoke 모킹. 규칙은 apps/desktop/src-tauri/src/commands/*.rs와 같게 둔다:
// - local_db: UUIDv7 id, expected_version 규칙, 소프트 삭제, 오류 `{code, detail}`(detail에 현재 version — TS가 버려야 하는 값).
//   클라우드 사본 연결(AR-06-077): link는 projectUuid·cloudVersion만(deny_unknown_fields), 같은 사본의 version 감소는 VERSION_CONFLICT.
// - fs_open_import: 대화상자가 고른 파일(`files.offerImport`)의 확장자·크기를 읽기 전에 검사(AR055 detail = 상한).
// - export_save_file: 원시 본문 + `x-export-format` 헤더, 취소는 null, 결과는 pathHash·bytes·sha256.
// - rasterize_svg(AR-06-080): `{svg, options}`(옵션 키 정확히 하나), 8MiB 상한 AR055, 허용 밖 요소·깨진 SVG INVALID_INPUT, 동시 호출 BUSY.
//   결과는 원시 PNG(ArrayBuffer). 실제 렌더는 Rust `cargo test`(골든)가 확인한다.
// 오류 detail에는 일부러 경로·값을 섞어 "TS가 원문을 버리는가"를 검사할 수 있게 한다.
import { createHash } from "node:crypto";
import type { BridgeCommand, InvokeArgs, InvokeFn, InvokeOptions } from "../tauri/invoke.ts";
import { createFileFixture, type FileFixture } from "./files.ts";
import { fakePng } from "./memory.ts";

export interface RustInvokeCall {
  cmd: BridgeCommand;
  args: InvokeArgs;
  options?: InvokeOptions;
}

interface Row {
  name: string;
  siteLabel: string | null;
  clientName: string | null;
  clientContact: string | null;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  /** projects.cloud_project_id·cloud_version(AR-06-077). */
  cloud?: { projectUuid: string; cloudVersion: number };
  revisions: { schemaVersion: number; engineVersion: string; designModel: string; sha256: string }[];
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIB = 1024 * 1024;
const IMPORT_LIMIT: Record<string, number> = { dxf: 20 * MIB, ifc: 100 * MIB, "3dm": 100 * MIB };
const EXPORT_FORMATS = ["dxf", "svg", "pdf", "png", "ifc", "gltf", "3dm"];
const SAVE_FIELDS = new Set([
  "id",
  "name",
  "siteLabel",
  "clientName",
  "clientContact",
  "schemaVersion",
  "engineVersion",
  "designModel",
  "note",
  "expectedVersion",
]);

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const fail = (code: string, detail: string) => {
  throw { code, detail };
};

export interface RustInvoke {
  invoke: InvokeFn;
  /** rasterize_svg 응답 지연(ms, 동시 호출 BUSY 재현용). */
  rasterDelayMs: number;
  calls: RustInvokeCall[];
  keychain: Map<string, string>;
  files: FileFixture;
}

/** 설치형 Rust 쪽 전체 모킹. 시계는 단조 증가 가짜 값(정렬 검사용). */
export function createRustInvoke(keychain: Map<string, string> = new Map()): RustInvoke {
  const calls: RustInvokeCall[] = [];
  const projects = new Map<string, Row>();
  const files = createFileFixture();
  let tick = 0;
  let rasterBusy = false;
  const now = () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString();

  const version = (row: Row) => row.revisions.length;

  const validateSave = (input: Record<string, unknown>) => {
    for (const k of Object.keys(input)) if (!SAVE_FIELDS.has(k)) fail("INVALID_INPUT", `unknown field ${k}`);
    if (typeof input.id !== "string" || !UUID_V7.test(input.id)) fail("INVALID_INPUT", "id");
    if (typeof input.name !== "string" || input.name.trim() === "" || [...input.name].length > 200) fail("INVALID_INPUT", "name");
    if (typeof input.designModel !== "string") fail("INVALID_INPUT", "design_model_json");
    try {
      const v: unknown = JSON.parse(input.designModel as string);
      if (typeof v !== "object" || v === null || Array.isArray(v)) fail("INVALID_INPUT", "design_model_json");
    } catch {
      fail("INVALID_INPUT", "design_model_json");
    }
    if (typeof input.schemaVersion !== "number" || input.schemaVersion < 1) fail("INVALID_INPUT", "schema_version");
    if (input.expectedVersion !== null && (typeof input.expectedVersion !== "number" || input.expectedVersion < 1)) {
      fail("INVALID_INPUT", "expected_version");
    }
  };

  const invoke: InvokeFn = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const a = args as Record<string, unknown>;
    switch (cmd) {
      case "secret_get":
        return keychain.get(String(a.key)) ?? null;
      case "secret_set":
        keychain.set(String(a.key), String(a.value));
        return null;
      case "secret_delete":
        keychain.delete(String(a.key));
        return null;

      case "local_db_list_projects":
        return [...projects.entries()]
          .filter(([, r]) => !r.deleted)
          .sort(([ia, a1], [ib, b1]) => b1.updatedAt.localeCompare(a1.updatedAt) || ia.localeCompare(ib))
          .map(([id, r]) => ({ id, name: r.name, siteLabel: r.siteLabel, updatedAt: r.updatedAt, version: version(r) }));
      case "local_db_get_project": {
        const id = String(a.id);
        if (!UUID_V7.test(id)) fail("INVALID_INPUT", "id");
        const r = projects.get(id);
        if (!r || r.deleted) return null;
        const rev = r.revisions[r.revisions.length - 1]!;
        return {
          id,
          name: r.name,
          siteLabel: r.siteLabel,
          clientName: r.clientName,
          clientContact: r.clientContact,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          version: version(r),
          ...rev,
        };
      }
      case "local_db_save_project": {
        const input = a.input as Record<string, unknown>;
        validateSave(input);
        const id = input.id as string;
        const row = projects.get(id);
        const expected = input.expectedVersion as number | null;
        const fields = {
          name: input.name as string,
          siteLabel: (input.siteLabel as string | null) ?? null,
          clientName: (input.clientName as string | null) ?? null,
          clientContact: (input.clientContact as string | null) ?? null,
        };
        const rev = {
          schemaVersion: input.schemaVersion as number,
          engineVersion: input.engineVersion as string,
          designModel: input.designModel as string,
          sha256: sha256(input.designModel as string),
        };
        if (!row) {
          if (expected !== null) fail("NOT_FOUND", "project");
          const t = now();
          projects.set(id, { ...fields, createdAt: t, updatedAt: t, deleted: false, revisions: [rev] });
          return { version: 1, sha256: rev.sha256 };
        }
        if (row.deleted) fail("NOT_FOUND", "deleted");
        if (expected !== version(row)) fail("VERSION_CONFLICT", String(version(row)));
        Object.assign(row, fields, { updatedAt: now() });
        row.revisions.push(rev);
        return { version: version(row), sha256: rev.sha256 };
      }
      case "local_db_get_cloud_link": {
        const id = String(a.id);
        if (!UUID_V7.test(id)) fail("INVALID_INPUT", "id");
        const r = projects.get(id);
        return r && !r.deleted && r.cloud ? { ...r.cloud } : null;
      }
      case "local_db_set_cloud_link": {
        const id = String(a.id);
        if (!UUID_V7.test(id)) fail("INVALID_INPUT", "id");
        const link = (a.link ?? {}) as Record<string, unknown>;
        for (const k of Object.keys(link)) if (k !== "projectUuid" && k !== "cloudVersion") fail("INVALID_INPUT", `unknown field ${k}`);
        if (typeof link.projectUuid !== "string" || !UUID_V7.test(link.projectUuid)) fail("INVALID_INPUT", "project_uuid");
        if (typeof link.cloudVersion !== "number" || !Number.isSafeInteger(link.cloudVersion) || link.cloudVersion < 1) {
          fail("INVALID_INPUT", "cloud_version");
        }
        const r = projects.get(id);
        if (!r || r.deleted) fail("NOT_FOUND", "project");
        const prev = r!.cloud;
        if (prev && prev.projectUuid === link.projectUuid && (link.cloudVersion as number) < prev.cloudVersion) {
          fail("VERSION_CONFLICT", String(prev.cloudVersion));
        }
        r!.cloud = { projectUuid: link.projectUuid as string, cloudVersion: link.cloudVersion as number };
        return null;
      }
      case "local_db_delete_project": {
        const id = String(a.id);
        if (!UUID_V7.test(id)) fail("INVALID_INPUT", "id");
        const row = projects.get(id);
        if (!row || row.deleted) fail("NOT_FOUND", "project");
        if (row!.revisions.length !== a.expectedVersion) fail("VERSION_CONFLICT", String(version(row!)));
        row!.deleted = true;
        row!.updatedAt = now();
        return null;
      }

      case "fs_open_import": {
        const kind = String(a.kind);
        if (!(kind in IMPORT_LIMIT)) fail("INVALID_INPUT", `unknown variant ${kind}`);
        const picked = files.takeImport();
        if (!picked) fail("CANCELLED", "dialog");
        const ext = picked!.name.split(".").pop()?.toLowerCase() ?? "";
        if (ext !== kind) fail("INVALID_INPUT", "extension");
        const limit = IMPORT_LIMIT[kind]!;
        // Rust: 메타데이터 크기로 읽기 전에 거부.
        if (picked!.size > limit) fail("AR055", String(limit));
        const bytes = files.read(picked!);
        // Rust `Response::new(bytes)` → 웹뷰에서는 ArrayBuffer.
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      case "rasterize_svg": {
        const keys = Object.keys(a).sort().join(",");
        if (keys !== "options,svg") fail("INVALID_INPUT", `invalid args: ${keys}`);
        const svg = a.svg;
        const o = a.options as Record<string, unknown> | null;
        if (typeof svg !== "string") fail("INVALID_INPUT", "svg");
        const ok =
          o !== null &&
          typeof o === "object" &&
          Object.keys(o).length === 1 &&
          ((Number.isInteger(o.widthPx) && (o.widthPx as number) >= 1) ||
            (typeof o.dpi === "number" && o.dpi >= 10 && o.dpi <= 1200));
        if (!ok) fail("INVALID_INPUT", "options");
        if (new TextEncoder().encode(svg as string).byteLength > 8 * MIB) fail("AR055", "svg_bytes");
        if (rasterBusy) fail("BUSY", "busy");
        // 실제 Rust는 고정 토큰만 주지만, 여기서는 TS가 detail을 버리는지 보려고 원문을 섞는다.
        if (!/^\s*<svg[\s>]/.test(svg as string)) fail("INVALID_INPUT", `parse: ${(svg as string).slice(0, 64)}`);
        if (/<(image|use|style|foreignObject|filter|mask|pattern)\b|\bhref\s*=/i.test(svg as string)) {
          fail("INVALID_INPUT", `element: ${(svg as string).slice(0, 64)}`);
        }
        rasterBusy = true;
        try {
          if (rust.rasterDelayMs > 0) await new Promise((r) => setTimeout(r, rust.rasterDelayMs));
        } finally {
          rasterBusy = false;
        }
        const png = fakePng();
        return png.buffer;
      }
      case "export_save_file": {
        const format = options?.headers?.["x-export-format"];
        if (!format || !EXPORT_FORMATS.includes(format)) fail("INVALID_INPUT", "format");
        if (!(args instanceof Uint8Array)) fail("INVALID_INPUT", "body");
        const body = args as Uint8Array;
        if (body.byteLength === 0) fail("INVALID_INPUT", "empty");
        const limit = format === "dxf" ? 20 * MIB : 100 * MIB;
        if (body.byteLength > limit) fail("AR055", String(limit));
        const target = files.takeSaveTarget(format!);
        if (target === null) return null;
        if (target.failWith) fail(target.failWith, `PermissionDenied ${target.path}`);
        files.write(target.path, body);
        return {
          pathHash: sha256(`com.archstudio.desktop/path-hash/v1\0${target.path}`),
          bytes: body.byteLength,
          sha256: sha256(body),
        };
      }
    }
  };
  const rust: RustInvoke = { invoke, calls, keychain, files, rasterDelayMs: 0 };
  return rust;
}
