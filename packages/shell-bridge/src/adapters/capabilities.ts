// capabilities: 화면이 플랫폼 차이를 아는 유일한 통로(ADR-001 2.1). 화면은 `platform === 'web'` 같은 직접 검사를 쓰지 않는다
// (eslint.config.mjs `platform` 묶음이 기계적으로 막는다). 값은 "지금 이 빌드에 구현이 있는가"이며, 구현 작업이 끝날 때 true로 바꾼다.
import { BridgeError } from "./errors.ts";

/** 005 키(NativeBridge.capabilities). 이름·값을 바꾸지 않는다(008이 쓴다). */
export interface Capabilities {
  /** 네트워크 없이 열기·편집(로컬 정본). */
  readonly offline: boolean;
  /** OS 파일 대화상자 경로 읽기·쓰기. */
  readonly localFiles: boolean;
  /** 서명된 앱 업데이트. true ⇔ `PlatformAdapters.updater !== null`. */
  readonly autoUpdate: boolean;
  /** 비밀이 앱 재시작 후에도 남는가(키체인). false면 새로고침 = 재로그인. */
  readonly persistentSecrets: boolean;
}

/** 070 확장 키(PlatformAdapters.capabilities). */
export interface PlatformCapabilities extends Capabilities {
  /** 이 PC에만 저장하는 로컬 프로젝트 모드(설치형 SQLite). 웹은 클라우드만(ADR-001 3.2). */
  readonly localProjects: boolean;
  /** 시리얼로 이 기기 활성화(서명 라이선스 파일). true ⇔ `entitlement.license !== null`. */
  readonly licenseActivation: boolean;
}

export type CapabilityKey = keyof PlatformCapabilities;

export const CAPABILITY_KEYS: readonly CapabilityKey[] = Object.freeze([
  "offline",
  "localFiles",
  "autoUpdate",
  "persistentSecrets",
  "localProjects",
  "licenseActivation",
]);

const BRIDGE_KEYS: readonly (keyof Capabilities)[] = ["offline", "localFiles", "autoUpdate", "persistentSecrets"];

/** 설치형. autoUpdate·licenseActivation은 updater 작업·041 구현이 들어올 때 true로 바꾼다. */
export const TAURI_CAPABILITIES: PlatformCapabilities = Object.freeze({
  offline: true,
  localFiles: true,
  autoUpdate: false,
  persistentSecrets: true,
  localProjects: true,
  licenseActivation: false,
});

/** 웹(072). 로컬 파일은 대화상자 경로가 아니라 `<input type=file>`·다운로드라 false. */
export const WEB_CAPABILITIES: PlatformCapabilities = Object.freeze({
  offline: false,
  localFiles: false,
  autoUpdate: false,
  persistentSecrets: false,
  localProjects: false,
  licenseActivation: false,
});

/** 005 4키만 남긴 얼린 사본(NativeBridge용, 키 집합을 005와 똑같이 유지). */
export function bridgeCapabilities(caps: Capabilities): Capabilities {
  return Object.freeze(Object.fromEntries(BRIDGE_KEYS.map((k) => [k, caps[k]])) as unknown as Capabilities);
}

type CapabilitySource = PlatformCapabilities | { readonly capabilities: PlatformCapabilities };

const capsOf = (source: CapabilitySource): PlatformCapabilities =>
  "capabilities" in source ? source.capabilities : source;

/** 화면 분기 헬퍼: `hasCapability(adapters, "localFiles")`. */
export function hasCapability(source: CapabilitySource, key: CapabilityKey): boolean {
  return capsOf(source)[key] === true;
}

/** 없는 기능을 부르려 하면 NOT_SUPPORTED(화면은 보통 버튼을 숨기므로 방어용). */
export function requireCapability(source: CapabilitySource, key: CapabilityKey): void {
  if (!hasCapability(source, key)) throw new BridgeError("NOT_SUPPORTED");
}

/** 기능 유무에 따라 값 고르기(문구·컴포넌트 선택용). */
export function byCapability<T>(source: CapabilitySource, key: CapabilityKey, whenTrue: T, whenFalse: T): T {
  return hasCapability(source, key) ? whenTrue : whenFalse;
}
