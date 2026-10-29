import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { ENV_PREFIX, desktopEnvGuard } from "./env-allowlist.ts";

// Windows 개발 모드의 Tauri는 devUrl을 직접 띄워 devCsp를 넣지 않는다.
// 개발 서버가 같은 정책을 헤더로 보내 개발 중에도 CSP를 강제한다(정본: src-tauri/tauri.conf.json).
const tauriConf = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app: { security: { devCsp: Record<string, string> } };
};
const devCsp = Object.entries(tauriConf.app.security.devCsp)
  .map(([directive, value]) => `${directive} ${value}`)
  .join("; ");

// Tauri 셸 프런트. 포트는 src-tauri/tauri.conf.json build.devUrl과 같다.
export default defineConfig({
  plugins: [desktopEnvGuard()],
  envPrefix: ENV_PREFIX,
  clearScreen: false,
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
});
