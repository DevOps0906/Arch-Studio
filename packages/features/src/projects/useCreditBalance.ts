// 크레딧 잔액 조회 훅(03장 3.3절 크레딧 카드·요약 칸). 크레딧 화면(AR-06-044)과 공유할 자리 — 위치·계약은 팀장 결정 [DECISION].
// 잔액 원천(3.17절 core.wallets RLS 조회)은 아직 앱 API 클라이언트에 없다: 데모는 [예시] 값, 운영은 마지막 캐시(기준 시각) 또는 안내 문구.
// 원천이 생기면 fetched 자리에 넣고 성공 값만 캐시에 쓴다(데모 값은 캐시에 쓰지 않는다).
import { useMemo, useState } from "react";
import { useDemoMode, useOnline, useSession } from "../shell/index.ts";
import { CREDIT_CACHE_KEY, creditView, parseCreditCache, type CreditView } from "./credit.ts";
import { demoCredit } from "./demo-fixture.ts";

function readCache(): ReturnType<typeof parseCreditCache> {
  try {
    return parseCreditCache(globalThis.localStorage?.getItem(CREDIT_CACHE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function useCreditBalance(): CreditView {
  const demo = useDemoMode();
  const online = useOnline();
  const { state } = useSession();
  const signedIn = state.kind === "ready";
  const [cached] = useState(readCache);
  return useMemo(() => creditView({ signedIn, online, fetched: demo ? demoCredit() : null, cached }), [demo, online, signedIn, cached]);
}
