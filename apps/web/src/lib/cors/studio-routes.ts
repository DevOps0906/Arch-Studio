// 스튜디오(apps/desktop Vite 앱 — 설치형·웹 공용)가 Bearer로 부르는 API 목록(AR-06-071 결정 10).
// 무로그인 거부 증명: 이 목록의 라우트는 Authorization 없이 401이어야 한다(studio-routes-unauth.test.ts가 실제 Route Handler로 확인).
// 클라이언트 가드는 UX일 뿐이고, 거부는 서버가 한다. 새 스튜디오 호출을 추가하면 여기에도 추가한다(클라이언트 경로 스캔 테스트가 강제).

export type StudioMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface StudioRoute {
  readonly method: StudioMethod;
  /** 요청 예시 경로(동적 세그먼트는 형식에 맞는 값). */
  readonly path: string;
  /** src/app 아래 route.ts 경로. null = 서버 라우트 미구현(Next 기본 404로 거부, 후속 작업). */
  readonly file: string | null;
  /** 동적 세그먼트 값. */
  readonly params?: Readonly<Record<string, string>>;
}

const UUID = "00000000-0000-4000-8000-000000000001";

export const STUDIO_ROUTES: readonly StudioRoute[] = [
  { method: "POST", path: "/api/auth/finish", file: "api/auth/finish/route.ts" },
  { method: "GET", path: "/api/cloud-projects", file: "api/cloud-projects/route.ts" },
  { method: "POST", path: "/api/cloud-projects", file: "api/cloud-projects/route.ts" },
  { method: "DELETE", path: `/api/cloud-projects/${UUID}?expected_version=1`, file: "api/cloud-projects/[id]/route.ts", params: { id: UUID } },
  { method: "POST", path: `/api/cloud-projects/${UUID}/upload-url`, file: "api/cloud-projects/[id]/upload-url/route.ts", params: { id: UUID } },
  { method: "GET", path: "/api/cost-catalogs/latest", file: "api/cost-catalogs/latest/route.ts" },
  { method: "GET", path: "/api/drafting-profile", file: "api/drafting-profile/route.ts" },
  { method: "PUT", path: "/api/drafting-profile", file: "api/drafting-profile/route.ts" },
  { method: "POST", path: "/api/drafting-profile/logo-upload-url", file: "api/drafting-profile/logo-upload-url/route.ts" },
  { method: "POST", path: "/api/site/lookup", file: "api/site/lookup/route.ts" },
  { method: "POST", path: "/api/site/search", file: "api/site/search/route.ts" },
  {
    method: "GET",
    path: "/api/site/tiles/base/7/109/49",
    file: "api/site/tiles/[layer]/[z]/[x]/[y]/route.ts",
    params: { layer: "base", z: "7", x: "109", y: "49" },
  },
  { method: "POST", path: "/api/uploads/sign", file: "api/uploads/sign/route.ts" },
  { method: "POST", path: "/api/voice/stt", file: "api/voice/stt/route.ts" },
  { method: "POST", path: "/api/ai/chat", file: "api/ai/chat/route.ts" },
  { method: "POST", path: "/api/ai/render", file: "api/ai/render/route.ts" },
  { method: "POST", path: "/api/ai/review", file: "api/ai/review/route.ts" },
  { method: "GET", path: `/api/jobs/${UUID}`, file: "api/jobs/[id]/route.ts", params: { id: UUID } },
  { method: "GET", path: "/api/rule-packs", file: "api/rule-packs/route.ts" },
  { method: "GET", path: "/api/rule-packs/2026.10.0/download", file: "api/rule-packs/[version]/download/route.ts", params: { version: "2026.10.0" } },
  { method: "POST", path: "/api/license/activate", file: "api/license/activate/route.ts" },
  { method: "POST", path: "/api/license/deactivate", file: "api/license/deactivate/route.ts" },
  { method: "POST", path: "/api/license/refresh", file: "api/license/refresh/route.ts" },
  { method: "GET", path: "/api/license/list", file: "api/license/list/route.ts" },
  // 웹 어댑터(072)가 부르지만 서버 라우트가 아직 없다(후속). 없는 동안 Next 기본 404로 거부된다.
  { method: "GET", path: "/api/entitlement", file: null },
  { method: "GET", path: `/api/cloud-projects/${UUID}/blob`, file: null, params: { id: UUID } },
];
