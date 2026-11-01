// rhino3dm 모듈 타입(패키지 d.ts) + 이 패키지가 쓰는 WebAssembly 최소 타입.
// tsconfig lib에 DOM이 없어 WebAssembly 전역 타입이 없다 — 전역 선언을 추가하지 않고 globalThis에서 좁게 꺼낸다.
import type rhino3dm from "rhino3dm";

export type RhinoModule = Awaited<ReturnType<typeof rhino3dm>>;

export interface WasmMemory {
  readonly buffer: ArrayBuffer;
}

export interface WasmInstance {
  readonly exports: Record<string, unknown>;
}

interface WasmApi {
  instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: WasmInstance; module: object }>;
  Memory: abstract new (...args: never[]) => WasmMemory;
  RuntimeError: abstract new (...args: never[]) => Error;
}

export const wasmApi = (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

/**
 * embind 래퍼를 지우는 함수. 일부 클래스는 delete 이름을 다른 뜻으로 덮어쓴다(예: File3dmObjectTable.delete(id) = 객체 삭제)
 * — 그래서 embind 기본 ClassHandle.prototype.delete를 직접 부른다. 패키지 d.ts에는 delete가 없다.
 */
export function embindDeleter(rhino: RhinoModule): (handle: object) => void {
  let proto: object | null = rhino.File3dm.prototype as object;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "isAliasOf")) proto = Object.getPrototypeOf(proto) as object | null;
  const del = (proto as { delete?: (this: object) => void } | null)?.delete;
  if (typeof del !== "function") throw new Error("rhino3dm embind delete를 찾지 못했습니다");
  return (handle) => del.call(handle);
}
