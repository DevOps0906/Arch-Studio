// 주소·지번 조회 호출(POST /api/site/lookup, 035 계약) — 대지 화면과 새 프로젝트 창이 같이 쓴다.
// 입력 사전 검사 → 요청(멱등 키) → 응답 검증(parseLookupData) → 로컬 mm 후보(candidateFromLookup). 실패는 화면 안내(lookupFailure)로만 돌려준다.
import { isApiError, type ApiClient } from "../api-client/index.ts";
import { LOOKUP_TEXT, lookupFailure, lookupInputOk, type LookupFailure } from "./access.ts";
import { candidateFromLookup, parseLookupData, type LookupData, type SiteCandidateView } from "./model.ts";

export type LookupKind = "address" | "jibun" | "pnu";

export type LookupOutcome = { ok: true; data: LookupData; candidate: SiteCandidateView } | { ok: false; failure: LookupFailure; remaining?: number | null };

export async function requestSiteLookup(api: ApiClient, kind: LookupKind, value: string): Promise<LookupOutcome> {
  if (!lookupInputOk(kind, value)) return { ok: false, failure: { message: LOOKUP_TEXT.invalid, toDraw: false } };
  try {
    const data = await api.request({
      method: "POST",
      path: "/api/site/lookup",
      body: { query: { kind, value } },
      idempotencyKey: api.newIdempotencyKey(),
      parse: (d) => {
        const v = parseLookupData(d);
        if (!v) throw new Error("invalid");
        return v;
      },
    });
    const candidate = candidateFromLookup(data);
    if (!candidate) return { ok: false, failure: { message: LOOKUP_TEXT.badCandidate, toDraw: true }, remaining: data.remaining_today };
    return { ok: true, data, candidate };
  } catch (e) {
    return { ok: false, failure: isApiError(e) ? lookupFailure(e.code, e.details?.reason, e.userMessage) : { message: LOOKUP_TEXT.AR021, toDraw: true } };
  }
}
