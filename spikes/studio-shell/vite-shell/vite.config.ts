import { defineConfig } from "vite";

// apps/desktop/vite.config.ts 와 같은 빌드 설정(플러그인 없이 Vite 8 기본 TSX 변환).
export default defineConfig({
  build: { target: "chrome120", outDir: "dist", emptyOutDir: true },
});
