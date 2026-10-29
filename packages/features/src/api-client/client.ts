// 클라우드 API 클라이언트: Bearer, FIFO 재시도 대기열, 오류 코드 매핑.
// 시계·난수·fetch·sleep·토큰은 모두 주입된다(결정적 테스트). shell-bridge를 import하지 않는다.
import { ApiError, codeFromStatus, isAutoRetryable, pickSafeDetails, type SafeDetails } from "./api-error.ts";
import {
  FORBIDDEN_BODY_KEYS,
  type AbortSignalLike,
  type ApiClient,
  type ApiClientOptions,
  type ApiLogEvent,
  type ApiRequest,
  type FetchLike,
} from "./types.ts";

const normKey = (k: string): string => k.replace(/_/g, "").toLowerCase();
const FORBIDDEN_NORMALIZED = new Set<string>(FORBIDDEN_BODY_KEYS.map(normKey));

/** 타입을 우회(as any 등)한 호출도 막는다. 값은 오류에 싣지 않고 키 이름만 확인한다. */
export function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 20 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKey(v, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([k, v]) => FORBIDDEN_NORMALIZED.has(normKey(k)) || hasForbiddenKey(v, depth + 1),
  );
}

interface Subscriber {
  settled: boolean;
  reject: (e: ApiError) => void;
  detach: () => void;
}

interface Entry {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly bodyText: string | undefined;
  readonly idemKey: string | undefined;
  readonly parse: ((d: unknown) => unknown) | undefined;
  readonly enqueuedAt: number;
  readonly subscribers: Set<Subscriber>;
  readonly abort: { signal: AbortSignalLike; abort(): void };
  cancelled: boolean;
  done: boolean;
  resolve: (v: unknown) => void;
  reject: (e: ApiError) => void;
  readonly result: Promise<unknown>;
}

type GlobalLike = {
  fetch?: FetchLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  AbortController?: new () => { signal: AbortSignalLike; abort(): void };
  crypto?: { randomUUID?: () => string };
};
const G = globalThis as unknown as GlobalLike;

function defaultSleep(ms: number, signal?: AbortSignalLike): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = (): void => {
      G.clearTimeout?.(h);
      resolve();
    };
    const h = G.setTimeout?.(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function newAbort(): { signal: AbortSignalLike; abort(): void } {
  if (G.AbortController) return new G.AbortController();
  // AbortController 없는 환경 대비 최소 구현.
  const ls = new Set<() => void>();
  const s = {
    aborted: false,
    addEventListener: (_t: "abort", l: () => void) => void ls.add(l),
    removeEventListener: (_t: "abort", l: () => void) => void ls.delete(l),
  };
  return {
    signal: s,
    abort: () => {
      if (s.aborted) return;
      s.aborted = true;
      [...ls].forEach((l) => l());
    },
  };
}

/** Retry-After: 초(정수) 또는 HTTP 날짜. 해석 못 하면 null. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Math.min(Number(v), 86_400) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - nowMs);
}

function buildUrl(baseUrl: string, path: string, query: Readonly<Record<string, string | number | boolean>> | undefined): string {
  const base = baseUrl.replace(/\/+$/, "");
  const q = query
    ? Object.keys(query)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`)
        .join("&")
    : "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}${q ? `?${q}` : ""}`;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch: FetchLike | undefined = opts.fetch ?? G.fetch?.bind(globalThis);
  const now = opts.now ?? ((): number => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const genId =
    opts.genId ??
    ((): string => {
      const u = G.crypto?.randomUUID?.();
      if (!u) throw new Error("genId가 필요합니다(crypto.randomUUID 없음).");
      return u;
    });
  const jitter = opts.jitter ?? ((): number => 0);
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const maxWaitMs = opts.maxWaitMs ?? 120_000;
  const maxQueue = opts.maxQueue ?? 50;

  const queue: Entry[] = [];
  const byIdemKey = new Map<string, Entry>();
  const onlineWaiters = new Set<() => void>();
  let running = false;
  let active = 0;

  const log = (e: ApiLogEvent): void => opts.log?.(e);
  const ev = (type: ApiLogEvent["type"], en: Entry, extra: Partial<ApiLogEvent> = {}): void =>
    log({ type, id: en.id, method: en.method, path: en.path, ...extra });

  function fail(en: Entry, err: ApiError): void {
    if (en.done) return;
    en.done = true;
    if (en.idemKey) byIdemKey.delete(en.idemKey);
    ev("failure", en, { code: err.code, status: err.httpStatus });
    en.reject(err);
  }
  function succeed(en: Entry, value: unknown, status: number): void {
    if (en.done) return;
    en.done = true;
    if (en.idemKey) byIdemKey.delete(en.idemKey);
    ev("success", en, { status });
    en.resolve(value);
  }
  const mk = (code: string, status: number | null, retryable: boolean, details?: SafeDetails): ApiError =>
    new ApiError({ code, httpStatus: status, retryable, ...(details ? { details } : {}) });

  /** 응답 본문 → 성공 값 또는 ApiError. 원 본문은 어디에도 남기지 않는다. */
  function interpret(en: Entry, status: number, text: string): { ok: true; value: unknown } | { ok: false; error: ApiError; retry: boolean } {
    let json: unknown;
    let parsed = false;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
        parsed = true;
      } catch {
        parsed = false;
      }
    }
    const env = parsed && typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null;
    if (status >= 200 && status < 300) {
      let data: unknown = undefined;
      if (env && env["ok"] === true) data = env["data"];
      else if (env && env["ok"] === false) return { ok: false, error: mk("invalid_response", status, false), retry: false };
      else if (parsed) data = json;
      else if (text.length > 0) return { ok: false, error: mk("invalid_response", status, false), retry: false };
      try {
        return { ok: true, value: en.parse ? en.parse(data) : data };
      } catch {
        return { ok: false, error: mk("invalid_response", status, false), retry: false }; // 검증기 메시지(값 포함 가능)는 버린다.
      }
    }
    const errObj = env && typeof env["error"] === "object" && env["error"] !== null ? (env["error"] as Record<string, unknown>) : null;
    const rawCode = errObj && typeof errObj["code"] === "string" && errObj["code"].length <= 64 ? errObj["code"] : null;
    const details = pickSafeDetails(errObj?.["details"]);
    let code = rawCode ?? codeFromStatus(status);
    if (status === 402 && rawCode === null && details?.reason !== undefined) code = "entitled_false";
    const retry = isAutoRetryable(status, rawCode);
    const userRetryable = retry || code === "AR021";
    return { ok: false, error: mk(code, status, userRetryable, details), retry };
  }

  async function waitOnline(en: Entry): Promise<boolean> {
    ev("offline-wait", en);
    const remaining = en.enqueuedAt + maxWaitMs - now();
    if (remaining <= 0) return false;
    const stop = newAbort();
    let online = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
      onlineWaiters.add(r);
    });
    const onCancel = (): void => release();
    en.abort.signal.addEventListener("abort", onCancel, { once: true });
    await Promise.race([
      gate.then(() => {
        online = true;
      }),
      sleep(remaining, stop.signal),
    ]);
    stop.abort();
    onlineWaiters.delete(release);
    en.abort.signal.removeEventListener("abort", onCancel);
    return online;
  }

  async function process(en: Entry): Promise<void> {
    for (let attempt = 1; ; ) {
      if (en.cancelled) return fail(en, mk("aborted", null, false));
      if (now() - en.enqueuedAt > maxWaitMs) return fail(en, mk("queue_expired", null, true));
      if (opts.isOnline && !opts.isOnline()) {
        const online = await waitOnline(en);
        if (en.cancelled) return fail(en, mk("aborted", null, false));
        if (!online && opts.isOnline && !opts.isOnline()) return fail(en, mk("queue_expired", null, true));
        continue;
      }

      let token: string | null;
      try {
        token = await opts.getAccessToken();
      } catch {
        token = null;
      }
      if (token === null || token === "") return fail(en, mk("unauthenticated", 401, false));
      if (!doFetch) return fail(en, mk("network_offline", null, true));

      ev("attempt", en, { attempt });
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      if (en.bodyText !== undefined) headers["Content-Type"] = "application/json";
      if (en.idemKey) headers["Idempotency-Key"] = en.idemKey;

      let err: ApiError;
      let retry = true;
      let retryAfterMs: number | null = null;
      try {
        const res = await doFetch(en.url, {
          method: en.method,
          headers,
          ...(en.bodyText !== undefined ? { body: en.bodyText } : {}),
          signal: en.abort.signal,
        });
        const text = await res.text();
        const out = interpret(en, res.status, text);
        if (out.ok) return succeed(en, out.value, res.status);
        err = out.error;
        retry = out.retry;
        if (res.status === 401) {
          err = mk("unauthenticated", 401, false);
          retry = false;
        }
        retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), now());
      } catch {
        if (en.cancelled) return fail(en, mk("aborted", null, false));
        err = mk("network_offline", null, true); // fetch 예외는 원문을 버리고 코드만 남긴다.
      }

      if (!retry || attempt >= maxAttempts) return fail(en, err);

      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.max(retryAfterMs ?? 0, backoff + Math.max(0, jitter(backoff)));
      if (now() + delay - en.enqueuedAt > maxWaitMs) return fail(en, err);
      ev("retry", en, { attempt, delayMs: delay, status: err.httpStatus, code: err.code });
      await sleep(delay, en.abort.signal);
      attempt += 1;
    }
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const en = queue.shift();
        if (!en) break;
        await process(en);
      }
    } finally {
      running = false;
    }
  }

  function subscribe(en: Entry, signal: AbortSignalLike | undefined): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const sub: Subscriber = { settled: false, reject, detach: () => {} };
      const onAbort = (): void => {
        if (sub.settled) return;
        sub.settled = true;
        en.subscribers.delete(sub);
        reject(mk("aborted", null, false));
        if (en.subscribers.size === 0 && !en.done) {
          en.cancelled = true;
          en.abort.abort();
          const i = queue.indexOf(en);
          if (i >= 0) {
            queue.splice(i, 1);
            fail(en, mk("aborted", null, false));
          }
        }
      };
      sub.detach = () => signal?.removeEventListener("abort", onAbort);
      en.subscribers.add(sub);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      en.result.then(
        (v) => {
          sub.detach();
          if (!sub.settled) {
            sub.settled = true;
            resolve(v);
          }
        },
        (e: unknown) => {
          sub.detach();
          if (!sub.settled) {
            sub.settled = true;
            reject(e);
          }
        },
      );
    });
  }

  function request<T>(req: ApiRequest<T>): Promise<T> {
    const method = req.method;
    const idemKey = req.method === "GET" ? undefined : req.idempotencyKey;
    const id = genId();
    const path = req.path.split("?")[0] ?? req.path;

    if (method !== "GET" && (typeof idemKey !== "string" || idemKey.length === 0)) {
      return Promise.reject(mk("forbidden_field", null, false)); // 타입이 막지만 런타임에서도 보낸 적 없는 것으로 처리
    }
    if (req.body !== undefined && hasForbiddenKey(req.body)) {
      return Promise.reject(mk("forbidden_field", null, false));
    }

    if (idemKey) {
      const dup = byIdemKey.get(idemKey);
      if (dup && !dup.done) {
        log({ type: "dedupe", id, method, path });
        return subscribe(dup, req.signal) as Promise<T>;
      }
    }
    if (queue.length + active >= maxQueue) return Promise.reject(mk("queue_full", null, true));

    let resolve!: (v: unknown) => void;
    let reject!: (e: ApiError) => void;
    const result = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    result.catch(() => {}); // 구독자가 처리한다
    const en: Entry = {
      id,
      method,
      path,
      url: buildUrl(opts.baseUrl, req.path, req.query),
      bodyText: req.body === undefined ? undefined : JSON.stringify(req.body),
      idemKey,
      parse: req.parse as ((d: unknown) => unknown) | undefined,
      enqueuedAt: now(),
      subscribers: new Set(),
      abort: newAbort(),
      cancelled: false,
      done: false,
      resolve,
      reject,
      result,
    };
    if (idemKey) byIdemKey.set(idemKey, en);
    queue.push(en);
    active += 1;
    result.then(
      () => void (active -= 1),
      () => void (active -= 1),
    );
    const p = subscribe(en, req.signal) as Promise<T>;
    void pump();
    return p;
  }

  return {
    request,
    notifyOnline(): void {
      [...onlineWaiters].forEach((r) => r());
    },
    get pending(): number {
      return active;
    },
    newIdempotencyKey: genId,
  };
}
