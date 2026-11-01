// 새 프로젝트 지도(주소 검색·배경 타일) 실패 닫힘 스위치. 켜짐 = ARCH_SITE_MAP_ENABLED가 정확히 "true".
// 꺼지면 search·tiles 모두 503(site_map_disabled). 켜져 있어도 VWORLD_API_KEY가 없으면 AR021 not_configured.
// 스위치는 serverEnv 스키마(소유 밖)에 아직 없어 process.env에서 읽는다(ai/render/config.ts와 같은 방식).
// server-only를 import하지 않는다(node --test 대상).

export const SITE_MAP_ENABLED_ENV = "ARCH_SITE_MAP_ENABLED";

export function isSiteMapEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[SITE_MAP_ENABLED_ENV] === "true";
}
