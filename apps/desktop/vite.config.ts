import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { ENV_PREFIX, desktopEnvGuard } from "./env-allowlist.ts";
import { cspViolations, vercelOutputConfig, webCsp, WEB_BUILD_MODE, WEB_HOSTING_CONFIG, WEB_OUT_DIR, type WebBuildEnv } from "./web-hosting.ts";

// Windows 개발 모드의 Tauri는 devUrl을 직접 띄워 devCsp를 넣지 않는다.
// 개발 서버가 같은 정책을 헤더로 보내 개발 중에도 CSP를 강제한다(정본: src-tauri/tauri.conf.json).
const tauriConf = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app: { security: { devCsp: Record<string, string> } };
};

// 개발 서버 전용 nonce(AR-06-004b): Vite 개발 모드는 CSS를 <style> 요소로 주입해 style-src 'self'에 막힌다.
// 'unsafe-inline' 대신 서버를 띄울 때마다 새 nonce를 만들어 Vite `html.cspNonce`(주입 style·script에 nonce 부여)와
// 개발 헤더의 style-src에만 더한다. tauri.conf.json(csp·devCsp)은 바꾸지 않는다. 빌드 산출물은 CSS 파일(link)이라 해당 없음.
const devNonce = randomBytes(16).toString("base64");
const devCsp = Object.entries(tauriConf.app.security.devCsp)
  .map(([directive, value]) => `${directive} ${directive === "style-src" ? `${value} 'nonce-${devNonce}'` : value}`)
  .join("; ");

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 웹 빌드 호스트 설정(AR-06-071 결정 7): env 출처로 CSP를 만들고 검사(위반 시 빌드 실패) → build/web-hosting.json.
 * Vercel 빌더(VERCEL=1)에서는 Build Output API(.vercel/output: static + config.json)로도 조립한다.
 */
function webHosting(): Plugin {
  let env: WebBuildEnv = {};
  let outDir = "";
  return {
    name: "arch-web-hosting",
    apply: "build",
    configResolved(config) {
      env = config.env as WebBuildEnv;
      outDir = path.resolve(config.root, config.build.outDir);
      const bad = cspViolations(webCsp(env), env);
      if (bad.length) throw new Error(`웹 CSP 검사 실패: ${bad.join(", ")}`);
    },
    closeBundle() {
      const json = `${JSON.stringify(vercelOutputConfig(env), null, 2)}\n`;
      writeFileSync(here(`./${WEB_HOSTING_CONFIG}`), json);
      if (process.env.VERCEL !== "1") return;
      const out = here("./.vercel/output");
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      cpSync(outDir, `${out}/static`, { recursive: true });
      writeFileSync(`${out}/config.json`, json);
    },
  };
}

// Tauri 셸 프런트. 포트는 src-tauri/tauri.conf.json build.devUrl과 같다.
// 웹 스튜디오(mode web, AR-06-071): 같은 앱을 웹 어댑터로 빌드한다. @tauri-apps/*는 빈 모듈로 바꿔 웹 번들에 IPC 코드 0.
export default defineConfig(({ command, mode }) => ({
  plugins: [desktopEnvGuard(), ...(mode === WEB_BUILD_MODE ? [webHosting()] : [])],
  envPrefix: ENV_PREFIX,
  clearScreen: false,
  // features·ui는 워크스페이스 링크라 React·라우터가 두 벌 묶이지 않게 한 곳으로 모은다.
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
    ...(mode === WEB_BUILD_MODE ? { alias: [{ find: /^@tauri-apps\/api(\/.*)?$/, replacement: here("./src/web/tauri-stub.ts") }] } : {}),
  },
  ...(command === "serve" ? { html: { cspNonce: devNonce } } : {}),
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    headers: { "Content-Security-Policy": devCsp },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // Windows WebView2(Chromium) 기준.
    target: "chrome120",
    outDir: mode === WEB_BUILD_MODE ? WEB_OUT_DIR : "dist",
    emptyOutDir: true,
  },
}));
