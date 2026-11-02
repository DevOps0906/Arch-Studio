# 병렬 구현 정리표 (2026-11-03)

기준 `6436534`. 로컬 = `local/parallel-2026-11-02`(= main = `origin/local/parallel-2026-11-02`, 백업 push 됨). 원격 = `origin/main`(058a·050·051·053·054 결정 병합됨) + 기능 브랜치 `feat/ar-06-073` ⊂ `feat/ar-06-072`, `feat/ar-06-073` ⊂ `feat/ar-06-049`, `feat/ar-06-086`, `feat/ar-06-054-api`, `wip/ar-06-054-web`.
읽기 전용 조사(git log·show·diff). 테스트 수는 테스트 선언 수 grep 근사값.

## 1. 요약 표

| 작업 | 로컬 | 원격 | 핵심 차이 | 마이그레이션 | 권고 |
|---|---|---|---|---|---|
| 050 RAG | 3커밋, 리뷰 1회, 테스트 ~38 | origin/main 4커밋, 리뷰 🔴4 반영, 테스트 18 | 로컬=관할·종류 메타·위키 lint 넓음 / 원격=`search_effective` 재조회·`SearchResult`·(org,collection) 키 격리 | 양쪽 없음(로컬은 함수 제안만) | **원격** + 로컬 관할 필터·lint 규칙 이식 |
| 051 법규 검토 | 5커밋, 리뷰 3회(숫자 차단 구조화) | origin/main 6커밋, code+security 리뷰 | 로컬=parts[Text\|Ref] 허용 집합 숫자 차단 / 원격=Ed25519 팩 서명·api 배선·(job_id,attempt) | 없음 | **합치기**: 원격 기반 + 로컬 숫자 차단 이식 |
| 053 음성 | 3커밋, 보안 리뷰 1회 | origin/main 5커밋, code+security 리뷰 | 로컬=상담 녹음(워커 arch.stt) 포함·분당 정산 / 원격=받아쓰기만·정액 1·킬 스위치 | 없음 | **원격** (로컬 상담 녹음은 052용 보관) |
| 049 라우팅·보안 | 3커밋, 보안 리뷰, SQL 실행·변이 6종 | feat 3커밋(+073), 보안 리뷰, SQL 미실행(docker 없음) | 로컬=테스트만 / 원격=2403 마이그레이션·공개 지식 래퍼 | 원격 2403·`20261102000002` | **합치기**: 원격 마이그레이션 + 로컬 테스트·변이 |
| 072 웹 어댑터 | 3커밋, 리뷰 2회, blob GET 서버 구현 | feat 2커밋(073 위), 리뷰 1회 | 로컬=같은 출처·blob 라우트·오류 코드 5종 / 원격=baseUrl 주입(D-071a)·JWT 주체 캐시 가드·삭제 지원 | 없음 | **원격** + 로컬 blob 라우트·errors.ts 이식 |
| 073 클라우드 저장 | 3커밋, 리뷰 🟡 | feat 4커밋, security+contract 리뷰 | 로컬=RPC authenticated 5인자 / 원격=service_role 전용 9인자·DELETE·advisory lock | **둘 다 2402·`20261102000001`(이름 다름) — 충돌** | **원격** (로컬 ERD·타입 재생성은 원격 스키마로 다시) |
| 086 주석 편집층 | 3커밋, 리뷰 반영 | feat 3커밋, contract+code ACCEPT | 로컬=STD_LAYERS에 A-ANNO-USER·고아 3사유 / 원격=STD 밖·`orphan_anchor`·zod↔pydantic 판별 유니온 동치 | 없음(로컬은 DB v_std 후속 필요) | **원격** + 로컬 `orphan_moved` 스냅숏은 후속 |
| 054 채팅 | 3커밋 완료, 리뷰 3차 | api 완료(리뷰 없음)·web WIP(미검증) | 로컬=Dify 핵심 경로+X-Internal-Key / 원격=Dify 제외·web 서명 토큰 scope=chat | 없음 | **합치기**: 원격 설계 + 로컬 web 과금·SSE 조각 |

## 2. 작업별

### 050 RAG 색인
1. 커밋 — 로컬: ab509a5, 26e12d2, 5ca40fe(+a000e27 문서). 원격(origin/main): d61b6f5, e2c2b1d, 3b52cda, 5237e18, 0786a94(mypy).
2. 설계 차이
   - 로컬: `knowledge/{metadata,index,evaluation}.py`, 관할(시군구 5자리)·kind·attribution 메타, JSON 픽스처 16판, `scripts/arch-ingest/run.py` CLI, 위키 lint 10여 규칙. DB 검색 함수는 제안만.
   - 원격: `knowledge/{embedding,store,search,example_corpus}.py`, `arch.match_public_knowledge`(049 원격) 시그니처 흉내, k·4 오버샘플 재조회·`insufficient/truncated`, (org, collection, id) 저장 키. 원격 051·054가 이 모듈(`search_effective`, `Hit`, `KnowledgeStore`)을 import.
3. 리뷰·테스트 — 로컬: 리뷰 1회(DB 메타 왕복·예시 차단), 테스트 ~38(ingest 11·filter 12·lint 15). 원격: reviewer(code) REQUEST_CHANGES 🔴4 반영, test_rag 18.
4. 충돌 파일 — `ingest/__init__.py`·`pipeline.py`, `knowledge/__init__.py`, `wiki_config.py`, `tests/arch/rag/__init__.py`, 로그·tasks/README.
5. 권고 **원격** — 원격 051·054·049 래퍼와 한 사슬이라 바꾸면 셋 다 깨진다. 로컬 관할 필터·위키 lint 규칙·JSON 코퍼스는 후속 이식.

### 051 클라우드 법규 검토
1. 커밋 — 로컬: 1f283e2, bc92663, 6f60630, 666c065, 217305e(병합 0e75443·93fb549). 원격: e715cb1, d59c1c5, 8c5df27, c07c429, be3d91f, e23e976.
2. 설계 차이
   - 숫자 차단: 로컬은 LLM 문장을 `parts[Text|Ref]`로 받아 허용 문자 집합·한글 수사 닫힌 집합·`validate_free_text` 단일 판정(로마 숫자·원문자·한자 우회까지 막음), 04_API 4.2 `nature` 추가. 원격은 `{ref:}` 자리표시자 + 맨숫자 거부(정규식 계열).
   - 보안: 원격만 팩 Ed25519 서명 검증(`server/rule-packs/verify.ts`, `ARCH_RULEPACK_PUBKEYS` 실패 닫힘). 로컬은 sha256·크기 대조만.
   - 배선: 원격은 `routes/graphs.py`·`runs.py`·(job_id, attempt)·워커 `reader.ts`(arch.reviews에서 서버 판정 읽기)까지. 로컬은 api 배선을 "팀장 확인 필요"로 남김.
3. 리뷰·테스트 — 로컬: 리뷰 3회(재리뷰 우회 2회 → 고문 진단 → 구조화), api 그래프 ~26·web 12·worker 9. 원격: code REQUEST_CHANGES + security/contract ACCEPT 반영, 그래프 ~21·web 12·worker 10.
4. 충돌 파일 — `compliance/arch.py`, `graphs/arch_review.py`, `products/arch/schema.py`, web `server/ai/review/{config,deps,service,service.test}.ts`·`route.ts`, `next.config.ts`, web `package.json`, `pnpm-lock.yaml`, worker `handlers.ts`·`handlers/review/{config,handler,handler.test}.ts`, 04_API.md.
5. 권고 **합치기** — 원격 기반(서명 검증·배선·050 사슬), 로컬의 `validate_free_text`·parts 구조·유니코드 전수 테스트를 원격 그래프 resolve_refs/compliance에 이식.

### 053 음성
1. 커밋 — 로컬: 424e856, 521a8dc, 5fe3068. 원격: b82a1ec, bf4f8e8, 8c147ed, 20dbd9c, 6c4c7d3.
2. 설계 차이
   - 범위: 로컬은 상담 녹음(`core.voice_jobs`·enqueue `arch.stt`·워커 핸들러) 포함. 원격은 challenger 🔴4로 상담 녹음을 052로 이관, 받아쓰기·UI·읽어 주기만.
   - 과금: 로컬은 분당 선차감 후 실제 길이 정산, nonce로 원장 신규 여부 판정. 원격은 요청당 정액 1, 원장 선조회 + inflight 가드, 킬 스위치 `ARCH_VOICE_STT_ENABLED` 기본 off.
   - UI: 로컬 `voice/{model.ts,index.tsx}`, 원격 `voice/{dictation,speech,transcribe,browser}.ts`·api-client 바이너리 전송.
3. 리뷰·테스트 — 로컬: 보안 리뷰 1회, web 16·worker 6·features 5. 원격: code 🔴1🟠2 + security 🟠3 반영, web 20+통합 2·features 12.
4. 충돌 파일 — `app/api/voice/stt/route.ts`, `server/voice/{config,deps,provider,service,service.test,supabase-repo}.ts`, `features/src/voice/index.tsx`(로컬)와 `index.ts`(원격) 공존 → 모듈 해석 충돌, `packages/features/package.json`, worker `handlers.ts`, `.env.example`.
5. 권고 **원격** — 이미 origin/main, 범위 결정이 문서화됨. 로컬 `workers/.../handlers/stt/**`·상담 접수 코드는 052 착수 때 참고용(브랜치 보관). nonce 신규 판정은 원격 "프로세스 간 이중 호출" 한계 보강 후보.

### 049 라우팅 seed 검증·AI 보안 테스트
1. 커밋 — 로컬: 0bb8735, 871b755, 6a64a53. 원격(feat/ar-06-049): a9ef64d, 58504ef, 0b43b85, d167753(+073 포함).
2. 설계 차이
   - 원격: 강제 라우팅 14행을 `2403_arch_ai_routing.sql` 마이그레이션으로 멱등 upsert, `arch.public_knowledge_collections`·`arch.match_public_knowledge`(service_role, `core.is_service_caller()` 가드), `convert.mjs assertRoutingParity`, rls_smoke +22 TEST.
   - 로컬: DB 변경 0. `scripts/ai-routing/`(문서 표↔seed 대조 9건, security.sql 14건), `tests/arch/security/test_ai_binding.py`(12), 변이 6종 실제 실행·원복, 루트 `test:ai-routing`.
   - 불변식 표현: 로컬 "국외 미동의 → cross_border 0"과 원격 "국외 제공자 0"은 같음.
3. 리뷰·테스트 — 로컬: 보안 리뷰 반영, SQL 테스트 실제 실행(이 PC에 로컬 Supabase 있음). 원격: 보안 리뷰 🟠2 반영, SQL 테스트 미실행(docker 없음 → CI db 잡 의존).
4. 충돌 파일 — `apps/web/src/server/ai/pricing.test.ts`(양쪽 수정), 루트 `package.json`(로컬 `test:ai-routing` vs 원격 058a `test:ci`·`scan:secrets`), `tasks/logs/AR-06-049.md`.
5. 권고 **합치기** — 원격 마이그레이션·래퍼를 정본으로, 로컬 `scripts/ai-routing/**`·`test_ai_binding.py`를 추가하고 2403 이후 값으로 대조하게 고친 뒤 이 PC에서 test:rls·security.sql 실행.

### 072 웹 어댑터
1. 커밋 — 로컬: ee171af, 6999c09, f73a1d2. 원격(feat/ar-06-072, 073 위): d807cc3, 799df22.
2. 설계 차이
   - 출처: 로컬 `WebHttp`는 같은 출처 `/api/*`·`credentials:"same-origin"` 기본 → D-071a(스튜디오=다른 출처 SPA, Bearer만, 쿠키 없음)와 어긋남. 원격은 baseUrl·토큰 주입.
   - 서버: 로컬은 `GET /api/cloud-projects/[id]/blob` 라우트·`blob.ts`(+테스트 8) 구현, 삭제 NOT_SUPPORTED. 원격은 blob 라우트 없음(가짜 서버로만 검증), 삭제는 원격 073 DELETE 사용.
   - 캐시: 로컬 키 user:org:id + version·bytes 적중, 오류 코드 5종(QUOTA_EXCEEDED 등) 추가. 원격 `guarded-cache.ts` JWT sub|org 주체 가드·epoch, 네트워크 실패 시 캐시 반환, https 서명 URL·본문 상한.
3. 리뷰·테스트 — 로컬: 리뷰 2회(REQUEST_CHANGES → 재리뷰), shell-bridge 120(웹 adapters ~23). 원격: 리뷰 REVISE 🟠2 반영, shell-bridge 123(web.test ~17).
4. 충돌 파일 — `shell-bridge/src/{index,web/adapters,web/entitlement,web/file-gateway,web/http,web/project-store}.ts`, 로컬 `server/cloud-projects/{deps,log,supabase-repo}.ts`(원격 073과도 충돌), 04_API.md.
5. 권고 **원격** — 원격 073 API·D-071a와 맞음. 로컬 blob GET 라우트(원격 073 열 이름 `blob_bytes` 등에 맞춰)와 `adapters/errors.ts` 코드 추가분 이식.

### 073 클라우드 프로젝트 저장
1. 커밋 — 로컬: 207af12(결정), d300fb1, b5b235c. 원격(feat/ar-06-073): 164d905(결정), b36dd7a, b46c337, 0843c34(+058a 병합).
2. 설계 차이
   - 권한: 로컬 `save_cloud_project` 5인자 authenticated grant, RPC 안에서 storage.objects 재검사. 원격 9인자 **service_role 전용**, route가 세션·web_edit·레이트·객체 재검사, 조직 advisory lock + FOR UPDATE.
   - 범위: 원격만 `DELETE /api/cloud-projects/[id]` + 삭제 RPC·감사 로그·purge 페이지. 원격 `uploads/policy.ts` 수정.
   - 산출: 로컬만 `erd.mmd/svg`·`supabase.gen.ts`·`apps/web/src/types/supabase.ts` 재생성.
3. 리뷰·테스트 — 로컬: 리뷰 🟡 반영, service.test ~21, rls_smoke +~19 TEST. 원격: security+contract REVISE 🔴0 반영, service.test ~23, rls_smoke +~31 TEST, test:rls 미실행.
4. 충돌 파일 — `supabase/modular/2402_*`·`migrations/20261102000001_*`(파일명 다름, 버전 같음), `scripts/db/convert.mjs`(TARGETS), `supabase/tests/rls_smoke.sql`, `server/cloud-projects/{deps,errors,service,service.test,supabase-repo}.ts`, `app/api/cloud-projects/route.ts`, 로그·NOW·README.
5. 권고 **원격** — 보안 모델(service_role 전용 RPC)이 강하고 072·049가 그 위에 쌓임. ERD·타입은 원격 스키마 기준으로 이 PC에서 다시 생성.

### 086 도면 주석 편집층
1. 커밋 — 로컬: 40f2433, 6ce4b1a, fa29064. 원격(feat/ar-06-086): 15280c9, 9df425b(main 병합), 34f61e2.
2. 설계 차이
   - 레이어: 로컬은 `A-ANNO-USER`를 STD_LAYERS 끝에 추가(web `drafting-profile/layers.ts`·settings 16→17 동반, DB v_std 마이그레이션 전엔 이름 변경 저장 22023). 원격은 STD 밖 `USER_LAYER`, DB·pydantic StdLayer 무변경.
   - 고아: 로컬은 앵커에 좌표 스냅숏 → `orphan_missing·orphan_index·orphan_moved`, `unapplied_overrides`→`unapplied` 계약 교체. 원격은 `orphan_anchor` 1개 추가(기존 계약 유지), index 밀림은 후속.
   - 저장 키: 로컬 `arch.sheets.v2` 단일, 원격 `arch.sheets.v2.<id>` 시트 단위 격리·대시보드 공용 함수. 원격만 zod↔pydantic 판별 유니온 동치·음성 테스트 8, `--hash-only` 골든 갱신 도구.
3. 리뷰·테스트 — 로컬: 리뷰 반영 1회, corpus 36(17+19), user.test ~7. 원격: contract+code ACCEPT(🟡5 후속), corpus 66, user.test ~10·storage.test ~5, api pytest 520.
4. 충돌 파일 — 골든 90여 개 전부(양쪽 input_hash 재발급, 해시 값이 서로 다름), `domain/src/sheet.ts`, `drafting/src/{annotate,layers,sheet,writers}/**`, `features/src/sheets/**`, `apps/api/.../schema.py`, 계약 corpus, `drafting.handlers.ts`.
5. 권고 **원격** — 골든은 한쪽만 통째로 가져가야 하고, 원격이 계약 변경이 작고 동치 테스트가 강함. 로컬 좌표 스냅숏(`orphan_moved`)은 원격 후속 "안정 정점 id" 항목에 설계안으로 첨부.

### 054 법규 질의 채팅
1. 커밋 — 로컬: 4144253, 52a9f5c, 9a19e61(병합 f3a963a). 원격: 441bd33(결정, origin/main), 6bb9692(feat/ar-06-054-api), 7d62406(wip/ar-06-054-web, "미검증, 병합 금지").
2. 설계 차이
   - 경로: 로컬은 web → Dify(arch-chat) → FastAPI `/tools/answer`(`X-Internal-Key`) + 장애 시 `/tools/answer-direct` 폴백, apps/api 기동에 `DIFY_INTERNAL_API_KEY` 필수(운영 기동 조건 변경). 원격 결정은 Dify를 핵심 경로에서 빼고 web이 EdDSA 토큰(scope=chat, org·conv·req 클레임)으로 FastAPI 직접 호출.
   - 과금: 둘 다 턴 1·no_source 환불. 로컬은 nonce 원장 대조 409·중단 환불·환불 실패 alert, 원격은 request_id로 대화 id 결정·저장 답 재전송, 킬 스위치 `ARCH_AI_CHAT_ENABLED`.
   - 검색: 로컬 api는 로컬 050 `ScoredChunk`를, 원격 api는 원격 050 `search_effective`를 import → 050 선택과 묶임.
3. 리뷰·테스트 — 로컬: 리뷰 3차 정정 반영, api ~14·web ~16, 전체 lint·typecheck·pytest 통과. 원격: api ~13(리뷰 없음), web ~14(WIP, 미검증).
4. 충돌 파일 — `apps/api/app/ai/tools/{__init__,arch/__init__,arch/answer}.py`, `app/main.py`, `infra/dify/arch-chat/README.md`, web `server/ai/chat/{config,deps,service,service.test,supabase-repo}.ts`·`route.ts`, `server/ai/gateway/start-run.test.ts`, 로그.
5. 권고 **합치기** — 원격 결정(Dify 제외, 서명 토큰)을 정본으로 api는 feat/ar-06-054-api, web은 WIP를 끝내되 로컬 `chat/service.ts`의 nonce 대조·환불 표·abort 환불·SSE 순서를 옮기고 code+security 리뷰.

## 3. 원격에만 있는 작업과 로컬 충돌 지점

| 커밋 | 내용 | 로컬과 충돌 |
|---|---|---|
| 6859f85 | `.claude/settings.json` 읽기 차단에 `./.env.*` | 파일 충돌 없음. 이 규칙이 `.env.example`도 막아 원격은 env 이름을 못 넣음 → 로컬 `.env.example` 추가분을 수동으로 살려야 함 |
| de0cf8b | Dependabot·SECURITY.md | 충돌 없음. 원격에 열린 dependabot 브랜치 7개(cargo png·resvg·sha2·tiny-skia·usvg, pip 2) 별도 처리 |
| 2bb18c5 | 보안 레벨 L2 확정 | README.md(로컬 0796bdb 진행 현황), 01_PRD, 09_SECURITY_PLAN 텍스트 충돌 |
| 22a646a·2af7a5e | 058a CI(web·api·db·desktop-build·guard·supply-chain), 키 모양 비밀 스캐너, golden.yml | 루트 `package.json` scripts 충돌(로컬 `test:ai-routing`). 로컬 코드가 새 CI(api mypy·zod 동치, scan:secrets)를 통과해야 함 — 로컬 변경분 키 모양 grep은 0건. `test:ai-routing` CI 연결 필요 |
| f7b37c7 | envelope 테스트 CRLF 수정 | 충돌 없음(로컬은 같은 테스트가 CRLF에서 실패할 수 있음) |
| 0132a03 | D-071a: 스튜디오=Vite SPA 다른 출처·Bearer만·CORS 1출처 | 04_API.md·02_ARCH·03_SCREENS_UX 텍스트 충돌(로컬 051·054·072·073·086도 수정). 설계 충돌: 로컬 072 same-origin·credentials |
| 7008efa | 071 착수 결정(팝업 OAuth·Vercel·CORS) | 로컬 071 없음, 충돌 없음 |
| 3ea0493 | SBOM을 `@cyclonedx/cdxgen` 12.9.0(루트 devDep)으로 | `pnpm-lock.yaml` 충돌(로컬 051이 web에 `@arch-studio/rules` 추가) → lock 재생성 |
| 0786a94 | 050 테스트 mypy 수정 | 원격 050 채택 시 그대로 |
| 441bd33 | 054 착수 결정 | 로컬 054 설계와 정면 충돌(위 054 절) |

env 이름 불일치(정리 때 하나로): 로컬 `ARCH_AI_API_URL` ↔ 원격 `ARCH_API_URL`, 로컬 `ARCH_VOICE_STT_PROVIDER`·`ARCH_VOICE_CONSULT_ENABLED` ↔ 원격 `ARCH_VOICE_STT_ENABLED`, 원격 `ARCH_RULEPACK_PUBKEYS`·`ARCH_AI_CHAT_ENABLED` 미기재, 로컬 `DIFY_*` 4개는 원격 054 설계에서 불필요.

## 4. 마이그레이션 번호 충돌

| 위치 | 로컬 | 원격 |
|---|---|---|
| modular | `2402_cloud_projects.sql` | `2402_arch_cloud_projects.sql`, `2403_arch_ai_routing.sql`(049) |
| migrations | `20261102000001_cloud_projects.sql` | `20261102000001_arch_cloud_projects.sql`, `20261102000002_arch_ai_routing.sql`(049) |

- **충돌 있음**: 같은 버전 `20261102000001`·같은 조각 번호 2402에 내용이 다른 두 파일. 둘 다 `cloud_projects`를 ALTER하고 옛 4인자 `save_cloud_project`를 drop한 뒤 서로 다른 새 시그니처(5인자 authenticated / 9인자 service_role)를 만든다 → 함께 두면 버전 중복 오류 또는 오버로드 2개(PGRST203).
- 한쪽만 남긴다(권고: 원격). 로컬 2402 파일 쌍과 `convert.mjs` TARGETS 로컬 항목 삭제.
- 이 PC 로컬 Supabase에는 로컬 2402가 적용돼 있을 수 있다(049 변이 확인 때 db reset) → 전환 후 `supabase db reset` 필수. 운영 DB 적용 여부는 확인 필요(로그상 운영 데이터 없음).
- origin/main·086·054에는 새 마이그레이션 없음.

## 5. 추천 정리 순서

1. **기준 = origin/main**에서 통합 브랜치를 만든다(058a CI·L2·Dependabot·D-071a·050·051·053 포함). 로컬 브랜치는 `origin/local/parallel-2026-11-02`로 보존.
2. **DB 사슬**: `feat/ar-06-073` → `feat/ar-06-072` → `feat/ar-06-049` 순 병합(2402·2403, 20261102000001·2). 이 PC에서 `db reset` → `pnpm test:rls`·`node scripts/db/convert.mjs --check` 실행(원격은 docker 없어 미실행). 로컬 072 blob GET 라우트·errors.ts 코드, 로컬 049 `scripts/ai-routing/**`·`test_ai_binding.py` 이식, ERD·타입 재생성.
3. **`feat/ar-06-086` 병합**(골든은 원격 것 통째). 로컬 `orphan_moved` 스냅숏은 후속 행으로.
4. **AI 보강**: 051에 로컬 `validate_free_text`·parts 구조 이식(reviewer code). 054는 `feat/ar-06-054-api` + WIP web 완료, 로컬 chat 과금·SSE 조각 이식 후 code+security 리뷰. 053 로컬 상담 녹음은 052 착수 자료로.
5. **마무리**: `.env.example` 이름 통일, `pnpm-lock.yaml` 재생성, 04_API·tasks/README·NOW 정합, `test:ai-routing` CI 연결, CI 전부 green 확인 후 main 갱신.
