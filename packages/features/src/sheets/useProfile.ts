// 시트에 쓸 표제란 프로필(031 설정). 순서: 로컬 캐시(오프라인에서도 시트 생성, 031) → 온라인이면 서버 GET으로 갱신.
// 둘 다 없으면 기본값(사무소명 빈 칸)이고 화면이 설정 안내를 보인다. 서버 응답·캐시는 031의 validProfile로 검증한 값만 쓴다.
import type { DraftingProfile } from "@arch-studio/domain";
import { useEffect, useState } from "react";
import { useApi, useOnline, useSession } from "../shell/index.ts";
import { readDraftingProfileCache, writeDraftingProfileCache } from "../settings/drafting/cache.ts";
import { DEFAULT_PROFILE, parseProfileResponse } from "../settings/drafting/profile.ts";

export type ProfileSource = "server" | "cache" | "default";

export type ProfileState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly profile: DraftingProfile; readonly source: ProfileSource };

export function useDraftingProfile(): ProfileState {
  const api = useApi();
  const online = useOnline();
  const { state } = useSession();
  const orgId = state.kind === "ready" ? (state.session.org?.id ?? null) : null;
  const [out, setOut] = useState<ProfileState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    const cached = orgId ? readDraftingProfileCache(orgId) : null;
    const fallback: ProfileState = cached ? { status: "ready", profile: cached.profile, source: "cache" } : { status: "ready", profile: DEFAULT_PROFILE, source: "default" };
    if (!online || !orgId) {
      setOut(fallback);
      return;
    }
    if (cached) setOut(fallback);
    else setOut({ status: "loading" });
    api.request({ method: "GET", path: "/api/drafting-profile", parse: parseProfileResponse }).then(
      (data) => {
        if (!alive) return;
        if (data.profile) {
          writeDraftingProfileCache({ org_id: orgId, profile: data.profile, synced_at: new Date().toISOString(), updated_at: data.updated_at });
          setOut({ status: "ready", profile: data.profile, source: "server" });
        } else setOut({ status: "ready", profile: DEFAULT_PROFILE, source: "default" });
      },
      () => alive && setOut(fallback),
    );
    return () => {
      alive = false;
    };
  }, [api, online, orgId]);

  return out;
}
