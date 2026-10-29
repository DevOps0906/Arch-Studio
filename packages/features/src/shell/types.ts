// 셸 주입 계약(AR-06-004b). features는 shell-bridge를 런타임 import하지 않는다(`import type`만):
// 어댑터·인증·엔진 객체는 앱(apps/desktop, 이후 웹 스튜디오 071)이 만들어 AppProviders에 넘긴다.
import type { PlatformAdapters } from "@arch-studio/shell-bridge";
import type { DevMockAuth } from "@arch-studio/shell-bridge/auth";
import type { FetchLike } from "../api-client/index.ts";
import type { FinishProvider, LoginErrorCode } from "../auth/index.ts";

/** 화면이 보는 플랫폼 어댑터 5종(070). 설치형은 createPlatformAdapters(), 데모는 demo/의 인메모리 구현. */
export type ShellAdapters = PlatformAdapters;

export type SignInOutcome = { readonly ok: true } | { readonly ok: false; readonly code: LoginErrorCode };

/**
 * 인증 포트(008 createDesktopAuthSession을 감싼 구조적 인터페이스). 토큰 값은 api-client에만 흐르고 화면에는 나오지 않는다.
 * 로그인 방법이 null이면 이 빌드에 아직 없는 방법이다(Stage B는 AR-06-062가 채운다) → 화면은 버튼을 비활성 + 이유로 보인다.
 */
export interface AuthPort {
  getAccessToken(): Promise<string | null>;
  /** 로그아웃: 결과와 무관하게 비밀(키체인)을 지운다(008 A9). */
  signOut(): Promise<void>;
  /** 저장된 세션이 있는가(앱 재시작 복구용). 읽기 실패는 false. */
  hasSession(): Promise<boolean>;
  /** 이메일·비밀번호(D-15 권고, 062). */
  readonly signInWithPassword: ((email: string, password: string) => Promise<SignInOutcome>) | null;
  /** Google(시스템 브라우저 + PKCE + 딥링크, 062). */
  readonly signInWithGoogle: (() => Promise<SignInOutcome>) | null;
  /**
   * 개발 빌드 Mock 로그인(008 loadDevMockAuth 결과). 릴리스 빌드·mock 아님이면 null을 돌려준다.
   * 앱은 shell-bridge `loadDevMockAuth`만 넘긴다(판정 함수 하나, 화면은 판정하지 않는다).
   */
  readonly loadDevMock?: () => Promise<DevMockAuth | null>;
}

/** 엔진 워커 요청·응답의 구조적 최소형. 정본 타입은 apps/desktop/src/workers/protocol.ts(017). */
export interface EngineRequestLike {
  readonly op: string;
  readonly req_id: string;
}
export interface EngineResponseLike {
  readonly req_id: string;
}

/**
 * 엔진 호스트(017 WorkerClient 묶음). 앱이 `new Worker(new URL(...), {type:"module"})`로 만들어 주입한다.
 * send는 봉투 검사(parseRequest)를 통과하지 못하면 throw한다(프로그래밍 오류).
 */
export interface EngineHost {
  send(request: EngineRequestLike): void;
  /** 모든 응답(진행·결과·오류·superseded)을 받는다. 반환값으로 구독 해제. */
  subscribe(listener: (response: EngineResponseLike) => void): () => void;
  /** 워커 종료. 이후 send가 오면 다시 만든다(StrictMode effect 재실행 대비, 마지막 규칙 팩 재전송). */
  dispose(): void;
}

export interface ApiConfig {
  /** 클라우드 API 기준 URL(VITE_API_BASE_URL). 빈 값이면 호출이 실패(network)한다. */
  readonly baseUrl: string;
  /** 데모·테스트용 fetch 주입. 없으면 전역 fetch. */
  readonly fetch?: FetchLike;
}

/** 앱이 만들어 AppProviders에 넘기는 묶음. */
export interface ShellRuntime {
  readonly adapters: ShellAdapters;
  readonly auth: AuthPort;
  readonly api: ApiConfig;
  /** 워커를 만들 수 없는 환경(테스트)이면 null. */
  readonly engine: EngineHost | null;
  /** 개발 데모 모드 표시(화면 띠). 릴리스는 항상 false. */
  readonly demo?: boolean;
}

export type { FinishProvider };
