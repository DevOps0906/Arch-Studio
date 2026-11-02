// 웹 빌드(mode web) 전용 `@tauri-apps/*` 대체 모듈(AR-06-071 결정 9). vite.config.ts가 alias로 연결한다.
// 웹 번들에 Tauri IPC 코드가 0이어야 한다(scripts/check-web-dist.mjs). 웹에서는 createPlatformAdapters가 웹 어댑터를 고르므로 호출되지 않는다.
export async function invoke(): Promise<never> {
  throw new Error("웹 빌드에는 설치형 명령이 없다.");
}
