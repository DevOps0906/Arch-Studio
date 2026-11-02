// 요청 타입. 서버가 정하는 값(조직·금액·크레딧·가격 등)은 본문에 실을 수 없다(컴파일 오류 + 런타임 방어).

/** 본문에 보낼 수 없는 키(04장 1장: 조직은 세션에서만, 금액·크레딧은 서버 상수/DB). 소문자·밑줄 제거 후 비교한다. */
export const FORBIDDEN_BODY_KEYS = [
  "org_id",
  "orgId",
  "organization_id",
  "organizationId",
  "user_id",
  "userId",
  "actor_id",
  "amount",
  "amount_krw",
  "credits",
  "credit",
  "price",
  "total",
  "balance",
  "cost",
  "sku",
  "plan_id",
  "seats",
] as const;
export type ForbiddenBodyKey = (typeof FORBIDDEN_BODY_KEYS)[number];

type Forbidden = { [K in ForbiddenBodyKey]?: never };

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
export type JsonObject = Forbidden & { readonly [key: string]: JsonValue | undefined };

export type Query = Readonly<Record<string, string | number | boolean>>;

/** 공통 옵션. */
export interface CommonOptions<T> {
  /** 예: "/api/entitlement". 쿼리는 query로. */
  readonly path: string;
  readonly query?: Query;
  /** 취소. */
  readonly signal?: AbortSignalLike;
  /** 응답 data 검증 훅. zod 스키마면 `(d) => schema.parse(d)`. 던지면 invalid_response. */
  readonly parse?: (data: unknown) => T;
}

export interface ReadRequest<T> extends CommonOptions<T> {
  readonly method: "GET";
  readonly body?: never;
  readonly idempotencyKey?: never;
}

/** 변경 요청: 멱등 키 필수(AGENTS.md: 결제·차감 요청에는 멱등 키). 보통 본문 request_id와 같은 UUID를 넣는다. */
export interface WriteRequest<T> extends CommonOptions<T> {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: JsonObject;
  readonly idempotencyKey: string;
  /** 바이너리 본문(음성 받아쓰기 등). body와 함께 쓸 수 없다. contentType 필수. 멀티파트 미사용. */
  readonly rawBody?: BinaryBody;
  readonly contentType?: string;
  /** 추가 헤더(예: x-request-id). Authorization·Content-Type·Idempotency-Key는 덮어쓰지 못한다. */
  readonly headers?: Readonly<Record<string, string>>;
  /** false면 5xx·네트워크 오류도 자동 재시도하지 않는다(사용자가 다시 누른다). 기본 재시도. */
  readonly autoRetry?: false;
}

export type BinaryBody = Uint8Array | Blob;

export type ApiRequest<T> = ReadRequest<T> | WriteRequest<T>;

// ── 주입 가능한 환경(전역 DOM/Node 타입에 기대지 않는다) ──
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface FetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  /** 바이너리 본문. 기본 fetch는 body로 바꿔 보낸다(주입 fetch는 이 필드를 직접 받는다). */
  readonly binaryBody?: BinaryBody;
  readonly signal?: AbortSignalLike;
}
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export interface ApiLogEvent {
  readonly type: "attempt" | "retry" | "success" | "failure" | "dedupe" | "offline-wait";
  readonly id: string;
  readonly method: string;
  /** 쿼리 제외 경로만. 본문·토큰·헤더는 기록하지 않는다. */
  readonly path: string;
  readonly attempt?: number;
  readonly status?: number | null;
  readonly code?: string;
  readonly delayMs?: number;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** 토큰은 이 함수로만 얻는다(shell-bridge를 import하지 않는다). null이면 인증 오류. */
  readonly getAccessToken: () => Promise<string | null>;
  readonly fetch?: FetchLike;
  /** 밀리초 시각. 기본 Date.now. */
  readonly now?: () => number;
  /** ms 대기. signal이 abort되면 일찍 끝난다. 기본 setTimeout. */
  readonly sleep?: (ms: number, signal?: AbortSignalLike) => Promise<void>;
  /** 로컬 상관 id/멱등 키 생성(UUID v4). 기본 crypto.randomUUID. */
  readonly genId?: () => string;
  /** 지연에 더할 값을 돌려준다. 기본 0(결정적 스케줄). 난수는 호출자가 주입. */
  readonly jitter?: (delayMs: number) => number;
  /** false면 요청을 보내지 않고 notifyOnline()까지 대기. 기본 항상 온라인. */
  readonly isOnline?: () => boolean;
  readonly log?: (event: ApiLogEvent) => void;
  readonly maxAttempts?: number; // 기본 5
  readonly baseDelayMs?: number; // 기본 500
  readonly maxDelayMs?: number; // 기본 30_000
  /** 요청 하나가 대기열에서 기다릴 수 있는 총 시간. 기본 120_000 */
  readonly maxWaitMs?: number;
  /** 동시에 대기 가능한 건수(처리 중 포함). 기본 50 */
  readonly maxQueue?: number;
}

export interface ApiClient {
  request<T = unknown>(req: ApiRequest<T>): Promise<T>;
  /** 연결이 돌아왔을 때 호출하면 대기 중인 요청을 순서대로 다시 보낸다. */
  notifyOnline(): void;
  /** 대기 건수(처리 중 포함). */
  readonly pending: number;
  /** genId로 멱등 키를 만든다. */
  newIdempotencyKey(): string;
}
