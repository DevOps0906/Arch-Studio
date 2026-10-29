// 어댑터 오류 판별(구조적). shell-bridge BridgeError는 `{ name: "BridgeError", code }` 모양이고 message에 값이 없다(070).
// features는 instanceof를 쓰지 않는다(런타임 import 금지 + 데모 어댑터도 같은 모양을 던진다).
import type { BridgeErrorCode } from "@arch-studio/shell-bridge";

export type { BridgeErrorCode };

export function bridgeErrorCode(err: unknown): BridgeErrorCode | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === "BridgeError" && typeof e.code === "string" ? (e.code as BridgeErrorCode) : null;
}

/** 화면 문구(03장 5.1·5.2·5.3절). 없는 코드는 일반 문구. 값·경로는 넣지 않는다. */
const TEXT: Partial<Record<BridgeErrorCode, string>> = {
  NOT_FOUND: "프로젝트를 찾지 못했습니다. 목록에서 다시 여세요.",
  VERSION_CONFLICT: "다른 곳에서 이 프로젝트가 먼저 저장되었습니다. 병합하지 않습니다.",
  AR052: "파일을 저장하지 못했습니다. 디스크 공간과 폴더 쓰기 권한을 확인하세요.",
  AR055: "파일이 너무 큽니다. 필요한 레이어만 남겨 다시 저장하세요.",
  AR060: "이 PC의 프로젝트 저장소를 읽지 못했습니다. 백업에서 복구하거나 고객지원에 문의하세요.",
  AR061: "저장소가 읽기 전용 상태입니다. 열람·내보내기만 됩니다.",
  NOT_SUPPORTED: "이 환경에서는 쓸 수 없는 기능입니다.",
  CANCELLED: "취소했습니다.",
};

export function bridgeErrorText(err: unknown): string {
  const code = bridgeErrorCode(err);
  return (code && TEXT[code]) ?? "처리하지 못했습니다. 다시 시도하세요.";
}
