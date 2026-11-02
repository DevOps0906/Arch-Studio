# 04 API: Arch Studio (arch-studio)

작성일 2026-10-16. 약칭: PRD = `docs/file/02-요구사항/01_PRD.md`, CS = `docs/file/03-설계/공용코어/CORE_SPEC.md`, SM = `docs/file/03-설계/공용코어/SHARED_MODULES.md`, AA = `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md`, TG = `D:/WorkSpace/platform/docs/Tauri/README.md`. 테이블·RPC·잡 타입·오류 코드 이름은 `05_DATA_MODEL.md`와 같고, DB 함수의 정본은 05장과 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/2400_arch.sql`이다. 코어 RPC는 CS를 인용만 한다. 코드 블록은 계약 예시다. 호출자는 웹 화면(마케팅·계정, 쿠키), 웹 스튜디오(Vite SPA, Bearer, D-071a), 데스크톱(Tauri 셸, Bearer) 셋이고, 도면 생성·판정·매스 제안은 로컬 엔진이라 계약을 4.7절에 따로 둔다.

## 1. 원칙

| 항목 | 규칙 | 근거 |
|---|---|---|
| 인증 | 모든 Route Handler 첫 줄 `const ctx = await requireSession('arch', { roles? })`. 웹 화면(W)은 쿠키, 데스크톱(D)·웹 스튜디오(S, D-071a)는 `Authorization: Bearer <Supabase access_token>`. Bearer 검증은 코어 요청 T-C1(같은 `SessionContext` 반환)이 반영된 뒤에 열고, 그 전까지 데스크톱은 Supabase 직접 조회 범위(RLS)만 쓴다. 미로그인 401, pending/suspended 403, `entitled=false` 402. 조직은 세션에서만 얻고 본문의 `org_id`는 받지 않는다(zod에 없음) | `docs/file/03-설계/공용코어/SHARED_MODULES.md:80`, `D:/WorkSpace/platform/docs/Tauri/README.md:136`, `D:/WorkSpace/platform/docs/Tauri/README.md:372` |
| `entitled=false` 402의 예외 (추가 2026-10-28) | 만료·좌석 미배정·회수 사용자도 **데이터 회수 경로는 열어 둔다**. 허용(402 아님): `GET /api/entitlement`, `GET /api/cloud-projects`, `GET /api/cloud-projects/{project_uuid}/blob`(서명 URL 발급), 전체 프로젝트 일괄 내려받기 `GET /api/cloud-projects/export.zip`(MVP 포함 승인 2026-10-28, 2.1절), 로컬 내보내기. 차단(402): `POST /api/cloud-projects`, `POST /api/uploads/sign`, AI·검토·규칙 팩·좌석 외 쓰기. 402 본문은 `details: { reason: 'expired' \| 'seat_unassigned' \| 'seat_revoked' \| 'no_product' \| 'fallback', can_download: true }`(크레딧 402의 `required/balance`와 구분). `fallback` = 영구 업데이트 만료 폴백 상태에서 해당 권리가 없을 때(예: 웹 편집·클라우드 검토). 판정은 아래 "라우트별 필요 권리" 표의 right 하나만 본다(고정 순위 없음, `ADR-001` 4.7절 합성값). 구현은 해당 GET에서 `requireSession`이 `entitled=false`를 거절하지 않는 옵션이 필요하며 코어 요청 필요 여부 `미확인`. 쓰기 RPC의 DB 권리 검사 실패는 `AR044`(7.1절)로 올라오며 Route Handler가 이 402로 매핑한다. 보존 기한이 지난 사본은 404. 영구 폴백 조직(`fallback`)은 보존 기한이 없어 사본을 계속 열람·내려받는다(확정 D-H5 ①) | `ADR-001` 3.1·3.3·4.7 |
| 공개 예외 | `POST /api/webhooks/toss`(서명), `POST /api/samples/download-event`(익명, 레이트 리밋), `GET /auth/callback`, `POST /api/dev/login`(Stage A 로컬 전용) | `docs/file/03-설계/공용코어/AUTH_ROADMAP.md:364` |
| 순서 | 인증 → zod → 레이트 리밋(`core.rate_limit_hit`) → 기능 판정(`arch.org_features`) → 서버 variant 결정(단가 표는 `apps/web/src/server/ai/pricing.ts` 상수와 seed가 같은 값) → service_role RPC(검사·선차감·enqueue 한 트랜잭션) → 202 | `docs/file/03-설계/공용코어/CORE_SPEC.md:181-188` |
| 금액·크레딧 | 데스크톱은 금액·크레딧 수를 보내지 않는다. 요청은 "작업 종류 + 입력"뿐이고 단가는 서버 상수(PRD 4.5절, 9.4절)에서 정한다. 결제 금액도 서버가 `license_skus`·`plans`·`credit_packs`에서 읽는다 | `D:/WorkSpace/platform/docs/Tauri/README.md:173`, `docs/file/02-요구사항/01_PRD.md 4.9절` |
| 선차감 위치 | AI 작업은 `arch.start_ai_run`(service_role) 안에서만 차감한다. Route Handler가 `core.consume_credits`를 따로 부르는 경로는 동기 채팅 턴(`withCredits`)과 STT(`voice:<request_id>`)뿐이다. 사용자용 RPC 안에서는 차감하지 않는다 | `docs/file/03-설계/공용코어/DB_CONVENTIONS.md:243`, `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:125` |
| 멱등 | 유료·비동기 요청은 본문 `request_id`(UUID v4) 필수. 차감 `consume:arch:<request_id>`, 잡 `job:arch:<request_id>`, 채팅 `conv:<id>:turn:<n>`, 음성 `voice:<request_id>`. 같은 `request_id` 재전송은 기존 실행을 돌려준다(추가 차감 없음). 라이선스 발급·연장은 주문 id로 멱등, 활성화는 `(license, device_hash)`, 플랜 활성화는 `(org, device_hash)`로 멱등 | `docs/file/03-설계/공용코어/CORE_SPEC.md:198` |
| 환불 | 결과가 전달되지 않은 실패는 전액 환불(잡 `fail_job` 자동 환불 → `arch.fail_ai_run`). STT는 실제 길이로 정산 | `docs/file/02-요구사항/01_PRD.md 4.9절`, `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:129` |
| 응답 봉투 | 성공 `{ ok: true, data }`, 실패 `{ ok: false, error: { code, message, details? } }`. 402는 `details: { required, balance }`. 예외 원문·스택·SQL 문구를 내보내지 않는다 | 제안(`D:/WorkSpace/platform/docs/products/nomad-docs/04_API.md:15`와 같은 형식) |
| 진행 상황 | `GET /api/jobs/{id}` 폴링(3초, 제안) 또는 Realtime(`core.jobs`, RLS). 가짜 진행률 금지 | `docs/file/03-설계/공용코어/CORE_SPEC.md:312` |
| 레이트 리밋 | 활성화 API IP당 10회/시간, 렌더 API 조직당 20회/분, 채팅 사용자당 20회/60초(PRD 5장). 그 밖의 생성 API 조직당 60회/분, 로그인 IP당 10회/10분, 웹훅 제공자당 600회/분(코어 기준). 키 `arch:<route>:<org_id 또는 ip_hash>` | `docs/file/02-요구사항/01_PRD.md 5절`, `docs/file/03-설계/공용코어/SECURITY_BASELINE.md:147-149` |
| CORS | 데스크톱 셸 출처(+ 스튜디오 출처 1개, 바로 위 행)만 허용 목록에 둔다: Windows `http://tauri.localhost`, macOS(Phase 2) `tauri://localhost`(구현 시 확인). 와일드카드 금지, `Access-Control-Allow-Credentials` 없음(D·S는 쿠키를 쓰지 않음, D-071a), 허용 헤더 `Authorization`, `Content-Type`. 웹훅·`/auth/*`·`/api/dev/login`은 CORS를 열지 않는다. 규격은 코어 요청 T-C2 | `D:/WorkSpace/platform/docs/Tauri/README.md:137`, `D:/WorkSpace/platform/docs/Tauri/README.md:373` |
| 업로드 | 큰 파일(클라우드 사본, 렌더 입력, 제안서 도면 SVG, 상담 녹음)은 `POST /api/uploads/sign`으로 서명 업로드 URL을 받아 플랫폼 어댑터가 업로드한다: 데스크톱(D)은 Rust 스트리밍, 웹 스튜디오(S)는 브라우저가 서명 URL로 직접 PUT(서버 경유 없음). 경로는 서버가 만들고(`<org_id>/arch/<purpose>/<uuid>.<ext>`), 사용 시점에 서버가 크기·MIME·매직바이트·조직 폴더를 다시 검사한다 | `D:/WorkSpace/platform/docs/Tauri/README.md:175` |
| 웹 스튜디오 인증 (추가 2026-10-28) | `app.` 서브도메인의 스튜디오 호출자 = S. SPA(`app.`)와 API(Next `apps/web`)는 다른 출처이며 인증은 `Authorization: Bearer`만(메모리 보관, 쿠키+CSRF 경로 없음, D-071a). 조직은 세션에서만 얻고, CORS는 스튜디오 출처 1개만 허용 목록에 추가(`Allow-Credentials` 없음). 업로드 MIME·크기는 데스크톱과 동일 상한 | `ADR-001_DELIVERY_AND_LICENSING.md` 5장 |
| 로그 | 시리얼 원문, 라이선스 파일, 토큰, 도면·모델 좌표, 렌더 입력, 녹음, 프롬프트 전문을 로그에 남기지 않는다 | `docs/file/02-요구사항/01_PRD.md 5절`, `docs/file/02-요구사항/01_PRD.md 9.5절` |
| DB 강제 (추가 2026-10-28) | Route Handler의 권리 검사는 1차 방어일 뿐이다. 쓰기 RPC(`save_cloud_project`·`upsert_drafting_profile` 등)는 호출 사용자·대상 조직 단위 `rights.web_edit`를 DB 함수 안에서 다시 검사한다(세션 클라이언트로 RPC를 직접 호출해도 우회 불가). 정본은 `05_DATA_MODEL.md` 2.9·2.18절 | `ADR-001` 4.7절 |

**라우트별 필요 권리와 402 reason** (추가 2026-10-28, 제안). 권리 키는 `rights`(`ADR-001` 4.7절). 권리가 없을 때 reason: 상품 전혀 없음 `no_product`, 만료 `expired`, 좌석 `seat_unassigned`·`seat_revoked`, 영구 폴백 `fallback`.

| 라우트 | 필요 right | 폴백(영구 업데이트 만료) | 비고 |
|---|---|---|---|
| `POST /api/cloud-projects`, `POST /api/uploads/sign`(`project_snapshot`) | `web_edit` | 402 `fallback` | 업로드 목적이 `render_input`·`proposal_sheet`면 아래 AI 행 right를 따름 |
| `PUT /api/drafting-profile`, `POST .../logo-upload-url` | `web_edit` 또는 `desktop_edit` | 허용(`desktop_edit` O) | `oa` 역할도 함께 필요 |
| `POST /api/ai/render`, `POST /api/ai/proposal` | `ai_render` | **허용**(폴백 웹 AI 렌더 허용, `ADR-001` 4.1·`01_PRD.md` 4.3절) | 크레딧은 별도 |
| `POST /api/ai/review`, `GET /api/rule-packs`·`/download` | `cloud_review` | 402 `fallback`(`AR012` 매핑) | 폴백은 마지막 자격 팩만 |
| `POST /api/ai/intake`, `POST /api/ai/chat` | `ai_chat`(팀장 결정 2026-10-29) | **불가**(폴백 `ai_chat`=false, `01_PRD.md` 4.8 턴 0과 일치, `ADR-001` 4.7절) | 일일 턴 `ai_chat_turns_per_day`는 별도 적용. 호출자 D·S |
| `POST /api/license/activate`·`refresh`, `GET /api/updates/*` | `desktop_edit` | 허용(마지막 자격 빌드·팩) | 활성화는 좌석 필요. 호출자 D만 |
| `POST /api/site/lookup`, `GET /api/cost-catalogs/latest` | `desktop_edit` 또는 `web_edit` | 허용(`desktop_edit` O, 단가표는 마지막 자격 시점) | 호출자 D·S |
| `GET /api/entitlement`, `GET /api/cloud-projects`, `GET .../blob`, `GET /api/cloud-projects/export.zip` | `view_export` | 허용 | 402 없음(위 예외) |
| `POST /api/seats/assign`·`unassign`, `POST /api/checkout` | 역할 `oa` | 해당 없음 | 권리와 무관 |

## 2. Route Handler

역할: `member+` = owner/admin/member, `oa` = owner/admin. 호출자: W = 웹 화면(쿠키), D = 데스크톱(Bearer), S = 웹 스튜디오(`app.` 출처, 1장 "웹 스튜디오 인증": Bearer, D-071a). 기능 키는 PRD 4.8절·9.4절이고 `arch.org_features`가 판정한다.

### 2.1 라이선스·업데이트·규칙 팩·계정

| 메서드 경로 | 기능 ID | 역할/플랜 | 입력(zod 요약) | 출력 | 크레딧 | 호출하는 코어/제품 RPC | 오류 |
|---|---|---|---|---|---|---|---|
| `POST /api/license/activate` | AR-F-018, 021 | D, member+, 로그인 필수(D-16) | `{ serial: string(ARCH-XXXXX-XXXXX-XXXXX-XXXXX, Crockford Base32 정규화), device_hash: hex64, device_label?: string≤60 }` 또는 체험·월 구독 `{ mode: 'plan', device_hash, device_label? }`(시리얼 없음) | `{ license_file: SignedLicenseFile, license: { id, sku, serial_last5, updates_until, status } \| null, activation: { id, activated_at } }` | 0 | 시리얼: 정규화 → SHA-256 → `arch.activate_license(p_serial_hash, p_device_hash, p_user=ctx.user_id)`. 플랜: `arch.activate_plan_device(p_org=ctx.org.id, p_user=ctx.user_id, p_device_hash)`(기기 한도는 조직별 사용자당 2대, 좌석 여러 개여도 합산 안 함, 체험만 1대, 확정 D-H5 ③, `ADR-001` 4.3절. 초과 `AR001`. 활성화 행에 `seat_id` 기록, 05장 2.7). 다음 2.4절 파일 서명(`source` `license`·`plan`), `write_audit` | `AR001` 409(해제 화면 안내), `AR002` 404, `AR003` 403, `AR006` 403, 402(플랜 모드인데 체험·구독 만료), 429(IP 10회/시간) |
| `POST /api/license/deactivate` | AR-F-018 | W·D, oa | `{ activation_id: uuid }` | `{ activation: { id, deactivated_at }, self_deactivations_30d }` | 0 | `arch.deactivate_activation`(세션 클라이언트, authenticated) | `AR004` 429(고객지원 안내), 42501 403, P0002 404 |
| `POST /api/license/refresh` | AR-F-019 | D, member+ | `{ activation_id: uuid, device_hash: hex64 }` | `{ license_file }`(현재 `updates_until`·`features`로 재서명) | 0 | 활성화 행 조직·기기 일치 확인(admin 클라이언트) → `arch.org_features` → 재서명 | `AR003` 403, P0002 404(해제됨·기기 불일치), 429(IP 10회/시간, 활성화와 같은 버킷) |
| `GET /api/license/list` | AR-F-017, 018, 019 | W·D·S, member+ | - | `{ licenses: [{ id, sku, serial_last5, status, purchased_at, updates_until, activations: [{ id, device_label, activated_at, last_seen_at }] }], plan_activations: [{ id, device_label, activated_at, last_seen_at }], features: OrgFeatures, last_eligible_build: { version, build_date } \| null }`(시리얼은 끝 5자만, 전체 시리얼은 발급 메일에만) | 0 | SELECT(RLS) + `arch.org_features(ctx.org.id)` | - |
| `GET /api/updates/{target}/{arch}/{current_version}` | AR-F-019 | D(Bearer), 로그인 사용자 | 경로: `target` `windows`(MVP)·`darwin`(Phase 2), `arch` `x86_64`·`aarch64`, `current_version` semver | 200 업데이트 매니페스트(2.3절) 또는 204(받을 수 있는 새 빌드 없음) | 0 | `arch.org_features` → `arch.eligible_build(p_org=ctx.org.id, p_platform='<target>-<arch>', p_current)`(함수가 `build_date <= updates_until`까지 판정) → 설치 파일 서명 URL(10분, 제안) | 401(앱은 "로그인하면 업데이트 확인" 표시), `AR010` 403(현재 설치 빌드가 자격 밖: `details.last_eligible`) |
| `GET /api/rule-packs` | AR-F-005, 019 | D·S, member+ | `?after=<version>` | `{ items: [{ version, published_at, sha256, kid, bytes, status }], last_eligible, changes_after_last_eligible: [{ title, effective_from }] }`(제목만, PRD 4.3절 배너) | 0 | `arch.eligible_rule_packs(p_org=ctx.org.id)`, `arch.rule_pack_changes` SELECT | - |
| `GET /api/rule-packs/{version}/download` (변경 2026-10-28: 웹 스튜디오 추가) | AR-F-005, 019 | D·S, member+ | 경로 `version` | `{ version, url(서명 10분, 스튜디오 15분은 미구현), expires_at, sha256, bytes, kid, signature, signed_manifest }`(변경 2026-10-29 AR-06-042: `signed_manifest` = 저장소 `rule-packs/<version>/manifest.json` 원문 `{manifest, sig, kid}`, Rust가 `"arch-rulepack-v1\n"` ‖ manifest 바이트를 검증. 서버는 DB 행과 대조만 하고 서명하지 않는다. 같은 (조직, 버전) URL은 수명 절반 동안 재사용). 레이트 리밋 수치 `미확정`, 팩은 서버 데이터이며 엔진 번들에 포함되지 않는다(`ADR-001` 5장) | 0 | `arch.eligible_rule_packs(p_org=ctx.org.id)`에 그 버전이 있는지 확인 → Storage 서명 URL | `AR011` 403, P0002 404(`withdrawn` 포함) |
| `GET /api/cost-catalogs/latest` | AR-F-012 | D·S, member+ | - | `{ version, basis_date, items, source_note }` | 0 | `arch.latest_cost_catalog(p_org=ctx.org.id)`(published 최신. 폴백 조직은 `published_at <= updates_until` 최신, 규칙 팩과 같은 원칙. `arch.cost_catalogs`는 사용자 GRANT가 없어 이 RPC로만 읽는다) | 204(0행: 체험·구독 만료이고 라이선스 없음) |
| `POST /api/site/lookup` | AR-F-001 | D·S, member+, 체험·유효 상태 | `{ query: { kind: 'address' \| 'jibun' \| 'pnu', value: string≤200 } }` | `{ parcel: { pnu, address_label }, crs, boundary_m: [x,y][], zoning: { use_district, districts[] }, roads: [{ edge_index, width_m? }], sources: [{ provider, fetched_at }] }`(좌표 변환·mm 정수화는 로컬 domain이 한다) | 0 | 서버가 pnu HMAC-SHA-256(서버 비밀 `SITE_LOOKUP_HASH_KEY`, 02장 8절. 단순 SHA-256 아님) → `arch.record_site_lookup(p_org=ctx.org.id, p_pnu_hash)` → 6.1절 어댑터 | `AR020` 429, `AR021` 502(앱은 "직접 그리기"로 이동), 422(형식) |
| `GET /api/drafting-profile` | AR-F-028 | D·W·S, member+ | - | `DraftingProfile`(4.7.3절) + `logo_url`(서명 10분) | 0 | SELECT `arch.drafting_profiles`(RLS) | - |
| `PUT /api/drafting-profile` | AR-F-028 | D·S, oa | `DraftingProfile`(키 허용 목록, `layer_map` 키는 9.6절 표준 이름만, 값 `^[A-Za-z0-9_\-$]{1,64}$`, 제안) | `DraftingProfile` | 0 | `arch.upsert_drafting_profile(p jsonb, p_org=ctx.org.id)`(세션 클라이언트) | `AR042` 403, 22023 422 |
| `POST /api/drafting-profile/logo-upload-url` | AR-F-028 | D·S, oa | `{ ext: 'png', bytes ≤ 1MB }`(제안: SVG 로고는 스크립트 위험 때문에 받지 않음) | `{ signed_upload_url, path, expires_at }` | 0 | Storage 서명 업로드(버킷 `arch-user`, `<org_id>/arch/drafting-logo/<uuid>.png`) | `AR031` 413, 415 |
| `GET /api/cloud-projects` (변경 2026-10-28: 정본 키 `project_uuid`) | -(전용 ID 없음, 작업 AR-06-073) | D·W·S, member+ (`entitled=false`여도 허용, 1장 예외) | `?cursor` | `{ items: [{ project_uuid, local_id \| null, name, version, bytes, updated_at }], next, max, retention_until \| null }` | 0 | SELECT `arch.cloud_projects`(RLS) + `cloud_projects_max` | - |
| `POST /api/cloud-projects` (변경 2026-10-28: 업서트 계약) | -(전용 ID 없음, 작업 AR-06-073·077) | D·W·S, member+ | `{ project_uuid: uuid, local_id?: uuid(설치형 업로드 때만), name: string 1..120, storage_path, expected_version: int ≥ 0 }`. 업서트 기준 `(org_id, project_uuid)`, 새 프로젝트는 `expected_version=0`, 일치하면 `version+1`로 blob 교체. 로컬→클라우드 최초 업로드는 새 `project_uuid`를 발급(사본), 이후 같은 `local_id`는 같은 행에 업서트. blob 저장 순서 = `POST /api/uploads/sign`(`project_snapshot`) → 본 요청 | `{ project_uuid, version }` | 0 | 업로드 객체 재검사 → `arch.save_cloud_project(...)`(세션 클라이언트, 3장) | `AR040` 403, `AR041` 409(`details.current_version`, 앱은 "내 변경을 사본으로 저장" / "서버 최신 열기"만 제시), `AR031` 413, 23514 422(경로), 402(`web_edit` 없음: 만료·미배정·회수·`fallback`, 1장 "라우트별 필요 권리" 표). `arch.save_cloud_project`가 `rights.web_edit`를 DB 안에서 재검사하므로 Route Handler를 거치지 않는 RPC 호출도 거부 |
| `GET /api/cloud-projects/{project_uuid}/blob` (추가 2026-10-28) | -(전용 ID 없음, 작업 AR-06-072) | D·W·S, member+ (**`entitled=false`여도 허용**: 만료·미배정·회수 후 열람·내려받기, 1장 예외. 보존 기한 지나면 404) | 경로 `project_uuid` | `{ url(서명 10분, 제안), version, bytes, sha256?, schema_version }` | 0 | SELECT `arch.cloud_projects`(RLS: 조직 멤버면 읽기, 엔타이틀먼트와 분리, 05장 2.9절. 다른 조직은 404) → Storage 서명 다운로드 URL | P0002 404 |
| `GET /api/cloud-projects/export.zip` (추가 2026-10-29) | -(전용 ID 없음, 작업 AR-06-077) | D·W·S, member+ (**`entitled=false`여도 허용**, 1장 예외. 만료·`fallback`·미배정·회수 사용자 포함, MVP 승인 2026-10-28) | - | 조직의 전체 클라우드 프로젝트 `.arch` zip(스트리밍 또는 서명 URL, 방식은 구현 때 확정). 진행률은 실제 처리 건수, 실패 항목만 재시도 | 0 | SELECT `arch.cloud_projects`(RLS) → Storage 다운로드. 보존 기한 지난 사본은 제외 | 429(레이트 리밋 수치 `미확정`), P0002 404(사본 0건) |
| `GET /api/entitlement` (추가 2026-10-28) | AR-F-017, 018, 019 | S·W, member+ (세션 시작·주기 조회, 캐시 TTL `미확정`) | - | `OrgFeatures`(3장) + `{ products: [{ kind: 'perpetual' \| 'term' \| 'sub' \| 'trial', term_ends_at \| null, updates_until \| null }], seat: { state: 'assigned' \| 'unassigned' \| 'revoked' \| 'shortage', seats_total, seats_used }, rights: { web_edit, desktop_edit, view_export, ai_render, cloud_review, devices_max }, retention_until \| null }` | 0 | `arch.org_features(ctx.org.id, 호출 사용자)` + 좌석 조회(RLS). 권리는 상품별 OR·최대값 합성(고정 순위 없음, `ADR-001` 4.7), 만료일은 상품별 | 만료·미배정이어도 **200**으로 `rights`를 돌려준다(402 아님, 화면이 잠금 사유를 그리려면 필요) |
| `POST /api/seats/assign` · `POST /api/seats/unassign` (추가 2026-10-28) | AR-F-017, 018 | W·S, oa | `{ user_id: uuid }`(대상은 같은 조직 멤버) | `{ seat: { user_id, license_id, seat_no, assigned_at } }` | 0 | `arch.assign_seat(...)` · `arch.unassign_seat(...)`(신규 RPC, 05장 2.18, service 경유). 좌석 수 초과·재배정 제한(자리 `seat_no`당 회수 후 7일 냉각, 온라인 해제 확인 시 즉시, 30일 2회, 확정 D-H5 ②) 시 거부, 감사 `seat.assign` | `AR043` 409(좌석 부족), `AR045` 409(재배정 제한, `details: { reason, available_at }`), 42501 403, P0002 404 |
| `POST /api/identity/callback` (추가 2026-10-28) | -(전용 ID 없음, 가입 크레딧 30: PRD 4.5절 확인 필요) | S·W, 로그인 사용자. 제공자 서버가 호출하면 서명 검증(방식 `미확인`) | 제공자 결과 토큰(본문 최소화). 응답 후 휴대폰 번호 원문은 저장하지 않고 제공자 식별 해시(`ci_hash`)만 | `{ verified: true, credits_granted: 30 \| 0 }` | 0 (가입 크레딧 30은 1회 지급, 중복이면 0) | `arch.grant_identity_credit(p_user, p_ci_hash)`(신규 RPC, 05장 2.19): 유니크 키로 중복 방지 후 `core.grant_credits`(멱등 키 `identity:<ci_hash>`) | 이미 지급된 인증은 오류 없이 200 `credits_granted: 0`, 422(검증 실패), 429. 본인인증 제공자는 `팀장 결정 필요`(`미확인`) |
| `POST /api/uploads/sign` | AR-F-013, 014, 015 | D·S, member+ | `{ purpose: 'project_snapshot' \| 'render_input' \| 'proposal_sheet' \| 'consult_audio', project_ref?: uuid(로컬 프로젝트 id), ext, bytes, sha256 }` | `{ signed_upload_url, path, expires_at }` | 0 | 목적별 상한 검사 후 서명 업로드 URL. 경로 `<org_id>/arch/<purpose>/<uuid>.<ext>` 서버 생성. 버킷 `arch-user`, `consult_audio`만 코어 `voice-audio`. `POST /api/cloud-projects/{id}/upload-url`은 이 경로의 `project_snapshot` 별칭(제안: 클라우드 사본 화면 호환) | `AR031` 413, `AR040` 403(`project_snapshot`이고 새 사본이 상한을 넘을 때), 415 |
| `POST /api/checkout` | AR-F-017, 020, 021 | W, oa(시스템 브라우저의 웹 결제 화면에서만 호출. 데스크톱은 웹 `/pricing`을 연다) | `{ kind: 'license_sku', code: 'perpetual_early' \| 'perpetual_standard' } \| { kind: 'plan', code: 'updates_yearly' \| 'sub_monthly' } \| { kind: 'credit_pack', code: 'pack_100' \| 'pack_550' \| 'pack_1200' }`(금액 필드 없음) | `{ orderId, amountKrw, orderName, customerKey, successUrl, failUrl }` | 0 | 코어 `toss.createOrder`(금액은 서버가 읽음). `license_sku`는 코어 요청 C-1 반영 후에만(그 전에는 `arch.issue_license`가 `kind='one_time'`이 아닌 주문을 22023으로 거부하므로 영구 라이선스 주문을 만들지 않는다) | `AR005` 403, `checkout_unavailable` 409(C-1 전, 품절), `license_required` 409(`updates_yearly`인데 유효 라이선스 없음), 42501 403 |
| `POST /api/webhooks/toss` | AR-F-017, 020, 021 | 공개(서명) | Toss 이벤트 원시 본문 | 200 / 401 / 500 | - | 5장 | 401(서명 실패) |
| `GET /api/jobs/{id}` | AR-F-008, 013, 014, 034 | D·W·S, 같은 조직 멤버 | 경로 `id` = `core.jobs.id` | `{ id, job_type, status, progress, stage?, result?(4장 형식, 서명 URL 포함), error?: { code, message }, refunded: boolean }` | 0 | SELECT `core.jobs`(RLS) + 제품 실행 행(`arch.renders`·`arch.reviews`·`arch.intake_runs`·`arch.proposals`) | P0002 404(다른 조직도 404) |
| `POST /api/samples/download-event` | AR-F-039 | 공개(익명) | `{ sample_id: string≤40, format: 'dxf' \| 'pdf', ref?: string≤80 }` | 204 | 0 | 이벤트 기록만(저장 위치는 02장. DB 쓰기를 하지 않는 웹 분석 이벤트, 제안). 개인 식별값을 받지 않는다 | 429(IP 해시당 60회/분, 제안) |
| `POST /api/auth/finish` | AR-F-027 | D(Bearer, 교환 직후 1회) | `{ provider: 'google' \| 'email' \| 'kakao' \| 'naver', first_login_hint?: boolean }`(토큰·`code`는 본문에 넣지 않는다) | `{ next: '/onboarding' \| '/projects', session: SessionContext }` | 0 | 코어 `finishLogin`(제공자 허용 검사, `session_context`, open 앱이면 `bootstrap_app_for_org` 1회, 감사 `auth.login`). 코어 요청 T-C8 반영 후 | 401, 403(pending·suspended·허용 안 된 제공자), 프로필 없음은 `next: '/login'`(앱이 로그아웃) |
| `POST /api/dev/login` | AR-F-027 | Stage A, 로컬 전용(`isMockAuthAllowed()` 거짓이면 404) | `{ persona }`(공통 페르소나 키, `docs/file/03-설계/공용코어/AUTH_ROADMAP.md:52-62`) | 웹 쿠키 세션 | 0 | 시드 계정 실제 로그인 → `finishLogin`. 데스크톱 개발 빌드는 이 경로 대신 앱 안 `signInWithPassword`(로컬 시드 계정) | 404 |
| `GET /auth/callback` | AR-F-027 | Stage B(웹) | `?code&next` | 302(`next`는 `/`로 시작하고 `//`·`@`·`\` 없을 때만) | 0 | `exchangeCodeForSession` → `finishLogin`(`docs/file/03-설계/공용코어/AUTH_ROADMAP.md:132-146`). 데스크톱은 이 경로를 쓰지 않고 `archstudio://auth/callback` 딥링크로 받아 앱에서 교환(D-15) | `/login?error=callback` |

### 2.2 AI·음성 Route Handler

브라우저·데스크톱 모두 Dify·FastAPI·fal·음성 서버를 직접 호출하지 않는다(`D:/WorkSpace/platform/docs/Tauri/README.md:171`). 서명 토큰은 `apps/web/src/server/ai/`만 발급한다: EdDSA, `iss=arch`, `aud=platform-ai:arch`, `org`, `app=arch`, `sub`, `conv`, `feat`, `scope`, `jti`, `exp`(10분)(`docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:38`). 잡 실행 중 워커가 쓰는 토큰은 잡 토큰(`sub=job:<job_id>`, running 잡만, `jti` 1회)이다(`docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:39`).

| 메서드 경로 | 기능 ID | 역할/플랜 | 입력(zod 요약) | 출력 | 크레딧 | 호출 RPC | 서명 토큰 scope | 오류 |
|---|---|---|---|---|---|---|---|---|
| `POST /api/ai/render` | AR-F-013 | D·S, member+, `ai_render` | `{ request_id, project_ref: uuid, quality: 'standard' \| 'high' \| 'upscale', preset: { material: enum, time_of_day: enum, season: enum, style?: enum }, inputs: { depth_path, edge_path } \| { source_render_id } }`(경로는 `render_input` 업로드분만. 3D·도면 원본 없음) | 202 `{ run_id, job_id, credits }` | 3 / 5 / 업스케일 2 | 입력 재검사(PNG, 10MB, `render_max_px`) → `arch.start_ai_run(ctx.org.id, ctx.user_id, 'render', 'render_std' \| 'render_hq' \| 'upscale', request_id, project_ref, { preset })` | 잡 토큰 불필요(fal 키는 워커에만) | `AR030` 429, `AR031` 413, `CR001` 402, `AR034` 429(`AI_DAILY_LIMIT`), 429(조직 20회/분), 22023 422(`quality='high'`인데 `render_max_px` 1024) |
| `POST /api/ai/review` | AR-F-008 | D·S, member+, `cloud_review` | `{ request_id, project_ref, rule_pack_version, application_date, municipality_code, judgment: JudgmentResult(4.7.2절), model_summary: { site_area_m2, use_district, floors, gross_area_m2, building_area_m2, height_mm } }`(≤256KB, 제안) | 202 `{ run_id, job_id, credits }` | 15 | `arch.start_ai_run(.., 'review', 'review', ..)` | 잡 토큰 `graph:arch.review` | `AR012` 403(폴백·만료), `AR031` 413, `CR001` 402, `AR034` 429 |
| `POST /api/ai/intake` | AR-F-034, 015 | D·S, member+, `ai_chat`(ADR-001 4.7) | `{ request_id, project_ref, source: 'chat' \| 'consult', text?: string 1..4000, stt_job_id?: uuid }`(`text`와 `stt_job_id` 중 하나. `chat`은 텍스트·짧은 음성 대화, `consult`는 상담 녹음 전사본이며 `stt_job_id` 필수) | 202 `{ run_id, job_id, credits }` → 결과는 4.3절 후보(채택 전 반영 없음) | `chat` 2(PRD 9.4절), `consult` 5(PRD 4.5절). STT 분당 1은 `/api/voice/stt`가 따로 차감 | `arch.start_ai_run(.., 'intake', 'intake_text' \| 'intake_consult', .., { source })` | 잡 토큰 `graph:arch.intake`(feature `arch.intake`, `consult`는 `arch.intake_consult` 오픈소스 강제) | `AR032` 422(재시도 1회 후, 환불), `CR001` 402, `AR034` 429, P0002(STT 잡 없음·다른 조직) |
| `POST /api/ai/proposal` | AR-F-014 | D·S, member+, `ai_render` | `{ request_id, project_ref, kind: 'proposal' \| 'overview' \| 'area_table' \| 'cost', content: { overview, judgment: JudgmentResult, area_table, cost?, notes? }, render_ids: uuid[] ≤ 8, drawing_sheets: string[] ≤ 6(`proposal_sheet` SVG 경로) }`(≤512KB, 제안) | 202 `{ run_id, job_id, credits }` | `proposal` 10(렌더 별도), 나머지 템플릿 문서 1(`doc_template`), 같은 내용 해시 재요청 0 | SVG sanitize(6.2절) → 내용 해시 조회(같으면 기존 결과, 0크레딧) → `arch.start_ai_run(.., 'proposal', 'proposal' \| 'doc_template', .., { content_sha256 })` → `arch.proposals` 행 | 잡 토큰(서술 섹션 `graph:arch.proposal_narrative`, 6.3절) | `AR031` 413, `CR001` 402, `AR034` 429, 422(SVG 검사 실패) |
| `POST /api/ai/chat` | AR-F-009 | D·W·S, member+, `ai_chat_turns_per_day` > 0(0 = 라이선스 폴백 → 403 `ai_chat_unavailable`), 킬 스위치 `ARCH_AI_CHAT_ENABLED`(기본 off → 503 `chat_disabled`, 인증·차감 전) | strict `{ request_id: uuid v4, conversation_id?: uuid, message: string 1..2000, application_date?: YYYY-MM-DD }` | SSE(`text/event-stream`, 상류 답 전체 수신·출처 재검사 후 송출): `sentence{index,text,source_ids}`… → `sources[{chunk_id,title,article,effective_from}]` → `done{conversation_id,no_source,credits,refunded?,replay?,message?}` | 1/턴 선차감 `chat:<org_id>:<request_id>`(원장 nonce·조직·행위자·금액·대화 대조, 아니면 409). 출처 있는 답 = 1(무료 경로 없음). 환불(0): 출처 없음·FastAPI 실패/타임아웃 60초·FastAPI 4xx 거절(폴백 없음)·저장 실패·확정 직전 클라이언트 중단(499). 환불 실패는 alert 로그 + `refunded:false` | 같은 request_id 재전송 = 저장 답 재송출(추가 차감 0), 처리 중·환불된 키 409 `IDEMPOTENT_REPLAY` → 대화 id = request_id 결정값 → FastAPI `/tools/answer` 직접 호출(web 서명 EdDSA 토큰 scope `chat`, org·conv·req 클레임). Dify 연결은 후속(AR-06-054 [DECISION] 1) | `chat` | `CR001` 402, `AI_DAILY_LIMIT` 429, 429(사용자 20회/60초), `chat_rejected` 422, `chat_failed` 502, `chat_timeout` 504 |
| `POST /api/voice/stt` | AR-F-015, 034 | D, member+ | 받아쓰기: multipart `audio`(≤60초·5MB, 제안) + `{ request_id, mode: 'dictation' }`. 상담 녹음: `{ request_id, mode: 'consult', project_ref, audio_path(`consult_audio`), duration_s ≤ 7200, notice_version }` | 받아쓰기 200 `{ text, duration_s }` / 상담 202 `{ job_id }`(잡 `arch.stt`) | 분당 1(실제 길이 정산. 상담은 신고 길이로 선차감 후 정산) | `withCredits`(`voice:<request_id>`) / 상담은 `consume_credits` → `enqueue_job('arch.stt', p_credit_ledger_id)` | `voice` | `recording_notice_required` 422, `VOICE_TOO_LONG` 413, `AR031` 413(200MB), `CR001` 402 |

Phase 2 `arch.layout`(AI 실 배치 초안, 5크레딧, variant `layout`)의 Route Handler는 MVP 경로 목록에 두지 않는다. Phase 2 착수 때 `POST /api/ai/layout`(`ai_layout`, 입력 4.6절)을 추가한다(`arch.start_ai_run`은 그때까지 kind `layout`·`walkthrough`를 22023으로 거부). 읽어 주기(TTS)는 OS 음성 합성이라 서버 경로가 없다(0크레딧, 제안). 법규 해설 위키(03장 3.13절)는 읽기 전용 경로 `GET /api/ai/wiki/pages?category&q&cursor`(목록 `{ items: [{ slug, title, category, checked_at, stale }], next }`)와 `GET /api/ai/wiki/pages/[...slug]`(본문 `body_md`, 출처·확인일, 링크, 개정 이력, 최근 점검일)만 둔다: D·W, member+, 전 상태(폴백·만료 포함), 0크레딧, 서명 토큰 scope `wiki`로 FastAPI `GET /wiki/pages/{slug}`를 부르고 대상은 운영자 조직(제품 공통 지식, `docs/file/03-설계/공용코어/LLM_WIKI.md:41`)의 `published` 페이지뿐이다. 사용자 조직 위키와 사용자 쓰기 경로(`PATCH`·ingest·lint Route Handler)는 두지 않는다(ingest·lint는 운영 도구 AR-06-050). 오류 P0002 404(미게시·없는 slug), 429(조직 60회/분). 경로 형태는 toon-factory·live-poll의 `/api/ai/wiki/*`와 같다(제안).

### 2.3 Tauri 업데이터 매니페스트

데스크톱 업데이터(`tauri-plugin-updater`)의 동적 엔드포인트는 `GET /api/updates/{target}/{arch}/{current_version}`이고 요청에 Bearer 헤더를 붙인다(업데이터 플러그인의 사용자 헤더 옵션, 미확인: 구현 시 2.x 문서로 확인). 응답 형식은 Tauri 2 동적 업데이트 서버 형식을 따른다(필드 이름 미확인, 구현 시 확인).

```ts
// 200 응답 (받을 새 빌드가 있을 때만). 없으면 204, 본문 없음
interface UpdateManifest {
  version: string          // arch.builds.version (semver), current_version 보다 커야 한다
  notes: string            // 릴리스 노트(공개 문구만)
  pub_date: string         // RFC 3339, arch.builds.published_at
  url: string              // 설치 파일 서명 URL(10분, 제안)
  signature: string        // Tauri 업데이트 서명(라이선스 서명 키·코드 서명 인증서와 별개 키)
}
```

| 규칙 | 내용 | 근거 |
|---|---|---|
| 자격 | 서버가 요청마다 판정한다(앱이 보낸 `updates_until`·라이선스 파일은 쓰지 않음). 영구 라이선스 조직은 `build_date <= updates_until`인 빌드만 내준다. `rule_pack_updates=true`(체험·월 구독·업데이트 유효)는 채널 `stable` 최신. 체험 만료·구독 만료이고 라이선스 없음은 204 | `docs/file/02-요구사항/01_PRD.md 4.4절`, `D:/WorkSpace/platform/docs/Tauri/README.md:197` |
| 채널 | MVP는 `stable`만 매니페스트로 낸다. `beta`는 계정 화면 직접 다운로드(제안) | 제안 |
| 자격 밖 설치 | 현재 버전 빌드가 자격 밖이면 `AR010` 403, `details.last_eligible: { version, download_page: '/account/licenses' }`. 앱은 실행 시에도 로컬 판정(내장 `build_date` > 라이선스 파일 `updates_until`)으로 같은 안내를 띄운다 | `docs/file/02-요구사항/01_PRD.md 4.4절` |
| 폴백 | 마지막 자격 버전은 계속 실행되고 계정 화면에서 설치 파일을 다시 받는다 | `D:/WorkSpace/platform/docs/Tauri/README.md:198` |

### 2.4 라이선스 파일

서버가 Ed25519로 서명한 JSON이다. 서명 개인키 `LICENSE_SIGNING_PRIVATE_KEY`는 웹 서버 전용이며 AI 서명 토큰 키와 분리하고(코어 요청 C-3, T-C4), 앱에는 공개키만 넣는다. 검증은 Rust 코어(`license.rs`)가 하고 화면은 결과(`LicenseStatus`)만 받는다(`docs/file/02-요구사항/01_PRD.md 4.4절`, `D:/WorkSpace/platform/docs/Tauri/README.md:193`).

```ts
// 서명 대상. 직렬화는 키 정렬 JSON(UTF-8, 공백 없음, 제안: 서명 재현성)
interface LicensePayloadV1 {
  v: 1
  license_id: string | null   // uuid. 체험·월 구독(source 'plan')은 null
  org_id: string              // uuid
  app_id: 'arch'
  sku: 'perpetual_early' | 'perpetual_standard' | 'trial' | 'sub_monthly'; source: 'license' | 'plan'
  updates_until: string | null  // YYYY-MM-DD (발급 시점 값. 연장되면 /api/license/refresh 로 재발급). plan 은 null
  activation_id: string       // uuid
  device_hash: string         // hex64, 앱별 솔트로 해시한 기기 식별값
  issued_at: string           // RFC 3339
  seat_id: string             // uuid, 활성화한 좌석(05장 2.7·2.18)
  rights: {                   // 사용자별 합성 결과(ADR-001 4.7). 오프라인 표시·로컬 판정용, 정본은 서버
    web_edit: boolean; desktop_edit: boolean; view_export: boolean
    ai_render: boolean; ai_chat: boolean; cloud_review: boolean; devices_max: number
  }
  rights_expiry: Partial<Record<'web_edit' | 'desktop_edit' | 'ai_render' | 'ai_chat' | 'cloud_review', string | null>>   // 권리별 종료 시각(RFC 3339). 기간제·구독·체험이 주는 권리 = 그 상품 종료 시각, 영구가 주는 권리 = issued_at + 30일(온라인 재확인, 확정 D-H5 ②, 변경 2026-10-29). view_export는 키에 없음(항상 허용). 종료 후 로컬은 refresh 전까지 그 권리를 false로 본다
  kid: string; offline_valid_until: string | null   // 설치형 편집을 주는 상품 중 가장 늦은 값, 영구 null, 기간제·구독·체험은 min(발급 + 7일, 상품 종료일)로 clamp(D-H3, 제안, 02장 2.2절)
  features: {                 // PRD 9.4절: 오프라인에서도 같은 값을 쓰는 키만(제안)
    drafting_watermark: boolean   // true 면 시트 표제란 "체험판"
    rule_pack_updates: boolean; cloud_review: boolean; ai_render: boolean   // 발급 시점 값, 표시용(판정은 서버)
  }
}
interface SignedLicenseFile {
  payload: string             // base64url(LicensePayloadV1 직렬화 바이트)
  sig: string                 // base64url(Ed25519 서명)
  kid: string                 // payload.kid 와 같아야 한다
}
// Rust 검증 결과(화면이 받는 값)
type LicenseStatus =
  | { state: 'valid'; payload: LicensePayloadV1; build_eligible: boolean }   // build_eligible: 내장 build_date <= updates_until
  | { state: 'invalid_signature' | 'unknown_kid' | 'device_mismatch' | 'malformed' }
  | { state: 'absent' }
```

| 규칙 | 내용 |
|---|---|
| 오프라인 | 활성화 후 로컬 기능은 동작하되 영구도 `rights_expiry`(발급 + 30일)가 지나면 refresh 전까지 열람·내보내기만(D-7(a)를 D-H5 ②로 대체, 변경 2026-10-29). 클라우드 기능은 호출마다 서버가 라이선스·플랜을 다시 판정한다(`docs/file/02-요구사항/01_PRD.md 4.4절`) |
| 체험·월 구독 | `POST /api/license/activate`(플랜 모드) → `arch.activate_plan_device`로 `source='plan'` 파일을 받는다. 로컬 권한은 이 파일로만 판정하고 `offline_valid_until`(제안 7일)이 지나면 온라인 재발급(`POST /api/license/refresh`) 전까지 "열람·내보내기만"으로 내린다 |
| 저장 | 파일 원문은 로컬 `license_store`. 로그·오류 보고에 넣지 않는다 |
| 재발급 | `updates_yearly` 결제·플랜 변경 후 앱이 `POST /api/license/refresh`를 부른다(앱 시작 시 하루 1회, 제안) |
| 복수 상품 보유 (추가 2026-10-28, 제안) | 파일은 사용자·기기당 1개(`ADR-001` 4.7절). 위 `LicensePayloadV1`에 사용자별 합성 결과를 더한다: `seat_id`(uuid, 활성화한 좌석), `rights{ web_edit, desktop_edit, view_export, ai_render, cloud_review, devices_max }`(`ADR-001` 4.7 합성값, 05장 2.18 `org_features.rights`와 같은 키), `rights_expiry`(권리별 종료 시각, 위 스키마, 영구도 30일), `offline_valid_until`(설치형 편집을 주는 상품 중 가장 늦은 값, 영구 null, 그 상품 종료일로 clamp, D-H3), `issued_at`. 합성 입력은 파일 발급 대상 조직의 좌석뿐(개인↔팀 조직 교차 금지, `ADR-001` 4.7절). `sku`·`source`·`license_id`는 설치형 편집을 주는 대표 상품 1개를 표시용으로만 담는다. 배포된 파일이 아직 없으므로 버전을 올리지 않고 `v: 1` 정의에 새 필드를 직접 넣었다(팀장 결정) |
| 서버 정본 우선 | 파일의 `rights`·`features`는 오프라인 로컬 판정과 표시용이다. 온라인이면 `GET /api/entitlement`(2.1절)가 정본이며 다르면 서버 값을 쓰고 `POST /api/license/refresh`로 재서명한다. 클라우드·AI·저장은 파일 값과 무관하게 서버가 매 호출 판정한다. 좌석 회수·상품 만료는 다음 refresh 또는 `offline_valid_until`·`rights_expiry`(영구 최대 30일)까지 로컬에 남을 수 있다(D-H3 위험 수용). 회수된 활성화가 refresh로 해제를 받으면 서버가 `release_confirmed_at`을 기록한다(05장 2.7, 좌석 냉각 조기 종료) |

## 3. RPC (SECURITY DEFINER)

모든 제품 함수는 `arch.` 스키마, `SECURITY DEFINER`, `set search_path = ''`, PUBLIC EXECUTE 회수 후 허용 목록 부여, service_role 판정은 `core.is_service_caller()`다(05장). 시그니처는 05장과 같고 상세 검사는 05장이 정본이다.

| 시그니처 | 호출자 | 검사 | 반환 | SQLSTATE |
|---|---|---|---|---|
| `arch.issue_license(p_order_id uuid)` | service_role(결제 확정 후처리, 5장) | 주문 확정 상태·종류 일회성(C-1)·상품 참조가 `license_skus`, 주문 id 멱등(이미 발급이면 기존 행, 시리얼 원문 null), 수량 한도(D-2), 무작위 100비트 시리얼 생성 → SHA-256·끝 5자 저장, `updates_until = 구매일 + 1년`, 가입 크레딧 300 `core.grant_credits`(pack, 멱등 키 `license:<license_id>`, 제안), 감사 `license.issue` | `(license_id uuid, serial text)`. 시리얼 원문은 이 반환값에서 한 번만(이메일 발송 후 폐기) | 42501, P0002, 22023 |
| `arch.activate_license(p_serial_hash text, p_device_hash text, p_user uuid)` → jsonb | service_role(Route Handler가 세션 검증 후) | 해시 형식, 라이선스 존재(`AR002`), `p_user`가 라이선스 조직 멤버(`AR006`), `status='active'`(`AR003`), 같은 기기 활성 행이 있으면 그대로 반환, 활성 수 < `max_activations`(`AR001`), `last_seen_at` 갱신, 감사 `license.activate` | jsonb `{ activation: { id, activated_at, last_seen_at }, license: { id, org_id, sku, serial_last5, updates_until, status } }` | `AR001`, `AR002`, `AR003`, `AR006`, 42501, 22023 |
| `arch.deactivate_activation(p_activation_id uuid)` | authenticated(oa) | 같은 조직 owner/admin, 이미 해제면 그대로 반환, 조직의 셀프 해제 30일 3회 미만(`AR004`), 감사 `license.deactivate` | 활성화 행 | `AR004`, 42501, P0002 |
| `arch.org_features(p_org uuid)` → jsonb | authenticated(자기 조직) / service_role | 멤버십, 라이선스 상태 + 플랜 `features` + 9.4절 키 병합(PRD 4.8절 표, 폴백 열). 체험 만료는 엔타이틀먼트 `expires_at`이 아니라 생성 시각 + `runtime_config.trial_days`(14)로 이 함수가 판정한다(만료 사용자도 RLS로 계정 화면·클라우드 사본을 읽어 열람·내보내기 유지, 05장 3절) | `OrgFeatures`(아래) | 42501 |
| `arch.extend_updates(p_order_id uuid)` | service_role(`updates_yearly` 결제 확정) | 주문 확정·플랜 `updates_yearly`, 주문 id 멱등, 조직에 `active` 라이선스. 유효 중이면 `updates_until + 1년`, 만료 후면 `결제일 + 1년`(D-5 a, PRD 4.2절의 해석: 제안), 조직의 활성 라이선스 전부에 적용(제안), 감사 `license.extend_updates` | 갱신된 라이선스 행들 | `AR003`, 42501, P0002 |
| `arch.eligible_build(p_org uuid, p_platform text, p_current text)` | service_role(업데이트 매니페스트) | 플랫폼 값 허용 목록, `channel='stable'`, `published`, `version > p_current`, 조직 자격(`build_date <= updates_until`, 업데이트 유효·체험·구독은 전부) 중 최신 | `arch.builds` 행 또는 null | 22023 |
| `arch.eligible_rule_packs(p_org uuid default null)`, `arch.latest_cost_catalog(p_org uuid default null)` | authenticated / service_role | 조직(null이면 `caller_org`: 개인 조직, 비멤버 42501)의 `rule_pack_updates`와 `updates_until`: `published_at <= updates_until`(또는 업데이트 유효 시 전부), `status='published'`만. 단가표도 같은 자격 원칙의 최신 1건, 자격 없으면 0행 | 규칙 팩 `table`(version, published_at, basis_date, sha256, signature, kid, bytes, status) / 단가표 `table`(version, basis_date, published_at, items, source_note, sha256) 0~1행 | 42501, 22023 |
| `arch.record_site_lookup(p_org uuid, p_pnu_hash text)` | service_role | 해시 형식, 조직 당일 건수 < `site_lookups_per_day`(`AR020`), 주소 원문 미저장 | `remaining int` | `AR020`, 22023 |
| `arch.upsert_drafting_profile(p jsonb, p_org uuid default null)` | authenticated(oa) | owner/admin(`AR042`), 키 허용 목록(4.7.3절), `layer_map` 키는 표준 레이어만, `logo_storage_path`는 자기 조직 폴더, 감사 `drafting_profile.update` | `arch.drafting_profiles` 행 | `AR042`, 22023, 23514 |
| `arch.start_ai_run(p_org uuid, p_actor uuid, p_kind text, p_variant text, p_request_id uuid, p_project_ref uuid, p_options jsonb default '{}')` | service_role | `p_kind` ∈ render·review·intake·proposal·layout·walkthrough(layout·walkthrough는 Phase 2라 실행 테이블이 생길 때까지 22023 거부), variant 단가 상수(render_std 3, render_hq 5, upscale 2, review 15, intake_text 2, intake_consult 5, proposal 10, doc_template 1, layout 5, walkthrough 40), `p_actor`가 `p_org` 멤버, 기능 키(`ai_render`/`cloud_review`(아니면 `AR012`)/`ai_intake`/`ai_layout`), 렌더 조직 동시 3건(`AR030`), `runtime_config.daily_credit_cap`(초과 `AR034`, 0이면 끔), 선차감 `consume:arch:<request_id>`(`CR001`), `enqueue_job(queue=job_type, p_credit_ledger_id, 'job:arch:<request_id>')`, 실행 행(`renders`·`reviews`·`intake_runs`·`proposals`) 생성, 같은 `request_id` 재호출은 기존 반환 | `(run_id uuid, job_id uuid, credits int)` | `AR012`, `AR030`, `AR034`, `CR001`, 42501, 22023 |
| `arch.finish_ai_run(p_run_id uuid, p_result jsonb)`, `arch.fail_ai_run(p_run_id uuid, p_reason text)` | service_role(워커·ai-service) | finish: 실행이 `running`, kind별 결과 스키마(4장), intake 고정 스키마(`AR032`), review 문장별 출처(`AR033`), 상태 `succeeded`. fail: 활성 실행, 상태 `failed` → 환불 원장(`refund:job:<job_id>`) 확인 후 `refunded` | 둘 다 jsonb `{ run_id, kind, status }`(실행 테이블이 4개라 행 타입 대신) | finish `AR032`, `AR033`, 22023, P0002 / fail 22023, P0002 |
| `arch.purge_expired()`, `arch.reconcile_runs(p_org uuid)` | service_role(워커 크론, 02장 4절. `reconcile_runs`는 `start_ai_run`도 렌더 동시 수 판정 전에 부름) | purge: `site_lookups` `site_lookup_retention_days`(90) 경과 삭제, 만료 `intake_runs` 삭제, 만료 렌더 `purged_at` 표시. reconcile: 잡이 failed·canceled인데 queued·running으로 남은 실행 행을 failed로 | purge `table`(bucket, path)(워커가 지울 Storage 경로) / reconcile 정리 행 수 int | 42501 |
| `arch.save_cloud_project(p_project_uuid uuid, p_local_id uuid default null, p_name text, p_storage_path text, p_expected_version int)` (변경 2026-10-28, 신규 마이그레이션에서 시그니처 교체) | authenticated(member+) | `(org, p_project_uuid)` 업서트. 새 프로젝트(기대 버전 0)면 조직 수 < `cloud_projects_max`(`AR040`), 기존이면 `version = p_expected_version`(`AR041`), 경로가 `<org_id>/arch/project_snapshot/` 아래(서버 생성 경로) | `(project_uuid uuid, version int)` | `AR040`, `AR041`, 23514, 42501 |

`OrgFeatures`(반환 jsonb, 키는 PRD 4.8절·9.4절. `state`·`updates_until`·`license_ids`는 화면 표시용 추가 키, 제안):

```ts
interface OrgFeatures {
  state: 'trial' | 'trial_expired' | 'licensed' | 'licensed_fallback' | 'subscribed' | 'subscription_expired'
  updates_until: string | null
  license_ids: string[]
  cloud_review: boolean; rule_pack_updates: boolean; ai_render: boolean; local_gpu_render: boolean
  render_max_px: number; site_lookups_per_day: number; ai_chat_turns_per_day: number
  cloud_projects_max: number; max_activations: number
  drafting_watermark: boolean; ai_intake: boolean; ai_layout: boolean
}
```

코어 RPC(인용만, CS): `session_context`, `bootstrap_app_for_org`, `consume_credits`, `grant_credits`, `refund_credits`, `enqueue_job`, `claim_jobs`, `heartbeat_job`, `complete_job`, `fail_job`, `cancel_job`, `reap_stale_jobs`, `write_audit`, `rate_limit_hit`, `confirm_payment_order`, `fail_payment_order`, `apply_subscription_transition`, `resolve_ai_route`, `match_ai_chunks`, `set_ai_cross_border_ack`, `expire_voice_audio`.

### 3.1 05장과 맞춘 점 (2026-10-16 확정)

| 함수 | 쟁점 | 확정 |
|---|---|---|
| `arch.start_ai_run` | service_role 함수인데 조직·행위자·변형(렌더 품질 3/5/2, 제안서 10/1, intake 2/5) 인자가 없다. 차감액을 함수가 정할 수 없다 | `p_org uuid, p_actor uuid, p_variant text, p_options jsonb` 추가. 단가는 함수 안 상수 표(서버 `pricing.ts`·seed와 같은 값), 클라이언트 값 아님 |
| `arch.eligible_build`, `arch.record_site_lookup` | 조직 인자가 없어 `build_date <= updates_until`을 함수가 판정할 수 없다 / service_role인데 조직 인자가 없다 | 둘 다 `p_org uuid` 추가. `eligible_build`는 함수가 조직 자격까지 판정 |
| 05장 확정 후 추가(2026-10-16) | 조직 선택 인자, 단가표·정리 RPC, 반환형, 일일 상한 코드, Phase 2 kind | `eligible_rule_packs`·`upsert_drafting_profile`에 `p_org uuid default null`, `latest_cost_catalog`·`purge_expired`·`reconcile_runs` 신규, `activate_license`·`finish_ai_run`·`fail_ai_run`은 jsonb 반환, `AR034` 신규(7.1절), `start_ai_run`의 layout·walkthrough는 22023 |
| 제안서 실행 행 | 05장 테이블 목록에 제안서 테이블이 없었다 | `arch.proposals` 추가(job 연결, 포함 시트 경로 배열, 결과 PDF 경로, status는 다른 실행 행과 같은 값). 체험·월 구독 기기는 `arch.activate_plan_device`(`license_activations.license_id` null 허용 + `source`·`org_id`) |

## 4. 잡 페이로드 계약

큐 이름 = `job_type`(02장 4절). payload에는 id·경로·열거값만 넣고 사용자 원문(요구 문장, 전사본)과 비밀은 넣지 않는다(실행 행 또는 Storage에서 읽는다). 스키마는 TS(zod, `packages/domain`)와 Python(pydantic, `apps/api/app/ai/products/arch/`) 두 곳에서 같은 정의를 쓰고 동치 테스트로 묶는다(제안). 실행 위치: `arch.render`·`arch.proposal_pdf`·`arch.stt`는 `workers/arch-jobs`가 실행하고, 그래프 잡(`arch.review`·`arch.intake`·`arch.layout`)은 `workers/arch-jobs`가 집어(claim) 잡 토큰으로 FastAPI `POST /graphs/{name}/runs`를 호출하며 그래프는 FastAPI에서 돈다(6.3절). 도면 생성·DXF/SVG/PDF 출력·매스 자동 제안은 잡이 아니다(4.7절, 0크레딧).

### 4.1 요약

| job_type | payload | result(`finish_ai_run` / `complete_job`) | progress(`heartbeat_job` message) | 타임아웃·재시도 |
|---|---|---|---|---|
| `arch.render` | `{ run_id, quality, preset, inputs: { depth_path, edge_path } \| { source_render_id }, max_px }` | `{ output_path, width, height, bytes, provider: 'fal', model, seed, ai_label: true, expires_at(90일) }` | `{ stage: 'submit' \| 'generate' \| 'persist' }` | 3분 초과 실패·환불, 재시도 1(같은 seed) |
| `arch.review` | `{ run_id, rule_pack_version, application_date, municipality_code }`(판정 입력은 `arch.reviews` 행) | 4.2절 | `{ stage: 'load' \| 'retrieve' \| 'interpret' \| 'compliance' }` | 10분 초과 실패·환불, 재시도 1 |
| `arch.intake` | `{ run_id, source: 'chat' \| 'consult', stt_job_id? }`(문장은 `arch.intake_runs` 행. `consult`는 feature `arch.intake_consult`로 오픈소스 강제) | 4.3절 | `{ stage: 'extract' \| 'validate' \| 'retry' }` | 스키마 실패 1회 재시도 후 `AR032` 실패·환불, p95 20초 |
| `arch.proposal_pdf` | 4.4절 | `{ pdf_path, pages, bytes, sheets_included, narrative: { model, ai_label: true } \| null, content_sha256 }` | `{ stage: 'narrative' \| 'assemble' \| 'render' }` | 렌더 120초, 전체 p95 60초, 실패 전액 환불 |
| `arch.stt` | `{ voice_ref, audio_path, notice_version, language: 'ko', declared_duration_s }` | `{ transcript_path, duration_s, chunks, provider: 'oss-voice', model }` | `{ stage: 'split' \| 'transcribe' \| 'merge', done, total }` | 10분 단위 분할(요청당 상한, `docs/file/03-설계/공용코어/VOICE_ARCHITECTURE.md:61`), 대체 없이 실패·환불(오픈소스 강제) |
| `arch.layout`(Phase 2) | 4.6절 | 4.6절 | `{ stage }` | 실패 전액 환불 |

### 4.2 `arch.review` 결과

```ts
interface ReviewResultV1 {
  schema_version: 'review.v1'
  rule_pack_version: string
  items: Array<{
    key: string                              // JudgmentResult.items[].key 와 같은 값, 또는 'district_plan' 등 RAG 전용 항목
    verdict: 'PASS' | 'FAIL' | 'WARN' | 'CHECK'   // CHECK = 확인 필요
    engine_value?: { value: number; limit: number; unit: string }  // 엔진 값 그대로 복사. LLM 이 만든 숫자를 넣지 않는다
    sentences: Array<{ text: string; source_ids: string[]; nature: 'interpretation' }>  // source_ids 가 빈 문장이 하나라도 있으면 AR033
  }>
  needs_check: Array<{ text: string; source_ids: string[]; nature: 'interpretation' }>  // 확인 필요도 source_ids 1개 이상
  sources: Array<{ id: string; law: string; article: string; effective_from: string; kind: 'law' | 'ordinance' | 'interpretation' | 'district_plan' }>
  disclaimer_version: string                 // "법적 판정 아님" 고지 버전
}
```

숫자 규칙(AR-06-051): 숫자는 `engine_value`(엔진 값 복사)·`verdict`로만 나간다. `text`는 AI 해석 문장이고 숫자가 없다(`nature: 'interpretation'` = 해석, 수치 아님). 그래프 안에서 LLM은 `parts: [{type:'text', text} | {type:'ref', item:'<판정 key>', field:'value'|'limit'}]`로 쓰고, ref는 같은 항목의 엔진 값만 가리키며 출력 문장에는 고정 낱말 '산정값'·'한도값'으로 그려진다(needs_check 문장은 ref 금지). `text`는 단일 판정기 `validate_free_text`(문자 허용 목록: 한글 음절·ASCII 알파벳·공백·고정 구두점만, 한글 수사 닫힌 집합, 금지 표현)를 통과한 것만 남는다. 그래프 실행 결과(`GET /graphs/runs/{id}`의 `result.refs`)는 남은 문장의 ref 경로 `<key>.<value|limit>` → 엔진 값이다. 화면은 수치를 `engine_value`에서 표시한다.

### 4.3 `arch.intake` 결과 (고정 스키마, 좌표 없음)

```ts
interface IntakeCandidateV1 {           // zod .strict(): 정의 밖 키(좌표·polygon·x·y 등)가 있으면 검증 실패
  schema_version: 'intake.v1'
  checklist_answers: Array<{
    question_id: string                 // packages/program 체크리스트 문항 id 허용 목록
    answer: string | number | boolean | string[]
    confidence: 'high' | 'medium' | 'low'
    evidence: string                    // 원문 인용 120자 이하(원문에 있는 문자열이어야 함)
  }>
  rooms: Array<{
    name: string                        // 40자 이하
    use: string                         // 규칙 팩 용도 코드 허용 목록
    count: number                       // 정수 1..20
    target_area_m2: number | null       // 사용자가 말한 값만. 말하지 않았으면 null(면적은 packages/program 이 계산)
    area_evidence: string | null        // target_area_m2 가 있으면 그 숫자가 들어 있는 원문 인용, 없으면 AR032
  }>
  memo: Array<{ kind: 'preference' | 'budget' | 'constraint' | 'other'; text: string }>   // 300자 이하
}
```

후보는 데스크톱 화면에서 항목별로 채택해야 체크리스트·면적표에 반영된다(PRD AR-F-034, `docs/file/02-요구사항/01_PRD.md 9.3절`).

### 4.4 `arch.proposal_pdf` payload

```ts
interface ProposalPdfPayloadV1 {
  run_id: string                        // arch.proposals.id (3.1절)
  kind: 'proposal' | 'overview' | 'area_table' | 'cost'
  content_path: string                  // 서버가 요청 본문을 정규화·저장한 JSON(`<org_id>/arch/proposal_content/<uuid>.json`)
  content_sha256: string                // 같은 내용 재요청 0크레딧 판정
  render_ids: string[]                  // arch.renders 중 같은 조직·succeeded·미만료
  drawing_sheets?: string[]             // POST /api/uploads/sign purpose 'proposal_sheet' 로 올린 SVG 경로(sanitize 통과분). 도면 자체는 로컬 생성, 0크레딧
  template_version: string
  narrative: boolean                    // kind='proposal' 만 true(서술 섹션 LLM)
}
```

판정 수치·면적·공사비는 데스크톱 엔진 값을 그대로 쓰고, 서술 섹션은 숫자를 새로 만들지 않는다(서술에 입력에 없는 숫자가 있으면 compliance가 막는다, 제안). 꼬리말에 "법적 판정 아님"과 9.1절 도면 고지를 넣는다(`docs/file/02-요구사항/01_PRD.md 9.3절`).

### 4.5 `arch.stt`

녹음 전 제3자 고지(`notice_version`)를 받은 녹음만 접수하고 원본은 처리 후 24시간 안에 삭제한다(`docs/file/02-요구사항/01_PRD.md 6절`, `docs/file/03-설계/공용코어/VOICE_ARCHITECTURE.md:95`). 전사본도 같은 시점에 지우고 채택된 후보만 로컬에 남긴다(제안). STT는 오픈소스 강제(`docs/file/02-요구사항/01_PRD.md 3절`).

### 4.6 `arch.layout` (Phase 2, 의도 JSON만)

```ts
interface LayoutPayloadV1 {
  run_id: string
  floor: { outline_mm: Array<[number, number]>; entrance_edge_index?: number; north_angle_deg: number }  // PRD 9.7절: 층 외곽·면적표만 보낸다
  targets: Array<{ name: string; use: string; target_area_m2: number }>
  conditions: { daylight_priority: string[]; notes?: string }
}
interface LayoutIntentV1 {               // 결과. 좌표·치수·면적 키 금지(.strict())
  schema_version: 'layout_intent.v1'
  variants: Array<{                      // 정확히 3개
    label: string
    zones: Array<{ id: string; kind: 'public' | 'private' | 'service' | 'wet'; rooms: string[]; preferred_side?: 'N' | 'S' | 'E' | 'W' | 'entrance' }>
    adjacency: Array<{ a: string; b: string; relation: 'adjacent' | 'near' | 'apart' | 'door'; weight: 1 | 2 | 3 }>
  }>
}
```

배치(실 다각형)는 데스크톱의 결정적 솔버(`packages/layout`)가 만든다. 시트에는 "AI 배치 초안 기반" 주석이 붙는다.

### 4.7 로컬 엔진 계약 (서버 API 아님)

데스크톱 앱 안에서 화면 → Web Worker(`apps/desktop/src/workers/**`) → 엔진 패키지(`domain`, `geometry`, `rules`, `massing`, `layout`, `drafting`, `io`)로 흐르는 계약이다. 네트워크를 쓰지 않고 크레딧이 없다. 같은 입력과 같은 엔진 버전이면 같은 바이트를 낸다(DXF 헤더 생성 시각 제외, `docs/file/02-요구사항/01_PRD.md 9.1절`). 파일 쓰기는 엔진이 하지 않고 `shell-bridge`의 Exporter → Rust `export.rs`가 한다.

#### 4.7.1 DesignModel v1

```ts
// packages/domain. 좌표·길이는 mm 정수(zod .int()), 면적 표시는 m2 소수 둘째 자리
type Mm = number
type Point = [Mm, Mm]
interface Polygon { outer: Point[]; holes?: Point[][] }   // 외곽 반시계, 구멍 시계, 닫는 점 중복 없음(제안)

interface DesignModelV1 {
  schema_version: 1
  units: 'mm'
  site: {
    boundary: Polygon
    north_angle_deg: number
    roads: Array<{ edge_index: number; width_mm: Mm }>
    zoning: { use_district: string; districts: string[]; building_line?: Point[] }
    parcel: { pnu?: string; address_label?: string }
  }
  rule_context: { rule_pack_version: string; application_date: string; municipality_code: string; ordinance_applied: boolean }
  masses: Array<{
    id: string; footprint: Polygon; base_level_mm: Mm
    floors: Array<{ id: string; level: number; height_mm: Mm; use: string }>   // level: 지하 -1, 1층 1
    roof: { type: 'flat' | 'gable' | 'hip' | 'shed'; pitch?: number }
  }>
  floor_layouts: Array<{
    floor_id: string
    rooms: Array<{ id: string; name: string; use: string; polygon: Polygon }>
    openings: Array<{ id: string; kind: 'door' | 'window'; host: { room_id: string; edge_index: number }; offset_mm: Mm; width_mm: Mm; swing?: 'left' | 'right' }>
  }>
  program: {
    checklist_answers: Record<string, string | number | boolean | string[]>
    targets: Array<{ name: string; use: string; target_area_m2: number }>
    user_locked_rows: string[]           // 사용자 수정 행. 재계산이 덮어쓰지 않는다(AR-F-011)
  }
  meta: { created_by_engine_version: string }
}
```

#### 4.7.2 JudgmentResult (판정 결과, 파생)

```ts
interface JudgmentResult {               // 필드는 제안. 02·05장과 함께 확정
  engine_version: string
  rule_pack_version: string
  application_date: string
  items: Array<{
    key: 'coverage' | 'far' | 'height' | 'sunlight' | 'setback' | 'parking' | 'seismic' | 'zero_energy' | 'supervision'
    verdict: 'PASS' | 'FAIL' | 'WARN' | 'NA'
    value?: number; limit?: number; unit: 'pct' | 'mm' | 'm2' | 'count' | 'bool'
    basis: Array<{ law: string; article: string; effective_from: string; ordinance: boolean }>   // 빈 배열 행은 표시하지 않는다(AR-F-004)
  }>
  pending_changes: number                // 폴백 배너 "이후 개정 n건"
}
```

#### 4.7.3 SheetSpec, DraftingProfile

```ts
interface SheetSpec {
  id: string
  kind: 'site_plan' | 'area_plan' | 'sunlight_section' | 'floor_plan' | 'elevation'   // elevation 은 Phase 2
  paper: 'A3' | 'A2' | 'A1'
  orientation: 'landscape' | 'portrait'
  scale: 'auto' | 100 | 200 | 300 | 500 | 600       // auto: 용지에 맞는 가장 큰 축척
  floor_id?: string                                  // floor_plan, area_plan(층별)
  section_line?: { a: Point; b: Point }              // sunlight_section. 없으면 매스 무게중심을 지나는 정북 방향
  elevation_face?: 'N' | 'S' | 'E' | 'W'
  annotations?: Annotation[]                         // 주석 편집층(AR-06-086). 주석만, 형상은 고칠 수 없다. 최대 500개, 빈 배열은 저장하지 않는다(키 생략)
  include_in_proposal: boolean
}
// 옛 `annotation_overrides` 키는 거부한다(이행 함수 migrateLegacySheetSpec 만 받는다). id 는 시트 안에서 유일(zod·pydantic 모두 거부), 1~200자.
// 문구는 200자, 용지 mm 오프셋은 ±10000. 그리는 순서는 id 사전순(배열 순서 무관). 서체·크기·색은 DraftingProfile 에서만.
type Annotation =
  | { id: string; kind: 'override'; target: string; dx_mm?: number; dy_mm?: number; text?: string; hidden?: boolean }  // 자동 주석 1개 이동·문구·숨김. 이행 id "ov-<target>"
  | { id: string; kind: 'dim'; a: Anchor; b: Anchor; offset_mm: number; text?: string }   // 값은 엔진이 두 앵커 거리(mm 반올림)로 채운다. text 는 {값} 포함 필수(기본 "{값}")
  | { id: string; kind: 'text'; anchor?: Anchor; dx_mm: number; dy_mm: number; text: string }  // anchor 없음 = 용지 좌표 메모(이행 id "note-<id>")
  | { id: string; kind: 'leader'; anchors: Anchor[]; dx_mm: number; dy_mm: number; text: string }  // 앵커 1~16, 마지막 앵커 + 오프셋에 문구
  | { id: string; kind: 'cloud'; anchors: Anchor[]; text?: string }                         // 앵커 3~64 닫힌 외곽
interface Anchor {                                   // 모델 객체 위의 한 점. 위치는 화면 좌표가 아니라 앵커 + 용지 mm 오프셋
  ref: string                                        // 모델 객체 id(1~128자): 'site' · 매스 id(site_plan) · 실 id(floor_plan)
  part: 'vertex' | 'edge' | 'center'                 // center = 외곽 상자 중심
  index?: number                                     // vertex 번호, edge = index → index+1 변(닫힘)
  at?: 'start' | 'end' | 'mid'                       // edge 위 위치, 기본 mid
}
interface DraftingProfile {              // 클라우드 arch.drafting_profiles, 로컬 drafting_profile_cache
  office_name: string
  architect_name?: string
  contact?: string
  logo_storage_path?: string
  layer_map: Partial<Record<StdLayer, string>>       // 표준 이름 → 사무소 이름
  default_paper: 'A3' | 'A2' | 'A1'
  default_text_height_mm: number                     // 용지 mm, 2.0~5.0(제안)
  font_family: string                                // 한글 TTF 글꼴 이름. DXF 에는 이름만 기록
}
type StdLayer =
  | 'A-SITE-BNDY' | 'A-SITE-ROAD' | 'A-SITE-SETB' | 'A-ENVL' | 'A-MASS' | 'A-WALL' | 'A-DOOR' | 'A-GLAZ'
  | 'A-AREA' | 'A-AREA-IDEN' | 'A-PARK' | 'A-ANNO-DIMS' | 'A-ANNO-TEXT' | 'A-ANNO-NRTH' | 'A-TTLB' | 'A-REFR'
```

레이어 색·선 종류는 PRD 9.6절 표 그대로다(1점 쇄선 `DASHDOT`, 파선 `DASHED`, 실선 `CONTINUOUS`).

사람 주석은 `A-ANNO-USER` 레이어에 그린다. 이 레이어는 `StdLayer`·`layer_map`·DB 표준 레이어 표에 없고, 사람 주석이 있을 때만 DXF LAYER 표에 붙는다(주석 없는 DXF는 기존과 바이트 동일). 사무소 매핑으로 이름을 바꾸는 것은 후속(DB 변경 필요).

**고아 주석**: 앵커 `ref` 가 이 시트에 그려지지 않거나(없는 id, area_plan·sunlight_section 은 앵커 대상 없음) `index` 가 범위 밖이면 고아다. 다중 앵커 주석은 하나라도 고아면 전체 고아다. 고아는 DXF·SVG·PDF·PNG 출력에서 뺀다. 워커 `build_sheet` 응답의 `unapplied_overrides[]`(`{ target, reason }`)로 보고하며 새 `reason` 은 `orphan_anchor`(target = 주석 id)다. 그 밖에 치수 두 점이 같으면 `degenerate_dim`, 치수 문구에 `{값}` 이 없으면 `invalid_template`. 기존 사유(`missing_target` 등)는 그대로다. 정점 수가 바뀌어 index 가 다른 정점을 가리키는 경우는 안정 정점 id 가 필요해 후속이다.

**저장 이행**: 로컬 시트 목록은 `arch.sheets.v2.<프로젝트>` 에 저장한다. v1(`arch.sheets.v1.<프로젝트>`)은 읽기만 하며 읽을 때 시트 단위로 이행한다(한 시트가 깨져도 나머지는 유지). 이행 규칙: 같은 target 은 뒤 항목이 이기는 병합 하나로 `ov-<target>`, `note:<id>` 는 `text` 주석 `note-<id>`(숨김·빈 문구 메모는 출력이 없었으므로 뺀다). 출력 해시(`input_hash`)는 정규화한 SheetSpec 으로 계산한다(빈 `annotations` 는 키 생략).

#### 4.7.4 SheetModel 프리미티브

```ts
type Mm = number; type PaperUm = number   // 정본 02장 2.3절. 뷰 안 형상은 모델 mm 정수, 용지 고정 요소(표제란·도곽·표·문자 높이)는 0.01mm 정수
type Prim<U> = { layer: StdLayer; key: string } & (       // key: 결정적 정렬 키
  | { t: 'line'; a: [U, U]; b: [U, U] }
  | { t: 'pline'; pts: [U, U][]; closed: boolean }        // DXF LWPOLYLINE
  | { t: 'arc'; c: [U, U]; r: U; a0: number; a1: number }
  | { t: 'circle'; c: [U, U]; r: U }
  | { t: 'text'; at: [U, U]; h: PaperUm; s: string; align: 'l' | 'c' | 'r'; source_ref?: string }   // 수치 TEXT는 source_ref 필수
  | { t: 'mtext'; at: [U, U]; h: PaperUm; width: PaperUm; s: string }
  | { t: 'hatch'; loops: [U, U][][]; pattern: 'SOLID' | 'ANSI31' }
  | { t: 'insert'; block: string; at: [U, U]; rot_deg: 0 | 90 | 180 | 270 })
  // 치수는 DIMENSION 엔티티를 쓰지 않고 line + text 로 분해한다(AR-F-038)

interface SheetModel {                   // 02장 2.3절 필드 + 아래 두 필드
  sheet_id: string; kind: SheetSpec['kind']; engine_version: string; input_hash: string
  paper: { size: 'A3' | 'A2' | 'A1'; orientation: 'landscape' | 'portrait'; w: PaperUm; h: PaperUm }
  scale: 100 | 200 | 300 | 500 | 600    // auto 를 해석한 확정 축척. 레이어 색·선 종류는 PRD 9.6절 표(작성기 상수)
  views: Array<{ view_id: string; origin: [PaperUm, PaperUm]; prims: Prim<Mm>[] }>; paper_prims: Prim<PaperUm>[]
  annotations: Array<{ anno_id: string; kind: 'dim' | 'label' | 'warning' | 'note'; prims: Prim<Mm | PaperUm>[]; overridable: Array<'offset' | 'hide'> }>
  blocks: Array<{ name: string; entities: Prim<Mm>[] }>   // 문·창 심볼, 방위표
  title_block: TitleBlockValues
  warnings: Array<{ code: 'AR057' | 'AR058'; detail: string }>   // 가져오기 경고 AR054는 import_dxf 결과에 둔다
  checks: SheetChecks
}
interface TitleBlockValues {
  office_name: string; project_name: string; sheet_title: string; scale_label: string; date: string; rule_pack_version: string; pending_changes?: number
  disclaimer: '기획설계 검토용 자료이며 인허가 설계도서가 아닙니다'   // 고정, 덮어쓰기 경로 없음
  watermark: boolean                                                  // features.drafting_watermark
}
interface SheetChecks { area_table_m2: Record<string, number>; parking_count?: number; min_setback_mm?: number }  // 판정 값과의 동일성 속성 테스트용
```

#### 4.7.5 Web Worker 메시지 프로토콜

```ts
type EngineRequest =                    // 봉투·레인·seq 규칙은 02장 2.4절. engine.worker: judge·suggest·layout, drafting.worker: sheet·export·import
  | { op: 'build_sheet'; req_id: string; lane: 'sheet'; seq: number; input: DraftingInput }   // DraftingInput: model, judgment, sheet(SheetSpec), profile, license{ drafting_watermark }, engine_version
  | { op: 'write'; req_id: string; lane: 'export'; format: 'dxf' | 'svg' | 'pdf' | 'png'; sheets: SheetModel[]; layer_map: Record<string, string>; bundle: boolean; project_name: string; date: string }  // date: 파일명 전용. pdf·png는 메인 스레드 대안(02장 2.4절)
  | { op: 'suggest_mass'; req_id: string; lane: 'suggest'; seq: number; model: DesignModelV1; targets: { gross_area_m2: number; floors?: number; use: string } }
  | { op: 'validate_layout'; req_id: string; lane: 'layout'; seq: number; model: DesignModelV1; floor_id: string }
  | { op: 'import_dxf'; req_id: string; lane: 'import'; bytes: ArrayBuffer; unit_hint?: 'mm' | 'm'; purpose: 'site_boundary' | 'reference' }   // reference 는 Phase 2
  | { op: 'judge' | 'load_rule_pack' | 'cancel'; req_id: string }   // 필드는 02장 2.4절

type EngineResponse =                   // 성공은 { req_id, seq?, ok: true, op, result, engine_version, elapsed_ms }. result 형식:
  | { op: 'progress'; req_id: string; stage: string; pct: number }
  | { op: 'build_sheet'; result: { sheet: SheetModel; svg_preview: string } }
  | { op: 'write'; result: { files: Array<{ name: string; bytes: ArrayBuffer; sha256: string }> } }  // bytes 는 Transferable
  | { op: 'suggest_mass'; result: { candidates: Array<{ label: 'max_coverage' | 'sunlight_margin' | 'regular_plan'; masses: DesignModelV1['masses']; judgment: JudgmentResult }>; max_gross_area_m2?: number } }  // 모두 PASS
  | { op: 'validate_layout'; result: { rooms: Array<{ room_id: string; area_m2: number; target_diff_m2: number | null }>; errors: Array<{ code: 'AR051'; room_ids: string[]; kind: 'overlap' | 'outside' }> } }
  | { op: 'import_dxf'; result: { unit: 'mm' | 'm'; polygons: Polygon[]; skipped_entities: Record<string, number> } }   // skipped_entities 가 있으면 AR054 경고
  | { op: 'import_dxf'; result: { ask_unit: Array<'mm' | 'm'> } }   // AR053: 사용자 답을 받아 unit_hint 를 정해 다시 요청
  | { req_id: string; ok: false; code: LocalErrorCode; detail: string }
  | { req_id: string; status: 'superseded' | 'canceled' }

type LocalErrorCode = 'AR050' | 'AR051' | 'AR052' | 'AR053' | 'AR054' | 'AR055' | 'AR056' | 'AR057' | 'AR058' | 'AR059'
```

| 규칙 | 내용 |
|---|---|
| 취소 | `cancel`은 협조적 취소다. 엔진은 단계 경계(뷰 생성, 주석, 작성기)마다 취소 표시를 확인하고 `canceled`로 끝낸다. 같은 레인의 새 요청이 오면 이전 요청은 `superseded`(02장 2.4절, 마지막 요청만 반영). `write`는 끝까지 실행 |
| 시간 | `build_sheet` p95 1초, `suggest_mass` p95 3초, `validate_layout` p95 100ms, `write` DXF 시트당 p95 2초·PDF 10장 p95 10초(`docs/file/02-요구사항/01_PRD.md 9.5절`) |
| 버전 | 모든 응답의 산출물에 `engine_version`. 로컬 `sheets`·`exports`에 함께 저장하고, 저장된 시트의 엔진 버전이 현재와 다르면 `AR059` 안내 후 재생성 |
| 입력 상한 | `import_dxf` 20MB(`AR055`, Rust `fs.rs`가 읽기 전 검사), 지원 엔티티 밖은 경고 후 무시(`AR054`)(`docs/file/02-요구사항/01_PRD.md 9.5절`) |

#### 4.7.6 내보내기 파일 이름 규칙 (제안)

| 항목 | 규칙 |
|---|---|
| 시트 1장 | `<프로젝트명>_<도면코드>_<시트번호 2자리>_1-<축척>_<YYYYMMDD>.<ext>` 예 `한남동주택_SP_01_1-200_20261016.dxf` |
| 도면코드 | `site_plan` `SP`, `area_plan` `AP`(층별이면 `AP-1F`), `sunlight_section` `SS`, `floor_plan` `FP-<층>`(`FP-1F`, `FP-B1`), `elevation` `EL-<면>`(`EL-N`) |
| 묶음 PDF | `<프로젝트명>_도면묶음_<n>장_<YYYYMMDD>.pdf` |
| 정규화 | 유니코드 NFC, Windows 금지 문자 `< > : " / \ \| ? *`와 제어 문자를 `_`로, 앞뒤 공백·마침표 제거, 확장자 포함 120자 이하 |
| 충돌 | 같은 이름이 있으면 `(2)`, `(3)`을 붙인다. 덮어쓰기는 사용자가 저장 대화상자에서 고를 때만 |
| 결정성 | 날짜는 파일 이름에만 쓰고 파일 내용(표제란 작성일은 시트 설정 값)에 섞지 않는다. 같은 입력 재현은 `exports.sha256`으로 확인 |

## 5. 웹훅

| 방향 | 제공자/이벤트 | 서명 방식 | event_id 출처 | 처리 |
|---|---|---|---|---|
| 수신 | Toss 결제 상태(`POST /api/webhooks/toss`) | 원시 본문으로 서명 검증(Toss 방식 미확인, `docs/file/03-설계/공용코어/SHARED_MODULES.md:186`). 코어 `receiveWebhook` | `paymentKey + status + 발생시각` 해시(Toss 고유 이벤트 id 필드 미확인, `docs/file/03-설계/공용코어/CORE_SPEC.md:254`) | `core.webhook_events(provider, event_id)` 멱등 → 주문 상태 동기화 → 확정된 주문이면 아래 "확정 후처리"를 멱등으로 실행. 서명 실패 401, 중복 200, 처리 실패 500(재전송 유도) |
| 발신 | 없음(MVP) | - | - | 사용자 등록 웹훅 이벤트를 두지 않는다. 시리얼·영수증은 이메일로 보낸다 |

확정 후처리(주문 종류별). 코어 원칙상 지급 정본은 confirm 경로이고 웹훅은 보조다(`docs/file/03-설계/공용코어/CORE_SPEC.md:251`). 그래서 같은 후처리 함수를 결제 결과 화면(`/checkout/result`)의 서버 confirm 직후와 웹훅 양쪽에서 부르고, 주문 id 멱등으로 한 번만 효과가 나게 한다(제안).

| 주문 | 후처리 | 결과 |
|---|---|---|
| `license_sku`(C-1 일회성) | `arch.issue_license(p_order_id)` → 반환된 시리얼 원문으로 이메일 발송 → 원문 폐기 | 1분 안에 이메일·계정 화면(끝 5자)(AR-F-017). 이메일 실패는 재발송 잡 대신 운영 알림(원문을 다시 만들 수 없으므로 고객지원이 시리얼 재발급, 제안) |
| `plan` `updates_yearly` | 코어 구독 전이 + `arch.extend_updates(p_order_id)` | 데스크톱은 다음 `POST /api/license/refresh`에서 새 `updates_until` 반영 |
| `plan` `sub_monthly`, `credit_pack` | 코어 처리만(구독 전이·월 지급, `confirm_payment_order` 지급 `order:<order_id>`) | 제품 처리 없음 |
| 환불·취소 | 라이선스 주문이면 `licenses.status='refunded'`(05장 함수), 활성화 행은 유지하되 클라우드 기능 거부(`AR003`) | 로컬 기능은 라이선스 파일 서명이 유효하므로 오프라인에서는 막을 수 없다(D-7 위험 수용, 02장 위험 표) |

fal 결과 웹훅은 받지 않는다. `/api/webhooks/fal` 경로를 두지 않고 워커가 결과를 폴링한다(fal 웹훅 서명 방식 미확인, `docs/file/03-설계/공용코어/SHARED_MODULES.md:262`)(6.2절).

## 6. 외부 API 어댑터

| 외부 | 호출 위치 | 실패 처리 | 쿼터 |
|---|---|---|---|
| VWorld(연속지적, 토지이용계획), 건축HUB | `apps/web/src/server/site/`(`POST /api/site/lookup`) | 호출당 4초 타임아웃·재시도 1회(제안: p95 5초 목표 안), 실패·형식 이상은 `AR021` 502 → 앱이 "직접 그리기"로 이동. 응답 좌표계·필드·이용 조건·출처 표기 의무는 모두 미확인(D-14, `docs/file/02-요구사항/01_PRD.md 8절`). 확인 전에는 직접 그리기가 기본 경로 | 조직 `site_lookups_per_day`, 제공자 일일 한도 미확인 |
| 국가법령정보 공동활용(DRF) | 규칙 팩 제작·RAG 색인(운영 도구, 사용자 요청 경로 아님) | 실패해도 사용자 기능에 영향 없음(다음 배치 재시도) | 미확인 |
| fal(렌더) | `workers/arch-jobs`(코어 fal client) | 제출 실패 즉시 실패·환불, 3분 초과 실패·환불, 안전 검사 거부는 재시도 없이 실패·환불. 결과는 Storage로 복사(fal URL 만료), 메타데이터에 AI 생성 표시. 표준·고품질 모델 id는 `core.ai_model_prices`(미확인: 고품질 계열의 fal 제공 여부) | 조직 동시 3건(`AR030`), 렌더 API 조직 20회/분 |
| 공용 WeasyPrint 렌더 `POST /render/pdf` | `workers/arch-jobs` | 렌더 예외 재시도 불가 → 환불, 타임아웃 120초(`docs/file/03-설계/공용코어/SHARED_MODULES.md:274`). `url_fetcher` 허용 목록(자체 Storage)만(`docs/file/03-설계/공용코어/SECURITY_BASELINE.md:174`) | 공용 서비스 한도. `RenderPdfRequest.app_id`에 `arch` 추가가 필요하다(현재 `'publishing' \| 'astro'`, `docs/file/03-설계/공용코어/SHARED_MODULES.md:280`, PRD 코어 요청 C-5) |
| FastAPI ai-service | `workers/arch-jobs`(잡 토큰), `/api/ai/chat`(서명 토큰 `chat`, 직접) | 체인 대체(라우터) → 노드 재시도 → 실패·환불. mock 응답 금지 | 조직 60회/분 |
| Dify `arch-chat` | 후속(AR-06-054 [DECISION] 1, 연결 전 로그 보존·처리위탁 고지 결정) | 연결 시 정함. 장애 폴백도 출처 있는 답은 1크레딧(무료 폴백 금지) | 공용 인스턴스 |
| core-voice(오픈소스 음성 서버) | `/api/voice/stt`(받아쓰기), `workers/arch-jobs`(`arch.stt`) | 오픈소스 강제라 국외 제공자로 대체하지 않고 실패·환불 | 요청당 STT 10분 → 상담 녹음은 10분 단위 분할 |
| Toss | 코어 toss 모듈 | `PM001`은 운영 알림 + 승인 취소 요청(코어 규칙) | - |

### 6.1 대지 조회 어댑터 계약

제공자 어댑터(`apps/web/src/server/site/`)는 `lookup(query, signal)` 하나로 `{ pnu, address_label, crs, ring_m, zoning, roads }`를 돌려준다. 좌표계는 제공자 값 그대로(미확인) 내려 주고, mm 로컬 좌표 변환은 데스크톱 `packages/domain`이 한다. 서버는 주소 원문과 응답 좌표를 저장하지 않고 `arch.site_lookups`에 지번 해시만 남긴다. 키는 서버 환경변수(02장 8절)에만 둔다.

### 6.2 제안서 PDF 조립

Route Handler가 `drawing_sheets`(`POST /api/uploads/sign` purpose `proposal_sheet`로 올린 SVG)를 sanitize한다(허용 요소·속성 목록, `script`·`foreignObject`·이벤트 속성·외부 `href` 제거, 1장 2MB 이하, 제안. 실패 422). 워커는 서술 섹션(`proposal`만, 6.3절)을 받은 뒤 엔진 값 표 + 인라인 SVG(외부 fetch 없음) + 렌더 이미지(자체 Storage) + "AI 초안" 표시 + 꼬리말 고지로 HTML을 조립해 `POST /render/pdf`로 보내고, 결과 `exports/<org_id>/arch/pdf/<uuid>.pdf`를 `finish_ai_run`에 넘긴다(`arch.proposals` 결과 경로). HTML 조립은 서버(워커)만 하고 클라이언트 HTML은 렌더하지 않는다(`docs/file/03-설계/공용코어/SHARED_MODULES.md:270`).

### 6.3 FastAPI 엔드포인트 (`docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:152-157` 중 이 제품이 쓰는 것)

| 엔드포인트 | 기능 ID | 호출자 | 인증 | 내용 |
|---|---|---|---|---|
| `POST /graphs/arch.review/runs` | AR-F-008 | `workers/arch-jobs`(`arch.review` claim 후) | 잡 토큰 `graph:arch.review`, `jti` 1회 | 규칙엔진 결과 + 지구단위계획·해석 RAG + compliance 노드(마지막, `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:117`) → 4.2절 결과 → `arch.finish_ai_run` |
| `POST /graphs/arch.intake/runs` | AR-F-034, 015 | 같음(`arch.intake`) | `graph:arch.intake` | 요구 문장(`source='chat'`) 또는 상담 전사본(`source='consult'`, 라우팅 `arch.intake_consult`) → 4.3절 스키마, 서버 재검증 실패 1회 재시도 후 `AR032` |
| `POST /graphs/arch.layout/runs`(Phase 2) | AR-F-035 | 같음(`arch.layout`) | `graph:arch.layout` | 4.6절 의도 JSON만 |
| `GET /graphs/runs/{id}` | AR-F-008, 034 | 워커 | 잡 토큰 | 상태·결과(재시도 시 같은 실행 재개) |
| `POST /products/arch/proposal/narrative` | AR-F-014 | 워커(`arch.proposal_pdf`) | 잡 토큰 `graph:arch.proposal_narrative` | 엔진 값 요약 → 서술 섹션(숫자 생성 금지 검사 포함). 제품 전용 엔드포인트(제안) |
| `POST /tools/answer` | AR-F-009 | `/api/ai/chat`(web 서버) | 사용자 서명 토큰 scope `chat`(org = 토큰 클레임), `jti` 1회 | 법령·조례·위키 근거 답변 `{answer:{sentences[{text,source_ids}]},sources,no_source}`, 출처 필수. 4xx(입력·토큰) 거절은 web이 폴백 없이 환불 |
| `POST /v1/chat/completions` | AR-F-009 | Dify 보조 LLM 노드 | 내부 API 키 | 조직 데이터 금지 |

잡 토큰은 워커가 웹 서버 내부 엔드포인트(워커 키 인증)에서 받는다(`docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:39`). 경로는 `POST /api/internal/ai-token`(워커 키 인증, book-trailer와 같은 형태)이다. 기능 라우팅 키: `arch.review`, `arch.intake`, `arch.intake_consult`(오픈소스 강제), `arch.proposal_narrative`, `arch.chat`, `arch.compliance`, `arch.knowledge`(임베딩), `arch.layout`(P2), 이미지 `arch.render`(02장 5절). 국외 이전 동의 전에는 오픈소스 경로만 쓴다(`docs/file/03-설계/공용코어/AI_ARCHITECTURE.md:86`).

### 6.4 Dify `arch-chat` 계약 (후속 — AR-06-054는 Dify 없이 web → `/tools/answer` 직접)

| 항목 | 값 |
|---|---|
| 입력 변수 | `platform_conversation_id`(필수). Dify `user` = 서버가 만든 `dify_user`(HMAC). 토큰·org·프로젝트 내용·대지 주소는 넣지 않는다 |
| 답변 | HTTP 노드 → `POST {AI_SERVICE_URL}/tools/answer`, 헤더 `X-Internal-Key`, 본문 `{ platform_conversation_id, dify_user: sys.user, query: sys.query }` |
| 응답 | `{ answer, citations: [{ law, article, effective_from, source_id }], no_source: boolean, usage }`. `no_source=true`면 "근거를 찾지 못했습니다"(AR-F-009) |
| 금지 | Dify 내장 지식베이스, 개별 사안 적법성 단정(compliance 노드가 차단) |
| 노드 이름·입력 변수 동작 | 설치한 Dify 버전 문서로 확인(미확인) |

## 7. 오류 코드

### 7.1 제품 SQLSTATE (`AR`, 서버)

| 코드 | 의미 | HTTP | 발생 위치 |
|---|---|---|---|
| `AR001` | 활성화 한도 초과(사용자당 2대, 체험 1대, 확정 D-H5 ③) | 409 | `activate_license`, `activate_plan_device` |
| `AR002` | 시리얼 무효 | 404 | `activate_license` |
| `AR003` | 라이선스 정지·환불·회수 | 403 | `activate_license`, `extend_updates`, 클라우드 기능 판정 |
| `AR004` | 셀프 해제 한도 초과(30일 3회) | 429 | `deactivate_activation` |
| `AR005` | 이메일 미확인 계정의 시리얼 구매 | 403 | `POST /api/checkout` |
| `AR006` | 다른 조직 시리얼 | 403 | `activate_license` |
| `AR010` | 업데이트 기간 밖 빌드 | 403 | 업데이트 매니페스트 |
| `AR011` | 규칙 팩 자격 없음 | 403 | `GET /api/rule-packs/{version}/download` |
| `AR012` | 폴백 상태 클라우드 검토 불가 | 403 | `start_ai_run`(kind `review`) |
| `AR020` | 대지 조회 일일 상한 | 429 | `record_site_lookup` |
| `AR021` | 공공 API 실패 | 502 | 대지 조회 어댑터 |
| `AR030`, `AR034` | 렌더 동시 3건 초과 / 일일 플랫폼 크레딧 상한(`arch.runtime_config.daily_credit_cap`, 베타 비용 서킷 브레이커, 차감 없음. 응답 코드 `AI_DAILY_LIMIT`) | 429 | `start_ai_run`(`AR030` kind `render`, `AR034` 전 kind) |
| `AR031` | 입력 크기 초과 | 413 | `POST /api/uploads/sign`, 사용 시점 재검사, AI 요청 본문 |
| `AR032` | intake 스키마 검증 실패(환불) | 422 | `finish_ai_run`, 워커 검증 |
| `AR033` | 출처 없는 검토 결과 차단(환불) | 500 | `finish_ai_run('review')` |
| `AR040` | 클라우드 사본 상한 | 403 | `save_cloud_project`, `POST /api/uploads/sign`(`project_snapshot`) |
| `AR041` | 버전 충돌 | 409 | `save_cloud_project` |
| `AR042` | 표제란 설정 권한 없음 | 403 | `upsert_drafting_profile` |
| `AR043` (채택 2026-10-28) | 좌석 부족(활성 배정 수가 구매 수 초과). `entitled=false` 402와는 다른 코드: 배정 시도 거부이며 기존 배정자는 영향 없음 | 409 | `assign_seat`, `POST /api/seats/assign`. `details.reason`(402)은 1장 `entitled=false` 예외 행의 값 목록(`expired`·`seat_unassigned`·`seat_revoked`·`no_product`·`fallback`)을 따르며 `AR043`은 그 값에 넣지 않는다 |
| `AR044` (채택 2026-10-28) | 권리 없음: 쓰기 RPC가 호출 사용자·대상 조직의 필요 권리(`rights.web_edit` 등, `ADR-001` 4.7절)가 false라 거부. `AR043`(좌석 부족, 배정 거부)과 다르다: 이미 좌석·상품 상태가 정해진 사용자의 편집·저장 거부 | 402 `entitled=false`, `details: { reason, can_download: true }`(1장) | `save_cloud_project`, `upsert_drafting_profile` 등 쓰기 RPC(`05_DATA_MODEL.md` 2.18절 "쓰기 RPC의 권리 검사") |
| `AR045` (채택 2026-10-28) | 좌석 재배정 제한: 회수 후 7일 냉각 중(회수 기기 온라인 해제 미확인) 또는 좌석당 재배정 30일 2회 초과(확정 D-H5 ②) | 409 | `assign_seat`, `POST /api/seats/assign`. `details: { reason: 'cooldown' \| 'reassign_limit', available_at }` |

### 7.2 코어·공통 코드 매핑 (`docs/file/03-설계/공용코어/CORE_SPEC.md:426`)

| 코드 | HTTP | 처리 |
|---|---|---|
| `CR001` 크레딧 부족 | 402 | `details: { required, balance }`, 크레딧 화면(웹 결제) 링크 |
| `AI001` 플랫폼 강제 오픈소스 범위 해제 시도 | 403 | 설정 화면 오류 |
| `AI002` 국외 이전 동의 필요 | 403 | 온보딩 동의 안내 |
| `42501` 403, `22023`·`JB002`·`SB001`·`PM410` 409(입력 형식 오류는 422), `P0002`·`PM404` 404(다른 조직 대상도 404), `PM001`·`PM409` 409 + 운영 알림, `23514` 422 | - | 코어 매핑 그대로 |
| 401 / 402(`entitled=false`) | `requireSession` | 데스크톱은 로그인 화면 / 체험 만료 안내 |

앱 코드(SQLSTATE 아님, Route Handler): `checkout_unavailable` 409(C-1 전·품절), `license_required` 409, `recording_notice_required` 422, `AI_DAILY_LIMIT` 429(채팅 일일 턴 상한과 SQLSTATE `AR034`), `AI_UNAVAILABLE` 503(체인 전부 실패, 환불 완료), `VOICE_TOO_LONG` 413, `rate_limited` 429. AI 코드 이름은 nomad-docs·flora-publishing과 같다(`D:/WorkSpace/platform/docs/products/nomad-docs/04_API.md:260`).

### 7.3 로컬 앱 오류 (SQLSTATE 아님, 화면 오류 코드)

데스크톱 엔진·Rust 명령이 내고 서버로 보내지 않는다. 오류 보고(사용자 동의 시)에는 코드와 엔진 버전만 넣고 좌표·파일 경로는 넣지 않는다.

| 코드 | 발생 조건 | UI 처리 |
|---|---|---|
| `AR050` | 모델 무효로 시트 생성 불가(자기교차 다각형, 대지 없음, 층 없음 등 zod·위상 검사 실패) | 시트 미리보기 자리에 원인 목록과 "모델에서 고치기" 버튼(해당 화면으로 이동) |
| `AR051` | 실 겹침·외곽 이탈 | 편집기에서 해당 실 강조, 저장 차단(AR-F-032) |
| `AR052` | DXF(또는 SVG·PNG) 쓰기 실패(디스크 공간·권한·경로) | 다른 위치 저장 대화상자, 이미 만든 바이트는 유지 |
| `AR053` | DXF 가져오기 단위 판별 실패 | mm·m 선택 대화상자, 선택 후 다시 가져오기 |
| `AR054` | 지원하지 않는 엔티티(경고 후 무시) | 가져오기 결과에 무시한 엔티티 종류·개수 표시, 진행 |
| `AR055` | 파일 크기 초과(DXF 20MB 등) | 상한 표시, 가져오기 중단 |
| `AR056` | PDF 생성 실패 | DXF·SVG 내보내기 대안 안내, 재시도 |
| `AR057` | 글꼴 없음(대체 글꼴 사용) | 경고 배지, 설정의 글꼴 선택으로 이동. 내보내기는 진행 |
| `AR058` | 축척 자동 선택 실패(가장 작은 축척으로도 용지에 안 맞음) | 더 큰 용지 또는 축척 직접 선택 제안 |
| `AR059` | 엔진 버전 불일치(이전 엔진으로 만든 시트) | "현재 엔진으로 다시 생성" 안내, 이전 내보내기 파일은 그대로 |
| `AR060` | 로컬 DB 손상·열기 실패(`quick_check` 실패, 앱 데이터 폴더 접근 불가) | 프로젝트 목록 대신 복구 안내(마지막 스냅샷 `backups/pre-migrate.db` 위치 안내, 지원 문의). 저장 차단 |
| `AR061` | 마이그레이션 중단·읽기 전용 모드(업데이트 전 스냅샷 실패, 마이그레이션 실패, 앱보다 새 스키마) | 읽기 전용 배너, 저장·삭제 차단, 열기·내보내기는 허용. 재시작·디스크 공간 확인 안내 |
| `AR063` (추가 2026-10-29, AR-06-042) | 설치된 규칙 팩 없음(판정·엔벨로프 불가, 모델 무효 `AR050`과 구분) | 판정 패널에 "설치된 규칙 팩이 없습니다" + 온라인 라이선스 확인 안내. 모델 편집은 계속 |
| `AR064` (추가 2026-10-29) | 규칙 팩 검증 실패(서명·sha256·크기·형식, 디스크 변조 포함). 낮은 버전으로 조용히 내려가지 않는다 | "규칙 팩을 확인하지 못했습니다" + 다시 받기 안내 |
| `AR065` (추가 2026-10-29) | 규칙 팩 자격 없음(라이선스 만료·시계 이상·오프라인 확인 기한 지남·`updates_until` 밖 팩) | "규칙 팩을 쓸 수 있는 기간이 아닙니다" + 재연결 안내. 열람·내보내기는 계속 |

### 7.4 PRD와 다른 값 메모

| 항목 | 04의 처리 | 근거 |
|---|---|---|
| 상담 녹음 → 후보 그래프 크레딧 | 확정: 같은 잡 `arch.intake`, `source='consult'`(AR-F-015, PRD 4.5절) variant `intake_consult` 5, `source='chat'`(AR-F-034, PRD 9.4절) variant `intake_text` 2. STT 분당 1은 별도. 단가 보정은 D-4 | `docs/file/02-요구사항/01_PRD.md 4.5절`, `docs/file/02-요구사항/01_PRD.md 9.4절` |
| 라이선스 발급 트리거 | PRD 4.4절은 "Toss 결제 확정 웹훅 → 발급", 코어는 "지급 정본은 confirm, 웹훅은 보조". 04는 두 경로 모두에서 같은 후처리를 주문 id 멱등으로 부른다(5장) | `docs/file/02-요구사항/01_PRD.md 4.4절`, `docs/file/03-설계/공용코어/CORE_SPEC.md:251` |
