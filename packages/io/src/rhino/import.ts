// .3dm 가져오기(AR-06-039): .3dm → 메시 객체 "후보"(정수 mm IntMesh). 메시만 읽고 Brep·곡선·블록 등은 종류별 개수만 경고로 남긴다.
// 결과는 항상 needs_confirmation — 사용자가 후보를 확정한 뒤에야 호출자가 DesignModel에 반영한다(이 패키지는 모델을 고치지 않는다).
// 순수성: 같은 커널 상태·같은 입력 → 같은 결과. 예외는 새지 않는다(구조화 결과, 퍼징 테스트가 확인).
import { COORD_LIMIT, canonicalMesh, closedMeshIssue, roundHalfAway, type IntMesh, type Point3 } from "@arch-studio/geometry";
import { Rhino3dmFail, type Rhino3dmImportError, type Rhino3dmImportErrorCode } from "./errors.ts";
import { RHINO_USER_ID, RHINO_USER_KEY } from "./export.ts";
import { DECOMPRESS_RATIO, MAX_3DM_NAME_LENGTH, MIN_GROWTH_ALLOWANCE_BYTES, resolve3dmLimits, type Rhino3dmImportLimits } from "./limits.ts";
import { embindDeleter, wasmApi, type RhinoModule } from "./module.ts";

/** 지원 단위 → mm 배율. 파일 선언 단위가 이 밖(None·Custom·Unset 등)이면 needs_unit으로 묻는다. */
export const RHINO_UNIT_TO_MM = {
  Microns: 0.001,
  Millimeters: 1,
  Centimeters: 10,
  Decimeters: 100,
  Meters: 1000,
  Kilometers: 1_000_000,
  Inches: 25.4,
  Feet: 304.8,
} as const;

export type Rhino3dmUnit = keyof typeof RHINO_UNIT_TO_MM;

export interface Rhino3dmImportOptions {
  /** 사용자가 고른 단위. 주면 파일 선언 단위 대신 이 단위로 mm 환산한다(AR053 답변). */
  unit?: Rhino3dmUnit;
  /** 상한 낮추기(올릴 수 없음). */
  limits?: Partial<Rhino3dmImportLimits>;
}

export interface Rhino3dmCandidate {
  /** 파일 객체 순번(0부터). */
  index: number;
  name: string;
  /** 우리가 내보낸 파일이면 arch_studio.key·arch_studio.id 사용자 문자열(없으면 null). */
  source_key: string | null;
  source_id: string | null;
  /** 정수 mm 정규 메시(사각형 면은 삼각형 2개로, 반올림으로 퇴화한 삼각형은 뺌). */
  mesh: IntMesh;
  /** 닫힌 메시인가(closedMeshIssue === null). 매스로 쓰려면 닫혀 있어야 한다. */
  closed: boolean;
}

export interface Rhino3dmImportStats {
  file_bytes: number;
  objects: number;
  meshes: number;
  vertices: number;
  faces: number;
  /** 꼭짓점 번호가 범위 밖이라 버린 면 수. */
  invalid_faces: number;
  /** 정규화 뒤 삼각형이 하나도 없어 후보에서 뺀 메시 수. */
  degenerate_meshes: number;
  /** 가져오기 한 번에 늘어난 wasm 메모리(바이트). */
  wasm_memory_growth: number;
}

export interface Rhino3dmWarning {
  code: "AR054";
  detail: string;
  /** 객체 종류 → 개수(이름 사전순). */
  skipped_objects: Record<string, number>;
}

export type Rhino3dmImportResult =
  | {
      ok: true;
      status: "needs_confirmation";
      unit: { unit: Rhino3dmUnit; source: "caller" | "file"; declared: string };
      candidates: Rhino3dmCandidate[];
      warnings: Rhino3dmWarning[];
      stats: Rhino3dmImportStats;
    }
  | {
      ok: true;
      /** 파일 단위가 없거나 지원 밖: 후보를 만들지 않는다. options.unit을 정해 다시 호출한다. */
      status: "needs_unit";
      code: "AR053";
      declared: string;
      stats: Rhino3dmImportStats;
    }
  | { ok: false; error: Rhino3dmImportError };

/** 지울 embind 래퍼(embindDeleter로 지운다). */
type Owned = object;

function fail(code: Rhino3dmImportErrorCode, message: string, discard = false): Rhino3dmImportResult {
  return { ok: false, error: discard ? { code, message, discard_kernel: true } : { code, message } };
}

/** wasm 호출 구간: 트랩·abort는 커널을 버려야 하는 오류로, 그 밖의 예외(embind·C++)는 손상 파일로 바꾼다. */
function wasm<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof Rhino3dmFail) throw e;
    if (e instanceof wasmApi.RuntimeError) throw new Rhino3dmFail("R3DM_WASM_TRAP", "3dm 파일을 읽는 중 wasm 실행이 중단되었습니다", { discard_kernel: true });
    throw new Rhino3dmFail("R3DM_MALFORMED", "3dm 파일을 읽을 수 없습니다(손상되었거나 3dm이 아님)");
  }
}

export function import3dmWith(rhino: RhinoModule, memoryBytes: () => number, bytes: Uint8Array, options: Rhino3dmImportOptions = {}): Rhino3dmImportResult {
  const owned: Owned[] = [];
  const del = embindDeleter(rhino);
  try {
    return run(rhino, memoryBytes, bytes, options, owned);
  } catch (e) {
    if (e instanceof Rhino3dmFail) return { ok: false, error: e.info };
    if (e instanceof wasmApi.RuntimeError) return fail("R3DM_WASM_TRAP", "3dm 파일을 읽는 중 wasm 실행이 중단되었습니다", true);
    // 예상 못 한 예외도 예외로 새지 않게 구조화한다(내용·경로 없음). 퍼징 테스트가 이 코드 0건을 확인한다.
    return fail("R3DM_INTERNAL", "3dm 파일을 처리하는 중 예상하지 못한 오류가 발생했습니다");
  } finally {
    for (let i = owned.length - 1; i >= 0; i--) {
      try {
        del(owned[i] as object);
      } catch {
        // 트랩 뒤에는 delete도 실패할 수 있다 — 이미 discard_kernel로 알렸다.
      }
    }
  }
}

function enumName(table: object, value: unknown): string {
  for (const [name, v] of Object.entries(table)) if (v === value) return name;
  return "Unknown";
}

function run(rhino: RhinoModule, memoryBytes: () => number, bytes: Uint8Array, options: Rhino3dmImportOptions, owned: Owned[]): Rhino3dmImportResult {
  const keep = <T extends Owned | null | undefined>(x: T): T => {
    if (x) owned.push(x);
    return x;
  };
  const limits = resolve3dmLimits(options.limits);
  if (!(bytes instanceof Uint8Array)) throw new Rhino3dmFail("R3DM_INVALID_OPTION", "입력은 Uint8Array여야 합니다");
  if (options.unit !== undefined && !Object.prototype.hasOwnProperty.call(RHINO_UNIT_TO_MM, options.unit)) {
    throw new Rhino3dmFail("R3DM_INVALID_OPTION", "알 수 없는 단위입니다");
  }
  if (bytes.length > limits.max_file_bytes) {
    throw new Rhino3dmFail("AR055", `파일이 ${limits.max_file_bytes}바이트 상한을 넘습니다`, { limit: limits.max_file_bytes });
  }
  const before = memoryBytes();
  if (before > limits.max_wasm_memory_bytes) {
    throw new Rhino3dmFail("R3DM_MEMORY_LIMIT", "3dm 커널 메모리가 이미 상한을 넘었습니다", { limit: limits.max_wasm_memory_bytes, discard_kernel: true });
  }

  const file = keep(wasm(() => rhino.File3dm.fromByteArray(bytes)));
  const checkMemory = () => {
    const now = memoryBytes();
    if (now > limits.max_wasm_memory_bytes) {
      throw new Rhino3dmFail("R3DM_MEMORY_LIMIT", "3dm 파일을 읽는 데 메모리 상한을 넘었습니다", { limit: limits.max_wasm_memory_bytes, discard_kernel: true });
    }
    const allowance = Math.max(bytes.length * DECOMPRESS_RATIO, MIN_GROWTH_ALLOWANCE_BYTES);
    if (now - before > allowance) {
      throw new Rhino3dmFail("R3DM_DECOMPRESSION_LIMIT", `3dm 파일을 펼친 크기가 원본의 ${DECOMPRESS_RATIO}배를 넘습니다`, { limit: allowance, discard_kernel: true });
    }
    return now - before;
  };
  checkMemory();
  if (!file) throw new Rhino3dmFail("R3DM_MALFORMED", "3dm 파일을 읽을 수 없습니다(손상되었거나 3dm이 아님)");

  const stats: Rhino3dmImportStats = {
    file_bytes: bytes.length,
    objects: 0,
    meshes: 0,
    vertices: 0,
    faces: 0,
    invalid_faces: 0,
    degenerate_meshes: 0,
    wasm_memory_growth: 0,
  };

  const declaredValue = wasm(() => keep(file.settings()).modelUnitSystem);
  const declared = enumName(rhino.UnitSystem, declaredValue);
  let unit: Rhino3dmUnit;
  let source: "caller" | "file";
  if (options.unit !== undefined) {
    unit = options.unit;
    source = "caller";
  } else if (Object.prototype.hasOwnProperty.call(RHINO_UNIT_TO_MM, declared)) {
    unit = declared as Rhino3dmUnit;
    source = "file";
  } else {
    stats.wasm_memory_growth = checkMemory();
    return { ok: true, status: "needs_unit", code: "AR053", declared, stats };
  }
  const scale = RHINO_UNIT_TO_MM[unit];

  const table = keep(wasm(() => file.objects()));
  const count = wasm(() => table.count);
  stats.objects = count;
  if (!Number.isSafeInteger(count) || count < 0 || count > limits.max_objects) {
    throw new Rhino3dmFail("R3DM_TOO_MANY_OBJECTS", `객체 수가 상한 ${limits.max_objects}개를 넘습니다`, { limit: limits.max_objects });
  }

  const skipped = new Map<string, number>();
  const candidates: Rhino3dmCandidate[] = [];
  const meshType = rhino.ObjectType.Mesh;
  for (let i = 0; i < count; i++) {
    const obj = keep(wasm(() => table.get(i)));
    const geom = obj ? keep(wasm(() => obj.geometry())) : null;
    if (!obj || !geom) {
      skipped.set("Unknown", (skipped.get("Unknown") ?? 0) + 1);
      continue;
    }
    const type: unknown = wasm(() => geom.objectType);
    if (type !== meshType || !(geom instanceof rhino.Mesh)) {
      const name = enumName(rhino.ObjectType, type);
      skipped.set(name, (skipped.get(name) ?? 0) + 1);
      continue;
    }
    stats.meshes++;
    const verts = keep(wasm(() => geom.vertices()));
    const faces = keep(wasm(() => geom.faces()));
    const vCount = wasm(() => verts.count);
    const fCount = wasm(() => faces.count);
    stats.vertices += vCount;
    stats.faces += fCount;
    if (stats.vertices > limits.max_total_vertices) {
      throw new Rhino3dmFail("R3DM_TOO_MANY_VERTICES", "메시 꼭짓점 수가 상한을 넘습니다", { limit: limits.max_total_vertices });
    }
    if (stats.faces > limits.max_total_faces) {
      throw new Rhino3dmFail("R3DM_TOO_MANY_FACES", "메시 면 수가 상한을 넘습니다", { limit: limits.max_total_faces });
    }
    const points: Point3[] = [];
    for (let k = 0; k < vCount; k++) {
      const p = wasm(() => verts.get(k));
      const mm = [0, 1, 2].map((d) => {
        const v = Number(p[d]) * scale;
        if (!Number.isFinite(v) || v > COORD_LIMIT || v < -COORD_LIMIT) {
          throw new Rhino3dmFail("R3DM_COORD_OUT_OF_RANGE", `좌표가 ±${COORD_LIMIT}mm 범위를 넘거나 유한하지 않습니다`, { limit: COORD_LIMIT });
        }
        return roundHalfAway(v) + 0; // -0 → 0
      });
      points.push([mm[0] as number, mm[1] as number, mm[2] as number]);
    }
    const tris: [number, number, number][] = [];
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n < vCount;
    for (let k = 0; k < fCount; k++) {
      const f = wasm(() => faces.get(k));
      const [a, b, c, d] = [f[0], f[1], f[2], f[3]];
      if (!ok(a) || !ok(b) || !ok(c) || !ok(d)) {
        stats.invalid_faces++;
        continue;
      }
      tris.push([a, b, c]);
      if (c !== d) tris.push([a, c, d]);
    }
    const mesh = canonicalMesh(points, tris);
    if (mesh.triangles.length === 0) {
      stats.degenerate_meshes++;
      continue;
    }
    const attrs = keep(wasm(() => obj.attributes()));
    const name = attrs ? wasm(() => String(attrs.name ?? "")) : "";
    const user = (key: string): string | null => {
      if (!attrs) return null;
      const v: unknown = wasm(() => attrs.getUserString(key));
      return typeof v === "string" && v.length > 0 ? v.slice(0, MAX_3DM_NAME_LENGTH) : null;
    };
    candidates.push({
      index: i,
      name: name.slice(0, MAX_3DM_NAME_LENGTH),
      source_key: user(RHINO_USER_KEY),
      source_id: user(RHINO_USER_ID),
      mesh,
      closed: closedMeshIssue(mesh) === null,
    });
  }
  stats.wasm_memory_growth = checkMemory();
  const warnings: Rhino3dmWarning[] = [];
  if (skipped.size > 0) {
    const sorted = [...skipped].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    warnings.push({
      code: "AR054",
      detail: "메시가 아닌 객체는 가져오지 않았습니다(Rhino에서 메시로 바꿔 저장하면 가져올 수 있습니다)",
      skipped_objects: Object.fromEntries(sorted),
    });
  }
  if (candidates.length === 0) {
    throw new Rhino3dmFail("R3DM_EMPTY", "가져올 수 있는 메시 객체가 없습니다");
  }
  return { ok: true, status: "needs_confirmation", unit: { unit, source, declared }, candidates, warnings, stats };
}
