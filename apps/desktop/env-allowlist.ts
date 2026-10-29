// 데스크톱 번들에 들어가는 빌드 시점 공개값 허용 목록(02_ARCHITECTURE.md 8절).
// 목록 밖 VITE_ 변수가 있으면 비밀이 번들에 섞일 수 있으므로 빌드를 멈춘다.
import { loadEnv, type Plugin } from "vite";

export const ENV_PREFIX = "VITE_";

export const ALLOWED_ENV = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_API_BASE_URL",
  "VITE_AUTH_MODE",
] as const;

/** 허용 목록 밖 VITE_ 변수, 릴리스 빌드의 `VITE_AUTH_MODE=mock`(9절)이면 예외를 던진다. */
export function checkDesktopEnv(env: Record<string, string | undefined>, release: boolean): void {
  const allowed: readonly string[] = ALLOWED_ENV;
  const unknown = Object.keys(env)
    .filter((key) => key.startsWith(ENV_PREFIX) && !allowed.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new Error(`허용 목록 밖 VITE_ 변수: ${unknown.join(", ")} (허용: ${allowed.join(", ")})`);
  }
  if (release && env.VITE_AUTH_MODE === "mock") {
    throw new Error("릴리스 빌드에서 VITE_AUTH_MODE=mock은 쓸 수 없다(개발 빌드 전용).");
  }
}

/** mock 차단 대상 빌드인가. production 외 mode(staging 등)도 배포 번들이 될 수 있으므로 명시적 development 빌드만 제외한다. */
export function isReleaseBuild(command: "build" | "serve", mode: string): boolean {
  return command === "build" && mode !== "development";
}

/** .env 파일과 프로세스 환경의 VITE_ 변수를 모두 검사하는 Vite 플러그인. */
export function desktopEnvGuard(): Plugin {
  return {
    name: "arch-desktop-env-guard",
    config(config, { command, mode }) {
      const envDir = typeof config.envDir === "string" ? config.envDir : (config.root ?? process.cwd());
      checkDesktopEnv(loadEnv(mode, envDir, ENV_PREFIX), isReleaseBuild(command, mode));
    },
  };
}
