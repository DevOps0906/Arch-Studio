// web 서버 전용 환경 변수. 기동 시 instrumentation.ts가 한 번 검증하고, 누락이면 서버가 시작하지 않는다.
import "server-only";
import { parseEnv, serverEnvSchema, type ServerEnv } from "@/lib/env/schema";

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseEnv(serverEnvSchema, process.env);
  return cached;
}

/** 기동 시 한 번 호출. 검증 실패면 프로세스를 끝내 서버가 요청을 받지 않게 한다. */
export function assertServerEnvOnBoot(): void {
  try {
    serverEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
