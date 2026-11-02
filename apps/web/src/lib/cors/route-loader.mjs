// 테스트 전용 Node 모듈 해석 훅(AR-06-071): Route Handler 모듈을 Next 없이 불러오기 위해 tsconfig `@/*` → `src/*`만 풀어 준다.
// `server-only`는 `--conditions=react-server`로 빈 모듈이 된다(studio-routes-unauth.test.ts가 자식 프로세스를 그렇게 띄운다).
import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((p) => path.extname(p) && existsSync(p));

export async function resolve(specifier, context, next) {
  // `@/x` 또는 확장자 없는 상대 경로(Next 번들러 해석)만 .ts로 보완한다.
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  const file = base ? withExt(base) : undefined;
  if (file) return next(pathToFileURL(file).href, context);
  // `next/headers`처럼 exports 맵 없는 패키지 하위 경로는 번들러가 .js를 붙인다.
  if (/^next\/[a-z/-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  return next(specifier, context);
}

if (!process.env.ARCH_ROUTE_LOADER_REGISTERED) {
  process.env.ARCH_ROUTE_LOADER_REGISTERED = "1";
  register(import.meta.url);
}
