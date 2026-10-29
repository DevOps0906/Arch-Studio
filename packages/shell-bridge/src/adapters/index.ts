// 플랫폼 어댑터 5종(ADR-001 2.1): 인터페이스·공용 오류·capabilities. 구현은 `tauri/`(설치형)·`web/`(072).
// 화면·기능 코드는 `PlatformAdapters`를 주입받아서만 데이터·파일·비밀·권한에 닿는다.
import type { NativeBridge } from "../bridge.ts";
import type { PlatformCapabilities } from "./capabilities.ts";
import type { EntitlementClient } from "./entitlement.ts";
import type { FileGateway } from "./file-gateway.ts";
import type { ProjectStore } from "./project-store.ts";
import type { Rasterizer } from "./rasterizer.ts";
import type { SecureStore } from "./secure-store.ts";
import type { Updater } from "./updater.ts";

/**
 * 플랫폼 어댑터 묶음. NativeBridge(005: capabilities·secrets·clearSecrets)를 넓힌 것이라 NativeBridge 자리에 그대로 넘길 수 있다.
 * 불변식(계약 하네스가 검사): `updater !== null` ⇔ `capabilities.autoUpdate`,
 * `entitlement.license !== null` ⇔ `capabilities.licenseActivation`.
 */
export interface PlatformAdapters extends NativeBridge {
  readonly capabilities: PlatformCapabilities;
  readonly projects: ProjectStore;
  readonly files: FileGateway;
  readonly secrets: SecureStore;
  readonly entitlement: EntitlementClient;
  /** 설치형만. 웹·구현 전에는 null. */
  readonly updater: Updater | null;
  /**
   * SVG → PNG(AR-06-080, 080에서 추가 — 선택 필드라 기존 구현은 그대로 맞다). 설치형만 채운다.
   * 없으면 NOT_SUPPORTED: 화면은 `rasterizerOf(adapters)`로 꺼낸다. 웹 PNG는 서버·워커 경로(072).
   */
  readonly rasterizer?: Rasterizer;
}

export * from "./capabilities.ts";
export * from "./entitlement.ts";
export * from "./errors.ts";
export * from "./exporter.ts";
export * from "./file-gateway.ts";
export * from "./license-client.ts";
export * from "./project-store.ts";
export * from "./rasterizer.ts";
export * from "./secure-store.ts";
export * from "./updater.ts";
