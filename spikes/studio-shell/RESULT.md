# AR-06-071a 스튜디오 셸 스파이크 결과 (2026-10-29, 버리는 코드)

질문: `packages/features`의 라우트 정의 한 벌을 Vite(설치형, `apps/desktop`과 같은 구성)와 Next.js 16 App Router `(studio)`가 함께 쓸 수 있는가(ADR-001 2장 경계 규칙).

재현: `pnpm install --ignore-workspace` → `node scripts/gen.ts` → `npx vite build vite-shell` → `npx next build next-shell` → `node scripts/measure.ts vite next-none next-strict`
→ `SPIKE_NONCE=1 npx next build next-shell` → `SPIKE_NONCE=1 node scripts/measure.ts next-nonce`. 결과 JSON은 `out/measure-*.json`(gitignore).
환경: Node 24.13, pnpm 10.34, Vite 8.3.5(플러그인 없음, target chrome120), Next.js 16.2.12(Turbopack), React 19.2.9, React Router 8.5.1, headless Edge. 3100 포트는 이 PC에서 Docker가 쓰고 있어 3917을 썼다.

## 1. 시도한 공유 방식

공통: `features/routes.ts`가 프레임워크 비의존 메타 배열(18경로, `{ id, path, load: () => import(...) }`, 화면 모듈은 `default` + 선택 `loader(params, signal)`)이다. 화면은 `features/nav.tsx`의 `useNav()` 계약(params·pathname·search·navigate·Link·data)만 보고, react-router나 next/*는 import하지 않는다. 셸은 이 계약을 구현하는 어댑터만 갖는다.

| 방식 | 셸 | 어댑터 | 경로 |
|---|---|---|---|
| V | Vite + React Router `createBrowserRouter` | `rr-adapter/routes.tsx`: 메타 → `RouteObject[]`(`lazy`가 Component·loader 반환) | `vite-shell/` |
| C | Next, 경로별 `page.tsx` 코드 생성(Next 고유 방식) | `scripts/gen.ts`가 메타에서 19개 page 생성, `adapter-native.tsx`(next/navigation·next/link) | `/c/...` |
| A | Next, optional catch-all 1개 + 공유 매처 | `adapter-catchall.tsx`: `matchRoute` + 동적 import, 이동은 `history.pushState`(Next와 usePathname 동기화) | `/a/[[...slug]]` |
| B | Next catch-all 안에서 React Router 그대로 구동 | V와 같은 `buildRRRoutes()` + `basename:"/b"`, `next/dynamic(ssr:false)` | `/b/[[...slug]]` |

자동 점검(`features/smoke.ts`): `/projects?auto=1` → Link 클릭 → `projects/:id/site`(loader 데이터 확인) → `navigate` → `plans`. 결과는 headless Edge가 `/__result`로 보낸다.

## 2. 측정 (실제 빌드·실행 출력)

빌드: 두 쪽 모두 성공.
- Vite: `✓ 120 modules transformed` / `index-*.js 290.47 kB │ gzip: 92.42 kB` / 화면별 청크 18개(`site-*.js 0.63 kB`, `plans-*.js 0.35 kB` 등) / `✓ built in 228ms`
- Next: `✓ Compiled successfully` / 라우트 표 `ƒ /a/[[...slug]]`, `ƒ /b/[[...slug]]`, `○ /c/projects`, `ƒ /c/projects/[id]/site` 등 22행(정적 ○ 11, 동적 ƒ 11)

초기 JS는 진입 HTML이 부르는 `<script src>` 합(gzip level 9, 같은 함수로 측정. Vite 보고값 92.42 kB와 같은 파일):

| 방식 | 초기 JS 파일 | 초기 JS gzip | 인라인 스크립트 | 지연 청크(이동 후 로드) | 이동 중 서버 RSC 요청 | 점검(3회 반복) |
|---|---|---|---|---|---|---|
| V Vite+RR | 1 | **89.08 KB** | 0 | 2개 0.70 KB(site·plans) | 0 | 통과 3/3 |
| C Next 코드 생성 | 9 | **185.13 KB** | 6 (6,876 B) | 2개 7.45 KB | **4** | 통과 3/3 |
| A Next catch-all | 9 | **183.24 KB** | 4 (6,569 B) | 3개 2.62 KB | 0 | 통과 3/3 |
| B Next 안 RR | 9 | **182.72 KB** | 4 (6,735 B) | 5개 33.95 KB(RR 포함) | 0 | 통과 3/3 |

- 지연 로드 청크 분리: 네 방식 모두 됨(화면 청크가 DOMContentLoaded 뒤 이동 시점에 받아짐).
- Next 런타임만으로 초기 JS가 Vite+RR의 약 2배(+94 KB gzip). B는 첫 이동 때 RR 약 31 KB가 더 붙는다.
- C는 이동할 때마다 서버 RSC 왕복이 생긴다(서버가 꼭 있어야 하고, 오프라인에서는 못 쓴다).

라우터 차이를 흡수한 방법과 남는 비용:

| 항목 | 흡수 방법 | 남는 비용 |
|---|---|---|
| params | V·B: RR `useParams()`가 내비게이션 상태가 바뀔 때마다 새 객체를 줌 → 값 기준 memo(안 하면 화면 effect가 반복되어 Link 클릭이 무한히 반복됨, 실측). C: Next `useParams()`의 catch-all 배열 → `"*"`로 정규화. A: 공유 매처가 직접 만듦 | 매처가 둘(RR / 자체)이 되면 경로 문법을 맞추는 시험이 필요 |
| navigate | 계약을 "앱 기준 절대 경로만"으로 좁힘(상대 경로 해석 차이 제거). basename: RR은 라우터 옵션, C는 `router.push(base+to)`, A는 `pushState(base+to)` | 상대 경로·`navigate(-1)`·state 전달은 계약 밖 |
| loader | RR은 네이티브 `loader`. Next에는 클라이언트 loader가 없어 C·A 어댑터가 렌더 전에 직접 호출하고, 데이터가 오기 전에는 화면을 그리지 않는다 | SSR 데이터 없음, pending·에러·취소 의미를 어댑터별로 따로 구현. A는 이전 화면에 새 URL의 search가 먼저 보이는 문제가 있어 search를 로드 시점 값으로 고정했다(실측 버그) |
| Link | RR `<Link>` / `next/link` / `<a>`+pushState(수식키 클릭은 브라우저 기본 동작) | 프리페치 동작이 방식마다 다름 |
| 코드 위치 | C는 메타 → page 파일 코드 생성(19개 생성물), A·B는 page 1개 | C는 생성물 동기화 검사가 필요 |

## 3. CSP (`script-src 'self' 'wasm-unsafe-eval'`, 인라인 금지)

| 방식 | 엄격 CSP 헤더 | 결과 |
|---|---|---|
| V Vite 정적 | 위반 0, 점검 통과 | 인라인 스크립트 0. 정적 호스팅 헤더만으로 충족 |
| C·A·B Next 정적·기본 | **위반 4~6건 `script-src-elem` blocked `inline`**, 하이드레이션 실패로 점검 실패 | App Router가 RSC 페이로드를 인라인 `self.__next_f.push` 스크립트로 넣음 |
| C·A·B Next nonce(`proxy.ts`가 요청마다 nonce) | 위반 0, 점검 통과 | 대신 **모든 경로가 동적 렌더(ƒ)**로 바뀜(빌드 표 22행 전부 ƒ). 정책도 `'nonce-…' 'strict-dynamic'`이 되어 071 완료 조건의 "`wasm-unsafe-eval`만"과 다르다. 해시 방식은 시도하지 않음(미확인) |

## 4. [DECISION] 후보

**[DECISION] D-071a — Vite SPA 하나 + `web` 어댑터 + 정적 호스팅.** 스튜디오 웹판은 설치형과 같은 Vite 빌드(같은 `RouteObject[]`, 같은 React Router)에 shell-bridge `web/` 어댑터만 바꿔 끼워 정적으로 배포하고(`app.` 서브도메인, SPA 폴백 rewrite, CSP는 호스팅 헤더), Next는 마케팅·계정만 맡는다.

근거:
1. 공유 자체는 Next에서도 된다(C·A·B 모두 같은 features 라우트로 점검 통과, 실측). 하지만 Next로 얻는 이득(SSR·RSC)을 스튜디오는 쓰지 못한다. 로그인 전용이라 SEO가 필요 없고, 엔진은 워커에서 돌고, loader 데이터도 클라이언트에서 받는다. A·B는 결국 "Next 안의 SPA"다.
2. 비용은 실측으로 확인했다. 초기 JS가 2배(183~185 KB, Vite+RR은 89 KB)이고, 엄격 CSP를 지키려면 nonce 때문에 모든 경로를 동적 렌더해야 해서 요청마다 서버 렌더가 생긴다. C는 이동마다 서버 왕복도 생긴다.
3. 정의가 한 벌이 된다. 메타 → RR 어댑터를 데스크톱과 웹이 바이트 단위로 같이 쓰므로, 라우터 차이를 흡수하는 층(params 정규화·loader 재구현·search 고정)이 필요 없다.

실현 가능성: **확인**(브라우저 기준). 같은 Vite 빌드를 정적 서빙하고 엄격 CSP를 건 상태로 Link·params·loader·navigate·지연 청크까지 headless Edge에서 3/3 통과했다.
미확인으로 남은 것: Tauri WebView2 안에서의 실행(이번에는 브라우저만 확인), 실제 정적 호스트(Vercel 또는 Cloudflare)의 헤더·rewrite 설정, 엔진 워커·WASM 로드.

071 구조에 주는 영향(팀장 확인 필요):
- 쓰기 경로 `web/src/app/(studio)/**`, `web/src/lib/studio/**`가 별도 Vite 앱(예: `apps/studio-web`, 또는 `apps/desktop`의 `--mode web` 빌드 타깃)으로 바뀐다. `web/next.config.ts`의 스튜디오 헤더 1줄 요청은 필요 없어지고, 정적 호스트 설정 파일이 생긴다.
- "쿠키 세션 시 CSRF"는 서버 없는 SPA라 Bearer(supabase-js, 메모리 보관) 쪽이 자연스럽다. 쿠키를 쓰려면 API 출처 설계가 따로 필요하다(ADR-001 2.1 `SecureStore` 웹 구현, 5장).
- "로그인 없이 `(studio)` 접근 시 거부"는 정적 파일이 공개되므로, 클라이언트 가드 + 데이터 측 RLS/API 거부로 다시 정의해야 한다(번들에 비밀 0은 기존 `VITE_` 허용 목록 검사로 충족).
- ADR-001 2장 경계 규칙의 "(studio)와 apps/desktop이 같은 features 라우트 정의를 공유" 문장을 이 결정으로 고쳐야 한다(문서 변경은 팀장 판단).

Next를 꼭 유지해야 한다면 차선은 A(catch-all + pushState)다. 조건은 nonce 동적 렌더 수용, 초기 JS +94 KB, 자체 매처·loader 재구현 유지.
