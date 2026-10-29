import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { ENV_PREFIX, desktopEnvGuard } from "./env-allowlist.ts";

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

// Tauri 셸 프런트. 포트는 src-tauri/tauri.conf.json build.devUrl과 같다.
export default defineConfig(({ command }) => ({
  plugins: [desktopEnvGuard()],
  envPrefix: ENV_PREFIX,
  clearScreen: false,
  // features·ui는 워크스페이스 링크라 React·라우터가 두 벌 묶이지 않게 한 곳으로 모은다.
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
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
    outDir: "dist",
    emptyOutDir: true,
  },
}));
