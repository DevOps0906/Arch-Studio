// 서버 기동 훅: 필수 환경 변수가 없으면 프로세스를 끝낸다(02_ARCHITECTURE.md 8절 "기동 실패").
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertServerEnvOnBoot } = await import("./server/env");
    assertServerEnvOnBoot();
  }
}
