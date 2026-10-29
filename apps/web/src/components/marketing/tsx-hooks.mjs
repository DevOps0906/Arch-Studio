// node --test 에서 .tsx 컴포넌트를 불러오기 위한 로더 훅(새 의존성 없이 저장소의 typescript 로 변환).
// 테스트 파일에서 `register("./tsx-hooks.mjs", import.meta.url)` 한 뒤 동적 import 한다.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const file = fileURLToPath(url);
  const source = await readFile(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
