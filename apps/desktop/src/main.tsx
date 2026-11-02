// 데스크톱 진입점(AR-06-004b): 런타임(어댑터·인증·API·엔진) 조립 → features AppProviders → 라우터.
// 데모 데이터 모드는 개발 빌드 + VITE_DEMO_MODE=1에서만 동적 import한다. 조건식은 글자 그대로 둔다:
// 릴리스 빌드는 Vite가 DEV를 false로 치환해 분기와 데모 청크가 빠진다(scripts/check-release-bundle.mjs가 확인).
// 웹 스튜디오(AR-06-071, Vite mode web): 같은 진입점. 팝업 OAuth 콜백 경로면 앱을 띄우지 않고 code만 opener에 넘긴다.
// 규칙 팩은 웹 공급원(075 전까지 팩 없음 AR063). `import.meta.env.MODE === "web"`은 글자 그대로 둔다(빌드별 제거).
import { AppProviders, type ShellRuntime } from "@arch-studio/features/shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { createAppRouter } from "./routes/index.tsx";
import { rulePacksOf } from "@arch-studio/shell-bridge";
import { connectRulePacks, rustRulePackProvider, webRulePackProvider } from "./shell/rule-packs.ts";
import { createDesktopRuntime } from "./shell/runtime.ts";
import { createBrowserEngineHost } from "./shell/workers.ts";
import { handleOAuthPopupCallback, OAUTH_CALLBACK_PATH } from "./web/oauth-popup.ts";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("#root 요소가 없다.");

async function createRuntime(): Promise<ShellRuntime> {
  const engine = createBrowserEngineHost();
  if (typeof import.meta.env !== "undefined" && import.meta.env.DEV === true && import.meta.env.VITE_DEMO_MODE === "1") {
    const [{ createDemoRuntime }, { demoRulePackProvider }] = await Promise.all([
      import("@arch-studio/features/demo"),
      import("./shell/demo-rule-pack.ts"),
    ]);
    if (engine) void connectRulePacks(engine, demoRulePackProvider());
    return createDemoRuntime({ search: location.search, engine });
  }
  const runtime = createDesktopRuntime(engine);
  if (import.meta.env.MODE === "web") {
    if (engine) void connectRulePacks(engine, webRulePackProvider());
    return runtime;
  }
  // 규칙 팩 공급(AR-06-042): Rust가 서명·자격을 다시 확인한 팩만. 라이선스 파일 저장 경로는 041·074 후속(지금은 null → AR063/AR065).
  if (engine) void connectRulePacks(engine, rustRulePackProvider(rulePacksOf(runtime.adapters), async () => null));
  return runtime;
}

function Fatal() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-pad text-fg">
      <div role="alert" className="flex max-w-md flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
        <h1 className="text-h2 font-semibold">앱을 시작하지 못했습니다</h1>
        <p className="text-body text-fg-2">
          {import.meta.env.MODE === "web"
            ? "웹 스튜디오 설정을 불러오지 못했습니다. 잠시 후 새로고침하세요."
            : "Arch Studio 창(설치형) 안에서 여세요. 개발 중 브라우저로 화면을 보려면 데모 모드(VITE_DEMO_MODE=1)로 실행하세요."}
        </p>
      </div>
    </main>
  );
}

function start(root: ReturnType<typeof createRoot>) {
  createRuntime().then(
    (runtime) => {
      const router = createAppRouter();
      root.render(
        <StrictMode>
          <AppProviders runtime={runtime}>
            <RouterProvider router={router} />
          </AppProviders>
        </StrictMode>,
      );
    },
    () => root.render(<Fatal />),
  );
}

if (!(import.meta.env.MODE === "web" && handleOAuthPopupCallback(OAUTH_CALLBACK_PATH))) start(createRoot(el));
