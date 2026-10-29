// node --test 에서 설정 화면 .tsx(와 packages/ui .tsx)를 불러오기 위한 로더 훅(apps/web marketing tsx-hooks.mjs와 같은 방식,
// 새 의존성 없이 저장소의 typescript로 변환). packages/ui 소스는 확장자 없는 상대 import(`./components/cn`)를 쓰므로
// resolve에서 .ts·.tsx를 차례로 붙여 본다. 테스트에서만 `register("./tsx-hooks.mjs", import.meta.url)` 한다.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!(specifier.startsWith("./") || specifier.startsWith("../")) || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        // 다음 확장자
      }
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const file = fileURLToPath(url);
  const source = await readFile(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
