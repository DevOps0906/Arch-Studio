// .3dm 입출력(AR-06-039 2단계): rhino3dm 8.35.0(MIT, openNURBS wasm). 매스 IntMesh → .3dm 내보내기, .3dm → 메시 "후보" 가져오기.
// - 초기화: wasm은 비동기(load3dmKernel). 이후 export3dm·import3dm은 받은 kernel로 동기 실행한다(모듈 전역 상태 없음).
// - wasm 바이트는 호출자가 준다(엔진은 I/O를 하지 않는다). 브라우저·Tauri는 번들러 URL을 fetch, Node 테스트는 파일을 읽어 넘긴다.
// - 결정성 한계([DECISION] tasks/logs/AR-06-039.md): rhino3dm은 객체 id(읽기 전용)를 무작위로 만들고 파일 시작 절에 저장 시각을 넣는다.
//   그래서 .3dm만 바이트 골든이 아니라 "의미 동일" 골든(객체 수·이름·키·정점 해시)으로 검사한다. 결정적 식별자는
//   사용자 문자열 arch_studio.id(= hash(project_id + 키) UUID)·arch_studio.key에 넣는다.
// - 가져오기 보안: 크기·객체·정점 상한, 호출 뒤 wasm 메모리 상한·증가량(입력 10배) 검사, mm 환산 후 COORD_LIMIT·정수화.
//   동기 wasm이라 함수 안에서 시간을 끊을 수 없다 — 워커 격리와 시간 상한(terminate)은 호출 쪽(앱) 책임이다.
import rhino3dm from "rhino3dm";
import { export3dmWith, type Rhino3dmExportInput } from "./export.ts";
import { import3dmWith, type Rhino3dmImportOptions, type Rhino3dmImportResult } from "./import.ts";
import { wasmApi, type RhinoModule, type WasmInstance, type WasmMemory } from "./module.ts";

export {
  DECOMPRESS_RATIO,
  DEFAULT_3DM_LIMITS,
  MAX_3DM_FILE_BYTES,
  MAX_3DM_OBJECTS,
  MAX_3DM_TOTAL_FACES,
  MAX_3DM_TOTAL_VERTICES,
  MAX_WASM_MEMORY_BYTES,
  MIN_GROWTH_ALLOWANCE_BYTES,
  type Rhino3dmImportLimits,
} from "./limits.ts";
export type { Rhino3dmImportError, Rhino3dmImportErrorCode } from "./errors.ts";
export { RHINO_USER_KEY, RHINO_USER_ID, rhinoObjectId, type Rhino3dmExportInput, type Rhino3dmMass } from "./export.ts";
export {
  RHINO_UNIT_TO_MM,
  type Rhino3dmCandidate,
  type Rhino3dmImportOptions,
  type Rhino3dmImportResult,
  type Rhino3dmImportStats,
  type Rhino3dmUnit,
} from "./import.ts";

export interface Load3dmOptions {
  /** rhino3dm.wasm 바이트(필수). 메모리 상한 검사를 위해 인스턴스화를 직접 하므로 바이트가 있어야 한다. */
  wasmBinary: Uint8Array;
}

export interface Rhino3dmKernel {
  /** 매스 목록 → .3dm 바이트(단위 mm). 같은 입력이어도 바이트는 매번 다르다(위 결정성 한계). */
  export3dm(input: Rhino3dmExportInput): Uint8Array;
  /** .3dm 바이트 → 메시 후보(needs_confirmation). 예외 대신 구조화 결과. error.discard_kernel이면 이 커널을 버린다. */
  import3dm(bytes: Uint8Array, options?: Rhino3dmImportOptions): Rhino3dmImportResult;
  /** 현재 wasm 선형 메모리 크기(바이트). 늘기만 하고 줄지 않는다. */
  memoryBytes(): number;
}

interface EmscriptenInit {
  instantiateWasm(imports: object, receive: (instance: WasmInstance, module: object) => void): object;
}

/** rhino3dm wasm을 초기화한다(비동기, 호출마다 새 인스턴스). 메모리 상한을 넘긴 커널은 버리고 다시 부른다. */
export async function load3dmKernel(options: Load3dmOptions): Promise<Rhino3dmKernel> {
  let memory: WasmMemory | undefined;
  let failInit: (e: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    failInit = reject;
  });
  const init: EmscriptenInit = {
    // 기본 인스턴스화 대신 직접 해서 내보낸 선형 메모리를 잡는다(메모리 상한 검사용).
    instantiateWasm(imports, receive) {
      wasmApi.instantiate(options.wasmBinary, imports).then(({ instance, module }) => {
        memory = Object.values(instance.exports).find((v): v is WasmMemory => v instanceof wasmApi.Memory);
        receive(instance, module);
      }, failInit);
      return {};
    },
  };
  const factory = rhino3dm as unknown as (init: EmscriptenInit) => Promise<RhinoModule>;
  const rhino = await Promise.race([factory(init), failed]);
  if (!memory) throw new Error("rhino3dm wasm 메모리를 찾지 못했습니다");
  const mem = memory;
  const memoryBytes = () => mem.buffer.byteLength;
  return {
    export3dm: (input) => export3dmWith(rhino, input),
    import3dm: (bytes, opts) => import3dmWith(rhino, memoryBytes, bytes, opts),
    memoryBytes,
  };
}
