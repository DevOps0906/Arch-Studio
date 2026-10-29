// Provider 계층(AR-06-004b): Display(테마·밀도) → Adapters(070) → Session(008 상태기계) → ApiClient(007) → Engine(017).
// 화면은 아래 훅으로만 데이터·파일·권한·엔진에 닿는다(전역 싱글턴·직접 invoke 금지). 객체는 모두 앱이 만들어 runtime으로 넘긴다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EntitlementDecision, EntitlementFeature, EntitlementStatus } from "@arch-studio/shell-bridge";
import { createApiClient, isApiError, type ApiClient } from "../api-client/index.ts";
import {
  authReducer,
  INITIAL_AUTH_STATE,
  loginErrorFromApi,
  requestFinishLogin,
  type AuthState,
  type FinishProvider,
  type LoginErrorCode,
} from "../auth/index.ts";
import { byCap, hasCap, type CapabilityKey, type PlatformCapabilities } from "./capabilities.ts";
import { DEFAULT_PREFS, loadPrefs, resolveDark, savePrefs, type DisplayPrefs } from "./prefs.ts";
import type { AuthPort, EngineHost, ShellAdapters, ShellRuntime } from "./types.ts";

function need<T>(value: T | null, hook: string): T {
  if (value === null) throw new Error(`${hook}는 AppProviders 안에서만 쓴다.`);
  return value;
}

/* ---------- Display (D-34: OS 설정을 따르고 사용자가 고른다) ---------- */
interface DisplayValue {
  readonly prefs: DisplayPrefs;
  readonly dark: boolean;
  update(patch: Partial<DisplayPrefs>): void;
}
const DisplayContext = createContext<DisplayValue | null>(null);

function useOsDark(): boolean {
  const query = useMemo(() => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null), []);
  const [dark, setDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (e: { matches: boolean }) => setDark(e.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  return dark;
}

function DisplayProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => (typeof document === "undefined" ? DEFAULT_PREFS : loadPrefs()));
  const osDark = useOsDark();
  const dark = resolveDark(prefs.theme, osDark);
  useEffect(() => {
    // tokens.css: 다크는 .dark 클래스 하나, 밀도는 [data-density="compact"](DESIGN_SYSTEM 6장).
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    if (prefs.density === "compact") root.dataset.density = "compact";
    else delete root.dataset.density;
  }, [dark, prefs.density]);
  const update = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ prefs, dark, update }), [prefs, dark, update]);
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplayPrefs(): DisplayValue {
  return need(useContext(DisplayContext), "useDisplayPrefs");
}

/* ---------- Adapters (070) ---------- */
const AdaptersContext = createContext<ShellAdapters | null>(null);
const DemoContext = createContext(false);

export function useAdapters(): ShellAdapters {
  return need(useContext(AdaptersContext), "useAdapters");
}

/** 개발 데모 모드인가(화면 띠 표시용). 기능 분기에 쓰지 않는다. */
export function useDemoMode(): boolean {
  return useContext(DemoContext);
}

export interface CapabilitiesValue {
  readonly capabilities: PlatformCapabilities;
  has(key: CapabilityKey): boolean;
  by<T>(key: CapabilityKey, whenTrue: T, whenFalse: T): T;
}

/** 플랫폼 차이는 이 훅으로만 분기한다(ADR-001 2.1, eslint `platform` 묶음). */
export function useCapabilities(): CapabilitiesValue {
  const { capabilities } = useAdapters();
  return useMemo(
    () => ({
      capabilities,
      has: (key: CapabilityKey) => hasCap(capabilities, key),
      by: <T,>(key: CapabilityKey, whenTrue: T, whenFalse: T) => byCap(capabilities, key, whenTrue, whenFalse),
    }),
    [capabilities],
  );
}

/**
 * 권리 판정(EntitlementClient.can). 판정 중 undefined, 실패는 Deny(unverified)로 본다(실패 닫힘).
 * 주의: 설치형 EntitlementClient는 041·074 연결 전까지 view_export만 Allow하고 나머지는 모두 `unverified` Deny다(070 후속).
 * 그래서 지금 설치형 화면은 편집·AI 메뉴가 모두 잠금 안내로 보이는 것이 정상이다. 데모 모드는 라이선스 상태를 고를 수 있다.
 */
export function useEntitlement(feature: EntitlementFeature | undefined): EntitlementDecision | undefined {
  const { entitlement } = useAdapters();
  const [decision, setDecision] = useState<EntitlementDecision | undefined>(undefined);
  useEffect(() => {
    if (!feature) return;
    let alive = true;
    entitlement.can(feature).then(
      (d) => alive && setDecision(d),
      () => alive && setDecision({ allowed: false, reason: "unverified" }),
    );
    return () => {
      alive = false;
    };
  }, [entitlement, feature]);
  return feature ? decision : undefined;
}

export function useEntitlementStatus(): EntitlementStatus | undefined {
  const { entitlement } = useAdapters();
  const [status, setStatus] = useState<EntitlementStatus | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    entitlement.status().then(
      (s) => alive && setStatus(s),
      () => alive && setStatus({ state: "none", offlineValidUntil: null }),
    );
    return () => {
      alive = false;
    };
  }, [entitlement]);
  return status;
}

/** navigator.onLine(표시용). 클라우드 호출 성공 여부의 정본은 api-client 오류 코드다. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/* ---------- Session (008 상태기계) ---------- */
export interface SessionValue {
  readonly state: AuthState;
  /** 앱 시작 시 저장된 세션 확인 중. */
  readonly booting: boolean;
  readonly auth: AuthPort;
  /** 로그인 방법 실행 직전. */
  startSignIn(): void;
  failSignIn(code: LoginErrorCode): void;
  /** 로그인 방법이 성공한 뒤: finish(`POST /api/auth/finish`) → 온보딩 또는 ready. 실패면 로그아웃(키체인 삭제). */
  completeSignIn(provider: FinishProvider): Promise<void>;
  acceptTerms(allChecked: boolean): void;
  setCrossBorder(ack: boolean): void;
  skipCrossBorder(): void;
  start(): void;
  signOut(): Promise<void>;
}
const SessionContext = createContext<SessionValue | null>(null);

function SessionProvider({ auth, api, children }: { auth: AuthPort; api: ApiClient; children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, INITIAL_AUTH_STATE);
  const [booting, setBooting] = useState(true);
  const booted = useRef(false);

  const finish = useCallback(
    async (provider: FinishProvider) => {
      try {
        const result = await requestFinishLogin(api, provider, api.newIdempotencyKey());
        dispatch({ type: "FINISH_OK", result });
      } catch (e) {
        dispatch({ type: "FINISH_FAILED", code: isApiError(e) ? loginErrorFromApi(e.code) : "login_failed" });
        await auth.signOut(); // 008 machine.ts: finish 실패 전이 뒤 반드시 로그아웃(clearSecrets)
      }
    },
    [api, auth],
  );

  useEffect(() => {
    if (booted.current) return; // StrictMode 두 번 실행 방지
    booted.current = true;
    void (async () => {
      let has = false;
      try {
        has = await auth.hasSession();
      } catch {
        has = false;
      }
      if (has) {
        // 재시작 복구: 세션이 남아 있으면 finish를 다시 부른다(서버 bootstrap은 멱등, 008).
        dispatch({ type: "SIGN_IN_START" });
        dispatch({ type: "SIGN_IN_OK" });
        setBooting(false);
        await finish("email");
      } else {
        setBooting(false);
      }
    })();
  }, [auth, finish]);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      booting,
      auth,
      startSignIn: () => dispatch({ type: "SIGN_IN_START" }),
      failSignIn: (code) => dispatch({ type: "SIGN_IN_FAILED", code }),
      completeSignIn: async (provider) => {
        dispatch({ type: "SIGN_IN_OK" });
        await finish(provider);
      },
      acceptTerms: (allChecked) => dispatch({ type: "ACCEPT_TERMS", allChecked }),
      setCrossBorder: (ack) => dispatch({ type: "SET_CROSS_BORDER", ack }),
      skipCrossBorder: () => dispatch({ type: "SKIP_CROSS_BORDER" }),
      start: () => dispatch({ type: "START" }),
      signOut: async () => {
        dispatch({ type: "SIGN_OUT" });
        try {
          await auth.signOut();
        } finally {
          dispatch({ type: "SIGNED_OUT" });
        }
      },
    }),
    [state, booting, auth, finish],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return need(useContext(SessionContext), "useSession");
}

/* ---------- ApiClient (007) ---------- */
const ApiContext = createContext<ApiClient | null>(null);

/** 클라우드 API. 토큰은 주입된 getAccessToken으로만 붙는다(화면은 토큰을 보지 않는다). */
export function useApi(): ApiClient {
  return need(useContext(ApiContext), "useApi");
}

/* ---------- Engine (017) ---------- */
const EngineContext = createContext<EngineHost | null>(null);

/** 엔진 워커 호스트. 워커를 만들 수 없는 환경이면 null(화면은 오류 상태로 보인다). */
export function useEngine(): EngineHost | null {
  return useContext(EngineContext);
}

/* ---------- 묶음 ---------- */
export function AppProviders({ runtime, children }: { runtime: ShellRuntime; children: ReactNode }) {
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: runtime.api.baseUrl,
        getAccessToken: () => runtime.auth.getAccessToken(),
        ...(runtime.api.fetch ? { fetch: runtime.api.fetch } : {}),
        isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      }),
    [runtime],
  );
  useEffect(() => {
    const on = () => api.notifyOnline();
    addEventListener("online", on);
    return () => removeEventListener("online", on);
  }, [api]);
  useEffect(() => () => runtime.engine?.dispose(), [runtime]);
  return (
    <DisplayProvider>
      <DemoContext.Provider value={runtime.demo === true}>
        <AdaptersContext.Provider value={runtime.adapters}>
          <SessionProvider auth={runtime.auth} api={api}>
            <ApiContext.Provider value={api}>
              <EngineContext.Provider value={runtime.engine}>{children}</EngineContext.Provider>
            </ApiContext.Provider>
          </SessionProvider>
        </AdaptersContext.Provider>
      </DemoContext.Provider>
    </DisplayProvider>
  );
}
