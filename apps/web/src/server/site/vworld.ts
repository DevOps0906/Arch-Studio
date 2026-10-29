// VWorld 대지 조회 어댑터(04_API.md 6·6.1절: `lookup(query, signal)` 하나로 `{ pnu, address_label, crs, ring_m, zoning, roads }`).
// 응답 형식은 VWorld 공개 문서 기준(지오코더 2.0 `/req/address`, 데이터 API 2.0 `/req/data`)이며 **원문 확인 전(D-14, 미확인)**이다.
// 키가 없어 실제 호출로 검증하지 않았다: 테스트는 fetch 주입 목 + 문서 기준 픽스처(vworld-fixtures.ts)로 한다(로그 "실제 호출 시나리오").
// 방어(로그 A1·A2·A5·A9): 출처·경로는 상수, 사용자 값은 URLSearchParams 값 칸에만, redirect 금지, 응답 크기·시간 상한, 형식·좌표 이상은 AR021.
// server-only를 import하지 않는다(node --test 대상). 키는 deps.ts가 serverEnv()에서 읽어 넘긴다.
import { providerError, SiteError, type ProviderFailReason } from "./http.ts";
import { PNU_RE, type SiteQuery } from "./schema.ts";

/** 허용 출처(고정). 이 밖의 호스트로는 요청하지 않는다. */
export const VWORLD_ORIGIN = "https://api.vworld.kr";
export const VWORLD_PATHS = { geocode: "/req/address", data: "/req/data" } as const;
/** 응답 좌표계: Korea 2000 / Central Belt 2010(미터, 투영). 화면이 원점을 빼고 mm 정수로 바꾼다(packages/domain mToMm). */
export const VWORLD_CRS = "EPSG:5186";
/** 데이터 API 레이어: 연속지적도(필지 경계), 용도지역(도시지역). 이름은 공개 목록 기준(미확인). */
export const VWORLD_DATASETS = { parcel: "LP_PA_CBND_BUBUN", zoning: "LT_C_UQ111" } as const;

/** 호출당 타임아웃(04_API 6장 "호출당 4초"). */
export const VWORLD_CALL_TIMEOUT_MS = 4000;
/** 조회 전체 마감(p95 5초 안: 세션·DB·응답 몫 0.5초를 남김, 로그 "상수 근거"). */
export const SITE_LOOKUP_DEADLINE_MS = 4500;
/** 재시도(1회)는 남은 시간이 이만큼 이상일 때만. */
export const RETRY_MIN_REMAINING_MS = 1000;
/** 응답 본문 상한. */
export const VWORLD_MAX_RESPONSE_BYTES = 1024 * 1024;
/** 고리 꼭짓점 상한(io DXF 가져오기와 같은 2,000). 03장 2.2 "200개 초과 경고"는 화면 몫. */
export const RING_MAX_VERTICES = 2000;
/** 필지 외접 사각형 최대 변(m). 이보다 큰 "필지"는 형식 이상으로 본다. */
export const PARCEL_MAX_EXTENT_M = 2000;
/** 필지 최소 면적(㎡). */
export const PARCEL_MIN_AREA_M2 = 1;
/** EPSG:5186 좌표 허용 범위(m, 남한 전역 + 여유). */
export const CRS_BOUNDS = { minX: -100_000, maxX: 800_000, minY: 0, maxY: 1_000_000 } as const;
const TEXT_MAX = 200;
const ZONE_TEXT_MAX = 60;
const ZONES_MAX = 10;

export type PointM = [number, number];

export interface ProviderLookupResult {
  pnu: string;
  address_label: string | null;
  crs: typeof VWORLD_CRS;
  /** 외곽 고리(닫는 점 없음, 제공자 좌표 그대로, m). */
  ring_m: PointM[];
  zoning: { use_district: string | null; districts: string[] };
  /** 제공자에 도로 폭 정보가 없어 비운다(사용자가 변마다 입력). */
  roads: { edge_index: number; width_m?: number }[];
  /** 정리 과정에서 버린 것(다중 필지 조각·구멍). 화면이 확인 안내에 쓴다. */
  notes: ("multipart" | "holes_dropped")[];
  datasets: string[];
}

/** 요청 하나의 조회 단계. 마감(SITE_LOOKUP_DEADLINE_MS)은 start() 시각 기준으로 두 단계에 걸쳐 공유한다(요청마다 따로). */
export interface ProviderSession {
  /** PNU(+지오코딩 점)를 얻는다. 상한 기록 전 단계: PNU 질의는 제공자를 부르지 않는다. */
  resolve(query: SiteQuery): Promise<{ pnu: string; point: PointM | null }>;
  /** PNU(+지오코딩 점)로 경계·용도지역. */
  fetchParcel(resolved: { pnu: string; point: PointM | null }): Promise<ProviderLookupResult>;
}

export interface SiteLookupProvider {
  readonly name: "vworld";
  start(signal?: AbortSignal): ProviderSession;
}

export type FetchImpl = (url: string, init: { method: "GET"; redirect: "error"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export interface VworldOptions {
  apiKey: string;
  fetch: FetchImpl;
  now(): number;
  /** VWorld 키에 등록한 서비스 도메인(일부 API 필수, 미확인). */
  domain?: string;
  callTimeoutMs?: number;
  deadlineMs?: number;
  maxResponseBytes?: number;
}

// ── 공용 정리 함수 ──

/** 표시 문자열 정리: 제어·서식 문자 제거, 공백 정리, 길이 상한. 결과가 비면 null. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
  return s === "" ? null : s;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function inBounds(x: number, y: number): boolean {
  return x >= CRS_BOUNDS.minX && x <= CRS_BOUNDS.maxX && y >= CRS_BOUNDS.minY && y <= CRS_BOUNDS.maxY;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 부호 있는 2배 면적(부동소수, 형식 검사용 — 판정·표시 면적은 화면이 geometry로 다시 계산). */
function shoelace2(ring: readonly PointM[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as PointM;
    const b = ring[(i + 1) % ring.length] as PointM;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/**
 * 고리 검사·정리: 유한 수·범위·점 수·닫는 점 제거·연속 중복 제거·외접 크기·최소 면적. 이상이면 null.
 * 자기교차 검사는 하지 않는다(화면이 geometry normalizePolygon으로 다시 검사하고, 실패하면 후보를 쓰지 않는다).
 */
export function cleanRing(raw: unknown): PointM[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > RING_MAX_VERTICES + 1) return null;
  const pts: PointM[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = p[0];
    const y = p[1];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !inBounds(x, y)) return null;
    const last = pts[pts.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    pts.push([x, y]);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
  if (pts.length < 3 || pts.length > RING_MAX_VERTICES) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX - minX > PARCEL_MAX_EXTENT_M || maxY - minY > PARCEL_MAX_EXTENT_M) return null;
  if (Math.abs(shoelace2(pts)) / 2 < PARCEL_MIN_AREA_M2) return null;
  return pts;
}

/** `response.status` 확인 → result. NOT_FOUND는 not_found, 그 밖은 invalid_response. */
function responseResult(json: unknown): Record<string, unknown> {
  const response = obj(obj(json)?.["response"]);
  const status = response?.["status"];
  if (status === "NOT_FOUND") throw providerError("not_found");
  if (status !== "OK") throw providerError("invalid_response");
  const result = obj(response?.["result"]);
  if (!result) throw providerError("invalid_response");
  return result;
}

/** 지오코더 응답 → 점(m). */
export function parseGeocode(json: unknown): PointM {
  const point = obj(responseResult(json)["point"]);
  const x = num(point?.["x"]);
  const y = num(point?.["y"]);
  if (x === null || y === null || !inBounds(x, y)) throw providerError("invalid_response");
  return [x, y];
}

function features(json: unknown): Record<string, unknown>[] {
  const fc = obj(responseResult(json)["featureCollection"]);
  const list = fc?.["features"];
  if (!Array.isArray(list)) throw providerError("invalid_response");
  if (list.length === 0) throw providerError("not_found");
  if (list.length > 100) throw providerError("invalid_response");
  return list.map((f) => obj(f) ?? {});
}

/** 연속지적 응답 → PNU·주소 표시·외곽 고리. 다중 조각이면 가장 큰 조각, 구멍은 버린다(notes로 알림). */
export function parseParcel(json: unknown, expectedPnu?: string): Pick<ProviderLookupResult, "pnu" | "address_label" | "ring_m" | "notes"> {
  const list = features(json);
  const feature = (expectedPnu ? list.find((f) => obj(f["properties"])?.["pnu"] === expectedPnu) : list[0]) ?? null;
  if (!feature) throw providerError("not_found");
  const props = obj(feature["properties"]);
  const pnu = props?.["pnu"];
  if (typeof pnu !== "string" || !PNU_RE.test(pnu)) throw providerError("invalid_response");
  const geometry = obj(feature["geometry"]);
  const type = geometry?.["type"];
  const coords = geometry?.["coordinates"];
  if (!Array.isArray(coords)) throw providerError("invalid_response");
  const polygons: unknown[] = type === "Polygon" ? [coords] : type === "MultiPolygon" ? coords : [];
  if (polygons.length === 0 || polygons.length > 50) throw providerError("invalid_response");
  const notes: ProviderLookupResult["notes"] = [];
  if (polygons.length > 1) notes.push("multipart");
  let best: PointM[] | null = null;
  let bestArea = -1;
  for (const poly of polygons) {
    if (!Array.isArray(poly) || poly.length === 0) throw providerError("invalid_response");
    if (poly.length > 1) notes.push("holes_dropped");
    const ring = cleanRing(poly[0]);
    if (!ring) throw providerError("invalid_response");
    const a = Math.abs(shoelace2(ring));
    if (a > bestArea) {
      best = ring;
      bestArea = a;
    }
  }
  if (!best) throw providerError("invalid_response");
  const address_label = cleanText(props?.["addr"], TEXT_MAX) ?? cleanText(props?.["jibun"], TEXT_MAX);
  return { pnu, address_label, ring_m: best, notes: [...new Set(notes)] };
}

/** 용도지역 응답 → 이름 목록(중복 제거, 상한). 결과 없음은 빈 목록(사용자가 고른다). */
export function parseZoning(json: unknown): string[] {
  let list: Record<string, unknown>[];
  try {
    list = features(json);
  } catch (e) {
    if (e instanceof SiteError && e.details?.["reason"] === "not_found") return [];
    throw e;
  }
  const names: string[] = [];
  for (const f of list) {
    const name = cleanText(obj(f["properties"])?.["uname"], ZONE_TEXT_MAX);
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= ZONES_MAX) break;
  }
  return names;
}

/** 외접 사각형 중심(용도지역 점 질의용, 오목 필지면 밖일 수 있다 → 결과는 후보로만). */
function bboxCenter(ring: readonly PointM[]): PointM {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

// ── HTTP ──

/** 본문을 상한까지만 읽는다. 넘으면 too_large(읽기 중단). */
async function readLimited(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) throw providerError("too_large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw providerError("too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

/** 요청 URL 조립: 출처·경로는 상수, 값은 searchParams.set(인코딩). 조립 결과의 출처·경로가 상수와 다르면 throw. */
export function buildVworldUrl(path: (typeof VWORLD_PATHS)[keyof typeof VWORLD_PATHS], params: Record<string, string>, apiKey: string, domain?: string): URL {
  const url = new URL(path, VWORLD_ORIGIN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (domain) url.searchParams.set("domain", domain);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", apiKey);
  if (url.origin !== VWORLD_ORIGIN || url.pathname !== path || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new SiteError("internal");
  }
  return url;
}

export function createVworldProvider(options: VworldOptions): SiteLookupProvider {
  const callTimeout = options.callTimeoutMs ?? VWORLD_CALL_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? SITE_LOOKUP_DEADLINE_MS;
  const maxBytes = options.maxResponseBytes ?? VWORLD_MAX_RESPONSE_BYTES;

  async function once(url: URL, timeoutMs: number, outer?: AbortSignal): Promise<{ ok: true; json: unknown } | { ok: false; reason: ProviderFailReason; retry: boolean }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuter = () => controller.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    try {
      let res: Response;
      try {
        res = await options.fetch(url.toString(), { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
      } catch {
        // 원 예외(메시지에 URL·키가 있을 수 있음)는 버린다.
        return { ok: false, reason: timedOut ? "timeout" : "network", retry: !outer?.aborted };
      }
      if (res.status >= 500) return { ok: false, reason: "http_status", retry: true };
      if (res.status !== 200) return { ok: false, reason: "http_status", retry: false };
      let text: string;
      try {
        text = await readLimited(res, maxBytes);
      } catch (e) {
        if (e instanceof SiteError) return { ok: false, reason: "too_large", retry: false };
        return { ok: false, reason: timedOut ? "timeout" : "network", retry: !outer?.aborted };
      }
      try {
        return { ok: true, json: JSON.parse(text) };
      } catch {
        return { ok: false, reason: "invalid_response", retry: false };
      }
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    }
  }

  /** 마감 안에서 호출 + (조건부) 재시도 1회. */
  async function call(deadline: number, path: (typeof VWORLD_PATHS)[keyof typeof VWORLD_PATHS], params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = buildVworldUrl(path, params, options.apiKey, options.domain);
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - options.now();
      if (remaining <= 0) throw providerError("timeout");
      const r = await once(url, Math.min(callTimeout, remaining), signal);
      if (r.ok) return r.json;
      const left = deadline - options.now();
      if (!r.retry || attempt === 1 || left < RETRY_MIN_REMAINING_MS) throw providerError(r.reason);
    }
    throw providerError("timeout");
  }

  return {
    name: "vworld",
    start(signal) {
      const deadline = options.now() + deadlineMs;
      // 주소 질의는 resolve에서 점으로 필지를 이미 받았으므로 fetchParcel이 같은 PNU면 다시 부르지 않는다.
      let cached: ReturnType<typeof parseParcel> | null = null;
      return {
        async resolve(query) {
          if (query.kind === "pnu") return { pnu: query.value, point: null };
          const json = await call(
            deadline,
            VWORLD_PATHS.geocode,
            { service: "address", request: "getcoord", version: "2.0", crs: VWORLD_CRS, type: query.kind === "jibun" ? "PARCEL" : "ROAD", refine: "true", simple: "false", address: query.value },
            signal,
          );
          const point = parseGeocode(json);
          const parcel = await call(deadline, VWORLD_PATHS.data, parcelParams({ geomFilter: `POINT(${point[0]} ${point[1]})` }), signal);
          cached = parseParcel(parcel);
          return { pnu: cached.pnu, point };
        },
        async fetchParcel(resolved) {
          const parcel =
            cached && cached.pnu === resolved.pnu
              ? cached
              : parseParcel(await call(deadline, VWORLD_PATHS.data, parcelParams({ attrFilter: `pnu:=:${resolved.pnu}` }), signal), resolved.pnu);
          const [zx, zy] = resolved.point ?? bboxCenter(parcel.ring_m);
          const zoningJson = await call(
            deadline,
            VWORLD_PATHS.data,
            { service: "data", request: "GetFeature", version: "2.0", data: VWORLD_DATASETS.zoning, geomFilter: `POINT(${zx} ${zy})`, geometry: "false", attribute: "true", crs: VWORLD_CRS, size: "10" },
            signal,
          );
          const zones = parseZoning(zoningJson);
          return {
            pnu: parcel.pnu,
            address_label: parcel.address_label,
            crs: VWORLD_CRS,
            ring_m: parcel.ring_m,
            zoning: { use_district: zones[0] ?? null, districts: zones.slice(1) },
            roads: [],
            notes: parcel.notes,
            datasets: [VWORLD_DATASETS.parcel, VWORLD_DATASETS.zoning],
          };
        },
      };
    },
  };
}

function parcelParams(filter: { geomFilter: string } | { attrFilter: string }): Record<string, string> {
  return { service: "data", request: "GetFeature", version: "2.0", data: VWORLD_DATASETS.parcel, geometry: "true", attribute: "true", crs: VWORLD_CRS, size: "10", ...filter };
}
