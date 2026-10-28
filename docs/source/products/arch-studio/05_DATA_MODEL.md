# 05 데이터 모델: Arch Studio (arch-studio)

작성일 2026-10-16. 정본 SQL은 모듈러 조각 `docs/products/_supabase-modular/migrations/2400_arch.sql`(아래 "2400:줄")이고, 모놀리스 `supabase/monolith/migrations/0002_arch_domain.sql`은 변환본이다(8절). 표기·규칙은 `docs/products/_platform-core/DB_CONVENTIONS.md`를 따른다. 기능·요금 정본은 `01_PRD.md`(4장, 9.4절), RPC 계약은 `04_API.md` 3장이다. 데스크톱 로컬 SQLite(클래스 B)는 SQL 파일이 없고 이 문서 2.16~2.17절이 정본이다.

검증(2026-10-16, PGlite): `check.mjs --vector` 모듈러(코어 0000~0009 + seed + 2400, 그리고 2400 → seed → 2400 재적용)·모놀리스(0001 + 0002 + seed) 모두 OK. RLS·권한·RPC 스모크 125/125(모듈러·모놀리스 각각, `supabase/monolith/tests/rls_smoke.sql`, 러너 `run-smoke.mjs`).

## 1. 개요와 ERD

스키마 `arch`, 앱 id `arch`, 번호 범위 2400~2499(`docs/products/_platform-core/DB_CONVENTIONS.md:43`), SQLSTATE 접두사 `AR`(`DB_CONVENTIONS.md:22`, 코드표는 `04_API.md:510-531`). 이 제품의 사용자 데이터 대부분(설계 모델, 시트, 판정)은 데스크톱 로컬에 있고, 클라우드에는 권한·배포물·사용자가 실행한 클라우드 작업 기록만 둔다(`docs/Tauri/README.md:81-92`, `02_ARCHITECTURE.md:90-99`).

```
[클라우드, 스키마 arch]
core.organizations ─┬─ arch.licenses (serial_hash, serial_last5, updates_until) ── arch.license_activations (source license)
                    ├─ arch.license_activations (source plan, license_id null: 체험·월 구독 기기)
                    ├─ arch.drafting_profiles (조직당 1행: 표제란, layer_map)
                    ├─ arch.cloud_projects (local_id, version, storage_path)
                    ├─ arch.renders ── source_render_id(업스케일, 같은 조직)
                    ├─ arch.reviews / arch.intake_runs / arch.proposals   (각 행 ── core.jobs, core.credit_ledger)
                    └─ arch.site_lookups (service 전용: 날짜 + 지번 HMAC)
core.payment_orders ── arch.licenses.order_id (발급 멱등), licenses.extension_order_ids (연장 멱등)
카탈로그(org 없음, service 쓰기): arch.license_skus, arch.builds, arch.rule_packs ── arch.rule_pack_changes,
                                arch.cost_catalogs, arch.runtime_config
코어 참조: core.plans·app_entitlements(플랜 features), core.wallets·credit_ledger(선차감), core.jobs(잡), core.audit_log,
          core.ai_*(라우팅·RAG·위키), core.voice_*(STT), storage(arch-releases, arch-user, org-files, exports, voice-audio)

[로컬 SQLite, 데스크톱 app_data_dir]
projects ─┬─ model_revisions (DesignModel JSON) ── judgment_snapshots
          ├─ sheets (SheetSpec + annotation_overrides) ── exports (형식, 엔진 버전, sha256)
          └─ render_items (로컬 저장 렌더)
license_store, local_settings, rule_pack_cache, cost_catalog_cache, drafting_profile_cache
```

| 경계 규칙 | 내용 | 근거 |
|---|---|---|
| 같은 조직만 가리킨다 | 라이선스 ↔ 기기는 `(license_id, org_id)` 복합 FK, 업스케일 원본은 `(source_render_id, org_id)` 복합 FK. 다른 조직 행 연결은 23503 | 2400:185, 2400:268 |
| 클라우드 사본은 동기화가 아니다 | `cloud_projects`는 사용자가 올린 스냅샷(클래스 A)이고 로컬 정본(B)을 대체하지 않는다. 클래스 C(동기화)는 MVP에 없다 | `docs/Tauri/README.md:92` |
| 로컬은 권한을 정하지 않는다 | 로컬 테이블 어떤 값도 플랜·크레딧·라이선스·체험 판정에 쓰지 않는다. 로컬 권한은 서명 라이선스 파일, 클라우드 권한은 `arch.org_features` | `docs/Tauri/README.md:90`, `02_ARCHITECTURE.md:94-99` |

## 2. 테이블

표준 컬럼(`DB_CONVENTIONS.md` 3장): 조직 소유 테이블은 `org_id`, `created_at`, `updated_at`(트리거 `core.set_updated_at`, 2400:740-746), 실행 테이블은 `created_by`(행위자). 사용자 쓰기 경로가 없으므로 `created_by default auth.uid()` 대신 RPC가 행위자를 넣는다. 전 테이블에 `guard_privileged_write` 이중 잠금(2400:748-755). 컬럼 전체는 SQL이 정본이고 아래는 설계 판단이 들어간 컬럼만 적는다.

### 2.1 runtime_config (2400:53) — 카탈로그

| 컬럼 | 타입 | NULL | 기본 | 설명 |
|---|---|---|---|---|
| `key` | text PK | 아니오 | - | `price.<variant>` 10행 + 운영 상수 6행(2400:1846) |
| `value_int` | integer | 아니오 | - | 값 |
| `note` | text | 예 | - | 근거 메모 |

`price.*`는 계약 크레딧 표(render_std 3, render_hq 5, upscale 2, review 15, intake_text 2, intake_consult 5, proposal 10, doc_template 1, layout 5, walkthrough 40)와 같고 서버 상수 `apps/web/src/server/ai/pricing.ts`와 일치 테스트로 묶는다(`01_PRD.md:133-147`, `:384-391`). `start_ai_run`이 이 표에서 차감액을 정하므로 Route Handler·데스크톱은 금액을 보내지 않는다. 운영 상수: `render_max_active_per_org` 3, `render_retention_days` 90, `self_deactivations_per_30d` 3, `trial_days` 14, `daily_credit_cap` 200,000(제안: 베타 원가 측정 전 서킷 브레이커, `01_PRD.md:215`. 0이면 끔), `site_lookup_retention_days` 90(제안: 분기 남용 분석에 충분). 사용자 GRANT 없음.

### 2.2 license_skus (2400:61) — 카탈로그

| 컬럼 | 타입 | NULL | 기본 | 설명 |
|---|---|---|---|---|
| `code` | text PK | 아니오 | - | `perpetual_early`, `perpetual_standard`(`01_PRD.md:79-82`) |
| `price_krw` | integer | 아니오 | - | 490,000 / 890,000(VAT 포함) |
| `includes_updates_months` | integer | 아니오 | 12 | 첫 1년 업데이트 |
| `bonus_credits` | integer | 아니오 | 0 | 가입 크레딧 300(pack 버킷) |
| `max_activations` | integer | 아니오 | 2 | PC 2대(`01_PRD.md:126`) |
| `max_quantity` | integer | 예 | - | 얼리버드 100개(D-2 (a) 권고값, 제안) |
| `fallback_features` | jsonb | 아니오 | `{}` | "영구 + 업데이트 만료" 기능 값(4.8·9.4절 폴백 열) |
| `is_active` | boolean | 아니오 | true | seed: early만 true, standard는 정식 출시 때 켠다 |

anon·authenticated는 `fallback_features`를 뺀 컬럼만 읽는다(가격 화면).

### 2.3 builds (2400:77) — 카탈로그

| 컬럼 | 설명 |
|---|---|
| `version`, `platform`, `channel` | semver, `windows-x86_64` 등(4값), `stable`/`beta`. `(platform, channel, version)` 유일 |
| `status` | `draft` → `published` → `withdrawn`(3절) |
| `build_date` | 업데이트 자격 판정 기준(`build_date <= updates_until`, `01_PRD.md:128`) |
| `storage_path`, `signature`, `sha256`, `bytes` | 버킷 `arch-releases`의 `builds/<channel>/<version>/<file>`(정규식 CHECK), Tauri 업데이트 서명 |

사용자 GRANT·정책 없음. 매니페스트는 service RPC `eligible_build`로만 만든다.

### 2.4 rule_packs (2400:97), rule_pack_changes (2400:116) — 카탈로그

| 테이블 | 핵심 컬럼 | 설명 |
|---|---|---|
| `rule_packs` | `version`(`YYYY.MM.n`), `status`, `basis_date`, `storage_path`(`rule-packs/<v>/pack.json`), `sha256`, `signature`, `kid`, `bytes`, `published_at`, `withdrawn_at` | 서명 매니페스트. 게시 뒤 `version`·`sha256` 불변(트리거). 사용자는 `storage_path`를 뺀 컬럼만 읽고 다운로드는 서명 URL(`04_API.md:36-37`) |
| `rule_pack_changes` | `rule_pack_id`, `title`(200), `kind`(law·decree·rule·ordinance·interpretation), `effective_from`, `law_ref` | 폴백 배너 "이후 개정 n건"의 제목 목록(`01_PRD.md:114`). 내용은 담지 않는다 |

### 2.5 cost_catalogs (2400:127) — 카탈로그

`version`, `status`, `basis_date`, `items jsonb`(배열, 1MB 이하), `source_note`, `sha256`, `published_at`. 사용자에게 테이블 GRANT가 없고 `arch.latest_cost_catalog(p_org)`(2400:1572)만 내용을 준다. 자격은 규칙 팩과 같은 원칙(업데이트 유효면 최신, 폴백이면 `published_at <= updates_until` 최신, `04_API.md:38`).

### 2.6 licenses (2400:146)

| 컬럼 | 타입 | NULL | 기본 | 설명 |
|---|---|---|---|---|
| `org_id` | uuid | 아니오 | - | 구매 조직(D-16 (a), `01_PRD.md:321`) |
| `sku_code` | text FK | 아니오 | - | `license_skus.code` |
| `order_id` | uuid FK 유일 | 예 | - | `core.payment_orders(id)`. 발급 멱등 키. null은 운영 수동 발급(감사 필수) |
| `serial_hash` | text 유일 | 아니오 | - | 정규화한 시리얼 본문 20자(Crockford Base32, `ARCH-`·하이픈 제거, 대문자)의 SHA-256 hex. 원문은 저장하지 않는다 |
| `serial_last5` | text | 아니오 | - | 화면 표시용 끝 5자(계약 14 #7, Crockford 문자 CHECK) |
| `status` | text | 아니오 | `active` | `active`, `suspended`, `refunded`, `revoked`(3절) |
| `purchased_at` | timestamptz | 아니오 | now() | |
| `updates_until` | date | 아니오 | - | 발급 시 KST 오늘 + `includes_updates_months` |
| `max_activations` | integer | 아니오 | 2 | 발급 시 상품 값 복사 |
| `extension_order_ids` | uuid[] | 아니오 | `{}` | `extend_updates` 멱등(같은 주문 두 번 연장 금지) |
| `status_changed_at`, `status_reason` | | 예 | | 상태 전이 기록 |

사용자는 `serial_hash`, `extension_order_ids`, `order_id`를 뺀 컬럼만 읽는다(2400:1755).

### 2.7 license_activations (2400:168)

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `org_id` | uuid | 아니오 | 플랜 기기 한도 집계용(계약 14 #6) |
| `license_id` | uuid | 예 | `source='license'`일 때만 값(CHECK `license_activations_source_ref_check`) |
| `source` | text | 아니오 | `license`(영구) / `plan`(체험·월 구독) |
| `device_hash` | text | 아니오 | 앱별 솔트로 해시한 기기 식별값 hex64(`01_PRD.md:124`). 사용자 SELECT 컬럼에서 뺀다 |
| `device_label` | text | 예 | 사용자 표시명 60자 |
| `activated_by`, `activated_at`, `last_seen_at` | | | `last_seen_at`은 같은 기기 재활성화·refresh 때 갱신 |
| `deactivated_at`, `deactivated_by`, `deactivation_kind` | | 예 | `self`, `support`, `refund`, `revoke`. 둘이 짝(CHECK). 한 번 해제하면 되살리지 않고 새 행을 만든다 |

활성 유일: 영구는 `(license_id, device_hash)`, 플랜은 `(org_id, device_hash)` 부분 유일 인덱스(2400:187-190).

라이선스 파일(계약 14 #5) 필드는 DB에 파일로 저장하지 않고 Route Handler가 아래에서 조립해 서명한다.

| 파일 필드 | DB 출처 |
|---|---|
| `license_id`, `sku`, `updates_until` | `licenses`(플랜 기기면 `license_id` null, `sku`는 플랜 코드) |
| `org_id`, `activation_id`, `device_hash`, `source` | `license_activations` |
| `features{drafting_watermark, rule_pack_updates, cloud_review, ai_render}` | `arch.org_features(org_id)` 발급 시점 값 |
| `offline_valid_until` | 영구 null, 플랜 기기는 `issued_at + 7일`(제안, `02_ARCHITECTURE.md:117`) |
| `v`, `app_id`, `issued_at`, `kid` | 서버 상수·시각 |

### 2.8 drafting_profiles (2400:199)

조직당 1행(PK `org_id`). 컬럼: `office_name`(1~100), `architect_name`(50), `contact`(100), `logo_storage_path`(`<org_id>/arch/drafting-logo/<uuid>.png`만, CHECK), `layer_map jsonb`(키는 PRD 9.6절 표준 16개, 값 `^[A-Za-z0-9_$-]{1,64}$`, RPC 검사), `default_paper`(A3·A2·A1), `default_text_height_mm`(2.0~5.0), `font_family`(이름만, 파일 경로 문자 불가), `updated_by`. 건축주 이름·연락처 컬럼은 없다. `upsert_drafting_profile`은 허용 키 밖(예: `client_name`)을 22023으로 거부한다(PRD 9.7절 "건축주 이름은 표제란 기본값에서 뺀다", `01_PRD.md:451`). 감사 로그에는 바뀐 키 이름만 남기고 값은 남기지 않는다(`01_PRD.md:421`).

### 2.9 cloud_projects (2400:218)

| 컬럼 | 설명 |
|---|---|
| `local_id` | 데스크톱 `projects.id`. `(org_id, local_id)` 유일 |
| `name` | 1~120자 |
| `storage_path` | `<org_id>/arch/project_snapshot/<local_id>/<uuid>.<ext>`(CHECK, 버킷 `arch-user`) |
| `version` | 1부터, 저장마다 +1. 줄어들지 않는다(트리거). 기대 버전과 다르면 `AR041` |

보존: 계정이 있는 동안(`01_PRD.md:213`). 조직 삭제 시 cascade.

### 2.10 renders (2400:239) — 서버 기록

| 컬럼 | 설명 |
|---|---|
| `project_ref`, `request_id`(유일) | 클라이언트 요청 UUID. 멱등 키 원천 |
| `variant` | `render_std`, `render_hq`, `upscale`. 업스케일만 `source_render_id`(CHECK) |
| `status` | 3절 AI 실행 전이 |
| `credits`, `credit_ledger_id`, `job_id` | 선차감 금액·원장·잡. 생성 뒤 불변(트리거) |
| `options` | 프리셋 + 입력 경로(`<org>/arch/render_input/...`만, `start_ai_run` 검사). 16KB |
| `output_path`, `width`, `height`, `bytes`, `provider`, `model`, `seed` | `org-files/<org>/arch/render/<uuid>.<png\|jpg\|webp>`(`finish_ai_run` 검사) |
| `ai_label` | 항상 true. succeeded면 출력·만료·AI 표시 필수(CHECK `renders_output_check`) |
| `expires_at`, `purged_at` | 성공 시각 + 90일(`01_PRD.md:213`), 정리 후 표시 |

### 2.11 reviews (2400:276) — 서버 기록

`variant='review'`, `rule_pack_version`, `application_date`, `municipality_code`, `judgment jsonb`(서버가 재계산한 JudgmentResult, 256KB, `02_ARCHITECTURE.md:308`), `model_summary`, `result jsonb`(`review.v1`, 512KB), `disclaimer_version`. 결과의 모든 문장(`items[].sentences[]`, `needs_check[]`)에 `source_ids`가 1개 이상 없으면 `finish_ai_run`이 `AR033`으로 거부한다(2400:1354-1367).

### 2.12 intake_runs (2400:305) — 서버 기록

| 컬럼 | 설명 |
|---|---|
| `variant` / `source` | `intake_text` ↔ `chat`, `intake_consult` ↔ `consult`(계약 14 #4, CHECK로 짝 고정) |
| `input_kind` | `text` / `voice`. 04장 입력 `source: 'text' \| 'voice' \| 'consult'`는 (chat,text) / (chat,voice) / (consult,voice)로 저장한다 |
| `input_text` | 텍스트 입력만 1~4,000자. 음성·상담은 null(전사본은 core-voice 결과 경로) |
| `stt_job_id` | 음성·상담 필수(같은 조직 잡, `start_ai_run` 검사) |
| `notice_version` | 상담 녹음 고지문 버전 필수(`01_PRD.md:228`) |
| `result` | `intake.v1`(04장 4.3절). 정의 밖 키(좌표·polygon 등)·면적 근거 없는 목표 면적은 `AR032` |
| `expires_at` | 생성 + 90일 뒤 `purge_expired`가 행을 지운다(제안: 요구 문장은 개인 생활 정보가 많고 후보는 이미 로컬에 반영됨) |

### 2.13 proposals (2400:339) — 서버 기록

계약 14 #3. `variant`(`proposal` ↔ `doc_kind='proposal'`, `doc_template` ↔ overview·area_table·cost), `template_version`, `content_path`(`<org>/arch/proposal_content/<uuid>.json`), `content_sha256`, `render_ids uuid[]`(12개 이하, 같은 조직 성공·미만료만), `sheet_paths text[]`(20장 이하, `<org>/arch/proposal_sheet/...`만), `pdf_path`(`exports/<org>/arch/pdf/<uuid>.pdf`), `pages`, `bytes`, `narrative`. 같은 조직·같은 `content_sha256`·같은 `template_version`의 성공 `doc_template`이 있으면 0크레딧(`01_PRD.md:143`, 인덱스 `proposals_template_reuse_idx`). `04_API.md:168-175`(3.1절 확정표)의 `arch.proposals`가 이 테이블이다.

### 2.14 site_lookups (2400:372) — 서버 전용

`org_id`, `lookup_date`(KST), `pnu_hash`, `(org_id, lookup_date, pnu_hash)` 유일. 주소·지번 원문 컬럼이 없다. `pnu_hash`는 서버 비밀 키(`SITE_LOOKUP_HASH_KEY`, 제안 환경변수) HMAC-SHA-256이다. 이유: 지번(PNU 19자리)은 경우의 수가 작아 단순 SHA-256은 사전 대입으로 되돌릴 수 있다(계약 5절 "지번 해시만"을 강화한 것, 제안). 90일 뒤 삭제. 사용자 GRANT 없음.

### 2.15 Storage 버킷 (2400:1833)

| 버킷 | 공개 | 쓰는 것 | 경로 |
|---|---|---|---|
| `arch-releases`(신규, 500MB) | 비공개, 정책 없음 | 빌드, 규칙 팩, 단가표 원본 | `builds/<channel>/<version>/...`, `rule-packs/<version>/pack.json` |
| `arch-user`(신규, 100MB) | 비공개, 정책 없음 | 클라우드 사본, 렌더 입력, 제안서 시트 SVG, 제안서 내용 JSON, 로고 | `<org_id>/arch/<purpose>/[<local_id>/]<uuid>.<ext>` |
| `org-files`(코어) | 비공개 | 렌더 결과 | `<org_id>/arch/render/<uuid>.<ext>` |
| `exports`(코어) | 비공개 | 제안서 PDF | `<org_id>/arch/pdf/<uuid>.pdf` |
| `voice-audio`(코어) | 비공개 | 상담 녹음(24시간 삭제) | 코어 규칙 |

제품 버킷에는 사용자 정책이 없어 업로드·다운로드는 서버가 만든 서명 URL로만 한다(`POST /api/uploads/sign`, 계약 14 #9). 업로드 크기 상한(50MB 초과 IFC 등)은 서명 시점과 사용 시점에 서버가 다시 본다(`04_API.md:20`).

### 2.16 로컬 SQLite 스키마 (데스크톱, 정본)

위치 OS `app_data_dir`, 접근은 Rust `local_db_*` 명령만(화면에서 SQL 금지, `docs/Tauri/README.md:107-114`). 마이그레이션 `apps/desktop/migrations/**`(AR-06-006). 분류 열은 Tauri 4.1절 A~D(`docs/Tauri/README.md:81-88`). 캐시는 "A의 읽기 캐시"로 표시하고 만료 시각을 둔다. 타입은 SQLite 저장 클래스.

| 테이블 | 분류 | 컬럼(타입) | 규칙 |
|---|---|---|---|
| `projects` | B | `id` TEXT PK(UUIDv7), `name` TEXT, `site_label` TEXT(주소 표시명, 선택), `client_name` TEXT NULL, `client_contact` TEXT NULL, `cloud_project_id` TEXT NULL, `cloud_version` INTEGER NULL, `created_at`, `updated_at`, `deleted_at` TEXT NULL | 건축주 정보는 로컬에만(클라우드 업로드 사본에서 제외 옵션 기본 켬, 제안). 휴지통 30일(제안) |
| `model_revisions` | B | `id` TEXT PK, `project_id` FK, `rev` INTEGER, `schema_version` INTEGER, `engine_version` TEXT, `design_model` TEXT(JSON), `sha256` TEXT, `created_at`, `note` TEXT NULL | `(project_id, rev)` 유일. 저장마다 새 행(append), 최근 50개 + 수동 고정 보존(제안). JSON은 `packages/domain` zod 통과분만 |
| `sheets` | B | `id` TEXT PK, `project_id` FK, `sheet_spec` TEXT(JSON), `annotation_overrides` TEXT(JSON 배열), `based_on_rev` INTEGER, `engine_version` TEXT, `updated_at` | 형상은 저장하지 않는다(SheetModel은 D). `engine_version`이 현재와 다르면 AR059 안내 |
| `judgment_snapshots` | B(내용은 D의 기록) | `id` TEXT PK, `project_id` FK, `rev` INTEGER, `rule_pack_version` TEXT, `application_date` TEXT, `engine_version` TEXT, `result` TEXT(JudgmentResult JSON), `created_at` | 내보내기·제안서·클라우드 검토 요청 시점 기록. 화면 판정은 매번 재계산(D)이고 이 표를 읽어 판정하지 않는다 |
| `exports` | B | `id` TEXT PK, `project_id` FK, `sheet_ids` TEXT(JSON), `format` TEXT(`dxf`·`svg`·`pdf`·`png`·`ifc`·`gltf`·`3dm`), `engine_version` TEXT, `rule_pack_version` TEXT, `sha256` TEXT, `path_hash` TEXT, `bytes` INTEGER, `created_at` | 경로 원문 대신 `path_hash`(앱 솔트 SHA-256)만. 결정적 출력 회귀 확인용 `sha256` |
| `render_items` | B | `id` TEXT PK, `project_id` FK, `cloud_render_id` TEXT NULL, `local_path_hash` TEXT, `width`, `height`, `ai_label` INTEGER(1), `saved_at` | 사용자가 로컬 저장한 렌더. 클라우드 90일 만료와 무관 |
| `local_settings` | B | `key` TEXT PK, `value` TEXT(JSON), `updated_at` | UI 설정, 마지막 `org_features` 표시용 캐시. 권한 판정 입력 금지 |
| `license_store` | B(A의 서명 사본) | `activation_id` TEXT PK, `file` TEXT(SignedLicenseFile 원문), `kid` TEXT, `issued_at` TEXT, `max_issued_at_seen` TEXT, `stored_at` | Rust `license.rs`만 읽고 쓴다. 매번 서명·`device_hash` 재검증. `max_issued_at_seen`보다 현재 시각이 이르면 시계 되돌림으로 본다(`02_ARCHITECTURE.md:381`) |
| `rule_pack_cache` | B(A의 읽기 캐시) | `version` TEXT PK, `sha256`, `signature`, `kid`, `published_at`, `basis_date`, `pack` BLOB, `changes_checked_at` TEXT, `pending_changes` INTEGER | 서명·`published_at <= updates_until` 확인분만 엔진에 넘긴다. 30일 미확인 배너(`02_ARCHITECTURE.md:385`) |
| `cost_catalog_cache` | B(A의 읽기 캐시) | `version` TEXT PK, `basis_date`, `sha256`, `items` TEXT(JSON), `fetched_at` | `latest_cost_catalog` 응답 사본 |
| `drafting_profile_cache` | B(A의 읽기 캐시) | `org_id` TEXT PK, `profile` TEXT(DraftingProfile JSON), `logo` BLOB NULL, `fetched_at` | 오프라인 표제란. 편집은 온라인 `PUT /api/drafting-profile`만 |

| 로컬 규칙 | 내용 | 근거 |
|---|---|---|
| 권한 판정 금지 | 위 표의 어떤 값도 플랜·크레딧·라이선스·체험·체험판 표시를 정하지 않는다. 로컬 권한 = `license_store` 서명 파일 검증 결과뿐 | `docs/Tauri/README.md:90`, `02_ARCHITECTURE.md:96` |
| 스키마 변경은 추가만 | 로컬 마이그레이션은 앱 버전과 함께 배포하고 컬럼·테이블 추가만. 삭제·이름 변경은 두 번에 나눠 배포 | `docs/Tauri/README.md:104` |
| JSON 스키마 버전 | `design_model`·`sheet_spec`은 `schema_version`을 갖고 `packages/domain`의 이주 함수(v1 → v2 …)로만 올린다. 이주는 필드 추가·기본값 채우기만(필드 삭제·의미 변경 금지), 원본 행은 그대로 두고 새 rev로 저장 | `02_ARCHITECTURE.md:377` |
| 백업 | 앱 업데이트 전 DB 스냅샷 1개 | `docs/Tauri/README.md:114` |
| 로그 | 좌표·표제란 값·경로 원문을 로그·오류 보고에 넣지 않는다 | `01_PRD.md:421` |

### 2.17 저장되는 DesignModel·SheetSpec 필드

정의는 `04_API.md:280-366`(4.7.1·4.7.3절). 아래는 `model_revisions.design_model`, `sheets.sheet_spec`, `cloud_projects` 스냅샷에 실제로 저장되는 필드와 저장 규칙이다.

| 객체 | 필드 | 저장 형식 | 규칙 |
|---|---|---|---|
| DesignModel | `schema_version`, `units` | 1, `'mm'` | 필수. 이주 함수 기준 |
| | `site.boundary`, `north_angle_deg`, `roads[]`, `zoning`, `parcel{pnu?, address_label?}` | mm 정수 다각형 | `pnu`·`address_label`은 로컬만. 클라우드 업로드 사본·검토 입력에서는 빼고 `municipality_code`만 보낸다(`01_PRD.md:452`) |
| | `rule_context{rule_pack_version, application_date, municipality_code, ordinance_applied}` | 문자열·불리언 | 판정 재현 키 |
| | `masses[]{id, footprint, base_level_mm, floors[], roof}` | mm 정수 | |
| | `floor_layouts[]{floor_id, rooms[], openings[]}` | mm 정수 | AR051 검사 통과분만 저장 |
| | `program{checklist_answers, targets[], user_locked_rows[]}` | JSON | intake 후보는 채택한 항목만 들어온다 |
| | `meta.created_by_engine_version` | 문자열 | |
| SheetSpec | `id`, `kind`, `paper`, `orientation`, `scale`, `floor_id?`, `section_line?`, `elevation_face?` | JSON | `elevation`은 Phase 2 |
| | `annotation_overrides[]{target, dx_mm?, dy_mm?, text?, hidden?}` | JSON | 주석만. 치수·면적 값·형상·표제란 고지는 대상이 될 수 없다(엔진이 무시) |
| | `include_in_proposal` | 불리언 | |
| 파생(D, 저장 안 함) | JudgmentResult(스냅샷 제외), 엔벨로프, SheetModel, DXF/SVG/PDF/PNG 바이트 | - | 내보낼 때만 사용자가 고른 경로에 파일로 |

## 3. 상태 전이

| 대상 | 현재 → 허용 | 누가 | 부수 효과 | 구현 |
|---|---|---|---|---|
| `licenses.status` | active → suspended / refunded / revoked, suspended → active / refunded / revoked. refunded·revoked는 종료 | service(웹훅 환불, 운영) | `status_changed_at`. refunded·revoked면 활성 기기 전부 해제(`deactivation_kind` refund·revoke). suspended는 기기를 남기고 활성화·refresh·클라우드 기능에서 `AR003` | `enforce_license_transition`(2400:645), `after_license_status`(2400:667) |
| `licenses.updates_until` | 증가만(연장 RPC) | service | 주문 id를 `extension_order_ids`에 추가(멱등) | `extend_updates`(2400:952) |
| `license_activations` | 활성(deactivated_at null) → 해제(종료). 되살리기 금지(22023), 다시 쓰려면 새 행 | 셀프 해제 owner/admin, 고객지원 service, 환불 트리거 | 셀프 해제는 조직당 30일 3회(`AR004`), service 해제는 세지 않음. 감사 `license.deactivate` | `enforce_activation_rules`(2400:683), `deactivate_activation`(2400:1498) |
| `builds`·`rule_packs`·`cost_catalogs`.`status` | draft → published / withdrawn, published → withdrawn. 게시 뒤 `version`·`sha256` 불변 | service(CI 게시, 운영) | withdrawn 팩은 자격 목록에서 빠진다(이미 받은 로컬 캐시는 다음 확인 때 비활성화, 제안) | `enforce_release_transition`(2400:702) |
| AI 실행 `renders`·`reviews`·`intake_runs`·`proposals`.`status` | (insert) queued → running / failed, running → succeeded / failed, failed → refunded | service(`start_ai_run`, `finish_ai_run`, `fail_ai_run`, `reconcile_runs`) | 시작 시 선차감·잡 생성. 성공 시 잡 `refund_on_failure=false`. 실패 시 남은 차감액 환불(키 `refund:job:<job_id>`, `fail_job`과 같은 키라 이중 환불 없음) 후 refunded. `request_id`·`org_id`·`credits`·원장 불변 | `enforce_run_transition`(2400:615, service에도 적용, 위반 22023) |
| `cloud_projects.version` | n → n+1(저장마다), 감소 금지 | member+(`save_cloud_project`) | 기대 버전 불일치 `AR041`(조용한 덮어쓰기 금지, `docs/Tauri/README.md:101`) | `enforce_cloud_project_version`(2400:722), `save_cloud_project`(2400:1671) |
| `proposals` | AI 실행과 같음 | service | 같은 내용·버전 템플릿 문서 재요청은 0크레딧 새 행 | 위와 같음 |
| 조직 기능 상태(`org_features.state`, 저장 안 함) | trial → trial_expired / licensed / subscribed, licensed → licensed_fallback(날짜 경과) → licensed(연장), subscribed → subscription_expired | 계산 | 4.3절 표의 기능 집합 선택 | `org_features`(2400:493) |

`org_features` 판정 순서: (1) 활성 라이선스의 최대 `updates_until`이 KST 오늘 이후면 `licensed`(updates_yearly 플랜 features), (2) 활성 `sub_monthly` 엔타이틀먼트면 `subscribed`, (3) 활성 라이선스가 있으면 `licensed_fallback`(SKU `fallback_features`), (4) `trial` 엔타이틀먼트 생성 후 `trial_days` 안이면 `trial`, (5) 그 밖은 만료(`v_expired`: 열람·내보내기만, 대지 조회·채팅·플랜 기기 0). 결과는 PRD 4.8·9.4절 키 전부 + `state`, `updates_until`, `license_ids`, `trial_ends_at`, `plan_code`(`04_API.md:153-164`). 체험 만료를 `app_entitlements.expires_at`으로 끊지 않고 이 함수가 판정한다. 이유: 엔타이틀먼트가 끊기면 RLS가 계정 화면·클라우드 사본까지 숨겨 "열람·내보내기만"(`01_PRD.md:108`)을 지킬 수 없다(제안, PRD 4.2절 `expires_at` 표기와 다름).

## 4. RLS 정책

모든 테이블 RLS ON, 테이블마다 `revoke all ... from public, anon, authenticated` 후 SELECT GRANT만(2400:1729-1795). 사용자 INSERT·UPDATE·DELETE 정책과 GRANT는 어느 테이블에도 없다(`DB_CONVENTIONS.md` 8.1절: 돈·권한·한도·상태가 걸린 테이블). 쓰기는 service_role 또는 아래 DEFINER RPC뿐이고, guard 트리거가 GRANT 실수를 한 번 더 막는다.

| 테이블 | SELECT 정책 | SELECT GRANT 컬럼 | 쓰기 |
|---|---|---|---|
| `license_skus` | anon·authenticated, `is_active` | `fallback_features` 제외 | service |
| `licenses` | `is_org_member(org_id)` 또는 플랫폼 관리자 | `serial_hash`, `order_id`, `extension_order_ids`, `status_reason` 제외 | `issue_license`, `extend_updates`, service 상태 변경 |
| `license_activations` | `is_org_member(org_id)` 또는 플랫폼 관리자 | `device_hash`, `activated_by`, `deactivated_by` 제외 | `activate_license`, `activate_plan_device`, `deactivate_activation` |
| `rule_packs` | published·withdrawn + `has_arch_access()`, 또는 플랫폼 관리자 | `storage_path` 제외 | service |
| `rule_pack_changes` | 게시된 팩의 개정 + `has_arch_access()` | 전체 | service |
| `drafting_profiles`, `cloud_projects`, `renders`, `reviews`, `intake_runs`, `proposals` | `is_org_member(org_id) and has_entitlement(org_id, 'arch')` | 전체 | 각각 `upsert_drafting_profile`, `save_cloud_project`, service AI RPC |
| `runtime_config`, `builds`, `cost_catalogs`, `site_lookups` | 정책 없음 | 없음 | service. 사용자에게는 RPC 결과만 |

viewer는 SELECT만 된다(모든 RPC가 member+ 또는 owner/admin을 요구). 사용자는 자기 플랜(`core.app_entitlements`), 크레딧(`core.wallets`·`credit_ledger`), 라이선스, 기기 행을 바꿀 수 없다: 코어 테이블은 코어 guard, 제품 테이블은 쓰기 GRANT 없음 + guard + 전이 트리거(스모크 "A 자기 플랜 변경 42501", "A 라이선스 상태 직접 변경 42501", "A 기기 활성화 직접 삽입 42501").

함수 EXECUTE(2400:1797-1831): 함수 목록 전체에서 PUBLIC·anon·authenticated를 회수하고 service_role에 준 뒤, authenticated에는 아래만 연다. 모든 DEFINER 함수는 `set search_path = ''`이고 객체 이름은 전부 스키마 한정이다.

| 함수 | authenticated | 안의 호출자 검사 |
|---|---|---|
| `org_features(uuid)` | 예 | `is_service_caller()` 또는 `is_org_member` |
| `deactivate_activation(uuid)` | 예 | 비멤버는 P0002(존재 숨김), owner/admin 아니면 42501 |
| `eligible_rule_packs(uuid default null)`, `latest_cost_catalog(uuid default null)` | 예 | `caller_org`: null이면 개인 조직, 비멤버 42501 |
| `upsert_drafting_profile(jsonb, uuid default null)` | 예 | `caller_org` + owner/admin(`AR042`) + 엔타이틀먼트 |
| `save_cloud_project(uuid, text, text, integer)` | 예 | 경로 첫 폴더의 조직 + member+ + 엔타이틀먼트 |
| `has_arch_access()`, `feature_int`, `feature_bool`, `kst_today`, `valid_user_path` | 예 | 읽기 전용 헬퍼 |
| `issue_license`, `activate_license`, `activate_plan_device`, `extend_updates`, `eligible_build`, `record_site_lookup`, `start_ai_run`, `finish_ai_run`, `fail_ai_run`, `purge_expired`, `reconcile_runs`, `config_int`, `caller_org`, `new_serial_body`, 트리거 함수 | 아니오(service_role만) | 1차 잠금은 EXECUTE 회수, 2차는 `is_privileged_session()`. 스모크가 사용자 호출 42501을 확인 |

## 5. 인덱스와 성능

| 인덱스 | 조회 |
|---|---|
| `licenses.serial_hash` 유일 | 활성화(시리얼 해시 단건) |
| `licenses_org_idx (org_id, status)` | `org_features`, 계정 화면 |
| `license_activations_license_device_uniq`, `_plan_device_uniq`(부분 유일) | 같은 기기 재활성화, 중복 방지 |
| `license_activations_active_idx (license_id) where 활성` | 활성 수 판정(AR001) |
| `license_activations_self_idx (org_id, deactivated_at) where self` | 30일 셀프 해제 수(AR004) |
| `builds (platform, channel, version)` 유일 | 매니페스트 |
| `cloud_projects (org_id, local_id)` 유일, `cloud_projects_org_updated_idx` | 저장, 목록 |
| `renders_active_idx (org_id, status) where queued/running` | 동시 렌더 3건(AR030) |
| `<run>_org_created_idx (org_id, created_at desc)` 4개 | 작업 기록, 일일 상한 합계 |
| `renders_expiry_idx (expires_at) where succeeded and purged_at null`, `intake_runs_expiry_idx` | 보존 정리 |
| `proposals_template_reuse_idx (org_id, content_sha256, template_version) where succeeded` | 재요청 0크레딧 판정 |
| `site_lookups (org_id, lookup_date, pnu_hash)` 유일, `site_lookups_created_idx` | 일일 상한, 90일 정리 |

예상 규모(제안: 사전예약 목표와 사무소 규모 가정): 조직 수천, 조직당 라이선스 1~3, 기기 2~6, 클라우드 사본 100 이하, AI 실행 월 수백. 핫 경로는 `org_features`(요청마다)이며 엔타이틀먼트 1행 + 라이선스 수 행이라 인덱스로 충분하다. 일일 플랫폼 상한 합계는 실행 테이블 4개의 당일 범위 스캔이므로, 하루 실행이 수만 건을 넘으면 일 단위 집계 테이블로 바꾼다(제안).

## 6. 코어 참조

| 코어 객체 | 용도 | 비고 |
|---|---|---|
| `core.organizations`, `org_members`, `is_org_member`, `has_org_role`, `has_entitlement`, `personal_org_id`, `is_platform_admin`, `is_service_caller`, `is_privileged_session` | 조직·권한·호출자 판정 | ALTER 없음 |
| `core.apps`, `plans`, `credit_packs`, `app_entitlements` | 앱 `arch`, 플랜 3, 팩 3, 플랜 features | 조각 13절(2400:1865) `do nothing`, 모듈러 `seed.sql` 반영은 코어 요청 C-4(`01_PRD.md:312`) |
| `core.payment_orders` | 라이선스 발급·연장의 주문 근거(`licenses.order_id` FK) | `kind`에 일회성이 없다(`docs/products/_supabase-modular/migrations/0002_core_billing.sql:140`). 아래 C-1 |
| `core.consume_credits`, `refund_credits`, `grant_credits`, `credit_ledger`, `wallets` | 선차감 `consume:arch:<request_id>`, 환불 `refund:job:<job_id>`, 라이선스 보너스 `license:<license_id>`(pack) | service 전용 함수 안에서만 호출(`DB_CONVENTIONS.md:243`) |
| `core.enqueue_job`, `jobs`, `fail_job`, `cancel_job` | 큐 = job_type(`arch.render`, `arch.review`, `arch.intake`, `arch.proposal_pdf`), 멱등 `job:arch:<request_id>` | `reconcile_runs`가 잡 실패·취소를 실행 행에 반영 |
| `core.write_audit` | 발급·활성화·해제·연장·표제란·사본 저장 | |
| `core.storage_org_id`, 버킷 `org-files`, `exports`, `voice-audio` | 렌더 결과, PDF, 녹음 | |
| `core.ai_routing_settings`, `ai_providers`, `ai_runs`, `ai_usage`, `ai_collections`·`ai_chunks`, `wiki_*`, `resolve_ai_route` | 라우팅 14행(조각 14절), 법령 RAG(`arch.knowledge`), 위키, 원가 | 제품 전용 AI 테이블 없음. 이미지 `arch.render`(fal)는 라우팅 종류(llm·embedding·stt·tts) 밖이라 워커 상수 |
| `core.voice_sessions`, `voice_jobs` | STT(분당 1, `voice:<request_id>`) | |
| `core.rate_limit_hit` | 활성화 API IP당 10회/시간(`01_PRD.md:214`) | Route Handler에서 |
| `core.oauth_states`, `encrypted_credentials`, `affiliate_*` | 쓰지 않는다 | 모놀리스에서 절 제거(8절) |

코어 ALTER 0건. 코어 요청:

| ID | 요청 | 이 문서의 잠정 처리 |
|---|---|---|
| C-1 | `payment_orders.kind`에 일회성 상품(제안 값 `one_time`) + 상품 참조(`metadata.license_sku` 또는 전용 컬럼)와 금액 검증 | `issue_license`는 `kind='one_time'`만 받으므로 C-1 전에는 어떤 주문도 통과하지 못한다(2400:817-818, 스모크 "결제 종류 C-1 전 issue_license 거부"). PRD D-3 (a) 권고대로 우회 결제((b) `billing_interval='none'` 플랜)는 쓰지 않고, 그동안 `POST /api/checkout`의 `license_sku`는 `checkout_unavailable` 409(`04_API.md:46`). 사전예약은 결제 없는 대기 명단으로 받는다(제안). C-1 값 이름이 달라지면 2400:817 한 줄만 바꾼다 |
| C-4 | 모듈러 `seed.sql`에 app `arch`, 플랜·팩 반영 | 조각 13절이 `do nothing`으로 같은 행을 넣는다(조각 단독 적용 가능) |
| R-A11(06장) | `DB_CONVENTIONS.md` 2400 행을 "조각 있음"으로, `AR` "(제안)" 해제 | 문서 변경 요청만 |

인증 단계는 스키마 변경이 없다. 네이버 브리지를 채택하면 코어 `auth_identity_links`를 참조만 한다(`AUTH_ROADMAP.md` 10장).

## 7. 리뷰 "높음" 결함의 차단 설계 (보안, 데이터)

이 제품은 원본 리뷰가 없다. `02_ARCHITECTURE.md:371`이 05장 7절로 넘긴 보안·데이터 7건(#4, #5, #6, #7, #8, #12, #13)과 같은 표의 #11(낡은 규칙 팩, 데이터 측면), 그리고 데이터 모델 고유 위험 6건(#15~#20, 이 문서 신규 번호)을 테이블·RLS·RPC 수준에서 적는다. #4·#5는 `docs/reviews/FortuneDocs.md:43-44`(3장 높음)의 이식 대상이다. 합계 14건.

| 리뷰 #n | 출처 | 결함 요약 | 차단 설계 | 담당 장/작업 |
|---|---|---|---|---|
| 위험 #4(`docs/reviews/FortuneDocs.md` 3장 #4) | `docs/reviews/FortuneDocs.md:43`, `02_ARCHITECTURE.md:378` | `FOR ALL` 정책으로 사용자가 계산 결과 행을 직접 쓴다 | `renders`·`reviews`·`intake_runs`·`proposals`에 쓰기 정책·GRANT 없음 + guard 트리거 + 전이 트리거(service에도 적용). 결과는 `finish_ai_run`만 쓰고 출력 경로가 자기 조직 폴더인지, review 문장마다 출처가 있는지(`AR033`), intake가 고정 스키마인지(`AR032`) 검사. 스모크 "A finish_ai_run 호출 42501", "출처 없는 문장 결과 AR033", "intake 결과에 좌표 키 AR032" | 2.10~2.13, AR-06-001, 002 |
| 위험 #5(같은 리뷰 #5) | `docs/reviews/FortuneDocs.md:44`, `02_ARCHITECTURE.md:379` | 비원자 크레딧 차감, 실패 환불 없음 | `start_ai_run` 한 트랜잭션: 기능 판정 → 단가표 차감액 → `core.consume_credits`(멱등 `consume:arch:<request_id>`) → 실행 행 → `enqueue_job`(원장 연결, `refund_on_failure`). 부족하면 CR001로 전부 롤백. 실패는 `fail_job` 자동 환불 → `fail_ai_run`이 남은 금액만 같은 키로 환불(이중 환불 불가) 후 refunded. 스모크 "지갑 30 - 3 = 27", "환불 후 지갑 24", "다시 실패 처리 22023" | 3절, AR-06-047 |
| 위험 #6(제품: 라이선스 파일 위조) | `01_PRD.md:125`, `02_ARCHITECTURE.md:380` | 라이선스 파일을 고치거나 다른 PC 파일을 복사한다 | DB는 파일을 믿지 않는다: `refresh`·클라우드 기능은 매번 `license_activations`(해제되지 않은 같은 `device_hash`)와 `org_features`로 다시 판정. 서명 개인키·시리얼 원문은 어떤 테이블에도 없다. 환불·회수 시 트리거가 활성 기기를 해제해 재발급이 막힌다. 스모크 "환불 뒤 활성 기기 0", "환불 라이선스 활성화 AR003" | 2.6, 2.7, AR-06-041 |
| 위험 #7(제품: 로컬 SQLite로 오프라인 권한 판정) | `docs/Tauri/README.md:90`, `02_ARCHITECTURE.md:381` | 로컬 DB·localStorage 값을 고쳐 체험 만료·폴백을 우회한다 | 로컬 스키마에 권한 컬럼이 없다(2.16절 규칙 "권한 판정 금지"). `local_settings`의 기능 캐시는 표시용. `license_store`는 Rust만 쓰고 `max_issued_at_seen`으로 시계 되돌림을 잡는다. 서버 쪽은 체험 만료를 `org_features`가 서버 시각으로 계산하고 클라이언트 값을 입력으로 받지 않는다 | 2.16, 3절, AR-06-006, 041 |
| 위험 #8(제품: 데스크톱 번들 비밀 노출) | `02_ARCHITECTURE.md:382` | service_role·서명 키가 설치 파일에 들어간다 | DB 측: 데스크톱(anon 키 + 사용자 세션)이 부를 수 있는 함수는 4절 authenticated 목록뿐이고, 발급·활성화·차감 RPC는 service_role 전용이라 anon 키가 새어도 권한이 생기지 않는다. 테이블에 비밀 컬럼이 없다(시리얼은 해시, 기기는 해시) | 4절, AR-06-058 |
| 위험 #11(제품: 낡은 규칙 팩을 최신으로 오인) | `01_PRD.md:114`, `02_ARCHITECTURE.md:385` | 폴백·장기 오프라인 사용자가 낡은 판정을 최신으로 믿는다 | 팩 자격은 서버 `eligible_rule_packs`만(폴백은 `published_at <= updates_until`, 스모크 "폴백 규칙 팩 1개"). 게시 팩의 버전·해시 불변, 회수 가능(트리거). `rule_pack_changes`가 "이후 개정 n건" 제목을 주고 로컬 `rule_pack_cache.changes_checked_at`이 30일 경과 배너 근거. `reviews`·`judgment_snapshots`·`exports`에 `rule_pack_version` 필수 | 2.4, 2.16, AR-06-015 |
| 위험 #12(제품: 딥링크 콜백 주입) | `02_ARCHITECTURE.md:386` | 가짜 `code`로 로그인 흐름을 가로챈다 | DB 측: 세션이 없거나 다른 사용자 세션이면 활성화가 다른 조직 시리얼에 붙지 않는다(`activate_license`가 `p_user`의 member+ 멤버십 확인, 다른 조직 `AR006`, viewer도 `AR006`). `p_user`는 Route Handler가 검증한 세션에서만 넣는다 | 2.7, AR-06-062 |
| 위험 #13(제품: 가져오기 경로 조작·과대 파일) | `02_ARCHITECTURE.md:387` | 임의 경로를 읽거나 과대 파일로 멈춘다 | 로컬은 `exports.path_hash`만 저장하고 경로 원문을 DB에 두지 않는다(대화상자 경로만, Rust). 클라우드 쪽은 #20 | 2.16, AR-06-006 |
| 위험 #15(데이터: 시리얼 무차별 대입) | `01_PRD.md:121`, `:126` | 시리얼을 추측해 남의 라이선스를 활성화한다 | 시리얼 본문 100비트 무작위(`gen_random_bytes`, 2400:473), 서버는 SHA-256만 저장, 활성화는 로그인 + 같은 조직 member+만(`AR006`), 활성화 API IP당 10회/시간(`core.rate_limit_hit`). 화면·API 응답은 끝 5자만. 발급 RPC 재호출은 시리얼 원문 null | 2.6, AR-06-040 |
| 위험 #16(데이터: 기기 활성화 남용) | `01_PRD.md:126` | 해제·재활성화를 반복해 PC 2대 제한을 무력화한다 | 활성 수 ≥ `max_activations`면 `AR001`(행 잠금으로 동시 요청 직렬화), 셀프 해제 조직당 30일 3회(`AR004`, 자문 잠금), 해제 행은 되살릴 수 없다(22023), 체험·구독 기기도 `activate_plan_device`가 `org_features.max_activations`(1)로 센다. 스모크 "기기 3 AR001", "셀프 해제 4번째 AR004", "체험 기기 2대째 AR001" | 2.7, 3절 |
| 위험 #17(데이터: 클라이언트가 보낸 org_id) | `docs/Tauri/README.md:103`, `docs/products/arch-studio/CLAUDE.md` 2장 | 요청 본문의 org_id로 다른 조직 자원을 쓴다 | service RPC는 Route Handler가 세션에서 정한 `p_org`·`p_actor`만 받고 함수가 `p_actor`의 멤버십을 다시 확인한다. 같은 `request_id`가 다른 조직 것이면 42501. authenticated RPC는 `caller_org`(비멤버 42501) 또는 경로 첫 폴더 조직의 역할을 확인한다. 스모크 "같은 request_id 를 다른 조직으로 42501", "비멤버 행위자 42501", "다른 조직을 지정한 규칙 팩 조회 42501" | 4절, AR-06-047 |
| 위험 #18(데이터: request_id 재전송 이중 차감) | `DB_CONVENTIONS.md` 9장 | 네트워크 재시도로 같은 작업이 두 번 차감된다 | `request_id` 유일(실행 테이블 4개) + 자문 잠금 `arch:run:<request_id>` + 원장 멱등 키 + 잡 멱등 키. 재호출은 기존 `(run_id, job_id, credits)` 반환, 추가 차감 없음. 스모크 "같은 request_id 재호출은 차감 없이 같은 실행", "원장 1행" | 2.10~2.13 |
| 위험 #19(데이터: 표제란·대지 조회의 개인정보) | `01_PRD.md:226`, `:451` | 건축주 이름·연락처, 주소·지번이 클라우드에 쌓인다 | `drafting_profiles`에 건축주 컬럼 없음 + 허용 키 밖 22023(스모크 "건축주 이름 키 22023"), 감사에 값 대신 키 이름만. `site_lookups`는 지번 HMAC과 날짜만, 90일 삭제. `intake_runs` 원문 90일 삭제, 상담 녹음은 원문 텍스트 미저장(STT 결과 경로만). DesignModel `parcel`은 클라우드 사본·검토 입력에서 뺀다(2.17절) | 2.8, 2.12, 2.14 |
| 위험 #20(데이터: Storage 경로 조작) | `04_API.md:20`, `SECURITY_BASELINE.md` 10장 | `..`·다른 조직 폴더 경로로 남의 파일을 읽거나 덮는다 | 모든 경로 컬럼과 RPC 입력이 정규식으로 `<org_id>/arch/<purpose>/[<uuid>/]<uuid>.<ext>`만 받는다(`valid_user_path`, 2400:443; `..`·임의 이름 불가). 클라우드 사본은 경로 첫 폴더 조직의 member+만, 렌더 입력·제안서 시트·로고·결과 PDF도 자기 조직·목적 폴더만. 제품 버킷은 사용자 정책이 없어 서명 URL로만 접근. 스모크 "경로 조작(..) 23514", "다른 조직 입력 경로 23514", "다른 목적 폴더 23514" | 2.15, AR-06-047 |

## 8. 모놀리스와 모듈러의 차이

| 항목 | 모듈러(`2400_arch.sql`) | 모놀리스(`0002_arch_domain.sql`) |
|---|---|---|
| 스키마 | `arch` | `public`. `core.apps.schema_name='public'`(seed) |
| 함수·테이블 이름 | `arch.*`, `core.*` | `public.*`(이름·시그니처 동일). 앱은 `SUPABASE_DB_SCHEMA`로 전환 |
| 큐·기능 키·감사 문자열 | `'arch.render'`, `'arch.' \|\| p_kind` 등 | 그대로(문자열 리터럴은 변환하지 않는다) |
| 스키마 블록 | `create schema`, 기본 권한, apps 행(`@modular-only` 블록) | 제거 |
| 권한 정리 | 테이블·함수 목록 반복(스키마 변수 `'arch' /*@schema*/`) | 같은 목록, 변수만 `'public'`. public의 코어 객체 권한을 건드리지 않는다 |
| 플랜·팩·상품·라우팅 | 조각 13·14절(`@monolith-seed` 블록) | `seed.sql`로 이동 |
| 운영 상수(`runtime_config`), 버킷 | 조각 11·12절 | 0002 안에 그대로(설정 데이터) |
| 코어 | 0000~0009 | `0001_core_lite.sql`: SECTION 6-A(oauth_states), 6-B(encrypted_credentials), 9(affiliate) 제거(제3자 OAuth 연결·서버 보관 키·제휴 링크가 없음. 9는 6-B 의존). 3(Toss), 4(크레딧), 6-C(레이트 리밋), 7(잡), 8(Storage), 11(AI), 12(음성) 유지 |
| 가입 | `signup_app='arch'` 메타데이터 | apps 1행이면 자동 부트스트랩 |

변환 규칙은 `DB_CONVENTIONS.md:247-269`: `@modular-only`·`@monolith-seed` 블록 분리, 식별자 `core.`·`arch.` → `public.`(문자열 리터럴 제외), 스키마 변수 치환. 변환 스크립트는 AR-06-001 소유(`scripts/db/**`)이고 두 파일 본문은 변환 외에 같아야 한다(`--check` diff 0). 이 문서의 모놀리스 파일은 같은 규칙으로 만들었다.

## 9. 마이그레이션 파일

| 파일 | 줄 | 내용 |
|---|---|---|
| `docs/products/_supabase-modular/migrations/2400_arch.sql` | 1,940 | 모듈러 조각(정본). 1 카탈로그, 2 라이선스·기기, 3 표제란·사본, 4 AI 실행, 5 헬퍼·`org_features`, 6 트리거, 7 서버 RPC 10개, 8 사용자 RPC 5개, 9 RLS·GRANT, 10 EXECUTE, 11 Storage, 12 운영 상수, 13 플랜·팩·상품, 14 라우팅 14행 |
| `docs/products/arch-studio/supabase/monolith/migrations/0001_core_lite.sql` | 3,211 | 코어 축소판 복사본(SECTION 6-A, 6-B, 9 제거, 각 자리에 사유 주석) |
| `docs/products/arch-studio/supabase/monolith/migrations/0002_arch_domain.sql` | 1,852 | 도메인 변환본 |
| `docs/products/arch-studio/supabase/monolith/seed.sql` | 89 | apps 1, 플랜 3(trial 기본, updates_yearly, sub_monthly), 팩 3(pack_100/550/1200), 라이선스 상품 2, 라우팅 14 |
| `docs/products/arch-studio/supabase/monolith/tests/rls_smoke.sql` | 375 | RLS·권한·RPC 회귀 125항목(행위자 A·M·V·B·C·anon·service) |
| `docs/products/arch-studio/supabase/monolith/tests/run-smoke.mjs` | 114 | 러너. `node products/arch-studio/supabase/monolith/tests/run-smoke.mjs --target mod\|mono` |

seed 값(전부 제안, 정본 `01_PRD.md:87-94`, `:149-155`, `:175-185`, `:400-406`):

| 플랜 | 가격 | 주기 | plan 크레딧 | 가입 크레딧 | features 요약 |
|---|---|---|---|---|---|
| `trial`(기본) | 0 | none | 0 | 30 | 검토·팩·렌더·intake true, GPU·layout false, 1024px, 대지 10/일, 채팅 20/일, 사본 3, 기기 1, 워터마크 true |
| `updates_yearly` | 290,000 | year | 480 | 0 | 전부 true, 4096px, 30/일, 200/일, 사본 100, 기기 2, 워터마크 false |
| `sub_monthly` | 49,000 | month | 150 | 0 | 위와 같고 기기 1 |
| 폴백(`license_skus.fallback_features`) | - | - | - | - | 검토·팩·GPU·layout false, 렌더·intake true, 4096px, 대지 30, 채팅 0, 사본 100, 기기 2, 워터마크 false |

검사 명령(`docs/products/_tools-sqlcheck/README.md`):

| 명령 | 결과 |
|---|---|
| `node check.mjs --vector mod ../_supabase-modular/migrations/000*.sql ../_supabase-modular/seed.sql ../_supabase-modular/migrations/2400_arch.sql` | 전부 OK |
| `node check.mjs --vector mod ... 000*.sql 2400_arch.sql seed.sql 2400_arch.sql`(순서 바꿈 + 재적용) | 전부 OK |
| `node check.mjs --vector mono ../arch-studio/supabase/monolith/migrations/*.sql ../arch-studio/supabase/monolith/seed.sql` | 전부 OK |
| `node products/arch-studio/supabase/monolith/tests/run-smoke.mjs --target mod` / `--target mono` | 125/125, 125/125 |

계약과 다른 점(04장과 맞출 것):

| 항목 | 이 문서 | 이유 |
|---|---|---|
| `eligible_rule_packs`, `upsert_drafting_profile` | 끝에 `p_org uuid default null` 추가(계약 형태로 인자 없이 호출 가능) | 다중 조직 사용자가 현재 조직을 고르게. null이면 개인 조직 |
| `latest_cost_catalog(p_org)` | 신규 RPC | 단가표를 자격별로만 주기 위해 테이블 GRANT를 두지 않았다(04장 `GET /api/cost-catalogs/latest`는 이 RPC를 호출) |
| `purge_expired()`, `reconcile_runs(p_org)` | 신규 service RPC | 보존 정리(워커 크론), 잡만 끝난 실행 정리 |
| `AR034` | 신규 SQLSTATE: 일일 플랫폼 크레딧 상한 | 04장 앱 코드 `AI_DAILY_LIMIT` 429에 대응. 04장 7.1절 표에 반영됨(AR030 행과 병합) |
| `start_ai_run`의 `layout`·`walkthrough` | 시그니처는 받되 22023으로 거부 | Phase 2라 실행 테이블이 없다. 착수 때 테이블과 분기 추가 |
| 반환형 | `activate_license` → jsonb(활성화 + 라이선스 요약), `finish_ai_run`·`fail_ai_run` → jsonb(`run_id`, `kind`, `status`) | 실행 테이블이 4개라 한 행 타입으로 돌려줄 수 없다 |
| `site_lookups.pnu_hash` | HMAC-SHA-256(서버 키) | 2.14절 |
| 체험 만료 | `app_entitlements.expires_at` 대신 `org_features`가 `trial_days`로 계산 | 3절 끝 |
