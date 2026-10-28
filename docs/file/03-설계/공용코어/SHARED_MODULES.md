# SHARED_MODULES: 공용 모듈 경계와 인터페이스

작성일 2026-10-12. 제품이 "참조만 하고 재정의하지 않는" 공용 모듈 16개(+ AI 계층 5개, 19장)의 소유자, 소비자, 인터페이스, 뒷받침하는 코어 SQL, 실패·환불 동작을 적는다(`D:/WorkSpace/platform/docs/products/_PRODUCT_AGENT_BRIEF.md:53`). TypeScript 블록은 계약 예시다. 구현 파일이 아니다. 경로 인용에서 `migrations/`는 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/`다.

## 0. 패키지 배치 (제안)

분석은 "공용 패키지로 분리", "SS 구현을 기준으로"만 정했고(`docs/reference/00_MERGE_ANALYSIS.md:965`, `:972`) 패키지 이름은 정하지 않았다. 아래는 제안이다.

| 패키지/서비스 | 내용 | 런타임 |
|---|---|---|
| `packages/core-db` | Supabase 클라이언트 3종, `session_context` 래퍼, 코어 RPC 타입, 생성 타입 | TS |
| `packages/core-billing` | credits, toss, webhooks | TS |
| `packages/core-auth` | auth, org, oauth, 암호화(credentials), audit, rate limit | TS |
| `packages/core-ai` | 얇은 LLM 호출 래퍼(라우터 본체는 FastAPI로 이동, 8장), fal 클라이언트, compliance | TS |
| `packages/core-voice` | 음성 어댑터(ElevenLabs SDK + 오픈소스 음성 서버 클라이언트), 19장 | TS |
| `packages/ai-gateway` | Next.js `/api/ai/*`, `/api/voice/*` 공통 구현(서명 토큰 발급, 크레딧, 중계), 19장 | TS |
| `services/ai-service` (제품별 `apps/api`) | FastAPI: llm 라우터, rag, wiki, graphs, tools, 19장 | Python/FastAPI |
| `services/dify` (공용 1개) | 자체 호스팅 Dify, 설치 `D:/WorkSpace/platform/docs/develop/_shared/dify/` | Docker |
| `services/voice-server`, `services/llm-server` (공용 GPU) | 오픈소스 음성 서버, vLLM 서버, 설치 `D:/WorkSpace/platform/docs/develop/_shared/voice/`, `llm/` | Docker/GPU |
| `packages/core-jobs` | jobs 클라이언트와 워커 루프, storage 헬퍼 | TS |
| `packages/core-affiliate` | affiliate 어댑터, 단축 링크, 대가성 문구 삽입 | TS |
| `packages/automation-core` | React Flow 서버 실행 엔진, 노드 레지스트리, n8n/Make 브릿지 | TS |
| `packages/sns-uploader` | SNS 업로더(video 소유) | TS |
| `services/render-weasyprint` | PDF 렌더 서비스(publishing 소유, astro 소비) | Python/FastAPI 컨테이너 |
| `services/media-worker` | Whisper, demucs, FFmpeg 워커(video 소유) | Python |
| `packages/admin-kit` | admin-suite 전용 UI 코어(확정 결정 2). 이 문서 범위 밖 | TS |

패키지 이름과 배치는 제안이다. AI 계층 상세는 `AI_ARCHITECTURE.md`, `VOICE_ARCHITECTURE.md`, `LLM_WIKI.md`가 정본이고 이 문서는 경계만 적는다.

모든 TS 패키지는 `SUPABASE_DB_SCHEMA`(`core` 또는 `public`)를 읽어 RPC 스키마를 고른다(`D:/WorkSpace/platform/docs/products/_supabase-modular/ARCHITECTURE.md:10`).

## 1. 모듈 요약표

| 모듈 | 소유 | 소비 | 코어 SQL |
|---|---|---|---|
| auth | _platform-core | 전 제품 | `profiles`, `handle_new_user`, `session_context` |
| org | _platform-core | 전 제품 | `organizations`, `org_members`, 멤버 함수, `is_org_member` 등 헬퍼 |
| credits | _platform-core | 크레딧 쓰는 제품(publishing, astro, video, blog, commerce, toon, notes, docs) | `wallets`, `credit_ledger`, `consume/grant/refund_credits`, `ai_usage` |
| toss | _platform-core | 유료 플랜 있는 제품 | `payment_orders`, `payments`, `billing_keys`, `confirm_payment_order`, `apply_subscription_transition` |
| webhooks | _platform-core | 웹훅 받는 제품 전부 | `webhook_events` |
| oauth | _platform-core | SNS/마켓/제휴 연동 제품 | `oauth_states`, `create/consume_oauth_state`, `encrypted_credentials` |
| llm gateway | _platform-core (sellingstudio 구현 기준). 2026-10-13부터 라우터 본체는 ai-service | 전 제품 | `ai_usage`, `consume_credits`, `resolve_ai_route` |
| fal client | _platform-core (sellingstudio 구현 기준) | video, commerce, toon, publishing(표지), astro(테마 이미지) | `jobs`, `webhook_events`, `ai_usage` |
| weasyprint render | flora-publishing | astro-ai, nomad-docs(DOCX·공문서 프리셋은 nomad-docs 코어 요청 C-1) | `jobs`, Storage `exports` |
| sns uploader | sceneflow | nomad-commerce(2단계), nomad-blog(인스타 포스팅), book-trailer(YouTube 업로드, P1) | `encrypted_credentials`, `oauth_states`, `jobs` |
| automation-core | _platform-core | video, commerce, (blog) | `jobs`(parent_job_id), `webhook_events` |
| compliance | _platform-core | video(LLM 판정), commerce(금지어), blog | `ai_usage` |
| storage | _platform-core | 전 제품 | 버킷 3개, `storage_org_id` |
| audit | _platform-core | 전 제품 | `audit_log`, `write_audit` |
| jobs | _platform-core | 비동기 작업 있는 제품 전부 | `jobs` + RPC 8개 |
| affiliate | _platform-core | sceneflow, nomad-blog | `affiliate_*`, `brandconnect_applications` + 함수 6개 |
| ai-gateway | _platform-core | 전 제품 | `ai_conversations`(visitor_key, dify_user, status), `ai_messages`, `ai_usage`, `ai_org_settings`, `set_ai_cross_border_ack`, `consume_credits` |
| ai-service | _platform-core | 전 제품 | `ai_*`, `wiki_*`, `match_ai_chunks`, `resolve_ai_route`, `ai_runtime` |
| dify | _platform-core (공용 인프라) | 전 제품 | 없음(조직 데이터를 두지 않음) |
| core-voice | _platform-core | 전 제품 | `voice_sessions`, `voice_jobs`, `expire_voice_audio`, 버킷 `voice-audio` |
| llm-wiki | _platform-core | 전 제품(제품 위키), 개발 환경(개발 위키) | `wiki_pages`, `wiki_links`, `wiki_revisions` |

## 2. auth

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 전 제품 |
| 기준 구현 | `sellingstudio/lib/supabase/client.ts`, `server.ts`, `admin.ts`(3계층), `Hospital/src/proxy.ts:13-48`(라우트 보호 골격) |
| 코어 SQL | `core.profiles`(`migrations/0001_core_identity.sql:12-27`), `core.handle_new_user`(`:113-160`), `core.session_context`(`migrations/0004_core_security.sql:115-173`) |
| 실패 동작 | 프로필 없음 → 로그아웃 후 `/login`. `status='pending'` → `/pending` 안내. `status='suspended'` → 403 페이지. 기본값을 admin으로 두는 패턴(`Hospital/src/proxy.ts:57`) 금지 |

```ts
// packages/core-db
export function createBrowserClient(): SupabaseClient          // anon key, 브라우저
export function createServerClient(): Promise<SupabaseClient>  // anon key + 쿠키, SSR/Route Handler
export function createAdminClient(): SupabaseClient            // service_role key, 서버 전용. 절대 클라이언트 번들에 넣지 않는다

export interface SessionContext {
  user_id: string; email: string | null; display_name: string
  platform_role: 'user' | 'platform_admin'; status: 'active' | 'pending' | 'suspended'
  org: { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' | 'viewer' } | null
  app_id: string | null; plan_code: string | null; entitled: boolean; credit_balance: number
}
export async function getSessionContext(appId: string, orgId?: string): Promise<SessionContext | null>
// requireSession: 라우트 핸들러 진입부. 미로그인 401, pending/suspended 403, entitled=false 402(플랜 필요)
export async function requireSession(appId: string, opts?: { roles?: Array<SessionContext['org'] extends infer O ? O extends { role: infer R } ? R : never : never> }): Promise<SessionContext>
```

가입 폼 계약: `supabase.auth.signUp({ email, password, options: { data: { signup_app: '<app_id>', full_name } } })`. `signup_app`이 없으면 엔타이틀먼트가 생기지 않는다(`CORE_SPEC.md` 2.2). 로그인 수단의 단계(Mock → Google → 카카오·네이버)와 `packages/core-auth/providers` 계약은 20장과 `AUTH_ROADMAP.md`.

## 3. org

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 전 제품 |
| 코어 SQL | `core.organizations`, `core.org_members`(`migrations/0001_core_identity.sql:32-63`), 멤버 함수 7개(`migrations/0004_core_security.sql:315-503`), 헬퍼 `is_org_member`, `has_org_role`, `current_org_ids`, `has_entitlement`, `entitled_plan_code`(`:21-110`) |
| 운영 | 1인 1워크스페이스. UI는 개인 조직만 노출. 팀 기능이 있는 플랜(video Advanced)만 멤버 초대 화면을 연다 |
| 실패 동작 | 역할 부족 → 42501 → 403. 자기 역할 변경 시도 → 42501. 모든 변경은 `audit_log`에 남는다 |

```ts
// packages/core-auth
export interface OrgApi {
  inviteMember(orgId: string, userId: string, role: 'admin' | 'member' | 'viewer'): Promise<OrgMember>   // rpc invite_member
  acceptInvite(orgId: string): Promise<OrgMember>                                                        // rpc accept_invite
  approveMember(orgId: string, userId: string): Promise<OrgMember>                                       // rpc approve_member
  changeMemberRole(orgId: string, userId: string, role: 'admin' | 'member' | 'viewer'): Promise<OrgMember>
  removeMember(orgId: string, userId: string): Promise<void>
  transferOwnership(orgId: string, newOwnerId: string): Promise<void>
}
// 초대 대상이 아직 가입하지 않은 이메일이면: 서버가 Auth Admin API inviteUserByEmail 로 사용자를 만든 뒤 invite_member 를 호출한다(service_role).
```

## 4. credits

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 크레딧 과금 제품 |
| 코어 SQL | `core.consume_credits`, `grant_credits`, `refund_credits`(`migrations/0003_core_credits.sql:130-367`), `core.credit_balances`(`:106-114`), `core.ai_usage`(`:80-98`) |
| 호출 권한 | service_role 전용. 서버 코드(`createAdminClient`)에서만 호출 |
| 단가 정본 | 제품 01_PRD 요금 절. video는 `NOMAD Shorts Maker/PRD.md` 13장 크레딧 단가표 |
| 실패/환불 | `CR001` → HTTP 402 + 잔액/필요량 표시. 잡 실패 → `fail_job`이 자동 환불. 동기 호출 실패 → 호출 측이 `refund_credits(ledger_id, reason, null, 'refund:<ref>')`. 부분 성공(예: 3언어 중 1개 실패)은 실패분만 `p_amount`로 부분 환불 |

```ts
// packages/core-billing/credits
export interface ConsumeInput {
  orgId: string; amount: number; appId: string; reason: string
  ref?: { type: string; id: string }; idempotencyKey: string; actorId?: string; metadata?: Record<string, unknown>
}
export interface ConsumeResult { ledgerId: number; newBalance: number; planUsed: number; packUsed: number }
export class InsufficientCreditsError extends Error { readonly code = 'CR001'; constructor(public balance: number, public required: number) { super('insufficient_credits') } }

export interface CreditsApi {
  consume(input: ConsumeInput): Promise<ConsumeResult>                                  // rpc consume_credits
  grant(input: Omit<ConsumeInput, 'ref'> & { bucket: 'plan' | 'pack'; resetPlanBucket?: boolean }): Promise<{ ledgerId: number; newBalance: number }>
  refund(consumeLedgerId: number, reason: string, amount?: number, idempotencyKey?: string): Promise<{ ledgerId: number; newBalance: number }>
  // withCredits: consume → fn → 실패 시 refund. 동기 LLM/이미지 호출용 래퍼
  withCredits<T>(input: ConsumeInput, fn: (ledgerId: number) => Promise<T>): Promise<T>
  priceOf(appId: string, action: string, qty?: number): number                          // 제품 단가표(코드 상수)에서 조회
}
```

`priceOf`의 단가표는 제품 패키지가 주입한다. 코어는 단가를 알지 못한다.

## 5. toss

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 유료 플랜 제품 |
| 코어 SQL | `core.payment_orders`, `core.payments`, `core.billing_keys`, `core.billing_key_summaries`(`migrations/0002_core_billing.sql:66-181`, `:245-251`), `core.confirm_payment_order`(`migrations/0003_core_credits.sql:534-631`), `core.apply_subscription_transition`(`migrations/0002_core_billing.sql:265-341`), `core.expire_stale_payment_orders`(`:347-363`) |
| 금지 | 클라이언트가 보낸 amount를 믿는 것, orderId 파싱으로 org/plan 추출, `customerKey = Date.now()`(`docs/reference/00_MERGE_ANALYSIS.md:555`), 웹훅만으로 지급 |
| 실패/환불 | confirm 실패(`PM001`) → 별도 호출 `core.fail_payment_order`로 주문 failed 기록, 운영 알림, 사용자에게 "결제 확인 실패, 승인 취소 요청" 안내 후 서버가 Toss 취소 API 호출(제안). 정기결제 실패 → `past_due` → 재시도 1일/3일/7일(제안) → `canceled`. 환불 → Toss 취소 API → `payments` 갱신 → 크레딧 조정(`CORE_SPEC.md` 5.4) |

```ts
// packages/core-billing/toss
export interface CreateOrderInput { orgId: string; appId: string; kind: 'subscription' | 'credit_pack'; planId?: string; creditPackId?: string; createdBy: string }
export interface PaymentOrder { orderId: string; amountKrw: number; customerKey: string; expiresAt: string }

export interface TossApi {
  createOrder(input: CreateOrderInput): Promise<PaymentOrder>                 // 서버: plans/credit_packs 금액을 읽어 payment_orders INSERT
  confirm(orderId: string, paymentKey: string, amountKrw: number): Promise<Payment>  // 서버: Toss confirm API → rpc confirm_payment_order
  issueBillingKey(orgId: string, authKey: string): Promise<{ billingKeyId: string; cardMasked: string }> // 암호화 저장
  chargeBillingKey(subscriptionId: string): Promise<Payment>                 // 워커: 주문 생성 → 빌링키 승인 → confirm_payment_order
  cancelPayment(paymentKey: string, amountKrw: number, reason: string): Promise<Payment>
  transition(subscriptionId: string, to: 'active' | 'past_due' | 'canceled' | 'expired', reason?: string): Promise<Subscription>
}
```

`customerKey`는 `'org_' + orgId`로 고정한다(`migrations/0002_core_billing.sql:68`).

## 6. webhooks

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 웹훅 받는 제품 |
| 코어 SQL | `core.webhook_events`(`migrations/0002_core_billing.sql:187-201`) |
| 인바운드 | Toss(결제 상태), fal(이미지 완료), Make/n8n 콜백, (제안) YouTube/Meta 알림 |
| 아웃바운드 | 사용자 등록 웹훅 URL로 서명된 POST(`project.completed`, `pdf.exported` 같은 이벤트, `docs/reference/00_MERGE_ANALYSIS.md:149`). automation-core가 소유 |
| 실패 | 서명 실패 → 401 + `signature_valid=false, status='ignored'`. 중복 → 200. 처리 예외 → `status='failed', attempts+1, error` → 500으로 재전송 유도. 3회 실패 후 운영 알림(제안) |

```ts
// packages/core-billing/webhooks
export interface WebhookVerifier { provider: string; verify(req: { headers: Headers; rawBody: string }): { ok: boolean; eventId: string; eventType?: string } }
export async function receiveWebhook(verifier: WebhookVerifier, req: Request, handler: (payload: unknown, event: WebhookEvent) => Promise<void>): Promise<Response>
// receiveWebhook: rawBody 읽기 → verify → insert webhook_events (provider,event_id) unique → 충돌이면 200 → handler → processed/failed

// 아웃바운드 서명: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) 를 X-Signature, X-Timestamp 헤더로. 5분 이상 차이는 수신 측이 거부(제안).
export interface OutboundWebhook { url: string; secret: string; events: string[] }
export async function emit(hook: OutboundWebhook, event: { type: string; orgId: string; data: unknown }): Promise<void>
```

Toss 서명 검증 방식과 이벤트 고유 id 필드는 Toss 문서 기준으로 구현 시 확인한다(미확인). fal은 `request_id`를 event_id로 쓴다.

## 7. oauth

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / YouTube, Meta, TikTok, 네이버, 쿠팡 등 외부 연동 제품 |
| 코어 SQL | `core.oauth_states`, `create_oauth_state`, `consume_oauth_state`(`migrations/0004_core_security.sql:508-581`), `core.encrypted_credentials`, `credential_summaries`, `revoke_credential`(`:604-661`) |
| 암호화 | AES-256-GCM, 키는 환경변수 `CREDENTIALS_KEY_V<n>`(제안), 현재 버전 `CREDENTIALS_KEY_VERSION`. 키가 없으면 기동 실패. 0키 폴백 금지(`docs/reference/00_MERGE_ANALYSIS.md:621`) |
| 실패 | state 무효(`OA001`) → 400 "연결을 다시 시작하세요". 토큰 갱신 실패 → `status='error'`, `last_error`, 사용자 알림, 재연결 유도. 복호화 실패(키 버전 없음) → 500 + 운영 알림 |

```ts
// packages/core-auth/oauth
export interface OAuthProvider { id: string; authorizeUrl(params: { state: string; codeChallenge?: string; scopes: string[] }): string; exchange(code: string, codeVerifier?: string): Promise<TokenSet>; refresh(refreshToken: string): Promise<TokenSet> }
export async function beginOAuth(p: OAuthProvider, ctx: { userId: string; orgId: string; appId: string; redirectTo?: string }): Promise<string> // rpc create_oauth_state → authorizeUrl
export async function completeOAuth(p: OAuthProvider, state: string, code: string): Promise<{ credentialId: string }>              // rpc consume_oauth_state → exchange → encrypt → encrypted_credentials upsert

export interface CredentialVault {
  put(input: { orgId: string; appId: string; provider: string; externalAccountId: string; secret: unknown; scopes?: string[]; expiresAt?: string; label?: string }): Promise<string>
  get<T>(credentialId: string): Promise<T>            // 서버 전용. 복호화. 호출마다 audit 하지 않되 실패는 audit
  rotateAll(toVersion: number): Promise<{ rotated: number; failed: number }>
}
```

## 8. llm gateway

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core(기준 구현 `sellingstudio/lib/llm/openrouter.ts`) / 전 제품 |
| 2026-10-13 변경 | 이 절은 최초(2026-10-12) 설계의 이력이다. 라우터 본체는 FastAPI `ai-service`의 `llm/`로 옮겼고 상용(Claude, ChatGPT, Gemini, OpenRouter)과 오픈소스(vLLM) 이원화, `core.resolve_ai_route` 기반 대체 체인을 쓴다(`AI_ARCHITECTURE.md` 4절). `packages/core-ai/llm`의 TS 인터페이스는 `/api/ai/*` 호출용 얇은 래퍼로 남는다. 아래 "보강"의 OpenRouter 폴백은 새 대체 체인의 한 단계로 흡수된다 |
| 기준 구현에서 가져오는 것 | 용도별 모델 맵 `MODELS`(`openrouter.ts:3-8`), OpenRouter chat completions 호출과 `response_format: json_object`(`:15-46`) |
| 보강 | 제공자 라우팅(Anthropic 직접 + OpenRouter 폴백, `docs/reference/00_MERGE_ANALYSIS.md:164`), 사용자 노출은 "빠름/고품질" 2모드(`:164`), 호출마다 `ai_usage` 기록, 크레딧 선차감, 타임아웃과 재시도, 스트리밍, 모델 화이트리스트(`:868`) |
| 코어 SQL | `core.ai_usage`(`migrations/0003_core_credits.sql:80-98`), `consume_credits` |
| 금지 | 브라우저에서 제공자 직접 호출, 사용자 BYOK 키 평문 저장(`docs/reference/00_MERGE_ANALYSIS.md:163`), 장애를 mock 응답으로 숨기기(`:165`) |
| 실패/환불 | 제공자 오류 → 폴백 모델 1회 → 실패 시 `refund_credits` + `ai_usage.status='error'`. 폴백 성공은 `status='fallback'`. 타임아웃 기본 60초, 재시도 1회(제안) |

```ts
// packages/core-ai/llm
export type LlmPurpose = 'analyze' | 'copy' | 'vision' | 'naming' | 'script' | 'compliance' | 'translate' | string
export type LlmMode = 'fast' | 'quality'
export interface LlmRequest {
  orgId: string; appId: string; purpose: LlmPurpose; mode?: LlmMode
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> }>
  json?: boolean; temperature?: number; maxTokens?: number; credits: number; idempotencyKey: string; requestId?: string
}
export interface LlmResponse { text: string; model: string; provider: string; inputTokens: number; outputTokens: number; usageId: number; fallback: boolean }
export interface LlmGateway {
  complete(req: LlmRequest): Promise<LlmResponse>
  stream(req: LlmRequest): AsyncIterable<{ delta: string } | { done: LlmResponse }>
  resolveModel(purpose: LlmPurpose, mode: LlmMode): { primary: string; fallback?: string }   // 모델 맵은 환경/설정으로 교체 가능
}
```

모델 맵 기본값은 `openrouter.ts:3-8`의 네 가지를 출발점으로 하고 제품이 purpose를 추가한다. 크레딧 환산(토큰 → 크레딧)은 제품 단가표의 몫이다.

## 9. fal client

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core(기준 구현 `sellingstudio/lib/image/fal.ts`) / video(Track C/D 이미지), commerce(상세페이지 슬롯), toon, publishing(표지), astro(테마 이미지) |
| 기준 구현에서 가져오는 것 | 큐 제출 + `webhook_url`(`fal.ts:13-51`), 결과 조회(`:53-69`), 동기 호출(`:71-104`) |
| 보강 | 웹훅 수신을 `webhooks` 모듈로(서명 검증, 멱등), 결과 이미지를 Storage `org-files`로 복사(fal URL은 만료됨), `ai_usage` 기록, `enable_safety_checker` 기본값 true(기준 구현은 false, `fal.ts:24`, `:81`. 끄는 것은 제품 결정 사항) |
| 코어 SQL | `core.jobs`(fal request_id를 `payload.fal_request_id`로), `core.webhook_events`, `core.ai_usage` |
| 실패/환불 | 제출 실패 → 즉시 환불. 웹훅 `status != COMPLETED` 또는 30분 미도착(제안) → `fail_job` → 자동 환불. 안전 필터 거부는 재시도 불가 실패로 처리 |

```ts
// packages/core-ai/fal
export interface FalSubmit { orgId: string; appId: string; model: string; prompt: string; imageSize?: { width: number; height: number }; numImages?: number; safetyChecker?: boolean; jobId: string }
export interface FalClient {
  submit(input: FalSubmit): Promise<{ requestId: string }>              // queue.fal.run + webhook_url = /api/webhooks/fal
  poll(model: string, requestId: string): Promise<{ status: 'queued' | 'in_progress' | 'completed' | 'failed'; images?: Array<{ url: string; width: number; height: number }> }>
  generateSync(input: Omit<FalSubmit, 'jobId'>): Promise<Array<{ url: string }>>   // 짧은 작업 전용. 크레딧은 withCredits 로 감싼다
  persist(images: Array<{ url: string }>, path: { orgId: string; appId: string; entity: string }): Promise<string[]>  // Storage 경로 반환
}
```

fal 웹훅 서명 검증 방식은 fal 문서 기준으로 구현 시 확인한다(미확인). 확인 전에는 `request_id`가 우리가 제출한 잡의 것인지 대조하는 것만으로 처리한다.

## 10. weasyprint render service

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | flora-publishing / astro-ai(확정 결정 3, `docs/reference/00_MERGE_ANALYSIS.md:11`) |
| 형태 | FastAPI 컨테이너 1개(Railway). WeasyPrint + Noto CJK 폰트 + `url_fetcher` 제한(SSRF 차단)(`:108`, `:213`, `:334`, `:438`). Vercel/Route Handler에서 실행 금지(`:176`) |
| 입력 | 서버가 DB에서 읽은 원고로 조립한 HTML(sanitize 완료) + 판형 프리셋 + 출력 옵션. 클라이언트가 보낸 HTML을 직접 렌더하지 않는다 |
| 출력 | PDF를 Storage `exports/<org_id>/<app_id>/pdf/<uuid>.pdf`에 저장하고 경로 반환. 사용자는 서명 URL(7일)로 받는다 |
| 인증 | 내부 서비스 토큰(`X-Render-Token`, 환경변수) + 요청 본문에 `org_id`, `app_id`, `job_id`. 공개 인터넷에서 호출 불가(제안: Railway private network 또는 IP 허용 목록) |
| 코어 SQL | `core.jobs`(`job_type='render.pdf'`), Storage `exports` 정책(`migrations/0005_core_jobs_storage.sql:344-347`) |
| 실패/환불 | 렌더 예외 → `fail_job(retryable=false)` → 환불. 타임아웃 120초(제안). 폰트 누락은 배포 검증 항목(컨테이너 기동 시 Noto CJK 존재 확인) |
| 쪽번호/제책 | `@page` counter로 쪽번호, `:left/:right` 여백 비대칭은 프리셋에서(`docs/reference/00_MERGE_ANALYSIS.md:96`, `:111`) |

```ts
// 요청 계약 (HTTP POST /render/pdf)
export interface RenderPdfRequest {
  org_id: string; app_id: 'publishing' | 'astro'; job_id: string
  html: string                               // 서버가 조립·sanitize 한 HTML. 외부 URL 참조는 허용 목록(자체 Storage 공개 버킷)만
  preset: { page: 'A4' | 'A5' | 'A6' | 'B5' | 'B6' | 'custom'; width_mm?: number; height_mm?: number; margins_mm: { top: number; right: number; bottom: number; left: number; inner_extra?: number }; font_pt: number }
  options?: { watermark?: string; toc?: boolean; cover_image_path?: string }
}
export interface RenderPdfResponse { storage_path: string; pages: number; bytes: number; duration_ms: number }
```

astro-ai는 같은 계약으로 사주/타로 PDF를 렌더한다. 테마 미리보기도 이 서비스가 만든 PDF 첫 페이지 이미지를 쓴다(`docs/reference/00_MERGE_ANALYSIS.md:347`).

## 11. sns uploader

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | sceneflow / nomad-commerce(2단계, `docs/reference/00_MERGE_ANALYSIS.md:821`), nomad-blog(인스타 포스팅, `:642`), book-trailer(YouTube 업로드 P1, `D:/WorkSpace/platform/docs/products/book-trailer/02_ARCHITECTURE.md` 3절, TR-06-058) |
| 기준 자산 | Shorts Maker `lib/platforms/*`, `channels/oauth-manager.ts`, YSM `account_manager`(AES-GCM). 이식 전에 0키 폴백, state 결함, tsc 오류를 먼저 고친다(`:955`) |
| 플랫폼 | YouTube Data API v3(resumable 업로드), Instagram Reels/Threads(Meta Graph), TikTok Content Posting(`NOMAD Shorts Maker/PRD.md` 10-3), 네이버 클립(`naver_clip`, 확정 결정 18) |
| 네이버 클립 | 공식 업로드 API 미확인(2026-10-13 기준. 클립 크리에이터 PC 웹 업로드만 확인). Playwright로 사용자 네이버 계정에 로그인해 PC 웹에서 업로드한다. OAuth가 없으므로 `connect()`는 로그인 세션(쿠키)을 `encrypted_credentials`에 저장하는 흐름이고, 원본 `NOMAD Shorts Maker/src/skill/playwright-engine/naver-login.ts`를 재사용한다. 네이버 약관 위반·계정 정지 위험이 있어 owner/admin 위험 동의(고지문 버전 `clip-2026-10-v1`)가 없으면 업로드 잡을 만들지 않는다. 잡 `upload.naver_clip`. `pinComment`·`quota`는 지원하지 않음(capabilities로 표시), `fetchStats`는 PC 웹 화면 수집(제안). 공식 API가 확인되면 같은 `UploaderAdapter`로 교체한다 |
| 코어 SQL | `core.encrypted_credentials`(채널 토큰), `oauth_states`, `core.jobs`(`job_type='upload.<platform>'`), `rate_limit_hit` |
| 채널 한도 | 플랜 `features.max_channels`(`seed.sql:35`, `:55-57`)를 서버가 강제. 쿼터 초과 시 같은 언어 그룹의 대체 채널 선택(`docs/reference/00_MERGE_ANALYSIS.md:697`) |
| 실패/환불 | 업로드 실패 → 재시도 3회(`PRD.md` 10-4) → 최종 실패 시 환불(업로드 1크레딧/채널). 쿼터 초과 → 재시도 불가로 두지 않고 `run_after`를 다음 쿼터 리셋 시각(PT 자정)으로 미뤄 재큐잉(제안). 토큰 만료 → 갱신 1회 → 실패 시 `credentials.status='error'`, 잡 실패, 사용자 재연결 요청 |
| 대가성 문구 | affiliate 모듈의 `effective_disclosure`를 설명란 첫 줄과 고정 댓글에 삽입(확정 결정 12). 업로더는 `description`을 받기 전에 affiliate 모듈이 끼워 넣은 결과를 받는다. `naver_clip`은 `video_description` 문구를 제목 앞머리와 첫 번째 해시태그로 넣는다(`injectDisclosure(..., 'video_description', { target: 'title_hashtag' })`, 17장) |

```ts
// packages/sns-uploader
export type Platform = 'youtube' | 'instagram' | 'tiktok' | 'threads' | 'naver_clip'   // naver_clip: Playwright, 공식 API 미확인
export interface UploadInput {
  orgId: string; appId: string; platform: Platform; credentialId: string; channelRef: string
  media: { storagePath: string; mime: string; durationSec?: number }
  meta: { title: string; description: string; tags?: string[]; language: 'KO' | 'JA' | 'EN'; thumbnailPath?: string; scheduledAt?: string; visibility: 'public' | 'unlisted' | 'private'; paidPromotion?: boolean }
  pinnedComment?: string
}
export interface UploadResult { platformPostId: string; url: string; publishedAt?: string }
export interface UploaderAdapter {
  platform: Platform
  capabilities: { oauth: boolean; pinComment: boolean; quota: boolean; stats: boolean }   // naver_clip: 모두 false, stats만 제안
  connect(ctx: { userId: string; orgId: string; appId: string }): Promise<string>        // oauth.beginOAuth
  upload(input: UploadInput, onProgress: (pct: number) => void): Promise<UploadResult>   // resumable, 스트리밍(파일을 메모리에 통째로 올리지 않는다)
  pinComment(credentialId: string, postId: string, text: string): Promise<void>
  fetchStats(credentialId: string, postIds: string[]): Promise<Array<{ postId: string; views: number; likes: number }>>
  quota(credentialId: string): Promise<{ used: number; limit: number; resetsAt: string }>
}
export interface UploaderRegistry { get(platform: Platform): UploaderAdapter; pickChannel(orgId: string, language: 'KO' | 'JA' | 'EN', platform: Platform): Promise<string | null> }
```

`paidPromotion` 플래그 자동 설정은 제안 단계다(확정 결정 12). 기본값은 "사용자가 체크"이며 자동화는 결정 뒤 켠다.

## 12. automation-core

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / video, commerce, (blog). 노드는 각 제품이 등록(`docs/reference/00_MERGE_ANALYSIS.md:968`) |
| 원칙 | 서버 실행(브라우저 실행 금지), 엣지 연결 필수(`edges.length === 0`이면 실행 불가, `NOMAD Shorts Maker/CLAUDE.md` 구현 원칙 8), 위상 정렬(v1 설계), 노드 레지스트리(CM 구조)(`00_MERGE_ANALYSIS.md:968`) |
| 브릿지 | n8n/Make 콜백과 HMAC emit(`:959`, `:835`). 전역 n8n 키 프록시는 폐기(`:140`). 사용자 웹훅 URL 등록 → 서명 POST 하나로 통일(`:139`) |
| 코어 SQL | `core.jobs`: 플로우 실행 1건 = 부모 잡, 노드 1개 = 자식 잡(`parent_job_id`, `migrations/0005_core_jobs_storage.sql:37`) |
| 크레딧 | 노드마다 `estimateCredits(input)`. 실행 시작 시 합계를 미리 보여 주고(`NOMAD Shorts Maker/DESIGN.md` 5-6 "예상 크레딧"), 차감은 노드 시작 시 노드 단위로. 노드 실패 → 그 노드만 환불(`fail_job` 자동), 하류 노드는 canceled |
| 실패 | 사이클 감지 → 실행 거부(409). 노드 타입 미등록 → 거부. 플로우 저장은 제품 테이블(`workflows`)에 |

```ts
// packages/automation-core
export interface NodeDefinition<I = unknown, O = unknown> {
  type: string; appId: string; label: string
  inputSchema: ZodSchema<I>; outputSchema: ZodSchema<O>
  estimateCredits(input: I): number
  run(ctx: { orgId: string; appId: string; jobId: string; heartbeat(pct: number, msg?: string): Promise<void> }, input: I): Promise<O>
}
export interface FlowGraph { nodes: Array<{ id: string; type: string; data: unknown }>; edges: Array<{ source: string; target: string }> }
export interface FlowRunner {
  register(def: NodeDefinition): void
  validate(graph: FlowGraph): { ok: true; order: string[] } | { ok: false; errors: string[] }   // 위상 정렬, 엣지 필수, 타입 존재
  estimate(graph: FlowGraph): { total: number; perNode: Record<string, number> }
  start(graph: FlowGraph, ctx: { orgId: string; appId: string; userId: string; idempotencyKey: string }): Promise<{ parentJobId: string }>
}
```

## 13. compliance

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / video(업로드 게이트), commerce(상세페이지 금지어), blog(발행 전) |
| 두 단계 | 1) 규칙 사전(commerce 금지어, 한글 경계 처리. `\b`는 한글에 안 맞음, `docs/reference/00_MERGE_ANALYSIS.md:796`) 2) LLM 판정 PASS/WARN/FAIL(video Compliance Filter, `NOMAD Shorts Maker/PRD.md` 9-4) → 공용 모듈로 합침(`00_MERGE_ANALYSIS.md:973`) |
| 게이트 규칙 | FAIL → 발행 차단 + 수정 가이드. WARN → 사용자 확인 후 진행(확인 기록을 audit). PASS → 진행(`NOMAD Shorts Maker/CLAUDE.md` 구현 원칙 5) |
| 규칙 사전 위치 | 코어 SQL에 테이블이 없다. 제안: 패키지 안 버전 관리 JSON(플랫폼 공통) + 제품 스키마의 `banned_words` 테이블(조직/제품 추가분, `00_MERGE_ANALYSIS.md:796`) |
| 비용 | LLM 판정 1크레딧(`NOMAD Shorts Maker/PRD.md` 13장). 규칙 단계는 무료 |
| 실패 | LLM 오류 → 규칙 단계 결과만으로 WARN 처리하고 "AI 검증 실패" 표시. PASS로 통과시키지 않는다 |
| 제품 자체 문구 | 제품 마케팅 문구의 가상 후기, 허위 수치 금지는 01_PRD 법/개인정보 절의 몫이며 이 모듈이 검사하는 대상이 아니다 |

```ts
// packages/core-ai/compliance
export type Verdict = 'pass' | 'warn' | 'fail'
export interface ComplianceInput { orgId: string; appId: string; platform?: 'youtube' | 'instagram' | 'tiktok' | 'threads' | 'coupang' | 'smartstore' | 'naver_blog' | 'tistory' | 'wordpress'; text: string; title?: string; tags?: string[]; context?: Record<string, unknown> }
export interface ComplianceResult { verdict: Verdict; issues: Array<{ stage: 'rules' | 'llm'; code: string; message: string; span?: [number, number] }>; suggestions: string[]; usageId?: number }
export interface ComplianceChecker {
  checkRules(input: ComplianceInput): ComplianceResult                 // 동기, 무료
  check(input: ComplianceInput & { credits: number; idempotencyKey: string }): Promise<ComplianceResult>  // rules → llm
}
```

## 14. storage

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 전 제품 |
| 코어 SQL | 버킷 `org-files`, `exports`, `public-assets`와 정책(`migrations/0005_core_jobs_storage.sql:322-362`), `core.storage_org_id`(`:308-320`) |
| 경로 | `<org_id>/<app_id>/<entity>/<uuid>.<ext>` |
| 업로드 | 브라우저는 `org-files`/`public-assets`의 자기 조직 폴더에 직접 업로드(RLS). 큰 파일은 서명 업로드 URL(제안). `exports`는 서버만 |
| 다운로드 | 비공개 버킷은 서명 URL. 기본 1시간, exports 7일 |
| 검증 | 서버가 MIME과 크기를 다시 검사한다(`docs/reference/00_MERGE_ANALYSIS.md:223`). 원고 업로드 20MB 상한(`:126`)은 제품 값 |
| 실패 | 경로 첫 세그먼트가 uuid가 아니면 정책이 거부(`storage_org_id` null) |

```ts
// packages/core-jobs/storage
export function orgPath(p: { orgId: string; appId: string; entity: string; ext: string }): string
export interface StorageApi {
  signedUploadUrl(bucket: 'org-files' | 'public-assets', path: string): Promise<{ url: string; token: string }>
  signedDownloadUrl(bucket: 'org-files' | 'exports', path: string, ttlSec?: number): Promise<string>
  putFromServer(bucket: 'exports' | 'org-files', path: string, body: Buffer | ReadableStream, mime: string): Promise<void>   // service_role
  remove(bucket: string, paths: string[]): Promise<void>
}
```

## 15. audit

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 전 제품 |
| 코어 SQL | `core.audit_log`, `core.write_audit`(`migrations/0004_core_security.sql:236-307`) |
| 기록 대상 | `CORE_SPEC.md` 11장 목록 + 제품 관리자 화면의 모든 쓰기 |
| 실패 | 감사 기록 실패는 원 작업을 롤백한다(같은 트랜잭션). 코어 함수는 이미 그렇게 동작한다 |

```ts
// packages/core-auth/audit
export interface AuditEntry { orgId: string | null; action: string; target?: { type: string; id: string }; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }
export async function auditAsUser(entry: AuditEntry): Promise<number>     // rpc write_audit (사용자 세션)
export async function auditAsService(entry: AuditEntry & { actorId?: string; ip?: string; userAgent?: string; requestId?: string }): Promise<number>  // service_role INSERT
```

## 16. jobs

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 비동기 작업 제품 전부 |
| 코어 SQL | `core.jobs`와 RPC 8개(`migrations/0005_core_jobs_storage.sql:14-291`) |
| 워커 | TS 워커 루프와 Python 워커(supabase-py, service_role)가 같은 RPC를 쓴다. BullMQ FlowProducer를 쓰는 video 파이프라인도 상태를 `core.jobs`에 미러링한다(`:10`) |
| Realtime | 클라이언트는 `core.jobs` 변경 구독(`:293-301`). 채널 이름 `<app>:<org>:jobs`(`ARCHITECTURE.md:77`) |
| 실패/환불 | `fail_job` 자동 환불, `cancel_job` 환불. 재시도 지수 백오프. `reap_stale_jobs` 10분 |

```ts
// packages/core-jobs
export interface Job<P = unknown, R = unknown> { id: string; orgId: string; appId: string; queue: string; jobType: string; payload: P; result: R | null; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'; attempts: number; maxAttempts: number; progress: number; creditLedgerId: number | null }
export interface JobsApi {
  enqueue<P>(input: { orgId: string; appId: string; queue: string; jobType: string; payload: P; priority?: number; runAfter?: Date; maxAttempts?: number; creditLedgerId?: number; idempotencyKey: string; parentJobId?: string; createdBy?: string; refundOnFailure?: boolean }): Promise<Job<P>>
  cancel(jobId: string): Promise<Job>   // 사용자 세션 rpc cancel_job
}
export interface WorkerHandler<P, R> { jobType: string; run(job: Job<P>, ctx: { heartbeat(pct?: number, msg?: string): Promise<boolean>; signal: AbortSignal }): Promise<R> }
export interface WorkerOptions { queue: string; workerId: string; concurrency: number; pollMs: number; handlers: WorkerHandler<unknown, unknown>[] }
export function runWorker(opts: WorkerOptions): Promise<never>   // claim_jobs → run → complete_job | fail_job. heartbeat false 반환이면 취소 신호로 AbortSignal 발화
```

Python 쪽은 같은 RPC를 `supabase.rpc('claim_jobs', {...})`로 호출한다. 큐 이름을 TS와 분리해(`video.media.*`) 두 런타임이 같은 잡을 집지 않게 한다(`docs/reference/00_MERGE_ANALYSIS.md:717`).

## 17. affiliate

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / sceneflow, nomad-blog(확정 결정 12). 브랜드커넥트 어댑터와 Playwright 지원 플로우는 blog가 소유. video는 클립형 캠페인 지원을 cross-app 잡으로 요청한다(확정 결정 19) |
| 코어 SQL | `core.affiliate_accounts`, `affiliate_links`, `affiliate_clicks`, `affiliate_disclosures`, `brandconnect_applications`(`migrations/0006_core_affiliate.sql:24-211`), 함수 `new_affiliate_short_code`, `record_affiliate_click`, `effective_disclosure`, `upsert_affiliate_disclosure`, `consent_brandconnect_risk`, `create_brandconnect_application`(`:218-377`) |
| 제공자 | coupang(쿠팡파트너스 API), naver_brandconnect(Playwright, blog 소유), tenping(미확인), naver_shopping_connect(미확인). 공개 API가 없으면 Playwright 또는 수동 링크 등록 |
| 키 보관 | 제공자 API 키/세션 쿠키는 `encrypted_credentials`에, `affiliate_accounts.credential_id`로 연결(`:30`) |
| 단축 링크 | `/r/[code]` Route Handler가 service_role로 `record_affiliate_click` 호출 → 302. 레이트 리밋 키 `affiliate:r:<ip_hash>`(제안). 봇 UA는 기록만 하고 집계에서 제외(제안) |
| UTM | `utm_source=<source_app>`, `utm_medium=affiliate`, `utm_campaign=<source_ref>`, `utm_content=<provider>`를 `utm` jsonb에 저장하고 제휴 URL에 붙인다(제안). 제공자가 쿼리 파라미터를 보존하지 않으면 생략 |
| 대가성 문구 | `effective_disclosure(org, provider, placement)`로 가져와 blog는 본문 최상단(blog_top), video는 설명란 첫 줄(video_description)과 고정 댓글(video_pinned_comment)에 삽입. 네이버 클립은 `video_description` 문구를 제목 앞머리 + 첫 번째 해시태그로 넣는다(영상은 제목·영상 내·첫 해시태그 표시). 끌 수 없고 편집만 가능(`upsert_affiliate_disclosure`, owner/admin). 근거: 공정위 "추천·보증 등에 관한 표시·광고 심사지침"은 표시를 제목 또는 본문 시작 부분에 두도록 한다 |
| 브랜드커넥트 | 위험 동의(`consent_brandconnect_risk`, owner/admin) 없으면 지원서 생성 불가. 지원서는 `core.jobs` `job_type='brandconnect.apply'`로 워커(Playwright)가 제출. 상태 전이는 트리거가 강제(`:189-211`). 계정당 지원 레이트 리밋(제안: 시간당 5건, blog·video 합산). 지원서 대상은 `targetKind`로 나눈다: 블로그형(`blog`, blog가 생성) / 클립형(`clip`, video가 생성, `target_url`=클립 채널 주소). video가 만든 잡도 payload `{ applicationId, sourceApp: 'video' }`로 같은 워커가 blog 어댑터로 처리한다(cross-app 잡, 확정 결정 19) |
| 실패/환불 | 링크 생성 실패(제공자 오류) → 제품 작업은 링크 없이 진행하되 대가성 문구는 삽입하지 않음(링크가 없으면 대가성 관계가 없으므로). 브랜드커넥트 제출 실패 → `failed` → 재시도는 사용자가 명시적으로. 크레딧은 쓰지 않는다(제안: 제휴 기능은 플랜 기능 플래그 `features.affiliate`로 게이팅) |
| 제안 단계 | YouTube 유료 프로모션 플래그 자동 설정(확정 아님) |

```ts
// packages/core-affiliate
export type AffiliateProvider = 'coupang' | 'naver_brandconnect' | 'tenping' | 'naver_shopping_connect'
export type Placement = 'blog_top' | 'video_description' | 'video_pinned_comment'
export type BrandconnectTargetKind = 'blog' | 'clip'                 // blog↔sourceApp 'blog', clip↔sourceApp 'video' (DB CHECK)
export type BrandconnectCampaignType = 'blog' | 'clip' | 'shopping_connect' | 'unknown'   // 스캔 결과 분류(nomad-blog BL-F-032)

export interface AffiliateProduct { externalId: string; name: string; price?: number; imageUrl?: string; productUrl: string; category?: string }
export interface AffiliateAdapter {
  provider: AffiliateProvider
  capabilities: { searchProducts: boolean; createLink: boolean; fetchStats: boolean; applyCampaign: boolean }   // tenping/naver_shopping_connect 는 구현 시 확정
  searchProducts(accountId: string, query: string, opts?: { limit?: number }): Promise<AffiliateProduct[]>
  createLink(accountId: string, product: AffiliateProduct, utm: Record<string, string>): Promise<{ affiliateUrl: string }>
  fetchStats(accountId: string, range: { from: string; to: string }): Promise<Array<{ date: string; clicks: number; orders?: number; commission?: number }>>
  applyCampaign?(accountId: string, application: { campaignId: string; targetUrl: string; targetKind: BrandconnectTargetKind; message?: string }): Promise<{ externalId?: string }>  // brandconnect 전용, Playwright, blog 소유(video는 잡으로 요청)
}

export interface AffiliateApi {
  connectAccount(input: { orgId: string; provider: AffiliateProvider; partnerId?: string; credentialId?: string; label?: string }): Promise<string>   // service_role INSERT affiliate_accounts
  createShortLink(input: { orgId: string; accountId: string; provider: AffiliateProvider; sourceApp: 'video' | 'blog'; sourceRef: string; product: AffiliateProduct }): Promise<{ linkId: string; shortCode: string; shortUrl: string; affiliateUrl: string }>
  disclosure(orgId: string, provider: AffiliateProvider, placement: Placement): Promise<string>        // rpc effective_disclosure
  injectDisclosure(content: string, disclosure: string, placement: Placement, opts?: { target?: 'body' | 'title_hashtag' }): string   // blog_top: 본문 맨 앞 단락. video_description: 첫 줄. title_hashtag: 제목 앞머리 + 첫 해시태그(naver_clip)
  resolveClick(shortCode: string, req: { referrer?: string; ipHash?: string; userAgent?: string; country?: string }): Promise<string | null>  // rpc record_affiliate_click
  consentBrandconnectRisk(accountId: string): Promise<void>
  createBrandconnectApplication(input: { accountId: string; campaignId: string; targetUrl: string; targetKind: BrandconnectTargetKind; sourceApp: 'blog' | 'video'; brandName?: string; productName?: string; category?: string; message?: string }): Promise<string>   // rpc create_brandconnect_application
}
```

`ip_hash`는 `sha256(daily_salt + ip)`로 만들고 원문 IP는 저장하지 않는다(`migrations/0006_core_affiliate.sql:88`). 일 단위 솔트는 환경변수 시드 + 날짜로 파생한다(제안).

## 18. 제품이 지킬 공통 규칙

| 규칙 | 내용 |
|---|---|
| 재정의 금지 | 위 모듈(1장 표 전체, AI 계층 포함)을 제품 폴더에서 다시 만들지 않는다. 필요 기능이 없으면 `_platform-core`에 요청 작업으로 남긴다 |
| 서버 경계 | service_role 키는 서버 코드에만. 크레딧 RPC, 잡 RPC, 자격증명 복호화는 Route Handler/워커에서만 |
| 멱등 키 | 클라이언트가 요청마다 UUID `request_id`를 보내고 서버가 `consume:<app>:<request_id>`, `job:<app>:<request_id>`로 쓴다 |
| 실패 표시 | 장애를 mock 응답으로 숨기지 않는다(`docs/reference/00_MERGE_ANALYSIS.md:165`). 사용자에게 실패와 환불 여부를 보여 준다 |
| 문서화 | 제품 `02_ARCHITECTURE.md` 모듈 경계 절에 "어느 공용 모듈을 어떤 용도로 쓰는지" 표를 적는다 |

## 19. AI 계층 모듈 (2026-10-13 추가)

상세 설계는 아래 정본 문서에 있다. 이 장은 소유·소비·경계·실패 동작만 요약하고 내용을 복제하지 않는다. 제품은 참조만 하고 재정의하지 않는다.

| 모듈 | 소유 / 소비 | 인터페이스 요약 | 코어 SQL | 실패·환불 | 정본 |
|---|---|---|---|---|---|
| ai-gateway | _platform-core / 전 제품 | Next.js `/api/ai/chat`, `/api/ai/rag/*`, `/api/ai/wiki/*`, `/api/ai/graphs/*`. 인증, 엔타이틀먼트, 대화 매핑 기록, 크레딧 선차감과 정산, EdDSA 서명 토큰 발급, Dify·FastAPI 중계 | `ai_conversations`, `ai_messages`, `ai_usage`, `consume_credits`, `refund_credits` | 선차감 부족은 `CR001`. 실행 실패는 선차감 전액 `refund_credits`, 성공은 실제 사용량으로 정산(`ai_usage.settled_at`). 장애를 mock 응답으로 숨기지 않는다 | `AI_ARCHITECTURE.md` 1, 2, 7장 |
| ai-service | _platform-core / ai-gateway, Dify | FastAPI `llm/`(라우터), `rag/`, `wiki/`, `graphs/`, `tools/`, `compliance/`. EdDSA 서명 토큰(공개키 검증) 또는 Dify 내부 키 + 대화 매핑만 신뢰 | `ai_providers`, `ai_model_prices`, `ai_routing_settings`, `ai_collections`, `ai_documents`, `ai_chunks`, `ai_runs`, `ai_run_steps`, `match_ai_chunks`, `resolve_ai_route`, `set_ai_routing`, `ai_filter_chain`, 스키마 `ai_runtime` | 제공자 오류는 체인의 다음으로 대체하고 `ai_usage.status='fallback'`. 모두 실패면 `error` + 환불. 강제 오픈소스 범위와 국외 이전 동의(`AI002`)가 없는 조직은 상용(국외)으로 대체하지 않음. hms는 전용 `hms-llm`, `hms-embed` 사용 | `AI_ARCHITECTURE.md` 4, 5, 6, 8장 |
| dify | _platform-core(공용 자체 호스팅 1개) / ai-gateway | 제품별 Chatflow 앱. 토큰을 넘기지 않고 대화 매핑을 쓴다: Dify `user`=서버가 만든 `dify_user`, 입력 변수 `platform_conversation_id`, HTTP 요청 노드가 내부 키로 FastAPI `/tools/*` 호출 | 없음. 대화 id만 `ai_conversations.dify_conversation_id`에 연결 | Dify 장애 시 ai-gateway가 FastAPI `/tools/answer-direct`를 서명 토큰으로 직접 호출. Dify DB는 조직 데이터 저장소로 관리하고 조직 판단은 Dify에 두지 않는다. hms는 공용 Dify를 쓰지 않는다 | `AI_ARCHITECTURE.md` 3장, `D:/WorkSpace/platform/docs/develop/_shared/dify/README.md` |
| core-voice | _platform-core / 전 제품 | `VoiceAdapter.stt/tts` 하나의 인터페이스에 `elevenlabs`, `oss-voice` 구현 2개. Next.js `/api/voice/*` | `voice_sessions`, `voice_jobs`, `expire_voice_audio`, 버킷 `voice-audio`, `ai_usage`(kind `stt`, `tts`) | 체인 다음 제공자로 대체하고 `voice_jobs.fallback_from` 기록. 국외(ElevenLabs) 대체는 조직 동의가 있을 때만. 같은 목소리 연속 기능은 대체 없이 실패 + 환불. hms는 전용 `hms-voice` 서버만 사용 | `VOICE_ARCHITECTURE.md`, `D:/WorkSpace/platform/docs/develop/_shared/voice/README.md` |
| llm-wiki | _platform-core / 전 제품, 개발 환경 | 제품 위키는 FastAPI `wiki/`(ingest, compile, query, lint), 개발 위키는 스킬 `.claude/skills/llm-wiki/` | `wiki_pages`, `wiki_links`, `wiki_revisions`(수정·삭제 불가, `purge_wiki_page`만 예외) | 위키가 원본과 충돌하면 원본이 정본. ingest 실패는 잡 재시도 후 `failed`, 사용량만큼만 차감 | `LLM_WIKI.md`, 베이스 `.claude/skills/llm-wiki/SKILL.md` |

공통 규칙: 브라우저에서 Dify, FastAPI, LLM, 음성 제공자를 직접 호출하지 않는다. 서명 토큰은 EdDSA다. 개인키 `AI_TOKEN_PRIVATE_KEY`는 제품 Next.js만, FastAPI·음성 서버는 공개키(`AI_TOKEN_JWKS_URL`)만 갖는다(`SECURITY_BASELINE.md` 16장).


## 20. auth providers: 로그인 단계 (2026-10-14 추가, 확정 결정 22)

| 항목 | 내용 |
|---|---|
| 소유 / 소비 | _platform-core / 전 제품(제품 앱 안 위치는 `src/lib/auth/`) |
| 정본 | `AUTH_ROADMAP.md`(단계, 게이트, 가드, 콜백, 페르소나, 제품 매트릭스) |
| 코어 SQL | 변경 없음(`profiles`, `handle_new_user`, `bootstrap_app_for_org`, `session_context`). 네이버 브리지 경로를 택할 때만 `staged/0010_core_auth_identity_links.sql` |
| 실패 동작 | `AUTH_MODE=mock`인데 원격 Supabase를 가리키거나 배포 플랫폼이면 기동 실패. live 모드에서 로그인 수단 0개면 기동 실패. 콜백 실패는 `/login?error=callback`(토큰·코드 로그 금지) |

```ts
// packages/core-auth/providers — 계약 예시(구현 파일 아님)
export type AuthMode = 'mock' | 'live'
export type LoginProvider = 'google' | 'kakao' | 'naver' | 'email'
export function getAuthConfig(): { mode: AuthMode; providers: LoginProvider[]; naverPath?: 'supabase_custom' | 'bridge' }
export function isMockAuthAllowed(): boolean        // AUTH_MODE=mock && Supabase 호스트가 루프백 && VERCEL_ENV·RAILWAY_ENVIRONMENT 없음
export function listLoginOptions(appId: string): Array<{ kind: 'mock'; personas: Array<{ key: string; label: string }> } | { kind: 'oauth'; provider: 'google' | 'kakao' | 'naver' } | { kind: 'email' }>
export async function finishLogin(appId: string, next: string | null): Promise<string>  // session_context → (OAuth 첫 로그인) bootstrap_app_for_org → 상태 분기 → next 화이트리스트
```

| 단계 | 제품이 쓰는 경로 |
|---|---|
| A | `POST /api/dev/login { persona }`(로컬 전용, 판정이 거짓이면 404), `scripts/dev/seed-users.mjs --app <app_id>` |
| B | `signInWithOAuth({ provider: 'google' })` → `/auth/callback`(`finishLogin`) |
| C1 | `signInWithOAuth({ provider: 'kakao' })` → 같은 콜백 |
| C2 | `signInWithOAuth({ provider: 'custom:naver' })` → 같은 콜백, 또는 브리지 `/auth/naver/start`·`/auth/naver/callback` |


## 21. 공용 비즈니스 모듈 후보 (2026-10-15 제안, 미채택)

리드·폼·퍼널(funnel), 알림(notify), Dify 공용 챗봇 위젯(chat-widget), 구글 시트 연동(sheets-sync), 분석(analytics), CRM, 운영 콘솔, 문의함, LMS, 예약·자원, 실험·쿠폰, 콘텐츠 블록 후보와 우선순위·DB 번호 범위(0100~0999)·로드맵은 `COMMON_MODULES_ROADMAP.md`에 있다. 채택 전에는 이 문서의 1~20장만 규격이다. 로그인 공용 모듈의 구현·전체 적용 절차는 `D:/WorkSpace/platform/docs/develop/_shared/auth/README.md`.
