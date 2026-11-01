// 새 프로젝트 창 주소 검색(POST /api/site/search): 명시 제출 한 번 → 후보 목록(최대 10). 후보를 고르면 기존 조회(POST /api/site/lookup)를 부른다.
// 자동완성 없음(입력 중 요청 0). 검색 종류는 서버 schema.ts SITE_SEARCH_KINDS('jibun' | 'road'), 도로명 후보는 PNU 없이 온다.
// 실패 문구는 조회와 같은 lookupFailure + 스위치 꺼짐(503 site_map_disabled) → 직접 입력 안내.
import { isApiError, type ApiClient } from "../api-client/index.ts";
import { LOOKUP_TEXT, lookupFailure, lookupInputOk, type LookupFailure } from "../site/access.ts";
import type { LookupKind } from "../site/lookup.ts";

/** 서버 SITE_SEARCH_KINDS와 같은 값. */
export type SearchKind = "jibun" | "road";

export interface SearchCandidate {
  readonly label: string;
  readonly kind: SearchKind;
  readonly pnu: string | null;
}

export type SearchOutcome = { ok: true; candidates: readonly SearchCandidate[] } | { ok: false; failure: LookupFailure };

export const SEARCH_MAX = 10;
/** 지도·검색 스위치 꺼짐(503, 서버 http.ts site_map_disabled). */
export const SEARCH_DISABLED_TEXT = "지금은 주소 검색을 쓸 수 없습니다.";
const LABEL_MAX = 200;
const PNU_RE = /^\d{19}$/;

/** 서버 응답 data 검증. 형식이 틀린 후보는 버리고, 목록 자체가 없으면 null. */
export function parseSearchData(raw: unknown): readonly SearchCandidate[] | null {
  if (raw === null || typeof raw !== "object") return null;
  const list = (raw as Record<string, unknown>)["candidates"];
  if (!Array.isArray(list)) return null;
  const out: SearchCandidate[] = [];
  for (const c of list) {
    if (out.length >= SEARCH_MAX) break;
    if (c === null || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const label = r["label"];
    const kind = r["kind"];
    const pnu = r["pnu"];
    if (typeof label !== "string" || label.trim() === "" || label.length > LABEL_MAX) continue;
    if (kind !== "jibun" && kind !== "road") continue;
    out.push({ label, kind, pnu: typeof pnu === "string" && PNU_RE.test(pnu) ? pnu : null });
  }
  return out;
}

export async function requestSiteSearch(api: ApiClient, kind: SearchKind, value: string): Promise<SearchOutcome> {
  // 서버 parseSearchBody와 같은 규칙: 두 종류 모두 주소 문자 규칙(지번 본번 숫자 요구 없음).
  if (!lookupInputOk("address", value)) return { ok: false, failure: { message: LOOKUP_TEXT.invalid, toDraw: false } };
  try {
    const candidates = await api.request({
      method: "POST",
      path: "/api/site/search",
      body: { query: { kind, value } },
      idempotencyKey: api.newIdempotencyKey(),
      parse: (d) => {
        const v = parseSearchData(d);
        if (!v) throw new Error("invalid");
        return v;
      },
    });
    return { ok: true, candidates };
  } catch (e) {
    if (isApiError(e) && e.code === "site_map_disabled") return { ok: false, failure: { message: SEARCH_DISABLED_TEXT, toDraw: true } };
    return { ok: false, failure: isApiError(e) ? lookupFailure(e.code, e.details?.reason, e.userMessage) : { message: LOOKUP_TEXT.AR021, toDraw: true } };
  }
}

/** 고른 후보 → 조회 요청 값: PNU가 있으면 PNU로, 없으면 라벨(조회 종류: 도로명 road → address, 지번 → jibun). */
export function lookupArgsFor(c: SearchCandidate): { kind: LookupKind; value: string } {
  if (c.pnu) return { kind: "pnu", value: c.pnu };
  return { kind: c.kind === "road" ? "address" : "jibun", value: c.label };
}
