// Tauri invoke 진입점. 앱에서 Rust 명령을 부르는 곳은 이 패키지뿐이다(.claude/rules/desktop.md).
// 테스트는 InvokeFn을 주입해 모킹한다.

/** 이 패키지가 부르는 명령 이름(build.rs APP_COMMANDS 중 shell-bridge 담당분). */
export type BridgeCommand = "secret_get" | "secret_set" | "secret_delete";

export type InvokeFn = (cmd: BridgeCommand, args: Record<string, unknown>) => Promise<unknown>;

/** Tauri 웹뷰 안인지(전역 IPC 내부 객체 존재). 기능 코드는 이 값 대신 `capabilities`로 분기한다. */
export function isTauriRuntime(scope: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in scope;
}

/** @tauri-apps/api invoke. 웹 번들에서 Tauri 모듈을 불러오지 않도록 첫 호출 때 지연 로드한다. */
export const tauriInvoke: InvokeFn = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
};
