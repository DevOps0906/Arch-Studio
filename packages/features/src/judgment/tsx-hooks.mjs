// node --test에서 .tsx 컴포넌트(+ packages/ui의 확장자 없는 import)를 불러오기 위한 로더 훅. 새 의존성 없이 저장소의 typescript로 변환한다.
// 테스트에서 `register("./tsx-hooks.mjs", import.meta.url)` 한 뒤 동적 import한다(apps/web의 marketing/tsx-hooks.mjs와 같은 방식 + 확장자 해석).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/.test(specifier) && context.parentURL) {
    for (const ext of [".tsx", ".ts"]) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
    }
  }
  return nextResolve(specifier, context);
}

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
