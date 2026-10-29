// capabilities 조회(070 hasCapability·byCapability와 같은 규칙). features는 shell-bridge를 런타임 import하지 않으므로
// 같은 의미의 구조적 구현을 둔다: 값이 정확히 true일 때만 있다고 본다(실패 닫힘). 동치는 capabilities.test.ts가 070 함수와 비교한다.
import type { CapabilityKey, PlatformCapabilities } from "@arch-studio/shell-bridge";

export type { CapabilityKey, PlatformCapabilities };

export function hasCap(caps: PlatformCapabilities, key: CapabilityKey): boolean {
  return caps[key] === true;
}

export function byCap<T>(caps: PlatformCapabilities, key: CapabilityKey, whenTrue: T, whenFalse: T): T {
  return hasCap(caps, key) ? whenTrue : whenFalse;
}
