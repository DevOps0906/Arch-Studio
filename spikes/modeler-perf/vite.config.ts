import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// 스파이크(버리는 코드). apps/desktop과 같은 Vite 8 기본 TSX 변환(플러그인 없음).
// preview는 데스크톱 CSP(apps/desktop/src-tauri/tauri.conf.json의 csp)를 응답 헤더로 흉내 내 위반을 잡는다.
// connect-src는 ipc 대신 'self'만(브라우저 측정용). inline script·style·blob: worker 없음을 같이 확인한다.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self'",
].join("; ");

export default defineConfig({
  build: { target: "chrome120", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  worker: { format: "es" },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  preview: { headers: { "Content-Security-Policy": CSP } },
});
