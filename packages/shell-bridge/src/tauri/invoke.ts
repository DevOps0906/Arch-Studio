// Tauri invoke 진입점. 앱에서 Rust 명령을 부르는 곳은 이 패키지뿐이고, 패키지 안에서도 이 파일 한 곳이다(.claude/rules/desktop.md).
// 테스트는 InvokeFn을 주입해 모킹한다.

/** SecureStore 명령(`commands/secrets.rs`). */
export type SecretCommand = "secret_get" | "secret_set" | "secret_delete";
/** ProjectStore 명령(`commands/local_db.rs`). */
export type ProjectCommand =
  | "local_db_list_projects"
  | "local_db_get_project"
  | "local_db_save_project"
  | "local_db_delete_project";
/** FileGateway 명령(`commands/fs.rs`·`commands/export.rs`). */
export type FileCommand = "fs_open_import" | "export_save_file";

/** Rasterizer 명령(`commands/raster.rs`, AR-06-080). */
export const RASTERIZE_SVG_COMMAND = "rasterize_svg";
export type RasterCommand = typeof RASTERIZE_SVG_COMMAND;

/** RulePackStore 명령(`commands/rule_pack.rs`, AR-06-042). */
export const RULE_PACK_INSTALL_COMMAND = "rule_pack_install";
export const RULE_PACK_LOAD_COMMAND = "rule_pack_load";
export type RulePackCommand = typeof RULE_PACK_INSTALL_COMMAND | typeof RULE_PACK_LOAD_COMMAND;

/** 이 패키지가 부르는 명령 이름(build.rs APP_COMMANDS 중 화면용). */
export type BridgeCommand = SecretCommand | ProjectCommand | FileCommand | RasterCommand | RulePackCommand;

/** 명령 인자: JSON 객체 또는 원시 본문(`export_save_file`은 바이트 본문 + 헤더). */
export type InvokeArgs = Record<string, unknown> | Uint8Array;

export interface InvokeOptions {
  /** 원시 본문 명령의 헤더(`x-export-format`). */
  readonly headers?: Record<string, string>;
}

export type InvokeFn = (cmd: BridgeCommand, args: InvokeArgs, options?: InvokeOptions) => Promise<unknown>;

/** Tauri 웹뷰 안인지(전역 IPC 내부 객체 존재). 기능 코드는 이 값 대신 `capabilities`로 분기한다. */
export function isTauriRuntime(scope: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in scope;
}

/** @tauri-apps/api invoke. 웹 번들에서 Tauri 모듈을 불러오지 않도록 첫 호출 때 지연 로드한다. */
export const tauriInvoke: InvokeFn = async (cmd, args, options) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return options?.headers ? invoke(cmd, args, { headers: { ...options.headers } }) : invoke(cmd, args);
};
