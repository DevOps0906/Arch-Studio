// node --test에서 .tsx 화면 조각을 불러오기 위한 로더 훅(새 의존성 없이 저장소의 typescript로 변환, apps/web marketing tsx-hooks.mjs와 같은 방식).
// packages/ui는 확장자 없는 상대 import("./cn")를 쓰므로 resolve 훅이 .ts·.tsx를 붙여 본다. 테스트 전용(프로덕션 import 0).
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    for (const ext of [".ts", ".tsx"]) {
      const url = new URL(specifier + ext, context.parentURL);
      try {
        await access(fileURLToPath(url));
        return nextResolve(url.href, context);
      } catch {
        // 다음 확장자
      }
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
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
