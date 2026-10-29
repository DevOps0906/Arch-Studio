// 데모 데이터 모드(개발 전용, AR-06-004b). 백엔드·DB 없이 화면을 개발·스크린샷한다.
// 진입: 앱이 `import.meta.env.DEV === true && import.meta.env.VITE_DEMO_MODE === "1"` 조건 안에서만 동적 import한다
// (apps/desktop/src/main.tsx). 릴리스 빌드는 조건이 상수 거짓이라 이 모듈 청크가 빠진다 — check-release-bundle.mjs가 DEMO_MARKER로 확인.
// URL 조절(부팅 때 한 번 읽음): ?demo-session=none(로그아웃 상태로 시작) · ?demo-onboarding=1 · ?demo-license=trial|fallback|expired · ?demo-role=member
import type { EngineHost, ShellRuntime } from "../shell/types.ts";
import { createDemoAdapters, type DemoLicense } from "./adapters.ts";
import { createDemoAuth } from "./auth.ts";
import { DEMO_MARKER } from "./samples.ts";

export { DEMO_MARKER, DEMO_PROJECTS, type DemoProject } from "./samples.ts";
export { createDemoAdapters, DemoBridgeError, DemoProjectStore, type DemoLicense } from "./adapters.ts";
export { createDemoAuth, type DemoAuthOptions } from "./auth.ts";

export interface DemoRuntimeOptions {
  /** location.search. */
  readonly search: string;
  /** 앱이 만든 엔진 워커 호스트(데모에서도 실제 워커를 쓴다). */
  readonly engine: EngineHost | null;
}

const LICENSES: readonly DemoLicense[] = ["trial", "fallback", "expired"];
const ROLES = ["owner", "admin", "member", "viewer"] as const;

export function createDemoRuntime({ search, engine }: DemoRuntimeOptions): ShellRuntime {
  const q = new URLSearchParams(search);
  const license = (LICENSES as readonly string[]).includes(q.get("demo-license") ?? "") ? (q.get("demo-license") as DemoLicense) : "trial";
  const role = ROLES.find((r) => r === q.get("demo-role")) ?? "owner";
  const { auth, fetch } = createDemoAuth({
    signedIn: q.get("demo-session") !== "none",
    needsOnboarding: q.get("demo-onboarding") === "1",
    role,
  });
  return {
    adapters: createDemoAdapters(license),
    auth,
    api: { baseUrl: `http://${DEMO_MARKER}.invalid`, fetch },
    engine,
    demo: true,
  };
}
