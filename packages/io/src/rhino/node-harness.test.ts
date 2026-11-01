// 테스트 하네스(Node 전용): rhino3dm.wasm 바이트 읽기, 커널 로드, 원시 rhino3dm 모듈(픽스처 파일 생성용).
// 이름이 *.test.ts인 이유: Node 타입이 필요해 typecheck 대상(src, 테스트 제외)에서 빼야 한다. 테스트 케이스는 없다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 wasm 파일을 읽는다
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 패키지 경로를 찾는다
import { createRequire } from "node:module";
import rhino3dm from "rhino3dm";
import { load3dmKernel, type Rhino3dmKernel } from "./index.ts";
import type { RhinoModule } from "./module.ts";

const require = createRequire(import.meta.url);
const WASM_PATH = require.resolve("rhino3dm").replace(/rhino3dm\.js$/, "rhino3dm.wasm");

export const wasmBinary = (): Uint8Array => new Uint8Array(readFileSync(WASM_PATH));
export const loadKernel = (): Promise<Rhino3dmKernel> => load3dmKernel({ wasmBinary: wasmBinary() });
export const loadRaw = (): Promise<RhinoModule> => (rhino3dm as unknown as () => Promise<RhinoModule>)();

