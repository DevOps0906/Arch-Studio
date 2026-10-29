// 서버 기동 훅: 필수 환경 변수가 없으면 프로세스를 끝낸다(02_ARCHITECTURE.md 8절 "기동 실패").
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertServerEnvOnBoot } = await import("./server/env");
    assertServerEnvOnBoot();
    // Mock 인증이 원격·배포 환경에서 켜져 있으면 기동을 끝낸다(AR-06-008, 02_ARCHITECTURE.md 위험 #14).
    const { assertAuthConfigOnBoot } = await import("./lib/auth/config");
    assertAuthConfigOnBoot();
  }
}
