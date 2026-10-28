# 통합 전 기능 분석 (2026-10-12)

이 문서는 프로젝트를 합치기 전에 그룹별로 기능을 분석한 결과다. 기능마다 통합, 유지, 디벨롭, 폐기, 신규 중 하나로 분류했다. 분석은 Opus 5.5 분석 에이전트 3개가 리뷰(`D:/WorkSpace/platform/docs/reviews/`)와 원본 기획 문서를 읽고 작성했다. 아래 "확정 결정"은 사용자가 분석을 검토한 뒤 승인한 내용이며, 본문 분석 원문과 다른 경우 확정 결정을 따른다.

## 확정 결정 (분석 원문보다 우선)

| # | 항목 | 확정 내용 |
|---|---|---|
| 1 | 블로그와 영상 분리 | `sceneflow`(숏폼, 롱폼, Lofi, 플리)와 `nomad-blog`(블로그 전용)를 서로 다른 단독 프로젝트로 구성한다. 공유하는 것은 `_platform-core` 공통 모듈뿐이다. 블로그 게시기(네이버/티스토리/워드프레스)는 blog가 소유한다. 링크인바이오와 Track B 랜딩은 video가 소유한다. 제휴 링크, 클릭 통계, 대가성 문구는 `_platform-core`의 affiliate 공용 모듈이 맡고 video와 blog가 함께 쓴다(결정 12, 2026-10-12 변경). commerce의 블로그 원고 기능은 commerce 범위에서 뺀다. |
| 2 | admin-suite | 공유 코어 패키지(`packages/admin-kit`)와 앱 3개(erp, hms, sms)로 구성한다. hms는 의료정보 격리를 위해 별도 DB로만 제공하고, 모듈러 통합 DB에서 제외한다. |
| 3 | 출판·사주 백엔드 | Next.js + FastAPI로 구성한다. WeasyPrint 렌더 서비스는 두 제품이 공용으로 쓴다. |
| 4 | 결제 PG | 전 제품 Toss Payments로 통일한다. |
| 5 | 테넌시 | org 기준 스키마로 설계하고, 운영은 1인 1워크스페이스로 한다. |
| 6 | 영상 워커 | TS(BullMQ FlowProducer)가 오케스트레이션을 맡고, Python이 Whisper, demucs, FFmpeg 미디어 처리를 맡는다. |
| 7 | MVP 범위 | 출판: 전자책만 / video: Track A~F 전부(Distrokid 자동 배포, 24시간 라이브, 보이스 클로닝은 2단계) / commerce: 쿠팡 + 스마트스토어 + 엑셀/ZIP / 사주: 사주 + 타로 + 크레딧팩 (2026-10-18 sceneflow 개정: C·D → Track S, E·F Phase 2. sceneflow 01장 10장) |
| 8 | 플랜 정본 | 출판: 크레딧팩 + 저가 구독 / video: `NOMAD Shorts Maker/PRD_pricing.md` / commerce: V.2 가격표에 sellingstudio 크레딧을 환산 / 사주: Astro AI 단가표 |
| 9 | Capacitor 앱 | sellingstudio의 모바일 앱은 MVP 이후로 미룬다. |
| 10 | 브랜드와 폴더명 | video: SceneFlow(폴더 `sceneflow`. 2026-10-18 이름 변경, 이전 이름 NOMAD AI Factory·폴더 `nomad-video`. NOMAD AI Factory는 회사 브랜드로만 쓴다) / commerce: NOMAD Commerce / 사주: 신비로운AI(폴더 `astro-ai`) |
| 11 | 마이크로웹 | 대행 제작으로 시작해 셀프서비스로 확장한다. Next.js + platform-core로 이전한다. |
| 12 | 제휴마케팅(affiliate) | `_platform-core`에 affiliate 공용 모듈을 둔다. 제공자는 쿠팡파트너스, 네이버 브랜드커넥트, 텐핑, 네이버쇼핑 커넥트이며, 어댑터 구조로 추가할 수 있게 한다. 텐핑과 네이버쇼핑 커넥트는 공개 API 여부를 확인하지 않았다(없으면 Playwright 또는 수동 링크 등록). blog: 본문에 제휴 상품 카드와 링크를 자동 삽입하고, 대가성 문구를 글 상단에 자동 삽입한다. 네이버 브랜드커넥트 지원은 blog가 소유하며 완전 자동(Playwright)으로 한다. video: 모든 Track의 설명란과 고정댓글에 제휴링크와 대가성 문구를 자동 삽입하고, Track B 랜딩은 유지한다. 플랫폼의 유료 프로모션 표시 자동 설정은 제안 단계이며 확정이 아니다. C-5-1은 (b)로 결정됐다. |
| 13 | AI 계층 (2026-10-13) | FastAPI(`apps/api`)에 LangChain/LangGraph로 AI 계층을 구성하고, RAG는 Supabase pgvector(HNSW, 1024차원. 임베딩은 플랫폼 기본 Voyage, 제품 지식 컬렉션 기본 오픈소스, 기존 컬렉션은 기록된 모델로만 처리: 2026-10-13 사용자 결정)를 쓴다. 12개 제품 모두 MVP에 AI 기능을 넣는다. AI 크레딧은 선차감 + 정산이며 admin-suite만 예외(플랜 포함 한도 + 원가 기록, 2026-10-13 사용자 결정)다. LLM Wiki는 제품 지식 위키(DB + FastAPI)와 개발용 프로젝트 위키(`docs/wiki/` + 스킬) 두 가지다. 설계 정본 `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md`, `LLM_WIKI.md`, DB `0008_core_ai.sql`. |
| 14 | Dify (2026-10-13) | Dify는 채팅·운영 화면용으로 공용 자체 호스팅 1개를 쓴다(제품마다 앱 1개). 조직 데이터 검색·답변 생성·그래프 실행 같은 지식·도구는 FastAPI가 맡고, Dify는 서명 토큰을 전달만 한다. 설치 `D:/WorkSpace/platform/docs/develop/_shared/dify/`. |
| 15 | 3D 히어로 표준 (2026-10-13) | 전 제품 메인페이지 히어로는 PC·태블릿 풀 3D, 모바일은 절충안(HTML 즉시 표시 + 가벼운 3D 지연 로딩), 저사양·미지원·reduced-motion은 정지 이미지. 정본 `docs/file/03-설계/디자인/HERO_3D.md`. |
| 16 | 음성 (2026-10-13) | 음성 대화 전체(말하기 → STT → AI → TTS)와 제품별 음성 기능을 12개 제품 MVP에 넣는다. 제공자는 ElevenLabs(TypeScript SDK)와 오픈소스 공용 GPU 음성 서버(faster-whisper + silero-vad + 상업 이용 가능한 한국어 TTS)로 이원화한다. 정본 `docs/file/03-설계/공용코어/VOICE_ARCHITECTURE.md`, DB `0009_core_voice.sql`. |
| 17 | LLM 이원화 (2026-10-13) | 상용(ChatGPT, Claude, Gemini, OpenRouter 등)과 오픈소스(vLLM 서빙) 모델을 병행한다. 라우팅은 FastAPI 라우터가 `core.resolve_ai_route` 설정(commercial/open_source/auto)과 대체 체인으로 정한다. 민감 데이터는 오픈소스 강제(`force_open_source`, 조직이 해제 불가). 설치 `D:/WorkSpace/platform/docs/develop/_shared/llm/`. |
| 18 | 네이버 클립 채널 (2026-10-13) | sceneflow 업로드 플랫폼에 `naver_clip`을 추가한다(pro/advanced). 공식 업로드 API가 확인되지 않아(2026-10-13 조사) Playwright 자동 업로드로 하고, owner/admin 위험 고지·동의(`clip-2026-10-v1`)가 있어야 업로드 잡을 만든다. 대가성 문구는 제목과 첫 해시태그에 넣는다(공정위 추천보증 지침). 공식 API가 확인되면 어댑터를 교체한다(video D-23). 정본: `sceneflow/01_PRD.md` VD-F-075 |
| 19 | 브랜드커넥트 범용화 (2026-10-13) | `core.brandconnect_applications`의 `blog_url`을 `target_url` + `target_kind`(blog/clip) + `source_app`(blog/video)으로 바꾼다. Playwright 지원 어댑터는 blog가 계속 소유하고, video는 `brandconnect.apply` 잡을 `source_app='video'`로 요청한다. blog 스캔 결과에 `campaign_type`을 붙여 클립형 캠페인을 video로 넘긴다. 정본: `docs/file/03-설계/공용코어/CORE_SPEC.md` 13장, `nomad-blog/01_PRD.md` 3.4절 |
| 20 | toon-factory 벤치마킹 보강 (2026-10-13) | 경쟁 서비스 비교(`toon-factory/08_BENCHMARK.md`) 결과로 로그라인·시놉시스 생성과 플랫폼 포맷 프리셋을 MVP에, 직접 업로드(naver_clip 포함)와 숏툰 모션을 Phase 2에, 브랜디드 툰(광고 표시·고객 승인)을 신규로 넣는다. 벤치마크는 분기마다 다시 확인한다 |
| 21 | 쇼츠 대행사업 (2026-10-13) | 직접 대행으로 시작하고 sceneflow를 내부 도구로 쓴다(고객사 `video.clients`, 고객 승인 단계, 월간 리포트, VD-F-120~126). 영업·계약·운영 문서는 nomad-docs `shorts_agency` 패키지로 만든다. 다른 대행사에 판매하는 화이트라벨 SaaS는 Phase 2에서 검토한다(video D-24). 사업 운영 정본: `sceneflow/08_AGENCY_OPERATIONS.md` |
| 22 | 인증 단계 도입 (2026-10-14) | 전 제품의 로그인을 단계로 켠다. A(MVP 개발): 로컬 Supabase 시드 계정으로 실제 JWT를 받는 Mock 로그인(쿠키 역할 Mock 금지, 원격 DB·배포 환경 차단) → 게이트 G1(MVP P0 기능·핵심 플로우 E2E·RLS 스모크가 Mock으로 녹색) → B: Google OAuth(+제품 PRD의 이메일·초대 메일), 공개 베타 필수 → 게이트 G2(Google 실사용 2주 안정, 제안) → C1 카카오(Supabase 기본 제공자), C2 네이버(Supabase 커스텀 OAuth2 `custom:naver` 스파이크, 실패 시 서버 브리지 + `staged/0010_core_auth_identity_links.sql`). nomad-commerce의 MVP 카카오와 flora-publishing 카카오 열린 결정은 C1으로 옮긴다. 정본 `docs/file/03-설계/공용코어/AUTH_ROADMAP.md`. |

### video 트랙 정의 (확정)

| 트랙 | 콘텐츠 | 핵심 |
|---|---|---|
| A | 중국 드라마 숏폼 | 도우인·샤오홍슈 무료 배포 드라마를 KO/JA/EN으로 더빙하고 강조 자막을 넣는다. 수익은 광고. |
| B | 중국 상품 커머스 숏폼 | 상품 리뷰/시연 영상을 재가공하고 쿠팡파트너스 랜딩을 자동 생성한다. |
| C | AI 재생성 숏폼 | Mode1은 대본 → AI 이미지 → 켄번스 효과, Mode2는 급상승 영상 원본 재편집. |
| D | 롱폼 오리지널 | 지식, 라디오/오디오북, 해외 바이럴 재제작을 10섹션 스토리보드로 만들고, 핵심 구간 3개를 쇼츠로 자동 추출(OSMU)한다. |
| E | Lofi 음원 | Suno로 Lofi/Chill/Ambient/White Noise 단일 곡을 생성한다. 음원 자체가 상품이며 DSP 유통과 단일 곡 루프 영상이 따라붙는다. 관리 단위는 곡. |
| F | 플레이리스트(플리) | 상황·무드별 큐레이션 영상이다(카페, 드라이브, 공부, 수면 등). 장르 제한이 없고, 곡 N개를 30분/1시간/3시간 영상으로 묶는다. 트랙리스트·타임스탬프·무드 썸네일·고정 댓글을 함께 만든다. 곡은 Suno 자체 생성곡 또는 라이선스를 확보한 라이브러리만 쓴다. 관리 단위는 플레이리스트 프로젝트. |

E와 F는 Suno 생성 엔진과 인코딩 워커만 공유한다. 메뉴, 테이블(`music_tracks` / `playlists` + `playlist_items`), 크레딧 단가, 채널 역할(lofi / playlist), 색상은 따로 둔다.

---

# 분석 원문 1: 출판(flora-publishing) / 사주(astro-ai)

두 그룹의 분석을 마쳤습니다. 리뷰 6개는 전부 읽었고, 원본 기획 문서도 확인했습니다. 원본 기획 문서는 Flora-v2와 flora의 PRD·CLAUDE·DESIGN, Flora-v2 SKILL.md, flora-publisher README와 PRD 2개, SellingDocs PRD, FortuneDocs PRD·CLAUDE, Astro AI 기획안 13개 중 핵심 문서입니다. 코드는 기능이 실제로 있는지와 상태를 확인할 때만 열었습니다.

**표기 규칙**
- 근거의 `reviews/` 는 `D:\WorkSpace\platform\docs\reviews\` 입니다. 나머지 경로는 `D:\WorkSpace\platform\` 기준입니다.
- 그룹 A 약어: v1 = flora, v2 = Flora-v2, FP = flora-publisher, SD = SellingDocs
- 그룹 B 약어: AA = Astro AI, FD = FortuneDocs
- 구현 상태: 동작 / 부분 / 목업 / 기획만

---

# 그룹 A: flora-publishing (1인 출판 SaaS)

## A-1. 통합 제품 정체성과 베이스

통합 제품은 **"FLORA: 1인 창작자가 AI로 전자책을 기획, 집필, 판형 조정을 거쳐 인쇄용 PDF와 ePub까지 완성하는 SaaS"** 입니다. 오디오북은 그 위에 얹는 2차 확장으로 둡니다.

베이스는 **Flora-v2** 로 합니다. 세 리뷰가 모두 이 방향을 권고합니다(`reviews/Flora-v2.md:189`, `reviews/flora.md:188`, `reviews/flora-publisher.md:115`).

v2를 고른 이유는 다음과 같습니다.
- 기획 문서가 가장 상세합니다(PRD 547줄, DESIGN 689줄).
- 프론트가 154줄 셸과 단계별 컴포넌트로 나뉘어 유지보수가 가능합니다. v1은 위저드 하나가 4,095줄입니다.
- LLM 호출이 비동기로 바뀌어 있습니다.

다만 v2는 실제로 끝까지 동작하지 않고 완성도는 약 30%입니다(`reviews/Flora-v2.md:23-26`). 그래서 v1에서 검증된 엔진을 v2로 옮겨야 합니다. 대상은 다중 LLM 라우팅, 표지 제공자 7종, WeasyPrint와 ePub3, 판형 프리셋, F5 래퍼입니다(`reviews/flora.md:188`).

나머지 두 프로젝트는 별도 제품으로 두지 않고 흡수합니다.
- SD는 기능 범위가 v2의 부분집합입니다(`reviews/SellingDocs.md:42`). 대신 크레딧 원자 차감과 챕터 테이블 설계를 가져옵니다.
- FP는 Google Books 검색 화면 하나만 실제로 있는 템플릿 데모입니다. 동봉 PRD의 집필 큐와 마이크로 프롬프트 에디터 흐름만 반영합니다.

## A-2. 기능 매트릭스

**인증·계정·테넌시**

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 로그인/가입 | v1 동작(Supabase OAuth+이메일), v2 부분(GoTrue raw fetch로 세션 미생성), SD 기획만(매직링크+Google), FP 기획만(NextAuth Google/Kakao) | 통합 | `@supabase/ssr` 기반 이메일+Google. 카카오는 결정 사항(→ 확정 결정 22로 대체: 카카오는 C1단계, 정본 `docs/file/03-설계/공용코어/AUTH_ROADMAP.md`). NextAuth는 버림 | `reviews/Flora-v2.md:61,93`, `flora/PRD.md:103`, `구현해야 할 프로젝트/SellingDocs/PRD.md:47`, `flora-publisher/frontend/docs/prd/02_user_flow.md` |
| 라우트 보호(proxy.ts) | v1 동작, v2 부분(쿠키 세션 전제인데 세션이 없음) | 유지(v2) | v2 `src/proxy.ts`를 그대로 쓰고 로그인을 고쳐서 연결 | `reviews/Flora-v2.md:47,61` |
| 백엔드 JWT 인증 | v1 부분(`dev-user` 우회, LLM 무인증), v2 부분(LLM·export·upload 무인증, 빈 JWT secret 허용) | 디벨롭 | 라우터 단위 `Depends(get_current_user)` 적용, 공개 엔드포인트 화이트리스트, 프론트에 단일 `apiFetch`로 토큰 주입 | `reviews/Flora-v2.md:62-63,70,114`, `reviews/flora.md:68,80` |
| RLS 테넌트 격리 | v1 부분, v2 부분(`user_plans FOR ALL`로 셀프 업그레이드 가능), SD 기획만(`books FOR ALL`) | 디벨롭 | 플랜·크레딧 테이블은 SELECT만 허용, 쓰기는 service role만 | `reviews/Flora-v2.md:64,99`, `reviews/flora.md:70` |
| 슈퍼 어드민 | v1 부분(이메일 체크만), v2 목업(통계 0 고정, 이메일 하드코딩) | 디벨롭 | `profiles.role` 기반으로 바꾸고 실제 통계와 플랜 관리를 붙임 | `reviews/Flora-v2.md:89`, `Flora-v2/frontend/src/app/admin/page.tsx:37-43` |
| 대기자 명단 | v1 부분(경로 `/api/api/waitlist`, in-memory, 시드 147), v2 동작(Supabase 테이블) | 유지(v2) | v2 그대로 | `reviews/flora.md:82`, `reviews/Flora-v2.md:181` |

**전자책 파이프라인**

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 단계 구성 | v1 동작(11단계), v2 부분(10단계), FP 기획만(키워드 → 목차 → 스튜디오) | 통합 | v2 10단계 순서를 쓰고 v1의 어조 슬라이더와 옴니버스를 단계 안 옵션으로 흡수 | `flora/PRD.md:41-55`, `Flora-v2/PRD.md:41-56` |
| 판형 선택 / Auto-Fit | v1 동작(5종 `print-presets.ts` 714줄), v2 동작(6종 Auto-Fit, A6 추가), SD 기획만(여백/패딩 슬라이더), v2 SKILL.md 기획만(A6~B4). **값 충돌**: A5 기준 v1은 10.5pt, 여백 20/22/20/15mm이고 v2는 9.5pt, 18/20/18/14mm | 통합 | v2 6종 키와 Auto-Fit 패널을 쓰고, v1의 `@page`와 제책 여백(안쪽 > 바깥 3~5mm) 규칙을 이식. SD 슬라이더는 Auto-Fit 미세조정으로 흡수 | `flora/PRD.md:179-189`, `Flora-v2/PRD.md:476-485`, `reviews/SellingDocs.md:94` |
| 장르 선택 | v1 동작, v2 동작 | 유지(v2) | v2 `genre-selector` | `Flora-v2/PRD.md:65-68` |
| 키워드 추천 | v1 동작(`/llm/keyword-suggestions`) | 폐기 | v2의 4단계 제목 추천이 같은 역할을 하므로 단계만 늘어남 | `flora/api/routers/llm.py:639`, `flora/frontend/.../new/ebook/page.tsx:428` |
| 페르소나 60종 | v1 동작, v2 부분(프론트 60종 중 백엔드 Taste 프롬프트 14종) | 디벨롭 | 60종을 JSON 단일 소스로 두고 백엔드가 직접 로드 | `reviews/Flora-v2.md:77,116` |
| 나만의 페르소나 합성(+STT) | v2 부분(`/llm/blend-persona`, Whisper `/tts/stt`, 샘플 업로드 계약 깨짐) | 디벨롭 | 업로드 단일 훅으로 고침. 프로 이상 기능 | `Flora-v2/api/routers/llm.py:102`, `Flora-v2/api/routers/tts.py:71`, `reviews/Flora-v2.md:66` |
| 페르소나 보관함/즐겨찾기 | v2 부분(localStorage) | 디벨롭 | DB 저장(`user_settings`)으로 옮김 | `Flora-v2/frontend/.../personas/page.tsx:21-39` |
| 어조 슬라이더(ToneSlider) | v1 동작(Pro), v2 없음(PRD에는 명시) | 유지(v1 이식) | 7단계 집필 옵션 패널로 넣음 | `flora/PRD.md:48`, `Flora-v2/PRD.md:102` |
| AI 제목 추천 | v1 동작, v2 동작(무인증) | 유지(v2) | v2 그대로 쓰고 인증만 붙임 | `Flora-v2/PRD.md:76-80` |
| 기획안 3종 | v1 동작, v2 동작, SD 기획만(입력 6필드: 타겟 독자, 톤 등) | 통합 | v2 기획안 탭에 SD의 "타겟 독자, 강조 톤" 입력을 추가 | `구현해야 할 프로젝트/SellingDocs/PRD.md:52` |
| 목차 3종 + 챕터/소제목 편집 | v1 동작(`chapter-wizard` 1,473줄), v2 동작, FP 기획만(드래그 정렬), SD 기획만(책 전체를 단일 JSON으로 생성) | 통합 | v2 ChapterWizard에 FP식 드래그 정렬을 추가. SD의 단일 JSON 생성은 버림 | `reviews/SellingDocs.md:51`, `flora-publisher/frontend/docs/prd/02_user_flow.md` |
| 섹션 집필 | v1 동작, v2 동작(무인증) | 유지(v2) | v2 비동기 호출에 v1 프롬프트 자산을 이식 | `reviews/Flora-v2.md:42` |
| 옴니버스(단편집) 모드 | v1 동작 | 유지(v1 이식) | 집필 옵션 하나로 넣음, 우선순위 낮음 | `flora/api/routers/llm.py:298,472` |
| 전체 순차 생성 | v2 부분(EventSource GET과 POST 불일치로 405), FP 기획만(큐, 재시도 3회, 스트리밍), SD 기획만(단일 호출) | 디벨롭 | 서버 잡이 챕터별로 생성하고 즉시 DB에 저장. 세마포어 2~3, 지수 백오프 재시도 3회(FP 명세), 실패한 챕터만 표시, `fetch` + ReadableStream 진행률 | `reviews/Flora-v2.md:67,105,122`, `flora-publisher/frontend/docs/prd/03_features.md` 1.2절 |
| 이어쓰기/살붙이기/다듬기 + 본문 에디터 | v1 동작(`writing/{action}`), v2 동작(API), FP 기획만(TipTap, 선택영역 플로팅 툴바, `/` 명령, Diff 미리보기), SD 기획만(위지윅) | 디벨롭 | Tiptap 에디터에 선택영역 마이크로 프롬프트(삽입/대체/재생성), HTML sanitize 추가 | `flora-publisher/frontend/docs/prd/03_features.md` 2절, `reviews/SellingDocs.md:54,120` |
| AI 고도화(Multi-LLM transform) | v1 부분(마지막 1,000자만 처리하는 버그), v2 PRD에만 있음(라우터 없음) | 통합 | 별도 단계를 없애고 "다듬기"에 청크 분할 전체 다듬기로 흡수 | `reviews/flora.md:77,117` |
| 쪽번호 삽입 | v2 목업(추정치 메시지) | 폐기 | 쪽번호는 PDF 렌더 시 `@page` counter로 자동 처리. 원고에 넣을 이유가 없음 | `reviews/Flora-v2.md:86`, `Flora-v2/api/routers/books.py:72` |
| 번역 | v1 동작(UI 연결), v2 API만 | 유지(v2 API, Phase 2) | 완성 후 부가 기능 | `Flora-v2/api/routers/llm.py:336` |
| AI 조판(`/llm/layout`) | v1 동작(캔버스·사진집에서 사용), v2 없음(PRD에만) | 폐기 | Auto-Fit과 build-html이 대체. 사진집을 폐기하면 쓸 곳이 없음 | `flora/api/routers/llm.py:506` |
| AI 표지 생성 | v1 동작(제공자 7종), v2 목업(placehold.co) | 통합 | v1 제공자 라우팅을 httpx 비동기로 이식하되 제공자는 1~2개로 축소. v2의 3종 후보와 제목 오버레이 UI는 유지 | `reviews/flora.md:17`, `reviews/Flora-v2.md:17,149` |
| 책 정보(메타데이터) 자동 생성 | v1 동작(이름은 "지리 메타데이터"로 오기), v2 부분(원고를 읽지 않아 환각) | 디벨롭 | 서버가 DB에서 제목, 기획안, 원고 앞부분을 읽어 생성. ISBN은 "참조용" 고지 | `reviews/Flora-v2.md:78`, `Flora-v2/PRD.md:111-115` |
| 원고 병합(merge) | v1 동작(Next route), v2 동작(FastAPI) | 유지(v2) | 서버 한 곳에서만 처리 | `Flora-v2/api/routers/books.py:13` |
| 출판용 HTML 조립(build-html) | v1 동작(단락 escape 누락), v2 부분 | 통합 | v1 템플릿(`html-templates.ts`, `build-html`)을 서버로 옮기고 escape와 sanitize 적용 | `reviews/flora.md:78`, `reviews/Flora-v2.md:73` |
| PDF 내보내기 | v1 동작(WeasyPrint → fpdf2 폴백, 폰트가 `C:/Windows` 하드코딩), v2 부분(fpdf2 Helvetica라 한글 예외, 본문 미전송), SD 기획만(WeasyPrint), v1 프론트 html2pdf.js, SKILL.md 기획만(브라우저 인쇄) | 통합 | WeasyPrint 컨테이너 하나 + Noto CJK + `url_fetcher` 제한. 서버가 `project_id`로 원고를 읽어 렌더 | `reviews/flora.md:75`, `reviews/Flora-v2.md:68,107`, `reviews/SellingDocs.md:66` |
| Typst PDF | v1 동작 | 폐기 | PDF 엔진이 둘이 되고 Typst CLI 의존과 프리셋을 따로 유지해야 함 | `flora/api/routers/export.py:465`, `flora/.../ebook/[id]/page.tsx:291-323` |
| DOC 내보내기 | v1 동작(Word 호환 HTML이고 진짜 docx 아님) | 폐기 | 필요해지면 정식 docx 생성기로 새로 만듦 | `flora/api/routers/export.py:518` |
| ePub 내보내기 | v1 동작(ePub3, 식별자가 `hash()`라 매번 달라짐), v2 부분(ePub2, XML escape 없음), SD 기획만(epub-gen-memory), FP 기획만(Pro 페이월) | 통합 | v1 ePub3 빌더 + escape + uuid5 식별자 + 표지 바이너리 포함 | `reviews/flora.md:93`, `reviews/Flora-v2.md:73` |
| 워터마크(무료) | v2 부분(export 파라미터만 있음) | 디벨롭 | 서버가 플랜을 보고 강제 | `Flora-v2/api/routers/export.py:17,57-69` |
| 책 미리보기 | v1 동작(`book-page-preview`, `weasyprint-editor-panel` 1,067줄), v2 부분(`chapter-preview`) | 통합 | 미리보기도 실제 PDF와 같은 HTML 템플릿을 씀 | `reviews/flora.md:53` |
| 공유 링크 / 오픈 서가 | v2 목업(`/share/{id}` 404), SD 기획만(공개 서가 + JSON-LD인데 RLS와 모순) | 디벨롭(Phase 2) | `books.is_public`, `slug`, 공개용 SELECT 정책, Book JSON-LD | `reviews/Flora-v2.md:85`, `reviews/SellingDocs.md:52` |
| 차트 삽입(QuickChart) | SD 기획만 | 폐기 | 사용자 데이터가 외부로 전송됨. 필요하면 인라인 SVG로 대체 | `reviews/SellingDocs.md:61,99` |
| 원고 업로드 | v1 부분(txt/md만, 브라우저에서 읽음), v2 부분(txt/md/docx/pdf/hwp 파서는 있으나 프론트 계약 불일치로 422, HWP 깨짐), SD 기획만(포맷 미정) | 디벨롭 | multipart 1회 호출, 단일 훅, 20MB 상한, 스레드풀 파싱. HWP는 결정 사항 | `reviews/Flora-v2.md:66,76,103`, `flora/.../manuscript/page.tsx:862` |
| 업로드 후 기획 검토 경로 | v2 부분(`upload-plan-review`) | 유지(v2) | 위 업로드 수정과 함께 동작 | `Flora-v2/PRD.md:125-150` |
| 샘플 시드 3종 복제 | v2 부분(API 있으나 401), SKILL.md 기획만 | 유지(v2) | 인증만 고침 | `Flora-v2/api/routers/projects.py:112` |
| 프로젝트 저장/목록 | v1 동작(최종 원고만 PATCH), v2 부분(`projectId='new'` 공유, DB에 저장 안 됨) | 디벨롭 | 위저드 진입 시 `POST /projects`, `ebook_step_state` debounce PATCH | `reviews/Flora-v2.md:79,115` |
| 자동 저장 | v1 동작(매 렌더 직렬화), v2 부분(localStorage만) | 통합 | DB debounce 저장 하나로 | `reviews/flora.md:97` |
| 10단계 진행바·완성 Confetti | v2 동작 | 유지(v2) | 그대로 | `Flora-v2/DESIGN.md` 3.1절 |
| UI 테마 7종 | v2 동작 | 유지(v2) | 그대로. 플랜별 잠금은 서버 플랜 기준으로 | `Flora-v2/PRD.md:227-237` |
| Taste-Skill 시스템 | v2 부분(`taste-injector`, `skill-runner`는 죽은 코드) | 디벨롭 | 프롬프트 합성을 서버로 일원화하고 죽은 코드 삭제 | `reviews/Flora-v2.md:87` |

**오디오북**

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 보이스 7종·미리듣기 | v1 동작(F5 로컬, 영어 레퍼런스만이라 한국어 WAV 미등록), v2 목업(결과 폐기, JSON을 mp3로 저장) | 디벨롭(Phase 2) | TTS 엔진을 정한 뒤 Storage에 저장하고 서명 URL 반환 | `reviews/flora.md:18`, `reviews/Flora-v2.md:80`, `flora/PRD.md:215` |
| 등장인물 추출 | v1 동작(정규식), v2 API만(LLM 방식, 프론트 미사용) | 통합 | v2의 LLM 방식 사용 | `Flora-v2/api/routers/tts.py:53` |
| 멀티보이스 합성 | v1 동작 | 유지(v1 이식, Phase 2) | asyncio.gather 병렬 처리, 8,000자 절단 제거 | `reviews/flora.md:89,170` |
| 레퍼런스 WAV(커스텀 보이스) | v1 동작(경로 조작 취약점), v2 목업 | 폐기 | 음성 복제는 권리·동의 문제와 GPU 비용이 있음. 필요하면 별도 기획 | `reviews/flora.md:71,107` |

**자동화 · 제품 유형**

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| AI 캔버스(React Flow) | v1 부분(노드가 layout/cover/export API를 실제 호출), v2 목업(`setTimeout` 2초) | 폐기 | 10단계 위저드와 기능이 겹치고 실행 엔진이 없음 | `Flora-v2/frontend/.../automation/canvas/page.tsx:80-84`, `flora/.../canvas/page.tsx:116-144` |
| Make Webhook | v2 부분(키 발급만, `/trigger`는 에코만 하고 이벤트 발송 없음) | 디벨롭 | "사용자 웹훅 URL 등록 → `project.completed`, `pdf.exported` 이벤트를 서명된 POST로 전송" 하나로. Make, Zapier, n8n이 모두 받을 수 있음 | `Flora-v2/api/routers/automation.py:46-53` |
| n8n 연동 | v2 부분(전역 n8n API 키 프록시, 프론트는 안내문만) | 폐기 | 키 하나를 모든 테넌트가 공유해 격리가 안 됨. 위 웹훅으로 대체 | `Flora-v2/api/routers/automation.py:58-90` |
| 사진집 | v1 목업(셸 128/234줄) | 폐기 | MVP 밖. 전자책이 안정된 뒤 재기획 | `reviews/flora.md:26`, v2에는 라우트 없음 |
| 룩북 | v1 목업(셸 136/296줄) | 폐기 | 위와 같음 | 같음 |

**플랜 · 결제 · LLM · 기타**

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 플랜 체계 | v1 코드(아래 표), v1 PRD(Free/Pro 2단계), v2 기획 + `plan-limits.ts`(아래 표), FP 기획만(NOMAD PRO ₩9,900/월), SD 기획만(가입 10크레딧, 단가 미정) | 통합(결정 필요) | 아래 A-5의 2번 참조 | `flora/api/db.py:107-115`, `Flora-v2/PRD.md:303-326`, `flora-publisher/frontend/docs/prd/02_user_flow.md` 4절 |
| 플랜 제한·크레딧 서버 강제 | 전 프로젝트 없음(클라이언트에서만 게이팅) | 신규 | `deduct_credits` / `refund_credits` SECURITY DEFINER RPC, `credit_logs`, LLM·export 라우트 안에서 차감하고 실패 시 환불 | `reviews/Flora-v2.md:101`, `reviews/SellingDocs.md:68` |
| Pro 잠금해제(`'1234'`, localStorage) | v1 동작, v2 동작 | 폐기 | dev 빌드에서만 허용하거나 삭제 | `reviews/Flora-v2.md:65`, `reviews/flora.md:73` |
| 결제 | v1 부분(Stripe, 웹훅 서명 미검증), v2 부분(웹훅 시크릿 오용으로 전부 400, 가격 ID 플레이스홀더), FP 기획만(Toss 정기결제), SD 기획만(PG 미정) | 통합(결정 필요) | PG 하나 + 서명 검증 + 서버 재조회 후 플랜 반영 | `reviews/flora.md:69`, `reviews/Flora-v2.md:72` |
| 무료 체험 | v1 동작(`/billing/free-trial`) | 통합 | Free 플랜의 월 크레딧으로 흡수 | `flora/api/routers/billing.py:155` |
| 사용자 API 키(BYOK) | v1 부분(localStorage 저장, DB 컬럼은 죽은 기능) | 폐기 | 평문 저장 위험이 있고 쓰이지 않음 | `reviews/flora.md:81` |
| LLM 공급자/선택 | v1 동작(Anthropic, OpenAI, Gemini + OpenRouter 폴백, LLMSelector), v2 동작(Anthropic 단일, 선택 UI 없음), SD 기획만(4종 직접 연동, 사용자가 선택), FP 동작(Vertex 프록시, 미사용) | 통합 | 서버 라우터 하나(Anthropic + OpenRouter 폴백, 비동기). 사용자에게는 "빠름/고품질" 2모드만 노출 | `reviews/Flora-v2.md:174`, `reviews/SellingDocs.md:57,79` |
| mock 폴백 응답 | v1 동작(`except` 16곳에서 mock 반환, mock 데이터 1,000줄 이상) | 폐기 | 장애가 정상 응답처럼 보임. dev 모드에서만 허용 | `reviews/flora.md:92` |
| 시장 조사(Google Books 검색) | FP 동작 | 폐기 | v1이 "벤치마킹 방식 폐기"를 명시. 다시 필요하면 `bookApi.ts`(50줄)와 `BookCard.tsx`만 이식 | `flora/api/routers/llm.py:846`, `reviews/flora-publisher.md:115` |
| 도서 랜딩/홍보, 정산 메뉴 | FP 목업("준비 중입니다") | 폐기(결정 필요) | MVP 밖. 판매 기능을 넣을지는 결정 사항 | `flora-publisher/frontend/components/Sidebar.tsx:14-18`, `flora-publisher/frontend/App.tsx:49-61` |
| 랜딩 페이지 | v1 동작(593줄, 히어로 효과), v2 동작(101줄), SD 기획만(GEO 랜딩) | 통합 | v2 랜딩에 v1 히어로 연출을 더함 | `flora/CLAUDE.md` 메인 히어로 절 |
| GEO(JSON-LD) | SD 기획만 | 유지(SD 기획 채택, Phase 2) | 랜딩과 공개 책 페이지에 Metadata API로 적용 | `구현해야 할 프로젝트/SellingDocs/PRD.md:76-78` |
| 배포/CI | v1 부분(Dockerfile 시스템 라이브러리 누락, deploy.yml 문법 오류), v2 없음 | 디벨롭 | API Dockerfile(pango, cairo, fonts-noto-cjk), Railway 설정, GitHub Actions(tsc, lint, build, pytest) | `reviews/flora.md:74-75`, `reviews/Flora-v2.md:132,153` |

플랜 체계 충돌 값은 다음과 같습니다.

| 출처 | 플랜 | 월 가격 | 월 크레딧/한도 |
|---|---|---|---|
| v1 코드 | free / payperuse / basic / pro / business | 0 / ₩9,900 / ₩29,900 / ₩49,000 / ₩99,000 | 1 / 1 / 5 / 20 / 무제한 |
| v2 기획 | free / basic / pro / max | 0 / ₩30,000 / ₩60,000 / ₩100,000 | 50 / 200 / 1,000 / 무제한 |
| FP 기획 | NOMAD PRO 단일 | ₩9,900 | 무제한 생성 |
| SD 기획 | 크레딧제 | 미정 | 가입 시 10 |

## A-3. 버려지는 것

**스택·기술 선택**
- **FP의 Vite SPA, Express Vertex 프록시, 전역 fetch/WebSocket 몽키패치, Tailwind CDN, `latest` 의존성.** 쓰이지 않고 토큰이 유출될 수 있는 경로가 있습니다(`reviews/flora-publisher.md:52-53,75`). 폴더와 중복 zip은 아카이브합니다.
- **FP PRD의 NextAuth와 Vertex AI SDK.** Supabase Auth와 서버 LLM 라우터로 대체합니다.
- **SD의 Next.js 14 전제와 "Route Handler에서 WeasyPrint 실행" 가정.** 이 런타임 조합은 성립하지 않습니다(`reviews/SellingDocs.md:48,62`).
- **SD의 LLM 4사 SDK 직접 연동과 책 전체 단일 JSON 생성.** 키·SDK 관리 부담과 토큰/타임아웃 문제가 있습니다(`reviews/SellingDocs.md:51,57`).
- **Typst 경로 전체.** `build-typst`, `export/typst`, `typst-presets.ts`가 대상입니다. PDF 엔진을 둘 유지할 이유가 없습니다.
- **fpdf2 폴백과 html2pdf.js 클라이언트 PDF.** 한글이 안 되고 판형도 반영되지 않습니다(`reviews/Flora-v2.md:68`).
- **v1 DOC(Word 호환 HTML) 내보내기.**
- **v1 동기 SDK와 `requests` 호출.** 이벤트 루프를 막습니다(`reviews/flora.md:76`). v2의 AsyncAnthropic 방식으로 대체합니다.
- **SKILL.md의 Firebase Firestore 로드맵과 localStorage 라이브러리 방식.** Supabase와 충돌합니다.

**중복 구현**
- **v1 프론트 전체.** 4,095줄 위저드, 1,422줄 manuscript 복제, 1,473줄 chapter-wizard가 대상입니다(`reviews/flora.md:90`). 데이터와 엔진만 이식하고 `archive/flora-v1`로 옮깁니다.
- **v1의 인증 중복 구현.** `cover.py`의 `optional_verify`와 `auth.py`가 같은 일을 합니다(`reviews/flora.md:91`).
- **v2의 업로드 로직 3중 복제와 내보내기 로직 3중 복제**(`reviews/Flora-v2.md:127`).
- **v1과 v2의 waitlist, merge, build-html 이중 구현.** v2 서버 쪽 하나만 남깁니다.
- **v2의 수제 ePub2 빌더.** v1 ePub3로 대체합니다.

**죽은 코드·잔재**
- v2 `skill-runner.ts`, `taste-injector.ts`, `manuscript-uploader.tsx`(`reviews/Flora-v2.md:87`)
- v1 `/debug-api-keys`(`flora/api/routers/llm.py:1750`), `_GENRE_REFS_DEPRECATED` 벤치마킹 데이터, mock 데이터 1,000줄 이상
- v1 BYOK API 키 컬럼(migration 004), in-memory waitlist와 시드 수치 147
- v2 스텁: `/api/auth/`, `add-page-numbers`, 표지 placehold.co, 캔버스 `setTimeout`
- `PasswordUnlockModal`과 `flora_pro_unlocked` 우회(v1, v2 공통)
- v1 `f5-tts/` 업스트림 벤더링(train, eval, triton), `ckpts`와 venv가 트리 안에 있음, 잡파일 `-w`, `server.log`, `tsbuildinfo`(`reviews/flora.md:95-96`)
- 실키 노출: v1 `frontend/.env`, v2 루트 `.env`와 `.env.local`(`reviews/flora.md:79`, `reviews/Flora-v2.md:82`). 파일을 지우고 키를 재발급합니다.
- SD의 빈 `Claude.md`와 `add.md`(0바이트)

## A-4. 새로 채워야 할 기획 공백 (네 프로젝트 모두에 없는 것)

1. **DB 스키마 v2**
   - 가입 시 `profiles`, `user_plans`, `user_settings` 생성 트리거
   - `chapters` 별도 테이블(챕터 단위 편집과 재생성)
   - `books`에 `status`, `layout_settings`, `is_public`, `slug`
   - `credit_logs`, `exports`, `payments` 테이블
   - `reviews/SellingDocs.md:81`, `reviews/Flora-v2.md:46,142`
2. **크레딧 원자 차감 RPC와 행위별 단가표.** 차감 시점, 실패 시 환불, 동시성 테스트가 필요합니다(`reviews/SellingDocs.md:49,68`).
3. **결제 시퀀스.** PG 승인, 웹훅 서명 검증, 멱등 처리, 구독 갱신과 해지, 환불 정책.
4. **장시간 작업 구조.** 전체 집필과 오디오북을 잡 테이블과 진행률로 처리해 Vercel/Railway 타임아웃을 피합니다(`reviews/flora.md:131`).
5. **파일 저장소.** Supabase Storage 버킷 설계(원고, 표지, PDF, 오디오), 서명 URL, 보관 기간.
6. **보안 정책.** HTML sanitize, WeasyPrint `url_fetcher` 제한(SSRF), 업로드 크기와 형식 검증, 레이트 리밋(`reviews/flora.md:72`, `reviews/SellingDocs.md:55`).
7. **법적 요건.** 이용약관, 개인정보처리방침, AI 생성물 저작권과 책임 고지, ISBN "참조용" 고지, 환불 규정, 통신판매업 신고 정보. 어느 문서에도 없습니다.
8. **한글 폰트 번들 정책.** PDF와 ePub 양쪽 CJK 폰트 임베딩(`reviews/SellingDocs.md:58`).
9. **운영.** 배포 파이프라인, 필수 환경변수 기동 검증, 로깅과 모니터링, 테스트(401, 웹훅, 업로드 한도)(`reviews/Flora-v2.md:133,154`).
10. **화면·플로우 명세 보완.** 에러/빈 상태, 계정 탈퇴와 데이터 삭제 흐름.

## A-5. 사용자 결정 필요

1. **백엔드 스택**
   - (a) Next + FastAPI 유지(v1, v2 방식)
   - (b) Next Route Handlers가 인증과 크레딧을 맡고, Python은 PDF/TTS/파싱 마이크로서비스만(SD 리뷰안)
   - (c) Next 단독 + Puppeteer/epub-gen-memory(SD/FD 방식)
   - 권고: **(a)**. v2 FastAPI 라우터 11개가 이미 있고, 이식할 v1 엔진(WeasyPrint, pdfplumber, HWP, F5)이 전부 Python입니다. (c)는 판형 품질(`@page :left/:right`)에서 손해를 봅니다.

2. **요금제와 과금 모델** (값은 A-2의 플랜 표 참조)
   - (a) v2 4단계 월 구독(₩0/3만/6만/10만)
   - (b) 크레딧팩 일회 결제 + 저가 구독(FP의 ₩9,900 수준)
   - (c) v1처럼 "건당 결제"를 포함한 5단계
   - 권고: **(b)를 기본으로 하고 v2의 기능 게이팅표는 재활용**. 1인 작가 대상으로 월 ₩100,000(맥스)은 가격 근거가 문서에 없습니다. 어떤 안을 고르든 서버 크레딧 원장이 먼저입니다.

3. **결제 PG**
   - (a) Stripe(v1, v2 코드)
   - (b) Toss Payments(FP PRD, 국내 사용자)
   - (c) 둘 다
   - 권고: **(b)**. 대상이 국내 작가이고, 기존 Stripe 코드는 어차피 다시 작성해야 합니다(`reviews/Flora-v2.md:72`). 해외 판매를 고려할 때 (c)로 확장합니다.

4. **제품 범위(MVP)**
   - (a) 전자책만
   - (b) 전자책 + 오디오북
   - (c) PRD 전체(사진집, 룩북, 오디오북, 캔버스, Make, n8n)
   - 권고: **(a)로 출시**하고, 오디오북은 Phase 2, 자동화는 아웃바운드 웹훅 하나만 둡니다. v2 완성도가 30%라서 (c)는 출시가 계속 미뤄집니다.

5. **TTS 엔진(오디오북을 유지할 경우)**
   - (a) F5-TTS를 GPU 호스트에 직접 배포
   - (b) 외부 TTS API
   - (c) 오디오북 제외
   - 권고: **(b)**. F5는 GPU 상시 비용, 한국어 레퍼런스 미확보, 전용 Dockerfile 부재 문제가 있습니다(`reviews/flora.md:87,143`).

6. **LLM 전략**
   - (a) Anthropic 단일(v2)
   - (b) 다중 제공자 + 사용자가 모델 선택(v1, SD)
   - (c) 서버 라우터(Anthropic + OpenRouter 폴백)에 사용자 노출은 2모드
   - 권고: **(c)**. 모델별 단가를 사용자에게 설명할 필요가 없어집니다(`reviews/SellingDocs.md:57`).

7. **판형 프리셋 값 충돌** (A5 기준 v1은 10.5pt와 20mm 여백, v2는 9.5pt와 18mm 여백)
   - (a) v2 6종 값
   - (b) v1 5종 값
   - (c) v2 키를 쓰고 실물 출력 테스트로 값 확정
   - 권고: **(c)**

8. **원고 업로드 포맷**
   - (a) txt, md, docx, pdf, hwp 전부
   - (b) hwp 제외
   - (c) 1차는 txt, md, docx만
   - 권고: **(b)**. 현재 HWP 파서는 zlib 압축 레코드를 처리하지 못해 깨진 문자열을 냅니다(`reviews/Flora-v2.md:76`).

9. **판매·유통 기능** (FP의 "도서 랜딩/정산" 메뉴, SD라는 "Selling" 이름)
   - (a) 넣지 않음(제작 도구만)
   - (b) 공개 책 페이지만(Phase 2)
   - (c) 판매와 정산까지
   - 권고: **(b)**. (c)는 통신판매중개, 정산, 세무 기획이 통째로 필요합니다.

10. **카카오 로그인** (확정 결정 22로 대체됨, 2026-10-14)
    - (a) 이메일 + Google만
    - (b) 카카오 추가(FP PRD)
    - 권고: **(a)로 시작**하고 가입 전환 데이터를 보고 추가합니다. → 확정 결정 22가 대체했다: Mock(A) → Google+이메일(B) → 카카오(C1)·네이버(C2) 순서. 정본 `docs/file/03-설계/공용코어/AUTH_ROADMAP.md` 1장·8장.

---

# 그룹 B: fortune-ai (사주/운세 PDF SaaS)

## B-1. 통합 제품 정체성과 베이스

통합 제품은 **"만세력 기반 사주 리포트(타로 선택)를 AI로 생성해 책자형 PDF로 소장하고, 이메일과 대시보드로 받는 크레딧형 SaaS"** 입니다. 본인뿐 아니라 가족·지인 프로필을 보관함에 저장해 리포트를 만들 수 있습니다.

두 프로젝트 모두 코드가 없으므로 베이스는 **Astro AI 기획 문서 세트**(13개, 완성도 55%)로 합니다(`reviews/Astro_AI.md:20`). 요금표, 크레딧 단가, 대시보드 19개 화면, 랜딩 11섹션, 결제, 발송, RLS와 금지사항 규칙까지 플랫폼 골격이 정의된 쪽이 Astro AI이기 때문입니다.

다만 Astro AI에는 사주 정확도의 근간이 비어 있습니다.
- 입력 폼이 생년월일시 드롭다운 4개뿐입니다(`Astro AI/기획안/대시보드/PRD_DASHBOARD.md:27`).
- 만세력 사양이 없습니다(`reviews/Astro_AI.md:49`).

이 부분은 **FortuneDocs**(완성도 40%)에서 가져옵니다.
- 입력 모델: 성별, 음양력, 윤달, 야자시/조자시(`FortuneDocs/PRD.MD:55`)
- 다중 프로필 보관함, 대운 타임라인, 원국 프리뷰
- "평생 사주를 한 권의 책으로 소장"이라는 차별화 포지셔닝(`FortuneDocs/PRD.MD:15`)
- ePub 내보내기

FD는 스스로 SellingDocs 계보라고 밝히고 있어(`FortuneDocs/PRD.MD:3`) 출판형 리포트 구조와도 맞습니다.

## B-2. 기능 매트릭스 (모든 항목이 "기획만")

**계정 · 프로필 · 입력**

| 기능 | 보유 프로젝트 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 인증 | AA(이메일/Google/Apple), FD(매직링크/Google) | 통합 | 이메일+Google. Apple은 연기. 매직링크는 무료 크레딧 반복 수령 문제 때문에 연기 | `Astro AI/기획안/공통/ROADMAP.md:15`, `FortuneDocs/PRD.MD:49`, `reviews/FortuneDocs.md:51` |
| 역할(user/creator/admin) | AA | 디벨롭 | MVP는 user/admin만. 모든 Server Action에서 role 재검증 | `Astro AI/기획안/대시보드/PRD_DASHBOARD.md:9-13`, `reviews/Astro_AI.md:52` |
| 다중 프로필 보관함(가족·지인) | FD | 유지(FD) | 대상 CRUD + 제3자 정보 동의 체크 + 대상 수 상한 | `FortuneDocs/PRD.MD:50`, `reviews/FortuneDocs.md:50` |
| 사주 입력 폼 | AA(년·월·일·시 드롭다운 4개), FD(이름, 성별, 양력/음력/윤달, 야자시/조자시) | 통합 | FD 모델 + 생시 모름 + 출생지(경도). 성별은 필수(NOT NULL) | `Astro AI/기획안/대시보드/PRD_DASHBOARD.md:27`, `FortuneDocs/PRD.MD:55`, `reviews/FortuneDocs.md:41-42` |

**사주 엔진 · 시각화 · 리딩 종류**

| 기능 | 보유 프로젝트 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 만세력 계산 엔진 | AA("8자 자동 파싱", 사양 없음), FD(KASI API + `lib/astrology.ts`) | 디벨롭 | 절기 절입 시각 테이블 기반 순수 함수 엔진. 입춘/절기 기준 년·월주, 시주, 자시 처리, 서머타임, 진태양시. 골든 테스트 100건. KASI는 배치 검증용으로만 사용 | `Astro AI/기획안/공통/PRD.md:65`, `FortuneDocs/PRD.MD:31-32`, `reviews/FortuneDocs.md:40,59` |
| 오행·십신·대운·세운·용신 분석 | AA(오행, 대운, 세운, 용신, 기신), FD(십신, 오행 점수, 대운. 격국/용신은 GPT가 판별) | 통합 | 수치(오행, 십신, 대운)는 엔진이 결정적으로 계산해 주입. 용신·격국 해석 방식은 엔진 사양서에서 확정 | `Astro AI/기획안/공통/PRD.md:66`, `FortuneDocs/PRD.MD:39`, `reviews/FortuneDocs.md:47` |
| 실시간 원국 프리뷰(오행 색상 카드) | FD | 유지(FD) | 엔진 결과를 즉시 표시. 다크모드 대비 규칙(金-백, 水-흑) 보완 | `FortuneDocs/PRD.MD:56`, `reviews/FortuneDocs.md:55` |
| 대운 타임라인 | FD | 유지(FD) | 읽기 전용 타임라인 컴포넌트 | `FortuneDocs/PRD.MD:80` |
| 오행 차트 | FD(QuickChart 외부 API) | 디벨롭 | 인라인 SVG로 바꿔 화면, PDF, ePub에서 공통 사용 | `reviews/FortuneDocs.md:54` |
| 타로 3카드(메이저 22장, 정/역방향) | AA | 유지(AA, 결정 필요) | Fan 배열에서 3장 선택 | `Astro AI/기획안/공통/PRD.md:67`, `Astro AI/기획안/대시보드/PRD_DASHBOARD.md:28` |
| 통합 리딩(사주+타로) | AA | 유지(AA) | 타로를 넣을 경우에만 | `Astro AI/기획안/공통/PRD.md:68` |
| 궁합(2인) | AA(단가 25cr만 있고 선택 UI 없음) | 디벨롭(Phase 2) | 보관함에서 2명을 고르는 방식으로 FD 보관함과 결합 | `reviews/Astro_AI.md:65` |
| 연간 운세(월별 12섹션) | AA(단가 50cr만) | 디벨롭(Phase 2) | 섹션을 나눠 병렬 생성 | `reviews/Astro_AI.md:57,65` |

**리포트 생성 · 출력물**

| 기능 | 보유 프로젝트 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| AI 리포트 생성 | AA(Claude Skill, 사주 2,500자 / 통합 4,000자 이상, 이름 3회 언급), FD(챕터별 구조화 JSON, 농경사회 해석을 현대 커리어 관점으로 재해석) | 통합 | 챕터 분할 생성(5~7장) + zod 스키마 검증 + 현대적 재해석 사전 + 금지 표현(의료·투자 단정) + 실패 시 재시도 1회 | `Astro AI/기획안/공통/PRD.md:71-72`, `FortuneDocs/PRD.MD:60-61`, `reviews/FortuneDocs.md:103` |
| LLM 공급자 | AA(Claude 단일, 키는 FastAPI 전용), FD(Vercel AI SDK로 GPT, Claude, Gemini 역할 분담 체인) | 통합(결정 필요) | Claude 단일 + OpenRouter 폴백 | `Astro AI/기획안/공통/CLAUDE.md:17,241`, `FortuneDocs/PRD.MD:37-41`, `reviews/FortuneDocs.md:46` |
| 해설서 편집 화면 | FD(디렉토리 트리에만 있음) | 폐기 | 편집 범위가 정의되지 않았고 사주 리포트를 편집할 필요가 적음 | `FortuneDocs/PRD.MD:163`, `reviews/FortuneDocs.md:49` |
| PDF 생성 | AA(WeasyPrint, FastAPI/Railway, Noto CJK), FD(Puppeteer, A4 책자) | 통합(결정 필요) | WeasyPrint 단일 엔진 + `url_fetcher` 차단 + Storage 업로드 | `Astro AI/기획안/공통/CLAUDE.md:159-182`, `FortuneDocs/PRD.MD:84`, `reviews/FortuneDocs.md:45` |
| ePub | FD(epub-gen-memory) | 유지(FD, Phase 2) | PDF와 같은 HTML 템플릿 사용 | `FortuneDocs/PRD.MD:85` |
| PDF 테마(Taste) | AA(4종: mystical-dark, oracle-gold, cosmic-blue, rose-quartz) | 유지(AA) | MVP는 2종. `ThemeConfig → CSS 변수` 변환기 하나 | `Astro AI/기획안/공통/DESIGN.md:44-51`, `reviews/Astro_AI.md:87` |
| 테마 미리보기(Puppeteer) | AA | 폐기 | 실제 PDF(WeasyPrint)와 렌더러가 달라 결과가 다름. WeasyPrint로 만든 PDF 첫 페이지 이미지로 대체 | `reviews/Astro_AI.md:66,87` |
| PDF 보관·다운로드 정책 | AA(서명 URL 7일, 원본 24시간 삭제, 히스토리 재다운로드가 서로 모순) | 디벨롭 | 보관 기간을 하나로 정하고 재발급 규칙 명시 | `reviews/Astro_AI.md:55` |

**발송**

| 기능 | 보유 프로젝트 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 이메일 발송(Resend) | AA | 유지(AA) | 서명 URL 포함 | `Astro AI/기획안/공통/PRD.md:82` |
| 카카오 알림톡 | AA | 디벨롭(Phase 2) | 휴대폰 번호 수집 동의, 발신 프로필, 템플릿 심사를 먼저 진행 | `reviews/Astro_AI.md:61` |
| 대시보드 실시간 진행률 | AA(broadcast 채널, 인가 없음) | 디벨롭 | `readings` 행의 `postgres_changes` 구독 + RLS | `reviews/Astro_AI.md:60,84` |
| 발송 재시도 / `delivery_logs` | AA(pg_cron 5분 간격 3회) | 디벨롭 | outbox 테이블 패턴 | `reviews/Astro_AI.md:85` |

**크레딧 · 결제**

| 기능 | 보유 프로젝트 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 크레딧 시스템 | AA(가입 30cr, 사주 15 / 타로 20 / 통합 30 / 연간 50 / 궁합 25 / 재생성 5), FD(가입 3크레딧, 단가는 "지정된 크레딧"으로만 표기) | 통합 | AA 단가표 + `credit_ledger` + 원자 차감/환불 RPC(`auth.uid()` 검증, `REVOKE EXECUTE`) + 생성 실패 시 자동 환불 | `Astro AI/기획안/공통/PRD.md:29-45`, `FortuneDocs/PRD.MD:51,109`, `reviews/Astro_AI.md:50` |
| 구독 플랜 | AA(Starter 0 / Basic ₩9,900·200cr / Pro ₩29,900·700cr / Master ₩69,900·무제한) | 디벨롭(Phase 2) | Master 무제한에 공정 사용 한도 추가. Toss 빌링키 | `Astro AI/기획안/공통/PRD.md:29-34`, `reviews/Astro_AI.md:62` |
| 크레딧 팩 4종 | AA(100cr ₩4,900 ~ 2,000cr ₩69,900) | 유지(AA) | MVP 결제 수단 | `Astro AI/기획안/공통/PRD.md:52-58` |
| Toss 일반결제 | AA(웹훅 중심, `toss-signature`) | 디벨롭 | 결제창 → successUrl → 서버 confirm API → 금액·orderId 대조 → 멱등 지급. 웹훅은 보조로만 | `Astro AI/기획안/공통/CLAUDE.md:186-208`, `reviews/Astro_AI.md:53,75` |
| 연간 구독 20% 할인 | AA | 디벨롭(Phase 2) | 빌링키 도입과 함께 | `Astro AI/기획안/공통/PRD.md:99` |
| 환불 처리 | AA(어드민 수동) | 유지(AA) + 자동 환불 신규 | 사유 필수, 감사 로그 | `Astro AI/기획안/대시보드/PRD_DASHBOARD.md:124` |

**마켓 · 대시보드 · 랜딩 · 확장**

| 기능 | 보유 프로젝트 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 템플릿 마켓플레이스(업로드, 검수, 구매, 정산 70/30, 리뷰) | AA | 폐기(MVP 범위, 결정 필요) | Phase 3 이후. 업로드 JSON이 렌더러에 들어가는 보안 문제, 검수 권한 문제, 통신판매중개·원천징수 법무 문제 | `Astro AI/기획안/공통/PRD.md:47-50,89-94`, `reviews/Astro_AI.md:51-52,63` |
| 크리에이터 대시보드 6탭 | AA | 폐기(마켓과 함께 보류) | 마켓을 만들 때 다시 기획 | `Astro AI/기획안/대시보드/PRD_DASHBOARD.md:59-92` |
| 사용자 대시보드 | AA(6탭: 홈, 리딩 시작, 히스토리, 내 테마, 크레딧, 발송내역), FD(프로필 보관함 스위칭) | 통합 | 홈, 보관함(FD), 리딩 시작, 히스토리, 크레딧 | `Astro AI/기획안/대시보드/PRD_DASHBOARD.md:17-55`, `FortuneDocs/PRD.MD:161` |
| 어드민 대시보드 6탭 | AA | 디벨롭 | 최소 어드민: 유저 조회, 결제·환불, 크레딧 조정 로그, 발송 모니터 | `reviews/Astro_AI.md:102,131` |
| 랜딩 페이지 | AA(11섹션, 상세 명세), FD(GEO 메인 페이지) | 유지(AA) | 그대로 쓰되 가상 수치 블록은 실측값만 조건부로 표시 | `Astro AI/기획안/랜딩페이지/PRD_LANDING.md:14-83` |
| 비회원 Live Demo | AA(키워드 3개 공개, IP당 3회) | 디벨롭 | 만세력 엔진으로 키워드를 만들고 LLM은 쓰지 않음. 영속 레이트 리밋 | `Astro AI/기획안/랜딩페이지/PRD_LANDING.md:50-55`, `reviews/Astro_AI.md:86,133` |
| 가상 평점·후기·카운터 | AA(`aggregateRating 4.9`, 후기 12개, "12,470+") | 폐기 | 근거 없는 수치는 검색엔진 정책 위반이고 표시광고법상 위험 | `reviews/Astro_AI.md:54` |
| GEO(JSON-LD, `/llms.txt`, 블로그) | AA(GEO.md 전체), FD(JSON-LD, 사주 블로그) | 통합 | AA의 GEO 문서를 기준으로 하고 실측값만 사용 | `Astro AI/기획안/공통/GEO.md`, `FortuneDocs/PRD.MD:97` |
| 멀티버티컬(재테크, 건강, 학습, 연애) | AA(PRD 7절 + 템플릿 문서 2개) | 폐기(현 단계) | 건강·재테크는 의료법·유사투자자문 규제 대상. 연애AI만 이후 재검토 | `Astro AI/기획안/공통/PRD.md:156-164`, `reviews/Astro_AI.md:67` |
| 기업 API/화이트라벨 | AA(대상 사용자로 언급만) | 폐기 | 기능 정의가 없음 | `Astro AI/기획안/공통/PRD.md:23` |
| 다국어(KO/JA/EN) | AA(GEO 문서에만, 대시보드는 v1 한국어 전용) | 폐기(v1) | 한국어 전용 | `reviews/Astro_AI.md:64` |
| 개인정보 암호화(AES-256) | AA | 디벨롭 | 암호화 대상 컬럼(생년월일시, 이름) 범위를 정함 | `Astro AI/기획안/공통/PRD.md:117` |
| RLS | AA(역할별), FD(`fortune_books FOR ALL`로 크레딧 우회 가능) | 디벨롭 | 리포트는 서버만 INSERT, 사용자는 SELECT/DELETE, `WITH CHECK`로 소유자 검증 | `reviews/FortuneDocs.md:43` |
| Storybook 스냅샷 | AA | 폐기 | 솔로 개발 단계에서 비용 대비 효과가 낮음 | `Astro AI/기획안/공통/CLAUDE.md:256` |

## B-3. 버려지는 것

**스택·기술 선택**
- **Supabase Edge Function 단계.** Vercel 서버와 역할이 겹치고 크레딧과 AI 키 위치를 놓고 문서끼리 모순이 생깁니다(`reviews/Astro_AI.md:47,82`).
- **Puppeteer.** AA의 미리보기와 FD의 PDF 둘 다입니다. WeasyPrint를 고르는 경우 버립니다(`reviews/FortuneDocs.md:45`).
- **FD의 Vercel AI SDK 3사 체인과 `response_format` 강제.** OpenAI 전용 파라미터이고 체인인지 선택인지 불명확합니다(`reviews/FortuneDocs.md:46`).
- **FD의 "Pure JavaScript, Edge 런타임" 원칙, Next 14, 단일 `supabaseClient.ts`**(`reviews/FortuneDocs.md:53`).
- **KASI 음력 간지를 그대로 쓰는 방식.** 사주는 입춘과 절기 기준이라 규칙이 다릅니다. KASI는 검증용으로 내립니다(`reviews/FortuneDocs.md:40`).
- **QuickChart 외부 API.**
- **AA 랜딩 예시의 Tailwind v3식 `tailwind.config.ts`**(`reviews/Astro_AI.md:66`).

**중복·모순 설계**
- **AA `CLAUDE_TEMPLATE.md` 5절의 `generateReading`.** Next에서 차감, 호출, PDF, 발송을 한 함수로 처리하고 `max_tokens: 4096` 단일 호출을 씁니다. 공통 CLAUDE.md와 모순입니다(`reviews/Astro_AI.md:47,57`).
- **FD 스키마에서 LLM이 `five_elements` 점수를 생성하는 구조.** 엔진 계산값과 중복되고 서로 다를 수 있습니다(`reviews/FortuneDocs.md:47`).
- **AA의 broadcast 진행률 채널**과 **웹훅 중심 결제 처리.**
- **AA 대시보드 문서의 `approveTemplate` 예시.** role 확인 없이 service_role로 업데이트합니다(`reviews/Astro_AI.md:52`).
- **"Taste 외 하드코딩 금지"와 hex 하드코딩 예시가 공존하는 문제**(`reviews/Astro_AI.md:58`).

**잔재**
- FD `PRD.MD` 1~7행의 챗봇 응답 문구, `CLAUDE.MD`의 `[cite: 3]`와 닫히지 않은 코드펜스, 두 문서의 DDL·트리 중복(`reviews/FortuneDocs.md:27-28,56`)
- AA의 "원본 영상 24시간 삭제" 문구. 다른 프로젝트 문서에서 온 잔재로 보입니다(`reviews/Astro_AI.md:55`).
- 가상 평점·후기 데이터, 멀티버티컬 템플릿 문서 2개(보류 아카이브), Storybook·Apple 로그인·다국어 항목

## B-4. 새로 채워야 할 기획 공백

1. **아키텍처 단일 결정 문서.** 크레딧 차감 위치, Claude 키 위치, 데이터 접근 원칙(클라이언트 직접 조회 허용 여부)을 하나로 정합니다(`reviews/Astro_AI.md:47,59`).
2. **ERD와 마이그레이션.** 양쪽 모두 테이블 이름만 있거나 3개뿐입니다.
   - `profiles(role)`, `fortune_targets` 확장(윤달, 자시 방식, 생시 모름, 경도)
   - `readings` 상태 머신, `credit_ledger`, `credit_packages`, `payments`, `delivery_logs`, `themes`
   - 가입 트리거
   - `reviews/Astro_AI.md:48,121`, `reviews/FortuneDocs.md:99`
3. **만세력 사양서와 골든 테스트 100건.** 절기 경계일, 서머타임(1948~1960, 1987~1988), 대운수 산출 규칙 포함(`reviews/FortuneDocs.md:97`).
4. **잡 상태 머신과 환불 정책.** `consume → job → failed → refund`, 멱등 키(`reviews/Astro_AI.md:50,73`).
5. **결제 승인 시퀀스.** Toss confirm 기반(`reviews/Astro_AI.md:75`).
6. **법적 요건.**
   - 개인정보처리방침, 제3자(가족·지인) 생년월일시 수집 동의와 삭제 요청 처리
   - 점술 서비스 면책 고지
   - 알림톡 수신 동의
   - 통신판매업 정보, 환불 규정
   - 마켓을 열 경우 정산과 원천징수
   - 표시광고법(가상 후기 금지)
   - `reviews/Astro_AI.md:61,63`, `reviews/FortuneDocs.md:50`
7. **프롬프트 가이드.** 현대적 재해석 사전, 챕터 구성과 분량, 금지 표현(`reviews/FortuneDocs.md:103`).
8. **남용 방지.** 생성 API 레이트 리밋, 가입 크레딧 반복 수령 방지, Live Demo용 영속 저장소(`reviews/FortuneDocs.md:51`, `reviews/Astro_AI.md:62`).
9. **PDF·데이터 보관 정책.** 보관 기간과 재다운로드 규칙.
10. **성능 목표 정리.** "30초" 목표가 문서마다 다른 기준을 씁니다(`reviews/Astro_AI.md:56`).

## B-5. 사용자 결정 필요

1. **제품 정체성**
   - (a) AA: 30초 즉시 리딩 + 3채널 자동 발송
   - (b) FD: 평생 사주를 책 한 권으로 소장(PDF/ePub)
   - (c) 소장형 책자를 핵심 가치로 하고, 배달은 이메일+대시보드
   - 권고: **(c)**. 점신, 포스텔러 같은 조회형 앱과의 차별점은 FD의 "소장"이고, 배달 인프라는 AA 설계를 축소해 쓰면 됩니다.

2. **아키텍처와 PDF 엔진**
   - (a) AA 원안: Next → Edge Function → FastAPI → WeasyPrint
   - (b) Next + FastAPI 워커(WeasyPrint), Edge 제거(AA 리뷰 권고)
   - (c) Next 단독 + 서버리스 Chromium(FD)
   - 권고: **(b)**. 이때 WeasyPrint 렌더 서비스는 그룹 A의 FLORA와 같은 컨테이너를 공용으로 쓰는 것을 권합니다. (c)는 번들 크기, 콜드스타트, 한글 폰트 문제가 있습니다(`reviews/FortuneDocs.md:45`).

3. **타로 포함 여부**
   - (a) 사주만(FD)
   - (b) 사주 + 타로 3카드 + 통합(AA)
   - 권고: **(b)**. 타로는 만세력 엔진 없이 구현 비용이 낮고, 랜딩 Live Demo의 핵심 연출입니다. 다만 "책자 소장" 포지셔닝과 맞추려면 타로 리포트도 같은 책 템플릿을 쓰게 합니다.

4. **수익 모델**
   - (a) AA 전체(구독 4단계 + 크레딧팩 + 마켓 수수료)
   - (b) 크레딧팩 일회 결제만으로 시작
   - (c) FD식 가입 3크레딧 + 단가 미정
   - 권고: **(b)를 MVP로**, 구독과 빌링키는 Phase 2(`reviews/Astro_AI.md:102-103`). 가입 지급량은 AA 30cr과 FD 3크레딧이 충돌합니다. 30cr이면 사주 2회 분량이므로 남용 방지(구글 로그인 한정 지급)와 함께 정해야 합니다.

5. **LLM**
   - (a) Claude 단일(AA)
   - (b) GPT, Claude, Gemini 역할 분담 체인(FD)
   - (c) Claude + OpenRouter 폴백
   - 권고: **(c)**. 체인은 일관성과 비용 추적이 어렵습니다.

6. **만세력 데이터 소스**
   - (a) KASI API 실시간 호출(FD)
   - (b) 로컬 절기 테이블 엔진 + KASI 검증
   - (c) 외부 만세력 라이브러리 사용
   - 권고: **(b)**. 외부 장애와 호출 한도에서 자유롭고, Live Demo도 비용 없이 돌릴 수 있습니다.

7. **범위: 마켓플레이스, 크리에이터, 카카오 알림톡, 멀티버티컬**
   - (a) AA 원안 8주에 전부
   - (b) MVP에서 제외하고 Phase 3 이후
   - (c) 마켓 대신 운영자가 만든 프리미엄 테마 판매만
   - 권고: **(b)**. 멀티버티컬 중 건강·재테크는 법무 검토 전에는 기획에서 뺍니다.

8. **서비스명**
   - (a) 신비로운AI(AA, 랜딩과 GEO 키워드가 이 이름으로 작성됨)
   - (b) 포춘독스(FD)
   - 권고: 정체성으로 (c) "소장형 책자"를 고른다면 **(b)가 포지셔닝과 맞습니다**. 다만 AA 랜딩·GEO 카피를 전부 바꾸는 비용이 듭니다. 브랜드 판단이라 사용자가 정해야 합니다.

---

# 공통 결정 (두 그룹에 걸친 사항)

- **공통 코어 공유 여부**
  - (a) 두 제품 완전 분리
  - (b) Supabase 인증 골격, 크레딧 RPC와 원장, Toss 결제 모듈, WeasyPrint 렌더 서비스를 공용 패키지·서비스로 공유
  - 권고: **(b)**. 두 그룹 리뷰가 똑같은 결함을 반복해서 지적합니다. 비원자 크레딧 차감, 웹훅 서명 문제, Vercel에서 PDF가 안 돌아가는 문제입니다. 한 번 제대로 만들어 양쪽에서 쓰는 편이 중복 개발과 반복 버그를 함께 줄입니다.
- **결제 PG 통일.** 그룹 A에서 Toss를 고르면 두 제품의 결제 코드를 하나로 맞출 수 있습니다.

**참고한 주요 파일**
- 리뷰: `D:\WorkSpace\platform\docs\reviews\` 의 Flora-v2.md, flora.md, flora-publisher.md, SellingDocs.md, Astro_AI.md, FortuneDocs.md
- 그룹 A 기획: `D:\WorkSpace\platform\Flora-v2\` 의 PRD.md, CLAUDE.md, DESIGN.md, SKILL.md / `D:\WorkSpace\platform\flora\` 의 PRD.md, CLAUDE.md / `D:\WorkSpace\platform\flora-publisher\frontend\docs\prd\` 의 02_user_flow.md, 03_features.md / `D:\WorkSpace\platform\구현해야 할 프로젝트\SellingDocs\PRD.md`
- 그룹 B 기획: `D:\WorkSpace\platform\FortuneDocs\` 의 PRD.MD, CLAUDE.MD / `D:\WorkSpace\platform\Astro AI\기획안\` 의 공통/PRD.md, 공통/CLAUDE.md, 공통/ROADMAP.md, 대시보드/PRD_DASHBOARD.md, 랜딩페이지/PRD_LANDING.md
- 코드 확인: `D:\WorkSpace\platform\flora\api\db.py`, `D:\WorkSpace\platform\Flora-v2\api\routers\automation.py`, `D:\WorkSpace\platform\Flora-v2\api\routers\tts.py`, `D:\WorkSpace\platform\Flora-v2\frontend\src\app\(dashboard)\dashboard\automation\canvas\page.tsx`, `D:\WorkSpace\platform\flora-publisher\frontend\components\Sidebar.tsx`


# 분석 원문 2: 영상(sceneflow, 분석 당시 nomad-shorts) / 커머스(nomad-commerce)

# 그룹 C·D 기능 단위 통합 분석 (합치기 전 단계)

이번 분석에서 파일은 하나도 바꾸지 않았습니다. 리뷰 7개는 전부 읽었고, 기획 문서와 코드는 기능이 실제로 있는지 확인할 때만 열었습니다. Youtube_shots_Maker는 `git show`와 `git ls-tree`로만 봤습니다.

**표기 규칙**
- 리뷰 경로 앞부분 `D:\WorkSpace\platform\docs\reviews\`는 생략합니다. 소스 경로는 `D:\WorkSpace\platform\` 기준입니다.
- 리뷰 약칭: SM=`NOMAD_Shorts_Maker.md`, BS=`Nomad-BlogStudio.md`, YSM=`Youtube_shots_Maker.md`, V2=`Nomad-AI-Factory_V.2.md`, v1=`nomad-ai-factory.md`, CM=`nomad-ai-commerce.md`, SS=`sellingstudio.md`
- CA는 NOMAD Shorts Maker 안에 함께 들어 있는 구 제품 Content Automator(`src/skill/**`, `src/taste/content-automator`)를 가리킵니다.
- 구현 상태: 동작(실제로 끝까지 연결됨) / 부분(코드는 있지만 미연결이거나 결함 있음) / 목업 / 기획만

---

## 먼저 알아야 할 사실 3가지

1. **Nomad-BlogStudio는 블로그 제품이 아닙니다.** NOMAD Shorts Maker 기획의 이전 버전(v0.3.0)입니다.
   - 두 PRD의 구조가 같습니다. `Nomad-BlogStudio/PRD.md:2`는 v0.3.0, `NOMAD Shorts Maker/PRD.md:2`는 v0.4.0입니다(BS:4).
   - v0.4.0에서 MODULE 0, 트리플팩, 40채널, Compliance 기능만 추가되었습니다(`PRD_add.md` 전체).
   - 실제 블로그 기능은 Shorts Maker 안의 CA와 YSM의 Track D에만 있습니다.
2. **"NOMAD AI Factory"라는 이름을 두 그룹이 같이 쓰고 있습니다.**
   - 그룹 C: `NOMAD Shorts Maker/PRD.md:10`
   - 그룹 D: `Nomad-AI-Factory_V.2/PRD.md:1`, nomad-ai-commerce 레이아웃 타이틀(CM:76)
   - 디자인도 섞였습니다. Shorts Maker의 `DESIGN.md` 9-B에 커머스 화면(아마존 소싱, 마켓 배포 등 V.2 Stitch 프로젝트)이 들어 있습니다.
3. **세 리뷰가 같은 결함을 반복해서 지적했습니다.**
   - 크레딧 RPC 권한 미회수, 결제 웹훅 서명 미검증, OAuth state 위조, 세션 없는 백그라운드 작업이 RLS에 막혀 아무 일도 안 일어나는 문제(SM:78-85, BS:55-63, SS:58-61)
   - 따라서 인증/조직/과금/결제/암호화는 두 그룹이 같이 쓰는 공용 모듈 하나로 다시 만드는 쪽이 비용상 맞습니다.

---

# 그룹 C: nomad-shorts (숏폼/콘텐츠 자동화 SaaS)

## C-1. 통합 제품 정체성과 베이스

통합 제품은 **"NOMAD Shorts (ShortsOS)"**입니다. 트렌드 레이더(MODULE 0)로 소재를 고르고, 중국·해외 숏폼 소싱 또는 AI 재생성을 거쳐 STT, 번역, TTS, 무음컷, 자막 합성, 인코딩, Compliance 검증을 한 뒤 YouTube 다채널과 IG/TikTok/Threads로 배포하는 조직 단위, 크레딧 과금형 SaaS입니다. 수익은 광고, 쿠팡파트너스 랜딩, Lofi 음원에서 나옵니다.

**베이스는 NOMAD Shorts Maker로 권장합니다.** 이유는 세 가지입니다.
- 가장 최신 기획(v0.4.0)을 가장 넓게 구현했습니다(파일 277개, 약 26,300줄, 완성도 약 35%, SM:3,25).
- BlogStudio 기능을 모두 포함하는 상위 집합입니다.
- YSM은 이미 버려진 1세대이고 작업 트리에서 소스도 지워졌습니다(YSM:14-23, 69-76).

**가져올 것**
- BlogStudio: 미들웨어 라우트 가드, 서버 컴포넌트 데이터 조회 패턴, `tsc` 무오류 상태, zod/RHF/TanStack 구성(BS:20,36,49)
- YSM: Python 서비스 4종(demucs 음원 분리, 네이버 블로그 Playwright 게시, 프록시 풀, AES-GCM 자격증명 저장)을 Python 미디어 워커로 이식(YSM:122-123)

## C-2. 기능 매트릭스

### A. 플랫폼 공통

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 로그인/라우트 가드 | SM 부분(Mock 로그인 상시 노출, 대시보드 가드 없음) / BS 동작(미들웨어, 단 `/landing`까지 막음) / YSM 부분(Supabase + 네이버 로그인) | 통합 | Supabase Auth + `proxy.ts` 가드(BS 패턴). Mock 로그인 제거. 네이버 로그인은 `naver_id` 매핑 방식으로만 | SM:83, BS:49,64, YSM:84,114 |
| 조직(멀티테넌트) | SM 부분(org 스키마와 user 스키마가 함께 있음) / BS 부분(org 스키마, 가입 시 org 미생성, org_members 자가 가입 가능) / YSM 부분(user_id 기반) | 통합 | organizations/org_members + 가입 트리거 + `getCurrentOrg` 헬퍼(사용자가 여러 조직에 속한 경우 지원) | SM:91,101,163; BS:55,63,121; YSM:67 |
| 크레딧 원장(선차감/환불) | SM 부분(RPC 권한 미회수) / BS 부분(refund 고장, 비원자 처리) | 디벨롭 | service role 전용 consume/grant RPC를 `update…where balance>=n returning`으로 원자화. 워커 실패 시 자동 환불 | SM:78,110; BS:57,61-62,119 |
| Toss 결제/구독 | SM 부분(경로 2개가 서로 연결 안 됨, 웹훅 서명 선택적, customerKey가 Date.now) / BS 부분(orderId 파싱 실패) | 통합+디벨롭 | `payment_orders` 선저장, confirm 멱등 처리, 웹훅 서명 필수, 빌링키 정기결제 | SM:79-80,100,159; BS:58-60,120 |
| 플랜/권한 집행 | SM 기획 3종 상충 + 코드 2종 / BS 기획(v0.3) | 통합 | 플랜 정의 1곳 + DB `plans` 테이블. 트랙·언어·채널 수 제한을 서버에서 집행(아래 C-5-4) | SM:90,146; `PRD_pricing.md:116-143` |
| 마케팅 랜딩/가격 페이지 | SM 동작(579줄, Stitch 반영) / BS 동작 / YSM 부분 | 유지(SM) | SM 랜딩 유지. "128,470+ 생성" 같은 수치는 실데이터나 베타 문구로 교체 | SM:52; `NOMAD Shorts Maker/DESIGN.md` 9-E |
| 대시보드 KPI | SM 목업(더미 페이지 18개) / BS 부분(서버 컴포넌트가 실제 조회) | 디벨롭 | 서버 컴포넌트 + 실데이터. 자주 바뀌는 목록만 폴링 | SM:27,94,166; BS:36 |

### B. MODULE 0 (트렌드 레이더)

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 플레이보드 랭킹 | SM 부분(lib 스크래퍼, UI 더미, 성장률이 `Math.random`) | 디벨롭 | SerpApi 등 실데이터. 성장률을 실제 계산하거나 `is_mock` 표시 | SM:36,94 |
| 채널파인더(S~F 등급) | SM 부분(lib/API) | 유지 | Pro 이상 플랜 기능 | `NOMAD Shorts Maker/PRD.md:76-90`, `src/lib/radar/channel-finder.ts` |
| 블링 AI 컨설팅 | SM 부분(lib/API) | 유지(후순위) | 수익 추정치에 근거 출처 표기 | `NOMAD Shorts Maker/PRD.md:92-116` |
| Track C 트렌드 점수 | BS 목업(`Math.random`) | 통합 | MODULE 0 scorer 하나로 흡수 | BS:22,70 |

### C. 소싱과 전처리

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 도우인/샤오홍슈/YT/TikTok 수집 | YSM 부분(`downloader.py` 798줄, E2E 검증 안 됨) / SM 부분(ytdlp lib, sourcing worker가 기동 안 됨) / BS 부분(API만 있고 ytdlp 미사용) | 통합 | YSM 다운로더 로직을 Python 워커로 이식. yt-dlp 인자 앞에 `--`, URL 도메인 화이트리스트 | YSM:41,122; BS:73,129 |
| 워터마크 제거 | SM 부분(`lib/media/watermark.ts`) / BS 죽은 코드 | 유지(SM) | 미디어 워커에 연결 | BS:21 |
| pHash 중복 필터 | 기획만(BS PRD, SM 스키마에 `phash` 컬럼) | 디벨롭(후순위) | 소싱 시점에 해시로 중복 차단 | `Nomad-BlogStudio/PRD.md:65` |
| 프록시 풀 | YSM 부분(`proxy_manager.py`, `proxy_pool`) / SM 기획만(Residential) | 유지(YSM 이식, 후순위) | 소싱·스크래핑 워커 전용 | YSM:59,122; `NOMAD Shorts Maker/PRD.md:67` |

### D. 가공 파이프라인

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| STT(Whisper) | YSM 부분(로컬 large-v3, 전역 Lock 버그) / SM 부분(TS 워커가 `next/headers`에 의존, Python 워커와 입력 계약 불일치) / BS 죽은 코드 | 통합 | Python Whisper 워커 1개만(전용 큐, 동시성 1). 입력 계약 문서화 | YSM:91,128; SM:87,124 |
| 음원 분리(demucs) | YSM 부분만 | 유지(YSM 이식) | BGM/보이스 분리. 하위 프로세스 타임아웃 추가 | YSM:72,95,122 |
| 번역(DeepL + GPT) | SM 부분(translate.worker, `KO`/`ko` 키 대소문자 버그) / BS 죽은 코드 | 유지(SM) | 단계 간 결과 전달은 FlowProducer `returnvalue`로 | SM:88 |
| 트랙별 대본 각색 톤 | YSM 부분(`script_adapter`, 모델명을 자유 문자열로 받음) | 통합 | 번역 후처리 프롬프트로 흡수(A는 "도파민형", B는 "리뷰어 톤"). 모델은 허용 목록으로 제한 | YSM:87,151 |
| TTS | SM 부분(ElevenLabs + OpenAI) / YSM 부분(Edge-TTS/CLOVA) / BS 죽은 코드 | 통합 | ElevenLabs 기본 + OpenAI TTS-1-HD 백업(PRD 기준). Edge-TTS/CLOVA 제외 | `NOMAD Shorts Maker/PRD.md:302-311`; YSM:32 |
| KO/JA/EN 트리플팩 | SM 부분 | 유지(Pro 이상) | 언어 키 대소문자 통일 | `PRD_add.md:116-127`; SM:88 |
| 보이스 클로닝 | 기획만 | 유지(후순위) | Pro 플랜 기능 | `PRD_pricing.md:85` |
| 무음 컷편집 | SM 부분(TS lib + Python 워커) | 유지 | Python FFmpeg 워커 하나로 | `PRD_add.md:169-183` |
| 자막 + 쨉쨉이 레이어 합성 | SM 부분(TS/Python) / YSM 부분(FFmpeg 자막) / Remotion·CapCut은 기획만(의존성 없음) | 통합 | FFmpeg ASS + overlay 단일 엔진. Remotion·CapCut 제외 | `NOMAD Shorts Maker/package.json`(remotion 없음), `PRD_add.md:187-203` |
| 인코딩 | SM 부분 / BS 부분(워커 미기동, Track D가 CHECK 제약과 불일치) | 유지(SM) | 미디어 워커로 | BS:68 |
| 파이프라인 오케스트레이션 | SM 부분(8개 큐에 동시 enqueue, placeholder 전달, 즉시 `done` 처리) / BS 부분(큐 투입이 주석으로만 존재) / YSM 부분(Celery 체인, 구조는 동작) | 디벨롭 | BullMQ FlowProducer 체인. job 상태는 워커 완료 이벤트로 갱신 | SM:86,124,164; BS:69; YSM:67 |
| Compliance Filter | SM 부분(lib + `/api/compliance`) | 유지 | 업로드 전 서버 게이트로 강제 | `NOMAD Shorts Maker/PRD.md:339-353` |

### E. 트랙별 생산

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| Track A 드라마 숏폼 | SM 부분 / BS 부분 / YSM 부분 | 통합 | SM 파이프라인 + YSM 모듈 | SM:37; YSM:42 |
| Track B 커머스 숏폼 | SM 부분 / BS 부분 / YSM 부분 | 통합 | 쿠팡 랜딩과 연결 | SM:37 |
| Track C Mode1 AI 재생성 | SM 부분(script-gen/image-gen/animate 워커) | 유지 | 대본 → fal 이미지 → Ken Burns 순서 | `src/lib/queue/workers/*` |
| Track C Mode2 원본 재편집 | SM 부분 / BS 부분 | 통합 | Track A 파이프라인과 같은 것 하나로 | `Nomad-BlogStudio/CLAUDE.md` 구현원칙 1 |
| Track D 롱폼 10섹션 | SM 부분(UI/골격) / BS 부분(storyline/score는 목업, image는 fal 실제 호출, encode는 가짜 jobId) | 통합 | BS API 골격 + SM UI. sections를 별도 테이블로 정규화 | SM:38; BS:70-71,74,79,101 |
| OSMU(롱폼 → 쇼츠) | 기획만 | 디벨롭(후순위) | 핵심 구간 3개 추출 후 9:16 변환 | `NOMAD Shorts Maker/PRD.md:267` |
| 썸네일 자동/A·B | SM 부분(`lib/media/thumbnail.ts`) | 유지(후순위) | | |
| Track E Suno 음원 | SM 부분(suno.worker 타입 오류) / BS 부분(music API) | 통합 | Pro 이상 플랜 기능 | SM:88 |
| Distrokid 배포 | SM 부분(웹훅 인증 전혀 없음) | 유지(후순위) | 웹훅 서명 필수 | SM:93 |
| YouTube Live 24h | 기획만(P2) | 폐기(MVP 범위 밖) | | `NOMAD Shorts Maker/PRD.md:276` |

### F. 배포

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| YouTube OAuth/업로드 | SM 부분(40채널 oauth-manager, 콜백 인증 결함, 영상 전체를 메모리에 올려 PUT) / BS 부분(토큰 평문 저장) / YSM 부분(state 위조 가능) | 통합(SM 기준) | 서버 nonce state, AES-GCM(키 없으면 기동 실패), resumable 업로드 | SM:39,82,95,116; BS:65; YSM:83 |
| 채널 역할/쿼터/대체 채널 선택 | SM 부분 | 유지 | 플랜별 채널 수 제한 | `PRD_add.md:139-165` |
| Instagram Reels/Threads | SM 부분(Meta lib + oauth/refresh, 타입 오류) / YSM 부분 | 유지(SM) | 그룹 D와 공용 업로더로(C-6 참조) | SM:88 |
| TikTok | SM 부분(`lib/platforms/tiktok.ts`) / YSM 부분 | 유지(SM) | 앱 감사 일정 별도 관리 | V2:57 |
| 예약 발행 스케줄러 | SM 부분(Vercel cron이 RLS에 막혀 항상 0건 처리) / YSM 부분(Celery beat 5분) | 통합 | 스케줄러 하나로(BullMQ repeat 또는 pg_cron). Edge Function 중복 제거 | SM:44,72,151 |
| 국가별 최적 업로드 시각 | 기획만 | 유지(후순위) | | `PRD_add.md:248-256` |
| 다국어 GEO 메타 생성 | YSM 부분(`geo_metadata.py`) / SM 기획(GeoMetaEditor) | 통합 | 업로드 단계에 포함 | YSM:98 |
| 플랫폼 자격증명 다계정 저장 | YSM 부분(`account_manager.py` 1,146줄, AES-GCM, 쿠키 갱신) / SM 부분(`crypto.ts` 키 없으면 0키로 폴백) | 통합 | YSM 암호화 방식 + SM API. 0키 폴백 제거 | YSM:43,165; SM:84,120 |

### G. 커머스 수익화

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 쿠팡파트너스 랜딩 `/landing/[slug]` | SM 부분(`params` Promise 미대응, RPC 없음) / BS 부분(미들웨어가 막음) | 통합 | ISR 공개 랜딩. 공개 경로는 가드 예외 처리 | SM:89; BS:64,91 |
| 쿠팡 링크 검색/생성/통계 | SM(CA) 동작 수준 CRUD | 유지(결정 12) | `_platform-core` affiliate 공용 모듈의 쿠팡 어댑터로. video와 blog가 함께 사용 | SM:28; `src/app/api/coupang/*` |
| 네이버쇼핑 커넥트 CPS | YSM 부분(키 없으면 Mock으로 대체) | 디벨롭(MVP 포함, 결정 12) | affiliate 공용 모듈의 제공자 어댑터 | YSM:38,46 |
| 스마트스토어 링크 삽입 | YSM 부분(`commerce_links`) | 통합 | 랜딩 CTA 우선순위 로직으로 | YSM `CLAUDE.md:866-868` |
| 링크인바이오 `/lb/[username]` | SM(CA) 부분 | 유지 | Track B 랜딩 허브 | SM:55 |
| 네이버 브랜드커넥트 자동 지원 | SM(CA) 부분(Playwright) | 유지(결정 12) | blog 소유, 완전 자동 지원. 약관 위반·계정 정지 위험 고지와 사용자 동의 필요 | `src/skill/playwright-engine/brand-connect.ts` |

### H. 블로그/멀티채널 포스팅 (CA + YSM Track D)

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| AI 블로그 글 생성 | SM(CA) 동작 / YSM 부분(`blog_writer`) | 유지(C-5-1 (b) 결정) | 블로그 제품(nomad-blog)으로 이동 | SM:42; YSM:45 |
| 키워드 추천/SEO 점수/해시태그 | SM(CA) 동작 | 블로그 결정을 따름 | | `src/app/api/ai/{keywords,seo-score}` |
| 네이버 블로그 Playwright 게시 | SM(CA) 부분 / YSM 부분 | 통합(블로그 모듈 안에서) | | YSM:122 |
| 티스토리/워드프레스/내 블로그 게시 | SM(CA) 부분 | 블로그 결정을 따름 | | `src/skill/channel-api/*` |
| CA 인스타그램 포스팅 | SM(CA) 부분 | 통합 | F의 Meta 업로더로 일원화 | `src/skill/channel-api/instagram-client.ts` |
| TipTap 멀티채널 에디터 | SM(CA) 부분(sanitize 없는 `dangerouslySetInnerHTML`) | 블로그 결정을 따름 | sanitize 추가 | SM:106 |

### I. 자동화와 분석

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| React Flow 캔버스 | SM 부분(노드 파일 27개, executor의 AIContentGen 노드는 조용히 무동작) / BS 부분(UI) | 통합 | 공용 서버 실행 엔진 + 엣지 연결 필수(C-6 참조) | SM:43,92; `src/components/automation/nodes/` |
| n8n/Make 연동 | SM 부분(브릿지, 콜백 서명 선택적) | 유지(Advanced 플랜) | 서명 필수 | SM:93 |
| Slack 알림 노드 | SM 부분 | 유지 | | `SlackNotifyNode.tsx` |
| YouTube Analytics | SM 부분(lib) / BS 목업 | 디벨롭 | 분석 페이지를 실제 API로 | BS:70 |
| Supabase Edge Functions 3종 | SM 부분(Next 라우트와 기능 중복) | 폐기 | 정한 쪽 하나로 통일 | SM:66,151 |

### J. 신규 (어느 프로젝트에도 없지만 리뷰가 필요하다고 지적한 것)

| 기능 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|
| 백그라운드 전용 Supabase 서비스 클라이언트(쿠키 비의존) | 신규 | 웹훅·cron·워커 전용. 모든 쓰기의 error 처리 | SM:85,132 |
| 워커 독립 엔트리포인트와 배포 | 신규 | `workers/` 패키지 + `npm run worker` + 컨테이너 | SM:133,164; BS:96,126 |
| zod 입력 검증 + `lib/env.ts` 환경변수 검증 | 신규 | 코드가 참조하는데 없는 env 24개 정리 | SM:97,99,144 |
| 작업 결과 소유권 검증 | 신규 | task 조회 시 org 대조 | YSM:85,117 |
| 하위 프로세스 타임아웃 | 신규 | FFmpeg/demucs/yt-dlp 공통 | YSM:95,129 |
| 크레딧·웹훅·OAuth·RLS 통합 테스트 + CI | 신규 | Supabase 로컬 스택 | SM:147,172 |

## C-3. 버려지는 것

| 대상 | 이유 | 근거 |
|---|---|---|
| YSM FastAPI 라우터 9개, Celery 태스크와 beat, Next 14 프론트, `start.ps1`, Dockerfile 2종, `docker-compose.yml`, `railway.toml` | 2세대(Next 16 + 워커)로 대체되었고 코드 공유 흔적이 없음. 서비스 함수만 이식 | YSM:70-76,123 |
| YSM 작업 트리 잔해(pyc, `.venv`, `node_modules`, `.next`, 평문 키가 든 `.env`) | 실행 불가, 키 유출 위험. git 태그로 보존한 뒤 삭제 | YSM:19-21,89,145-147 |
| YSM role/plan 이중 권한, 실패 시 기본 등급 `admin` 표시 | 권한 오인 유발 | YSM:93-94 |
| BS 저장소 자체 | v0.3.0 하위 집합. lib 21개 중 17개가 죽은 코드. 폴더명과 제품 불일치 | BS:4,21 |
| BS 002 마이그레이션의 중복 RLS/인덱스, `increment`(x+1) 함수 | 의미 오류, 중복 | BS:61,76 |
| SM `001_initial.sql`(user 기반 9테이블)과 `002_billing.sql`(user 기반 구독) | org 기준으로 통일하면 재매핑 후 제거. 마이그레이션 번호 `001` 충돌 | SM:63-65,91 |
| SM 플랜 정의 3벌(`lib/plans.ts`, `themes/shorts-factory.ts` plans, 웹훅 `PLAN_CREDITS`) | 하나로 통합 | SM:90,146 |
| SM 결제 두 번째 경로(웹훅의 orderId 파싱 로직) | 정상 결제는 처리 못 하고 위조 요청만 통과 | SM:79-80 |
| `x-internal-call` 우회, `fetch(APP_URL+'/api/…')` 자기 호출 | 인증 우회. 함수 직접 호출로 교체 | SM:81,134 |
| Mock 로그인(`lib/mock-auth.ts`) | 프로덕션에 노출 | SM:83 |
| LLM 클라이언트 3종(OpenRouter SDK, OpenAI SDK, raw fetch), YSM의 Anthropic 직접 호출 | 클라이언트 하나로 | SM:98; YSM:98 |
| Python 워커가 BullMQ 프로토콜을 흉내 내는 방식 | TS 워커와 같은 큐를 두고 경쟁·충돌 | SM:87,124 |
| 플레이보드 난수 성장률, 대시보드 더미 배열 | 가짜 지표가 DB에 저장됨 | SM:94 |
| 루트 문서 분기본(`_add`, `_pricing`, `_complete`), `taste-skill*.ts` 3종, `files.zip`, `src/taste/content-automator` 테마 | 문서와 테마 중복 | SM:61,103,152 |
| Remotion, CapCut 익스포트 | 기획만 있고 의존성도 없음. FFmpeg 하나로 충분 | `NOMAD Shorts Maker/package.json` |
| ioredis 루트 직접 의존 | bullmq 내부 것과 중복 설치 | SM:88,143 |

## C-4. 새로 채워야 할 기획 공백

1. 제품 경계 정의: CA 블로그 제품을 어디에 둘지(SM:131, 197)
2. Supabase 접근 3계층 규약: 브라우저 / SSR / 서비스 롤(SM:132)
3. 파이프라인 단계 간 payload 계약과 실패·재시도·환불 규칙(SM:87, 133)
4. 워커 런타임과 배포 토폴로지: Railway인지, GPU를 쓸지, 큐를 어떻게 나눌지(SM:133, YSM:128)
5. 가입 시 조직 자동 생성 + 무료 크레딧 원장 기록(BS:63, 121)
6. 결제: 주문 사전 저장, 멱등 처리, 빌링키 정기결제, 월 크레딧 지급 배치(BS:120, SM:100). 월 지급은 `PRD_pricing.md` §7에 "Make.com 또는 Supabase cron"으로 미정 상태
7. OAuth state nonce, 암호화 키 관리, 키 교체(rotate) 정책(SM:116, 120; YSM:111)
8. 네이버 로그인 계정 연결 정책: 같은 이메일이면 자동 병합할지 금지할지(YSM:113-114)
9. YouTube resumable 업로드, 쿼터 초과 시 대체 채널 선택 로직 구체화(SM:95, `PRD_add.md:156`)
10. 테스트/CI 기준(SM:172)

## C-5. 사용자 결정 필요

**C-5-1. 블로그 자동 포스팅(CA)과 YSM Track D 블로그를 어디에 둘 것인가** (결정됨: (b). 확정 결정 1, 12 참조)
- (a) 숏츠 안에 "블로그/멀티채널 발행" 모듈로 유지
- (b) 별도 제품(블로그 스튜디오)으로 분리하고 인증·결제·업로더만 공유
- (c) 폐기
- **권장: (b).**
  - CA는 플랜 단위가 포스팅 수(Free 10건 / Pro 50건)라서 숏츠의 크레딧 모델과 맞지 않습니다(`src/lib/plans.ts:18-71`).
  - CA 스키마는 user 기준입니다(SM:63).
  - Shorts PRD v0.4에는 블로그가 없습니다.
  - 숏츠 MVP에서는 빼되, 링크인바이오·Meta 업로더는 숏츠 쪽으로 흡수합니다. (확정 결정 12로 변경: 쿠팡 링크는 affiliate 공용 모듈로 이동)
  - "Nomad-BlogStudio"라는 이름은 이 새 블로그 제품에 붙이는 것도 방법입니다.

**C-5-2. 워커 런타임**
- (a) TS BullMQ로만
- (b) Python으로만(Celery 부활)
- (c) TS가 오케스트레이션(FlowProducer)을 맡고, Python은 미디어 처리(Whisper, demucs, FFmpeg) 전용 큐만 소비
- **권장: (c).** 리뷰 권고와 같고(SM:133), 이식할 YSM 자산이 모두 Python입니다. 단 Python이 BullMQ를 흉내 내지 않도록 큐 이름과 계약을 분리하거나, Postgres 잡 테이블을 `SKIP LOCKED`로 가져가는 방식으로 연결합니다(V2:106).

**C-5-3. 테넌시**
- (a) org 기준
- (b) user 기준
- **권장: (a).** SM 신 스키마와 BS가 이미 org 기준이고, Advanced 플랜에 팀 5인 기능이 있습니다(SM:163, `PRD_pricing.md:105`).

**C-5-4. 플랜 정본** (현재 충돌하는 값)

| 출처 | 내용 |
|---|---|
| `NOMAD Shorts Maker/PRD.md:610-615`, `Nomad-BlogStudio/PRD.md:482-487`, 테마 파일 | Free 0원/50크레딧, Starter 29,000원/500, Pro 69,000원/1,500, Agency 99,000원/5,000 |
| `NOMAD Shorts Maker/PRD_pricing.md:116-143` | Starter 0원/100(1회), Basic 49,000원/1,200, Pro 99,000원/3,000, Advanced 149,000원/5,000 |
| `src/lib/plans.ts`(CA) | Free 0원, Pro 29,000원, Business 99,000원 (포스팅 수 기준) |
| 코드 사용처 | `jobs/route.ts:61`은 starter/agency, 결제 UI는 pro/business(SM:90) |

- **권장:** `PRD_pricing.md`를 정본으로 삼습니다. DB 시드와 기능 매트릭스까지 있는 유일한 문서입니다. 다만 "starter"가 문서에 따라 유료(29,000원)도 되고 무료도 되므로 키 이름 재정의가 필요합니다.

**C-5-5. MVP 트랙 범위**
- (a) A, B, C + 플레이보드
- (b) 5개 트랙 전부
- **권장: (a).** D(롱폼)와 E(Suno/Distrokid)는 2단계로 미룹니다.

**C-5-6. YSM 처리**
- (a) 태그만 남기고 아카이브
- (b) 태그 후 모듈 4종 이식
- **권장: (b).** YSM:122, 156.

## C-6은 그룹 D 뒤에 정리했습니다.

---

# 그룹 D: nomad-commerce (셀러 커머스 자동화 SaaS)

## D-1. 통합 제품 정체성과 베이스

통합 제품은 **"NOMAD Commerce"(가칭; "AI Factory"라는 이름은 그룹 C와 충돌하므로 정리 필요)**입니다. 셀러가 아마존·국내 도매에서 상품을 가져와 상품DB에 쌓고, AI 상세페이지(유형별 슬롯 이미지, 카피, 금지어 검사)를 만든 뒤, 마켓 규격에 맞춰 변환해 쿠팡/스마트스토어부터 배포하는 SaaS입니다. 2단계에서 카드뉴스, 쇼츠, SNS로 확장합니다.

**기획 정본은 V.2 문서, 코드 베이스는 sellingstudio로 권장합니다.**
- V.2 문서: 도메인 스펙(슬롯, 마켓 규격, 등록 폼)이 가장 깊습니다(V2:20-21, 158).
- sellingstudio를 코드 베이스로 고르는 이유:
  - 네 프로젝트 중 핵심 경로가 실제로 연결된 유일한 코드입니다. 로그인 → 생성 → 저장 → fal webhook → Realtime까지 이어지고, 완성도 약 55%입니다.
  - Next 16 `proxy.ts`, Supabase 클라이언트 3종, zod, 가입 트리거가 이미 있습니다(SS:19-20, 138-139).
  - V2 리뷰도 이 모듈들의 재사용을 권했습니다(V2:116).
- v1은 Vite SPA라서 V2를 그 위에 쌓을 수 없습니다(v1:86). 프롬프트와 캔버스 설계만 이식합니다(v1:88-94).
- nomad-ai-commerce는 코드 재사용 가치가 낮습니다(V2:117). 화면 흐름, 노드 실행기 구조, 플랜 정책 상수만 참고합니다.

## D-2. 기능 매트릭스

### A. 플랫폼

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 소셜 로그인 | SS 동작(Google/Kakao, profiles 보장) / v1 동작(Google/GitHub/Kakao PKCE) / CM 목업(임시 로그인만, 실제로는 진입 불가) / V2 기획 | 유지(SS) | SS 콜백의 `next` 파라미터 화이트리스트와 origin 고정 보강. 네이버 로그인은 SS PRD에만 있음 | SS:23,64; v1:22,153; CM:61,87; `sellingstudio/PRD.md:46` |
| 역할/슈퍼어드민 | CM 부분(`nomad_role` 쿠키라 위조 가능) / SS 부분(002 마이그레이션에 개인 이메일 하드코딩) / V2 기획(4단계 role) | 디벨롭 | DB role. 사용자가 role/plan을 직접 UPDATE할 수 없게 | CM:58,81; SS:72; V2:47 |
| 과금(크레딧/한도) | SS 부분(크레딧 비원자 차감, 생성 라우트가 잔액 미확인, plan을 요청 바디에서 신뢰) / v1 부분(클라이언트에서 한도 판단) / CM 부분(쿠키로 플랜 판정) / V2 기획(클라이언트 상수) | 통합+디벨롭 | 서버 RPC 하나로 차감·환불(D-5-2 참조) | SS:58-60; v1:58; CM:64; V2:45,142 |
| 결제 | SS 기획(Stripe 패키지만) / V2 기획(Toss 정기결제) / CM 목업(`window.alert`) | 통합 | 그룹 C와 공용 Toss 모듈(D-5-3 참조) | SS:69,131; V2:150; CM:20 |
| 월 크레딧 초기화, 50/80/90% 소진 알림 | SS 기획만 | 디벨롭 | pg_cron | SS:113,129 |
| Add-on 과금(슬롯·계정·쇼츠) | V2 기획 / CM 부분(`calcAddonSlots` 함수만) | 유지(후순위) | | `Nomad-AI-Factory_V.2/PRD.md:304` |
| 랜딩/가격 페이지 | SS 동작(1,213줄) / v1 동작(772줄) / CM 동작 / V2 기획 | 통합 | SS 랜딩 기반. V2 카피 중 허위 수치와 후기는 제거 | SS:100; V2:48 |
| 대시보드 KPI | SS 부분(크레딧/플랜만 실데이터, 탭은 목업) / v1 목업 / CM 목업 | 디벨롭 | 실데이터 집계 | SS:20,66; v1:66 |
| 환율 위젯과 마진 계산 | CM 부분(키가 없어 실패해도 success 반환) / v1 부분(LLM 추정치, 기본 1380) / V2 기획(수출입은행 5통화 + price-calculator) | 디벨롭 | 수출입은행 API + `exchange_rates` 캐시 + 서버 계산 유틸 | CM:67; v1:72; V2:85 |
| 쿠팡/네이버 TOP100, 데이터랩, 시즌 추천 | CM 목업(하드코딩) / V2 기획 | 디벨롭(후순위) | 공식 API가 없어 데이터 출처 확정 필요 | CM:74; V2:56 |

### B. 소싱과 상품DB

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 아마존 URL 수집 | CM 부분(정규식 파싱이 사실상 작동 안 함, SSRF, `raw_html` 통째 저장) / v1 부분(URL 기반 AI 리스팅 생성, 가격·환율은 LLM 추정) / V2 기획 | 디벨롭 | 서드파티 상품 데이터 API, 허용 도메인 목록 | CM:59,66,83; v1:24; V2:56,145 |
| eBay/Walmart 소싱 | v1 기획만 | 폐기(MVP) | 범위 축소 | `nomad-ai-factory/CLAUDE.md:131-156` |
| 위탁 엑셀(오너클랜/도매꾹/온채널/아마존 CSV/자유 양식) | CM 부분(엑셀 대량 insert, 대상 테이블 스키마 없음) / V2 기획(파서 5종) | 통합 | SheetJS + 컬럼 매핑 UI. MVP는 2종 | CM:24,72; V2:123 |
| 상품DB/목록(가상 스크롤, 일괄 작업) | CM 목업(수집한 상품을 보여주는 화면 없음) / SS 목업(Products 탭) / V2 기획 | 디벨롭 | `products` 중심 화면 | CM:74; SS:66 |
| 소싱 이력/결과물 보관함 | v1 동작(`contents` 저장·조회) | 통합 | 상품DB와 상세페이지 목록으로 흡수 | v1:20,26 |

### C. AI 콘텐츠 생성

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 상품명 최적화/키워드 추천 | SS 동작(product-names, keywords) / v1 동작(리스팅 JSON 프롬프트) / CM 죽은 코드 | 통합 | SS 라우트 + v1 프롬프트(톤·채널 가이드) 이식. 출력은 zod로 검증 | SS:24; v1:90; V2:94 |
| 금지어 필터 | CM 죽은 코드(`\b` 때문에 한글 매칭 안 됨) / V2 기획(코드 상수와 테이블 두 군데) | 디벨롭 | `banned_words` 테이블 하나만 출처로. 한글 경계 처리 | CM:65; V2:59,148 |
| 상세페이지 카피 생성 | SS 동작(Claude) / v1 부분(마크다운, 톤 5종) | 유지(SS) | v1 톤 가이드 흡수 | SS:17,140 |
| 입력: 텍스트/이미지 Vision/음성 STT | SS 동작 | 유지 | | SS:24; `StudioNewForm.tsx:109` |
| 입력: URL 벤치마킹 | SS 부분(Browserless env 이름 불일치, SSRF, 장부 불일치) | 디벨롭 | 허용 도메인, 크레딧 RPC 사용 | SS:63-64 |
| 카테고리 프리셋/엑셀 대량 생성 | SS 동작(프리셋 상수 18종, XLSX 업로드) | 통합 | V2 3-Mode의 "다중 등록"으로 흡수 | `StudioNewForm.tsx:531-548,618` |
| 이미지 생성(시안 → 최종) + webhook + Realtime | SS 동작(`final_url` 미기록, webhook 서명 없음, `USING(true)` 정책) | 디벨롭 | 서명 검증, 최종 단계 구현, 플랜별 모델은 서버에서 결정 | SS:61,74,85 |
| 상세페이지 유형 8종 + 자동 추천 | V2 기획 | 디벨롭 | MVP는 설득형/정보형/감성형 3종. 리뷰형의 AI 생성 후기·평점은 제외 | V2:48,123,125 |
| 이미지 슬롯 체계(T/D/L) | V2 기획(정의가 3가지로 갈림) | 디벨롭 | `MARKET_IMAGE_SPEC` 18슬롯을 정본으로 | V2:50,71 |
| Puppeteer 인포그래픽/법적고지 렌더링 | V2 기획 | 디벨롭 | 워커 컨테이너에서 실행(한글 폰트 포함) | V2:44,65,144 |
| 누끼(배경 제거) | V2 기획(Remove.bg) / SS 기획(birefnet) / CM 부분(gpt-image-1 썸네일, size 값 오류로 항상 400, 호출 UI 없음) | 통합 | 공급자 하나로 | CM:68; `sellingstudio/PRD.md:30` |
| Sharp 한글 카피 합성 | V2 기획 | 디벨롭 | | `MARKET_IMAGE_SPEC.md` §1 |
| 마켓별 이미지 변환/분할/검증 | V2 기획(코드 예시까지 있음) / SS 기획(Sharp 미구현) | 디벨롭 | 단위 테스트 포함 | V2:147; SS:132 |
| 3-Mode 생성 모달 + 큐 | V2 기획(Zustand 루프 + SSE 구조) | 디벨롭 | 잡 테이블 + 워커 + Realtime으로 재설계 | V2:44,65,144 |
| 상세페이지 에디터/인라인 편집/단일 이미지 재생성 | SS 기획(PRD 4.8, `/api/regenerate/image` 라우트 없음) / V2 기획 | 디벨롭 | | `sellingstudio/PRD.md:106-109,149` |
| 엑셀(플레이오토)/ZIP 내보내기 | SS 기획(미구현) | 디벨롭(MVP 포함 권장) | 마켓 API 승인 전에도 쓸 수 있는 대체 경로 | SS:20,132; `sellingstudio/PRD.md:91-103` |
| GEO JSON-LD | V2 기획(`brand` 하드코딩 오류) / CM 기획 | 디벨롭(후순위) | 카페24/아임웹에만 적용 | V2:59 |
| Vector DB 임베딩 | V2 기획 / CM 기획 | 폐기(MVP) | V2 MVP 보류 목록에 있음 | V2:124 |
| 브랜드킷/분석 대시보드 | SS 기획(Phase 5) | 유지(후순위) | | `sellingstudio/PRD.md:176` |

### D. 마케팅 산출물

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 카드뉴스 | V2 기획 | 유지(2단계) | | V2:124 |
| 상품 쇼츠 15/30/50초 | CM 목업(`setTimeout`) / v1 목업 / V2 기획 | 통합 | 그룹 C 렌더 엔진 호출(C-6 참조) | CM:20; v1:20 |
| SNS 5채널 배포 | V2 기획 / v1 목업(SnsNode) | 통합 | 그룹 C 공용 업로더 | V2:118,153 |
| SNS 설명란·고정댓글에 상품 URL 자동 삽입 | CM 기획 | 유지(2단계) | | `nomad-ai-commerce/PRD.md:68-70` |
| 블로그 원고/발행(지역뉴스, GEO 블로그 3버전) | CM 부분(요청 바디의 `tableName`으로 임의 테이블 insert 가능) / v1 부분(결과물 보관함 마크다운) | 사용자 결정(D-5-8) | | CM:63,91; `nomad-ai-factory/CLAUDE.md:239-243` |
| 제휴 링크 매칭(MonetizeNode) | v1 목업 | 폐기(D 쪽) | 크리에이터 수익화이므로 C 소관 | `nomad-ai-factory/CLAUDE.md:302` |
| 음원 라이브러리(업로드 + 기본 풀) | CM 목업(로컬 state) / V2 기획 | 유지(쇼츠와 함께) | | CM:75 |

### E. 마켓 배포

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 마켓 계정 다계정 슬롯 | CM 부분(CRUD는 동작하지만 인증 없이 키·시크릿을 평문 반환, `NOMAD_USER_ID` 1인 고정) / SS 목업(Integrations) / V2 기획 | 통합+디벨롭 | 암호화 저장, 응답 시 마스킹, 테넌트 필터 | CM:60,85; V2:46 |
| 쿠팡 Wing/스마트스토어 API 등록 | CM 목업(시뮬레이션) / V2 기획 | 디벨롭(MVP 2채널) | HMAC 서명, 카테고리 매핑 | V2:123,149 |
| 지마켓/옥션/11번가/롯데온/카페24/아임웹 | V2 기획 | 유지(2단계) | 지마켓·옥션은 ESM 하나로 묶음 | V2:133 |
| 와디즈 | SS 기획(출력 규격만) | 유지(이미지 규격 출력만) | API 배포 대상에서는 제외 | `sellingstudio/PRD.md:101` |
| 6-Step 위자드/배송·반품 템플릿/고시 자동완성 | V2 기획 | 디벨롭 | 두 마켓 필드로 축소. 반품 불가 문구와 "건강기능식품이 아닙니다" 자동 삽입은 제외 | V2:49,123,125 |
| 업로드 진행률/이력/실패 로그 | CM 부분(`globalThis` 인메모리, 서버리스에서 404) / V2 기획 | 디벨롭 | 잡 테이블 + Realtime | CM:69 |
| 판매관리(주문/정산/CS) | v1 부분(orders 조회만, 생성 경로 없음) / SS 목업(Sales) / V2 기획(메뉴 4줄) | 유지(3단계) | 요구사항부터 새로 작성 | v1:20,147; V2:57 |
| 해외배송 템플릿 ON/OFF | CM 목업 / V2 기획 | 통합 | 배송 템플릿으로 흡수 | CM:75 |

### F. 자동화와 기타

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| React Flow 캔버스 | v1 부분(reactflow v11, 실행은 setTimeout 시뮬레이션, 위상 정렬 설계는 좋음) / CM 부분(@xyflow 12 + 서버 엔진, 단 엣지 무시·`default` 노드에서 실패·HTTP 자기 호출) / SS 부분(UI 테스트 실행만) | 통합 | 공용 엔진(C-6 참조) | v1:66,92; CM:62,89; SS:27 |
| n8n/Make(Mode B/C) | V2 기획(HMAC emit 예시) / v1 기획 | 유지(2단계) | 그룹 C 브릿지 재사용 | `Nomad-AI-Factory_V.2/CLAUDE.md` §13 |
| Cron/고마진 상품 알림 | v1 부분(엔진·스케줄러가 빈 함수) | 폐기(MVP) | | v1:66 |
| 외부용 API Key 발급 | V2 기획 | 유지(엔터 플랜, 후순위) | | `Nomad-AI-Factory_V.2/PRD.md:169` |
| Capacitor Android/iOS 앱 | SS 부분(dev 서버를 가리키는 설정이라 배포 불가) | 사용자 결정(D-5-4) | | SS:62,87 |
| 사용자 API 키를 localStorage에 저장(BYOK) | v1 동작 | 폐기 | XSS 한 번이면 전부 유출 | v1:59,80 |
| 사용자가 AI 모델 선택 | v1 동작(서버 화이트리스트) / SS(역할별로 모델 고정) | 통합 | 서버 화이트리스트 안에서만 선택 | v1:76,152; SS:17 |

### G. 신규 (리뷰가 지적한 공백)

| 기능 | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|
| 장시간 생성 작업 실행 기반 | 신규 | `detail_page_generation_jobs` + Node 워커 컨테이너 + `SKIP LOCKED` 기반 플랜별 동시성 | V2:65,106,144 |
| 원자적 사용량 차감/환불 RPC | 신규 | anon/authenticated의 execute 권한 회수 | V2:107,142 |
| 테넌트별 자격증명 암호화(Vault 또는 AES-GCM) | 신규 | 단일 env 마켓 키 제거 | V2:46,143 |
| 테이블별 RLS 정책 + 정책 테스트 | 신규 | WITH CHECK, 전역 테이블은 읽기 전용 | V2:47,140 |
| 법률 검토를 거친 문안 | 신규 | 반품·건기식 고지·후기 | V2:69,152 |
| 슬롯당 원가와 마진 모델 | 신규 | 플랜 가격 근거 | V2:61 |

## D-3. 버려지는 것

| 대상 | 이유 | 근거 |
|---|---|---|
| v1 Vite SPA, HashRouter, Tailwind CDN, `index.html` 커스텀 CSS | Next 16으로 전환 | v1:96-99 |
| v1 Express 프록시(`backend/server.js`)의 CORS `*`, IP 레이트리밋, `/api-proxy` | 인증 없는 공개 AI 프록시. 모델 화이트리스트, json 모드, max_tokens 설정만 이식 | v1:57,76,95 |
| v1 `vertex-ai-proxy-interceptor.js`, `vite.config.ts` 더미 define | AI Studio 템플릿 잔재 | v1:62,100 |
| v1 인증 구현 3벌, `pages/`, `contexts/`, `lib/actions`, `lib/media`, `lib/commerce`, 설정 폼 2벌(약 4,500줄 미사용) | 죽은 코드 | v1:63,98 |
| v1 `reactflow` v11 + CDN CSS | @xyflow v12로 재작성 | v1:65 |
| v1 `schema.sql`(구 영상 스키마), `main.html`, `structer.zip`, `CLAUDE_v0.md` | 구 문서와 시안 | v1:71,102 |
| CM 모의 인증과 쿠키 권한(`mock-login`, `nomad_role`, `nomad_plan`) | 권한 위조 가능 | CM:58,64,81 |
| CM `globalThis` 잡 저장소, `mock-market-accounts`, `CustomProcessingNode`, 로그아웃 3중 구현 | 서버리스 비호환, 죽은 코드 | CM:69,73 |
| CM `execute-flow`의 HTTP 자기 호출, `tableName` insert, `raw_html` 저장, 정규식 아마존 파싱, exchangerate.host | 보안·동작 결함 | CM:59,63,66-67,71 |
| SS `/api/credits/use` 분리 차감 구조, 클라이언트가 `selling_pages`에 직접 insert, `USING(true)` UPDATE 정책 | 과금 우회, 무결성 붕괴 | SS:58-61,68 |
| SS 미사용 의존성 14개, `AuthProvider`, `projectStore`, `fal.ts` 미사용 함수, 대시보드 `MOCK_*` 탭, 루트 `image*.png` | 정리 대상 | SS:69,71,73 |
| SS Stripe(Toss로 정할 경우) | 그룹 C와 PG 통일 | SS:131 |
| SS CSP의 `unsafe-eval`, 사설 IP 하드코딩, 002 마이그레이션 개인 이메일 시드 | 설정 결함 | SS:70,72 |
| V2 문서 중복(DESIGN, MASTER_SPEC, DESIGN_FOR_STITCH, STITCH_UI_DESIGN_PLAN이 같은 토큰을 각자 정의) | 사실 하나에 출처 하나 원칙 | V2:32-38,109 |
| V2 CLAUDE.md 예제 코드(Zustand 큐 루프 + Route Handler 안의 SSE, 청크 버퍼링 버그), `@xyflow/react v11` 표기, `<form>` 금지, localStorage "아티팩트" 규칙, `middleware.ts` | 그대로 복사되면 결함이 재발 | V2:54-55 |
| V2 랜딩 허위 수치와 후기, 리뷰형 AI 후기·평점, 반품 불가·건기식 부정 문구 자동 삽입 | 표시광고법·전자상거래법 위반 소지 | V2:48-49 |
| DALL-E 3 | gpt-image 계열이나 fal Flux로 교체 | V2:61 |

## D-4. 새로 채워야 할 기획 공백

1. 문서 충돌 결정표: 슬롯 18개, 10/15장 기본값, `MANDATORY_SLOTS`, 파이프라인 8단계 이름과 진행률, 플랜 4종, 스택 버전(V2:139)
2. 백엔드 실행 모델: 워커, 재시도, 새로고침 후 진행 상황 복원(V2:21, 65)
3. 서버 측 사용량 집행 지점(V2:45, 67)
4. 자격증명 암호화 방식과 키 관리(V2:46)
5. RLS 세부 정책, 슈퍼어드민 접근 방식(V2:47)
6. 아마존 데이터 공급자 선정, SSRF 방어(V2:56)
7. 마켓/SNS API 승인 절차와 일정(V2:21, 129)
8. Toss 빌링키, 구독 상태 전이, 일할 계산, Add-on, 월 초기화(V2:58)
9. 판매관리 요구사항: 마켓별 주문 API(V2:57)
10. 법률 검토(V2:69)
11. Capacitor 배포 전략(SS:87)
12. 생성 라우트와 차감을 한 트랜잭션으로 묶는 규약(SS:79, 92)

## D-5. 사용자 결정 필요

**D-5-1. 코드 베이스**
- (a) sellingstudio 저장소를 확장
- (b) `basic-master-module` 골격으로 새로 시작하고 SS 모듈을 이식(V2:115, 141 권고)
- **권장: (a).**
  - SS는 이미 Next 16, proxy.ts, Supabase 3종, zod, 가입 트리거를 갖췄습니다.
  - 버릴 부분(거대 컴포넌트 2개, 목업 탭)만 잘라내는 쪽이 비용이 적습니다.
  - 단, 제품 이름과 IA는 V2 기준으로 재편합니다.

**D-5-2. 과금 모델**
- (a) 크레딧(SS, 그룹 C와 같은 방식)
- (b) 월 한도 쿼터(V2: 상품DB 30/300/2,000 등)
- (c) 하나의 사용량 원장(kind별) 위에 플랜 월 한도 + 추가 크레딧
- **권장: (c).** 원장 RPC를 그룹 C와 공유할 수 있습니다.

**D-5-3. 결제 PG**
- (a) Toss(V2, 그룹 C와 같음)
- (b) Stripe(SS PRD)
- **권장: (a).** 국내 셀러 대상이고, 그룹 C와 결제 모듈을 공유할 수 있습니다.

**D-5-4. sellingstudio Capacitor 앱**
- (a) 배포 URL을 로드하는 원격 셸로 유지
- (b) 폐기
- (c) MVP 이후로 연기(`lib/capacitor`만 보존)
- **권장: (c).** 현재 설정으로는 스토어 배포가 불가능하고(SS:62), 카메라는 UI에서 쓰이지도 않습니다(SS:71). 웹 MVP 이후 모바일 촬영→생성 수요를 확인하고 결정합니다.

**D-5-5. MVP 마켓·SNS 범위**
- (a) 쿠팡 + 스마트스토어 + 엑셀 출력, SNS 없음
- (b) 마켓 8개 + SNS 5개
- **권장: (a).** V2:123-124와 같습니다. SNS는 2단계에 그룹 C 업로더를 붙입니다.

**D-5-6. 테넌시**
- (a) user 기준(V2 PRD:31, SS)
- (b) org/workspace 기준(V2 JTBD의 에이전시 세그먼트, TEAM_MEMBER)
- **권장: (b) 스키마로 시작하되 "1인 1워크스페이스"로 운영.** 그룹 C와 공용 org 모듈을 쓸 수 있고, 나중에 에이전시 기능을 붙일 때 마이그레이션이 필요 없습니다.

**D-5-7. 플랜 정본** (현재 충돌하는 값)

| 출처 | 내용 |
|---|---|
| `Nomad-AI-Factory_V.2/PRD.md:296-301` | 프리 0원, 스타터 29,000원, 프로 69,000원, 엔터 149,000원 (한도형) |
| V2 랜딩 | 엔터 "별도 문의", 7일 환불(V2:52) |
| `nomad-ai-commerce/lib/utils/plan-policy.ts` | free 0원, basic 29,000원, pro 79,000원, enterprise 199,000원 (마켓 슬롯 1/3/8/20) |
| `sellingstudio/PRD.md:155-158` | FREE 0원/15크레딧, STARTER 29,000원/150, PRO 69,000원/350, ENTERPRISE 99,000원/550 (이월 규칙 포함) |
| v1 | `plan_limits` 테이블 DDL 자체가 없어 값을 알 수 없음(v1:60) |

- **권장:** V2 가격표를 기준으로 하고, SS 크레딧 수량을 각 플랜의 "월 생성량"으로 환산해 하나로 합칩니다. 엔터 가격은 한 가지로 확정합니다.

**D-5-8. 블로그 원고/발행 기능** (CM 11단계, v1 GEO 블로그)
- (a) D에 유지
- (b) D는 원고 생성(텍스트 내보내기)까지만 하고, 발행은 C-5-1의 블로그 제품이 담당
- **권장: (b).**

**D-5-9. 상세페이지 엔진의 정본**
- (a) SS의 이미지 6장 + fal 레이아웃
- (b) V2의 슬롯 18개 + Puppeteer/Sharp
- **권장:** 슬롯 체계는 V2를 정본으로 하고, 실행 엔진은 SS의 fal webhook + Realtime을 워커 기반으로 옮겨 씁니다.

---

## C-6. 그룹 C와 D의 겹치는 기능, 소유권 권고

| 겹치는 기능 | C 쪽 현황 | D 쪽 현황 | 소유 권고 |
|---|---|---|---|
| SNS 업로더(YouTube/IG/Threads/TikTok) + OAuth 매니저 + 토큰 암호화 | SM `lib/platforms/*`, `channels/oauth-manager.ts`, `lib/crypto.ts`(부분), YSM `account_manager`(AES-GCM) | V2 2단계 기획, v1 SnsNode 목업 | **C 소유, 공용 패키지로 분리.** D는 소비만. 이식 전에 0키 폴백, state 결함, tsc 오류부터 수정(V2:118,153) |
| 쇼츠 생성/렌더링 | SM Track C Mode1(대본→이미지→Ken Burns→TTS→인코딩), Track B 커머스 숏폼 | V2 "상품 쇼츠 15/30/50초"(기획), CM `render-shorts` 목업, v1 MediaNode 목업 | **렌더 엔진은 C 소유.** D는 "상품DB → 쇼츠 템플릿" UX와 음원 선택만 담당하고 C 워커 API를 호출 |
| 쿠팡파트너스/제휴 링크 | SM Track B 랜딩 + `/api/coupang/*`(CA), YSM 네이버쇼핑 커넥트 | v1 MonetizeNode(목업) | **`_platform-core` affiliate 공용 모듈(확정 결정 12).** video(C)와 blog가 사용. 크리에이터 수익화 기능이라 셀러 제품(D)에서는 제외 |
| React Flow 자동화 캔버스 | SM 노드 27개 + `reactflow-executor`(내부 호출 버그), BS UI | v1 Canvas(위상 정렬 설계), CM `execute-flow`(노드 실행기 분리 구조), SS UI | **공용 "automation-core"(플랫폼 공통).** 서버 실행, 엣지 연결 필수, 위상 정렬(v1 설계), 노드 레지스트리(CM 구조). 노드는 각 제품이 등록 |
| n8n/Make 브릿지 | SM `make-bridge.ts`, `n8n-bridge.ts`, 콜백 | V2 Mode B/C(기획, HMAC emit 예시) | **공용 automation-core에 포함** |
| 블로그 원고·발행 | SM CA(네이버/티스토리/WP), YSM Track D | CM 지역뉴스 블로그, v1 GEO 블로그 원고 | **C 또는 분리된 블로그 제품 소유.** D는 원고 생성까지 |
| 인증/조직/크레딧 원장/Toss 결제/웹훅 서명/OAuth state | 세 프로젝트 모두 결함 | 세 프로젝트 모두 결함 | **공용 플랫폼 모듈.** Fable 수준 설계를 한 번만 해서 양쪽에 적용 |
| LLM 클라이언트, fal 이미지 클라이언트 | SM 3종 혼재, BS `fal-image` | SS `lib/llm/openrouter.ts`, `lib/image/fal.ts`(가장 정돈됨) | **공용 패키지. SS 구현을 기준으로** |
| 콘텐츠 규제 검사 | SM Compliance Filter(LLM 판정 PASS/WARN/FAIL) | V2/CM 금지어 사전(규칙 기반) | **공용 "compliance" 모듈:** 규칙 사전(D) + LLM 판정(C) 두 단계 |
| 음원 | SM Track E Suno 생성 | V2/CM 음원 라이브러리(업로드와 기본 풀) | Suno 생성은 C 소유, D는 라이브러리로 소비 |
| 트렌드 | YouTube/TikTok 트렌드(MODULE 0) | 쿠팡/네이버 TOP100, 데이터랩 | 데이터 출처와 도메인이 달라 **각자 소유** |
| GEO | YouTube 다국어 메타(YSM `geo_metadata`) | 상품 JSON-LD | 이름만 같고 기능이 다름. **각자 소유** |

**그룹 간 추가로 결정할 것**
- (a) 두 제품이 같은 Supabase 프로젝트/계정을 공유할지(SSO, 크레딧 공용 지갑), (b) 프로젝트를 분리하고 공용 패키지만 공유할지
- **권장: (b)로 시작.** 장애와 RLS 영향 범위를 격리하고, 공용 코드는 패키지로 공유합니다.
- 브랜드 이름 "NOMAD AI Factory"는 둘 중 한 제품만 쓰도록 정해야 합니다.


# 분석 원문 3: 마이크로웹(microweb-studio) / 관리 시스템(admin-suite) / 단독 프로젝트

# 통합 기능 분석 (Group E, Group F, 단독 프로젝트)

리뷰 9건(+ WebSite)과 각 폴더의 기획 문서(PRD.md, CLAUDE.md, Design 문서)를 끝까지 읽었습니다. 기능이 실제로 있는지는 코드로 몇 군데 확인했습니다.

- 대상 코드: webcraft `constants/geoMeta.ts`, `pages/AdminDashboard.tsx`, ERP `components/settings/SettingsClient.tsx`, `app/actions/logs.ts`, Hospital `src/lib/permissions.ts`, School nested git HEAD `3c19d1e`의 파일 목록.
- 근거 표기는 `D:/WorkSpace/platform/docs/reviews/<파일>.md:줄` 또는 소스 경로로 했습니다.
- 구현 상태는 동작 / 부분 / 목업 / 기획만 네 가지로 적었습니다.

---

## GROUP E. microweb-studio (모바일 마이크로웹 제작/에이전시)

### 1. 통합 제품 정체성과 베이스

microweb-studio는 두 가지를 한 제품으로 묶습니다.
- **판매 상품:** 청첩장으로 시작해 돌잔치·부고장 등으로 넓혀 가는 "하객용 모바일 마이크로웹 템플릿"
- **영업 쇼룸:** 이 템플릿과 홈페이지 제작을 함께 파는 "웹 에이전시 영업 쇼룸"(포트폴리오, 가격표, 업종×등급 시뮬레이터, 견적 문의)

**베이스는 premium-wedding-invitation입니다.** 세 프로젝트 중 실제 고객(하객)이 쓰는 기능을 가진 것은 이것뿐입니다. 계좌 복사, tel/sms, 지도 딥링크, 방명록, 공유가 있습니다(`D:/WorkSpace/platform/docs/reviews/premium-wedding-invitation.md:22,111`). 리뷰도 이 코드를 "청첩장/돌잔치/부고장 공통 템플릿 베이스"로 권고합니다(`:122`).

나머지 두 프로젝트는 이렇게 들어갑니다.
- **webcraft-agency-simulator:** 랜딩, 포트폴리오, 가격표, 시뮬레이터가 실제로 동작합니다. 그래서 스튜디오의 "영업 프론트"로 붙입니다(`webcraft-agency-simulator.md:131`).
- **nexus-micro-web-builder:** 상품이 아니라 기획 쇼케이스입니다(`nexus-micro-web-builder.md:120`). 12개 모델 데이터만 "템플릿 출시 로드맵/카탈로그"로 흡수하고 앱은 해체합니다.

세 프로젝트 모두 같은 Vertex AI Studio 템플릿(백엔드 프록시, 인터셉터)에서 나왔습니다. 그래서 공통 잔재를 한 번에 걷어낼 수 있다는 점도 통합의 이점입니다(`nexus-micro-web-builder.md:7`).

**WebSite 판정: 별도로 유지하고, 포트폴리오에 "엔트리(링크/스크린샷)"로만 등록합니다.**
- 5개 사이트는 모두 실제 브랜드 납품작 성격입니다. Floria 플로럴 스튜디오, Flora Sentiment 커머스, 한울건설, B2B SaaS 랜딩이 그렇습니다(`WebSite.md:12,28,61,77`).
- 스택(HTML, JSX, TSX)과 미디어 규모(Lucury 529MB)가 서로 달라 코드를 합칠 이유가 없습니다.
- 반면 webcraft 포트폴리오는 가짜 picsum 9건입니다(`webcraft-agency-simulator/frontend/constants/portfolioWeb.ts`). 실제 납품작으로 바꾸는 것이 가장 큰 가치입니다.
- 등급 대응도 맞습니다. Basic(원페이지)은 Botanic, Floria_Neo, Lucury에, Pro(다중 서브페이지)는 Floria_NEO_02에 대응합니다(`geoMeta.ts:133-134`).
- 주의할 점이 있습니다. WebSite의 "Floria"(꽃 스튜디오)는 FLORA 출판 SaaS 그룹(flora, Flora-v2)과 이름만 같고 무관합니다(`flora.md:5`). 그쪽 그룹에 합치면 안 됩니다.
- Biz_Website는 소스가 없으므로(`WebSite.md:186`) 복원 전에는 포트폴리오에서 제외합니다.

### 2. 기능 매트릭스

통합 후 라우트 구성은 다음과 같습니다.
- `/` 랜딩
- `/portfolio`
- `/pricing`
- `/simulator`
- `/templates` 템플릿 갤러리
- `/contact` 견적 문의
- `/i/:slug` 하객 페이지
- `/studio` 운영자 편집기

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 히어로 캐러셀(Imagen 3장 생성) | wedding(동작, 방문마다 AI 생성) | 디벨롭: 업로드한 실제 커플 사진 캐러셀로 바꾸고, AI 보정은 운영자가 1회 생성해 저장 | `/i/:slug` 히어로 블록, Storage URL | premium-wedding-invitation.md:29,59,77,94 |
| Ken Burns, 패럴랙스, confetti, 크로스페이드 모션 | wedding(동작) | 유지 | 템플릿 공통 모션 | premium-wedding-invitation/CLAUDE.md:72-84 |
| 인사말, 혼주 소개 | wedding(동작, 정적) | 통합 | 섹션 블록, invitation JSON 데이터 기반 | premium-wedding-invitation.md:30,100 |
| 예식 달력 | wedding(동작) | 유지 | 공통 블록(돌잔치·행사 재사용) | premium-wedding-invitation.md:30 |
| 갤러리 모자이크 | wedding(동작, picsum) | 디벨롭: 업로드, 라이트박스, lazy 로딩 | 갤러리 블록 | premium-wedding-invitation.md:105 |
| AI 생성 지도 이미지 | wedding(동작하나 가짜 지도) | 폐기: 하객 길안내를 오도함 | 카카오/네이버 정적 지도 또는 임베드 | premium-wedding-invitation.md:60,79 |
| 지도 앱 딥링크, 대중교통 안내 | wedding(동작) | 유지 | 오시는 길 블록 | premium-wedding-invitation.md:31; CLAUDE.md:95-98 |
| 연락처 tel/sms, 계좌 복사 | wedding(동작) | 유지 | 공통 블록(부고장 조의금에도 재사용) | premium-wedding-invitation.md:32 |
| 화환 보내기 링크 | wedding(동작) | 유지(옵션) | 블록 옵션 | premium-wedding-invitation/CLAUDE.md:104 |
| 방명록 | wedding(부분, localStorage만) | 디벨롭: Supabase, RLS, 입력 검증, 관리자만 삭제 | 템플릿 공통 방명록 | premium-wedding-invitation.md:33,65,98-99 |
| AI 축하말 생성(Gemini) | wedding(부분, 개발용 프록시 경유) | 디벨롭: 전용 서버리스 엔드포인트(고정 모델, 길이 제한, rate limit) | 방명록 보조 기능 | premium-wedding-invitation.md:61,81,95 |
| 배경음악 토글 | wedding(동작, 샘플 MP3) | 유지(자체 호스팅) | 템플릿 옵션 | premium-wedding-invitation.md:105 |
| 링크 복사, Web Share | wedding(동작) | 유지 | 공통 공유 바 | premium-wedding-invitation/CLAUDE.md:77 |
| 카카오 공유 | wedding(미동작, 키·SRI 오류) | 디벨롭: 환경변수 키, 공식 SRI | 공통 공유 바 | premium-wedding-invitation.md:34,68,96 |
| OG 메타 | wedding(하드코딩) | 디벨롭: slug별 동적 생성 | `/i/:slug` 메타 | premium-wedding-invitation.md:71,88 |
| 예식 데이터 constants 하드코딩 | wedding(동작, 1커플) | 디벨롭: invitation 스키마와 DB 레코드로 | 템플릿 데이터 모델 | premium-wedding-invitation.md:71,100 |
| 범용 Vertex 프록시, 인터셉터, WS 프록시 | wedding, nexus, webcraft(공통 잔재) | 폐기: 오픈 프록시 위험. nexus·webcraft는 호출 0건 | 없음 | premium-wedding-invitation.md:61-64; nexus-micro-web-builder.md:62; webcraft-agency-simulator.md:66 |
| 12개 마이크로웹 비즈니스 모델 데이터 | nexus(동작, 정적) | 통합 | 템플릿 출시 로드맵과 `/templates` 카탈로그 원천(가격대 포함) | nexus-micro-web-builder.md:29,108; nexus-micro-web-builder/CLAUDE.md:120-135 |
| 모델별 수익/디자인/영업 벤토 카드 | nexus(동작) | 통합(내부용): 고객 비노출, docs 기획 자료로 | docs/기획 문서 | nexus-micro-web-builder.md:30,120 |
| 시장 분석 산점도 | nexus(동작, 임의 스코어) | 폐기: 근거 없는 수치 | 없음 | nexus-micro-web-builder.md:31 |
| 12종 모바일 목업 | nexus(동작, switch 하드코딩) | 디벨롭: 선언형 데이터로 바꿔 미출시 템플릿 "준비 중" 시안으로 | `/templates` 미리보기 | nexus-micro-web-builder.md:32,69,85 |
| 기획서 다운로드 | nexus(미구현) | 폐기: 내부 docs 이전으로 대체 | 없음 | nexus-micro-web-builder.md:33,101,120 |
| Landing/Login/Dashboard(Nexus Platform 고아 템플릿) | nexus(컴파일 불가 잔재) | 폐기 | 없음 | nexus-micro-web-builder.md:63-64,81 |
| 랜딩 히어로, 프로모 배너 | webcraft(동작) | 통합 | 스튜디오 `/` | webcraft-agency-simulator.md:29; frontend/pages/Home.tsx |
| 웹 포트폴리오 필터 | webcraft(동작, picsum 가짜 9건) | 디벨롭: WebSite 실제 납품작으로 교체 | `/portfolio` | webcraft/frontend/constants/portfolioWeb.ts; WebSite.md:176 |
| 상세페이지 디자인 포트폴리오 | webcraft(동작) | 유지 | `/portfolio` 탭 | webcraft/frontend/constants/portfolioDesign.ts |
| 4등급 가격표(Basic/Pro/Premium/Custom) | webcraft(동작) | 통합: 마이크로웹 단가(nexus priceRange)와 한 가격표로 | `/pricing` | webcraft/frontend/constants/geoMeta.ts:133-136; nexus-micro-web-builder/CLAUDE.md:122-135 |
| 업종 9 × 등급 4 시뮬레이터(톤, 팔레트, UI 프레임워크, 데스크톱/태블릿/모바일) | webcraft(동작) | 유지(선택값을 견적 문의로 전달) | `/simulator` | webcraft-agency-simulator.md:30,119; pages/Simulator.tsx:24 |
| 업종별 GEO 제안 카드 | webcraft(동작, 정적 카피) | 유지 | 시뮬레이터 내 | geoMeta.ts:12-124 |
| 업종별 CRM 미리보기(지표, 표) | webcraft(목업) | 디벨롭: 병원·교육은 Group F 실제 모듈 데모로 연결 | 시뮬레이터 Custom 등급 | geoMeta.ts:14,71,113 |
| 소셜 로그인 + 권한 직접 선택 | webcraft(목업) | 폐기: 실제 인증은 platform-core가 맡음 | 없음 | webcraft-agency-simulator.md:31,75 |
| 관리자 대시보드 모듈 구매/ON-OFF(CRM 모듈 6종) | webcraft(목업) | 폐기(UI). 모듈 목록은 Custom 등급 옵션 항목으로만 흡수 | `/pricing` 옵션 | webcraft-agency-simulator.md:32; geoMeta.ts:140-145 |
| 설정 잠금 비밀번호 1234, GitHub/Supabase 연동 안내 탭 | webcraft(목업) | 폐기 | 없음 | webcraft-agency-simulator.md:75; pages/AdminDashboard.tsx:37 |
| 코어 대시보드(월별 매출, 유입 채널) | webcraft(목업) | 폐기 | 없음 | pages/AdminDashboard.tsx:328-400 |
| 견적 상담 문의 | webcraft(미구현, 버튼만) | 디벨롭: 업종/등급/템플릿 선택값을 담은 문의 폼과 리드 저장 | `/contact` | webcraft-agency-simulator.md:33,77,113 |
| 중복 constants.ts, 고아 컴포넌트 7개, 중첩 repo | webcraft(잔재) | 폐기 | 없음 | webcraft-agency-simulator.md:73,76,89 |
| WebSite 5개 사이트 | WebSite(40~65%) | 유지(별도 저장소). 포트폴리오에는 링크로만 등록 | `/portfolio` 엔트리 | WebSite.md:41,56,72,89 |
| 다중 고객 `/i/:slug` 라우팅과 invitations 테이블 | 없음(리뷰 기획만) | 신규 | 상품화 전제 | premium-wedding-invitation.md:85,103 |
| 운영자 편집 화면(정보 입력, 사진 업로드) | 없음(리뷰 기획만) | 신규 | `/studio` | premium-wedding-invitation.md:104 |
| 섹션 블록 조합형 템플릿(청첩장, 돌잔치, 부고장) | 없음 | 신규 | 블록 레지스트리 | premium-wedding-invitation.md:122 |
| 공개 배포 경로(정적 호스팅 + 서버리스) | 없음 | 신규 | 배포 문서와 CI | premium-wedding-invitation.md:88 |
| 공용 폼 백엔드(문의, 뉴스레터; 허니팟, rate limit) | 없음 | 신규(WebSite와 공유) | 서버리스 1개 | WebSite.md:266,283 |

### 3. 버려지는 것

- **Vertex 범용 프록시, 인터셉터, WS 프록시(3개 공통):** nexus와 webcraft에서는 호출이 0건입니다. wedding에서는 공개하는 순간 오픈 프록시가 됩니다. webcraft는 `.env.local`까지 push되어 있습니다(`webcraft-agency-simulator.md:65`).
- **AI 지도 이미지:** 실제 위치와 다를 수 있어 하객을 잘못 안내합니다.
- **방문할 때마다 실행되는 Imagen 생성:** 하객 수에 비례해 비용이 늘고, 첫 화면이 몇 초간 회색으로 비어 있습니다(`premium-wedding-invitation.md:59`).
- **nexus 앱 본체(산점도, 기획서 다운로드, 고아 대시보드):** 근거 없는 스코어이고, 일부는 컴파일조차 안 되는 잔재입니다.
- **webcraft 모킹 로그인, 관리자 대시보드, 설정 잠금:** 실제 기능이 없어 외부에 공개하면 오해를 삽니다. 실제 운영자 화면은 `/studio`가 대체합니다.
- **중복 상수, 고아 파일, 중첩 repo, Tailwind CDN, `latest` 의존성:** 저장소 위생 문제입니다.

### 4. 새로 채워야 할 기획 공백

1. **invitation 데이터 스키마와 블록 구성 규칙:** 어떤 블록이 어느 템플릿에 들어가는지, 블록별로 어떤 필드가 필요한지 정해야 합니다.
2. **판매/주문 흐름:** 지금은 가격대만 있고 구매·결제·게시 절차가 없습니다(nexus CLAUDE.md:122-135, webcraft 결제는 모킹).
3. **운영자 편집 화면 범위와 사진 업로드 규격**
4. **견적 문의로 들어온 리드의 처리 흐름:** 저장 위치, 알림 방법을 정해야 합니다.
5. **템플릿 출시 순서:** 12개 모델 중 무엇을 언제 낼지 정해야 합니다.
6. **(리뷰에 없는 추가 제안) 공개 페이지의 개인정보 노출 정책:** 하객 페이지가 계좌번호와 전화번호를 공개합니다. 그래서 게시 기간, 만료 후 비공개 전환, 검색 노출 차단 규칙이 필요해 보입니다. 리뷰가 다루지 않은 항목이므로 확인이 필요합니다.

### 5. 사용자 결정 필요

| 갈림길 | 선택지 | 권고 |
|---|---|---|
| 기술 기반 | A) Vite SPA 유지 + 서버리스 / B) platform-core(Next.js 16 + Supabase)로 이전 | **B.** slug별 OG 메타(카카오 공유 미리보기), 인증이 필요한 `/studio`, Supabase RLS가 모두 필요하기 때문입니다. 이 판단은 제 추론입니다. |
| 판매 방식 | A) 셀프서비스(고객이 직접 편집하고 결제) / B) 대행(문의를 받아 운영자가 제작) / C) B로 시작해 A로 확장 | **C.** 결제와 셀프 편집기는 처음부터 새로 만들어야 하는 큰 범위입니다. |
| 첫 출시 템플릿 | A) 청첩장만 / B) 청첩장 + 돌잔치 + 부고장 | **A로 출시한 뒤 B.** 블록 재사용이 검증된 다음에 늘립니다. |
| AI 기능 범위 | A) 전부 제거 / B) 축하말 전용 엔드포인트만 / C) B + 히어로 AI 보정 1회 | **B.** C는 2단계로 미룹니다. |
| nexus 처리 | A) models.ts를 docs와 `/templates` 데이터로 흡수하고 앱은 아카이브 / B) 내부 기획 페이지로 유지 | **A** |
| WebSite 관계 | A) 코드를 통합 / B) 별도 저장소로 두고 포트폴리오 링크만 | **B** |

---

## GROUP F. admin-suite (공통 코어 + 도메인 모듈)

### 1. 통합 제품 정체성과 베이스

admin-suite는 "Supabase 기반 역할별 내부 관리 시스템을 빠르게 찍어내는 공통 코어"입니다. 그 위에 세 도메인 앱을 올립니다.
- ERP(재고, 판매, 인사)
- 병원(예약, 대기열, 환자, 검사)
- 학교(학급, 과목, 출석)

**정직한 결론: 하나의 앱으로 합치는 것은 권하지 않습니다.** 대신 "공유 코어 패키지 + 앱 3개"(모노레포 또는 템플릿)를 권합니다.

이유는 다음과 같습니다.
- 세 도메인은 사용자, 데이터, 규제 수준이 서로 겹치지 않습니다.
- 병원은 의료정보라서 다른 도메인과 같은 DB나 같은 배포에 섞는 것 자체가 위험을 키웁니다(`Hospital.md:81`).
- 반면 보일러플레이트는 거의 똑같이 반복되고, 같은 버그까지 공유합니다.
  - 반복되는 것: Supabase SSR 클라이언트, 가드, profiles(role, status), 사이드바/헤더, 테이블+모달 CRUD
  - 공통 버그: RLS 자기참조 재귀, KST 날짜, 가드 누락(`ERP-Wesite.md:100`, `School_Management_System.md:87`)

**코어 베이스는 basic-master-module입니다.** 이 모듈을 platform-core 템플릿으로 승격합니다(`basic-master-module.md:90`). 코어 패턴의 참조 원본과 첫 적용 앱은 다음과 같습니다.
- **참조 원본:** 셋 중 가장 앞선 Hospital의 `src/proxy.ts`와 `lib/permissions.ts`(`basic-master-module.md:74`).
- **첫 적용 앱:** 가장 작고 역할 구조가 단순한 ERP(`ERP-Wesite.md:100`).

### 2-a. 공통 코어 기능 매트릭스

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| Supabase SSR 클라이언트(server/browser) | ERP(동작, ssr 0.6), Hospital(동작, Database 제네릭), School(동작) | 통합 | core `lib/supabase/{client,server,admin}` (ssr 0.12) | basic-master-module.md:36-47,99 |
| 세션 갱신 + 보호 경로 가드 | Hospital(동작, 역할 미검사, 프로필 없으면 admin 처리), ERP(부분, /dashboard만), School(미동작, 루트 위치라 로드 안 됨) | 통합 + 디벨롭: 역할 기반 경로 차단 | core `src/proxy.ts` | Hospital.md:56; ERP-Wesite.md:67; School_Management_System.md:48 |
| 이메일 로그인 | ERP(부분, 가입 시 이름 누락), Hospital(동작, 역할 선택 UI), School(동작) | 통합 | core `(auth)/login` | ERP-Wesite.md:28; Hospital.md:19 |
| Google OAuth + 콜백 | ERP(동작, 콜백에서 프로필 생성), School(동작), Hospital(콜백만, UI 없음) | 통합 | core 콜백 라우트 | ERP-Wesite.md:49; Hospital.md:38 |
| 가입 시 프로필 자동 생성(handle_new_user) | 3개 모두 없음(School은 무한 리다이렉트 루프 유발) | 신규 | core 트리거 템플릿 | ERP-Wesite.md:69,120; School_Management_System.md:52,99; Hospital.md:113 |
| 가입 승인(Pending → Active) | ERP(기획만, status 컬럼만 있음) | 디벨롭: 코어 옵션 기능 | `/pending` 안내 + 승인 화면 | ERP-Wesite.md:29,122; ERP-Wesite/PRD.md:39 |
| 사용자 초대 | School(미구현, F-CLASS-02), ERP("직원 등록" 무동작) | 신규 | core 초대(Auth Admin API) | School_Management_System.md:104; ERP-Wesite.md:80 |
| 역할 → 페이지 권한 매트릭스 | Hospital(동작, 클라이언트 판정), ERP(읽기 전용 표시 + 기획), School(미들웨어 로직, 미로드) | 통합: 모듈이 역할과 페이지를 선언하는 팩토리, 서버에서 강제 | core `permissions` 팩토리 | Hospital/src/lib/permissions.ts:5-10; ERP-Wesite/components/settings/SettingsClient.tsx:17; ERP-Wesite.md:99 |
| 클라이언트 PageGuard | Hospital(동작, RSC 데이터 노출) | 폐기: 서버 가드로 대체 | 없음 | Hospital.md:54,79 |
| 비밀번호 임시 접근(OVERRIDE 1234) | Hospital(동작) | 폐기: 공유 4자리로 모든 역할 우회 | 없음 | Hospital.md:55,81 |
| 서버 액션 requireRole | ERP(1곳), 나머지 없음 | 신규 | core 헬퍼 | ERP-Wesite.md:70,122; School_Management_System.md:101 |
| RLS 역할 판정 SECURITY DEFINER 함수 | ERP(재귀 + 권한 상승), School(재귀 패턴), Hospital(RLS 없음) | 신규 | core `auth_role()`, `auth_is_active()` + 정책 템플릿 | ERP-Wesite.md:65-66; School_Management_System.md:49; Hospital.md:57 |
| 마이그레이션 구조(schema/rls/triggers/seed) | ERP(1개, 결함), Hospital·School(없음, CLAUDE.md에만) | 통합 | core 표준 + 모듈별 마이그레이션 | ERP-Wesite.md:111; Hospital.md:105; School_Management_System.md:90 |
| Realtime publication 설정 | ERP(누락), School(명시 필요) | 신규(표준화) | 마이그레이션 템플릿 | ERP-Wesite.md:77 |
| 실시간 구독 훅 | Hospital(동작, 이중 구독, 전체 재조회), School(동작, 피드), ERP(부분, reload) | 통합: 단일 채널, payload 기반 부분 갱신 | core `useRealtimeTable` | Hospital.md:61,70; School_Management_System.md:59; ERP-Wesite.md:76 |
| 실시간 활동 피드 | School(동작), ERP(부분, 최근 재고 변동) | 통합 | core ActivityFeed | School_Management_System.md:35; ERP-Wesite.md:33 |
| 활동/감사 로그 | ERP(부분, 설정 > 시스템 로그가 입출고와 판매를 합쳐 조회), Hospital(감사 로그 없음) | 디벨롭: 트리거 기반 audit_logs | core 감사 로그 화면 | ERP-Wesite/app/actions/logs.ts; SettingsClient.tsx:15; Hospital.md:55 |
| 상태 전이 / 승인 검증 유틸 | Hospital(예약 상태, 검사 pending→approved 미검증), ERP(판매 상태 목업) | 신규: 범용 상태 머신 헬퍼. 전자결재 엔진은 근거가 없어 넣지 않음 | core `transition()` | Hospital.md:62,68,115; ERP-Wesite.md:71 |
| AppShell(사이드바 + 헤더) | 3개 모두(각자 구현) | 통합 | core AppShell(nav는 props로) | ERP-Wesite.md:100 |
| 역할별 메뉴 필터 | Hospital(부분, 자물쇠로 노출), ERP·School(미구현) | 통합 | 권한 매트릭스로 필터링 | Hospital.md:73; ERP-Wesite.md:30 |
| 반응형 햄버거 메뉴 | 3개 모두 미구현(ERP·School PRD는 요구) | 신규 | AppShell 내장 | ERP-Wesite.md:84; School_Management_System.md:61 |
| KPI 카드 | ERP(동작), School(동작), Hospital(부분, 변동률 하드코딩) | 통합(컴포넌트), 집계는 모듈 RPC | core KpiCard | Hospital.md:64 |
| 차트 컴포넌트 | Hospital(recharts, 목업 데이터), School(학급별 막대, 동작), ERP(미구현) | 통합 | core 차트 래퍼 | Hospital.md:64; School_Management_System.md:20 |
| KST 날짜 범위 유틸 | 3개 모두 UTC 버그 | 신규 | core `kstDayRange()` | ERP-Wesite.md:75; Hospital.md:58; School_Management_System.md:54 |
| DataTable, FormModal, ConfirmDialog | 3개 모두 raw 반복(Hospital은 shadcn을 설치만 하고 미사용) | 통합 | core UI | ERP-Wesite.md:100,107; Hospital.md:71 |
| Toast | ERP(sonner), School(Toast), ERP 지침상 alert 금지 | 통합 | core Toast | ERP-Wesite/CLAUDE.md 5절 |
| 로그아웃 | School(작업 트리에 없음) 외 각자 | 통합 | AppShell 하단 | School_Management_System.md:53 |
| 설정 화면 | ERP(목업: 저장 안 됨, 실제 Supabase URL 노출), School HEAD(계정 정보, OAuth 안내) | 폐기(현재 내용). 코어는 계정 정보만 | core `/settings/account` | ERP-Wesite.md:72-73 |
| 헤더 검색, 알림 벨 | ERP(장식) | 폐기 | 없음 | ERP-Wesite.md:80 |
| Storage 이미지 업로드 | ERP(기획만) | 신규(코어 옵션) | core 업로드 헬퍼 | ERP-Wesite/PRD.md:25; ERP-Wesite.md:40 |
| DB 타입 생성(supabase gen types) | 3개 모두 미적용(Hospital `as any` 20건) | 신규 | core `db:types` 스크립트 | Hospital.md:67; ERP-Wesite.md:106 |
| 앱별 디자인 토큰 | ERP(Blue/Orange), Hospital(Dark/Medical Red), School(Indigo/Cyan) | 유지(앱별 토큰 세트) | core 컴포넌트 + 앱 테마 | ERP-Wesite.md:139; Hospital.md:132 |

### 2-b. 도메인 모듈 기능 매트릭스

| 기능 | 보유 프로젝트(구현상태) | 처리 | 통합 후 모습 | 근거 |
|---|---|---|---|---|
| 상품 CRUD(SKU, 카테고리, 단가, 안전재고) | ERP(동작) | 유지 | apps/erp 재고 | ERP-Wesite.md:35 |
| 입출고/조정 이력 | ERP(부분: 비원자 처리, 감소 조정 불가) | 디벨롭: `record_inventory_move` RPC | apps/erp | ERP-Wesite.md:36,68,78,121 |
| 재고 부족 판별, 위험 재고 테이블 | ERP(부분, 필터 없음) | 디벨롭: `is_low_stock` 생성 컬럼 | apps/erp 대시보드 | ERP-Wesite.md:34,79 |
| 판매 등록 | ERP(동작하나 비원자, Sales Manager는 권한이 없어 실패) | 디벨롭: `record_sale` RPC | apps/erp | ERP-Wesite.md:68,91 |
| 판매 상태와 취소 | ERP(목업) | 디벨롭: status 컬럼, 재고 복원 RPC | apps/erp | ERP-Wesite.md:71,127 |
| 판매 추이 차트 | ERP(미구현) | 디벨롭 | apps/erp 대시보드 | ERP-Wesite.md:32,128 |
| 부서 CRUD | ERP(조회만) | 디벨롭 | apps/erp 인사 | ERP-Wesite.md:37,129 |
| 임직원 전화, 직급 | ERP(미구현) | 디벨롭 | apps/erp 인사 | ERP-Wesite.md:38 |
| 권한 변경 모달 | ERP(동작) | 통합(코어 사용자 관리로 승격) | core 사용자 관리 | ERP-Wesite.md:39 |
| 중복 라우트 `/inventory` 등 | ERP(동작, 가드 밖) | 폐기 | 없음 | ERP-Wesite.md:74 |
| 환자 목록, 검색 | Hospital(목록 동작, 검색 없음) | 유지 + 디벨롭 | apps/hospital | Hospital.md:66,118 |
| 신규 환자 등록 | Hospital(버튼만) | 디벨롭 | apps/hospital | Hospital.md:66 |
| 환자 360(기본정보, CRM 태그, 알레르기 경고, 타임라인) | Hospital(부분: 성별 하드코딩, 타임라인은 idx%4) | 디벨롭: 검사 결과(lab_results) 병합 | apps/hospital | Hospital.md:65,94,121 |
| 예약 캘린더 월/주/일 + 의사 필터 | Hospital(조회 전용, 주말 누락, visit_type 없음) | 디벨롭: 빈 슬롯 클릭으로 예약 생성, 범위 조회 | apps/hospital | Hospital.md:63,69,75,119 |
| 실시간 대기열 + 상태 변경 | Hospital(동작, 전이 검증 없음) | 디벨롭: 코어 상태 전이와 서버 액션 | apps/hospital | Hospital.md:23,62 |
| 의료진 가용 토글 | Hospital(동작, 브라우저에서 직접 update) | 유지(서버 액션으로 이전) | apps/hospital | Hospital.md:57 |
| 검사 수치 입력 + 정상범위 경고 | Hospital(동작, 저장 후 화면 stale) | 유지 + 디벨롭 | apps/hospital | Hospital.md:24,68 |
| 검사 승인 단계, 신규 검사 의뢰 | Hospital(미구현) | 디벨롭 | apps/hospital | Hospital.md:68,122 |
| 진료 기록/처방(EMR) | Hospital(기획만, 버튼만) | 디벨롭 | apps/hospital | Hospital/PRD.md:17; Hospital.md:66 |
| 수납/매출 | Hospital(기획만, 대시보드 매출 하드코딩) | 디벨롭(스키마 확장) | apps/hospital | Hospital/PRD.md:19; Hospital.md:120 |
| 병원 관리자 대시보드(환자 수, 금일 예약, 노쇼) | Hospital(부분, 취소와 노쇼 혼동) | 디벨롭 | apps/hospital | Hospital.md:62,64 |
| 학급 CRUD | School(HEAD 동작, 작업 트리에서 삭제됨) | 유지(복원) | apps/school | School_Management_System.md:39,67 |
| 과목 CRUD + 학급 매핑 | School(HEAD 동작, 삭제됨) | 유지(복원) | apps/school | School_Management_System.md:39 |
| 학생 역할/학급 배정 | School(HEAD 동작, 학생 관리 드롭다운) | 통합(코어 사용자 관리 + class_id 확장 필드) | core + apps/school | School HEAD `src/app/admin/students/page.tsx` |
| 출석 체크 보드(upsert + Realtime) | School(HEAD 동작, 삭제됨) | 유지(복원) | apps/school | School_Management_System.md:67 |
| 관리자 출석 통계, 학급별 출석률 | School(동작, 분모 불일치) | 디벨롭 | apps/school | School_Management_System.md:55,102 |
| 학생 대시보드 | School(HEAD 동작, 삭제됨) | 유지(복원) | apps/school | School_Management_System.md:58 |
| 학생 실시간 알림 | School(컴포넌트만, 미사용) | 디벨롭(학생 대시보드에 연결) | apps/school | School_Management_System.md:22 |
| 출석 추이 그래프 | School(미구현) | 디벨롭 | apps/school | School_Management_System.md:108 |
| 이모지 아이콘 | School(동작) | 폐기: lucide로 교체 | 없음 | School_Management_System.md:62 |

### 2-c. 단일 앱 통합 vs 공유 코어 + 앱 3개

**단일 앱 통합**
- 장점
  - 인증, 배포, 도메인이 하나라 운영 대상이 하나입니다.
  - "모듈 ON/OFF로 파는 관리 솔루션"이라는 영업 그림과 맞습니다. webcraft의 Custom 등급 CRM 모듈 개념과 같은 그림입니다.
  - 코어 변경이 즉시 전체에 반영됩니다.
- 단점
  - 병원 의료정보가 ERP·학교 데이터와 같은 DB와 같은 배포 단위에 놓입니다. 사고가 나면 피해 범위가 커집니다.
  - 사용자 집단이 서로 겹치지 않아 통합 로그인의 실익이 없습니다.
  - 테마 3종, 역할 체계 3종(4/4/2개)을 한 앱에서 분기해야 해 복잡도가 오히려 늘어납니다.
  - 지금 세 앱 모두 접근제어가 실질적으로 깨져 있습니다. 그런 상태에서 합치면 리스크를 더하는 꼴입니다.

**공유 코어 + 앱 3개(모노레포 `packages/admin-kit` + `apps/erp|hospital|school`)**
- 장점
  - 보일러플레이트를 한 번만 올바르게 작성할 수 있습니다. 대상은 RLS 함수, proxy, requireRole, KST 유틸 같은 보안 코드입니다.
  - 데이터와 배포가 앱별로 격리됩니다.
  - 앱별 PRD를 그대로 유지할 수 있습니다.
- 단점
  - 코어 버전 관리 비용이 생깁니다.
  - 템플릿 복제 방식을 고르면 시간이 지나며 다시 갈라집니다. 지금 `@supabase/ssr`가 0.6~0.12로 흩어진 것이 그 사례입니다(`basic-master-module.md:46`).

**권고: 모노레포 공유 코어.** 템플릿 복제보다 패키지 공유가 편차 재발을 막습니다.

### 3. 버려지는 것

- **Hospital 비밀번호 우회(OVERRIDE_PASSWORD)와 verify-admin API, 클라이언트 PageGuard:** 보안상 존재하면 안 되는 구조입니다.
- **ERP 중복 라우트 4개, 미사용 조회 액션, 설정 화면 목업:** 설정 화면은 저장되지 않고 실제 URL을 노출합니다.
- **ERP 헤더 검색과 알림 벨:** 무동작 UI입니다.
- **Hospital의 미사용 shadcn, zustand, `as any` 20건:** shadcn은 코어 UI로 대체합니다.
- **School 루트 `middleware.ts`와 이모지 아이콘:** 위치 때문에 로드되지 않는 코드입니다.
- **각 앱의 자체 Supabase 클라이언트, 가드, 날짜 코드:** 코어로 흡수합니다.
- **ERP의 `ERP_Website` gitlink, Hospital/School의 nested git 이중 추적:** 모노레포로 정리합니다.

### 4. 새로 채워야 할 기획 공백

1. **코어 경계 문서:** 무엇이 코어(인증, 권한, 감사, 레이아웃, 실시간, 날짜)이고 무엇이 모듈인지 명시해야 합니다.
2. **공통 사용자 수명주기:** 가입, 승인/초대, 정지, 역할 변경, 로그아웃을 앱별 옵션으로 정의해야 합니다. 지금 ERP는 승인제, School은 초대제로 서로 다릅니다.
3. **감사 로그 범위와 보존 기간:** 의료 데이터 조회까지 기록할지 정해야 합니다.
4. **상태 전이표:** 예약, 검사, 판매 각각의 허용 전이와 그 전이를 누가 할 수 있는지 정해야 합니다.
5. **대시보드 지표 정의:** 출석률 분모, 노쇼와 취소 구분, 금일 매출 기준(KST)을 정해야 합니다.
6. **School 작업 트리 삭제가 의도인지 실수인지 확인**(`School_Management_System.md:67`)

### 5. 사용자 결정 필요

| 갈림길 | 선택지 | 권고 |
|---|---|---|
| 통합 형태 | A) 단일 앱 + 모듈 토글 / B) 모노레포 공유 코어 + 앱 3개 / C) basic-master 템플릿 복제 + 앱 3개 | **B** |
| DB 분리 | A) Supabase 프로젝트 1개 / B) 앱별 분리 | **B.** 의료정보를 격리하기 위해서입니다. |
| 권한 모델 | A) 앱별 고정 role enum + 코어 정적 매트릭스 / B) roles/permissions 테이블 기반 동적 RBAC | **A.** 역할이 2~4개뿐이라 B는 과합니다. |
| 가입 정책 | A) 승인제 / B) 초대제 / C) 코어가 둘 다 옵션으로 제공 | **C** |
| School 처리 | A) HEAD를 복원하고 개선분 재적용 / B) 현재 작업 트리 기준으로 재구현 | **A.** 복원 비용이 낮습니다. |
| 디자인 | A) 앱별 테마 유지 / B) 단일 테마로 통일 | **A.** 컴포넌트는 공통으로 쓰고 토큰만 앱별로 둡니다. |

---

## 단독 프로젝트

### Slido_Project (기획만, 코드 없음)

| 기능 | 처리 | 근거 |
|---|---|---|
| 방 생성/삭제, 대기·시작·종료 제어 | 유지 | Slido_Project/PRD.md 4.1 |
| 익명/닉네임 입장, 새로고침 없는 화면 전환 | 유지 | PRD.md 4.2 |
| 실시간 결과 차트 | 디벨롭: 300ms 단위로 묶은 집계 스냅샷 브로드캐스트 | Slido_Project.md:39,65 |
| 1인 1표(IP + LocalStorage) | 디벨롭: 익명 auth 기반 unique 제약. IP는 차단이 아니라 레이트리밋 신호로만 사용 | Slido_Project.md:41,55 |
| OBS 전체화면/크로마키 모드 | 디벨롭: 투명/그린 배경을 파라미터로 선택 | Slido_Project.md:46,67 |
| 스택 후보 Socket.io, FastAPI | 폐기: Supabase Realtime으로 확정 | Slido_Project.md:40 |
| Redis 집계 | 폐기(2단계 보류) | Slido_Project.md:45 |
| 방 페이지 GEO | 폐기(noindex, 랜딩에만 적용) | Slido_Project.md:49 |
| 방 코드 + QR, 재연결 시 스냅샷 복구, 레이트리밋/모더레이션, 결과 보존 + CSV, 데이터 모델 | 신규 | Slido_Project.md:44,47-48,63,84 |

- **기획 공백 Top 3**
  1. 동시 접속 수와 지연 목표를 수치로 정하기
  2. 실시간 스택 확정(Vercel 전제와 충돌)
  3. 중복 투표 정책과 IP 해시 개인정보 처리
- **추가 확인:** 제품명 "Slido"는 상용 서비스 상표입니다(`:50`).
- **그룹 연결:** 약합니다. platform-core 위에 올리면 됩니다. nexus 모델 5(행사/세미나 안내장)나 8(롤링페이퍼)에 실시간 투표 블록으로 붙일 여지는 있지만, 리뷰에 근거가 없는 제 추론이라 단독 유지를 권합니다.

### Stock_Trader_nomad (기획만)

| 기능 | 처리 | 근거 |
|---|---|---|
| 다크 금융 대시보드 UI, 종목 상세 모달(재무지표) | 유지 | Stock_Trader_nomad.md:31,123 |
| 멀티 증권사 통합 조회 | 디벨롭: 증권사 1곳, 모의 계좌, BrokerAdapter | Stock_Trader_nomad.md:70,101 |
| 실시간 시세(SSE), 블링크 | 디벨롭: 상주 워커 중계 + zustand 종목별 셀렉터 | Stock_Trader_nomad.md:44,48,71 |
| 멀티 AI 어드바이저(3사 × 4전략, 매수/목표/손절가) | 디벨롭: AI 1개로 포트폴리오 "진단"만 제공. 3사 비교는 2단계 | Stock_Trader_nomad.md:41,101 |
| AI 추천 리더보드 | 디벨롭: 내부 공개용, 계산 규칙 고정 | Stock_Trader_nomad.md:46,73 |
| 매매 일지 자동 동기화 | 유지(조회 전용) | Stock_Trader_nomad.md:124 |
| 스크래핑 | 폐기(영구) | Stock_Trader_nomad.md:39,102 |
| 공개 GEO, JSON-LD 금융 스키마 | 폐기(법률 검토 전 보류) | Stock_Trader_nomad.md:55,73 |
| 모델명 하드코딩, Context로 시세 관리 | 폐기 | Stock_Trader_nomad.md:48,54 |
| 키 암호화 보관, 6개 테이블 데이터 모델, 장 시간·휴장일, 주문 안전장치(주문 기능을 넣을 때만) | 신규 | Stock_Trader_nomad.md:45,52,75-86 |

- **기획 공백 Top 3**
  1. 개인용인지 공개용인지 결정과 법적 검토(투자자문, 마이데이터)
  2. 증권사 API 검증과 실시간 중계 구조
  3. 키 보관, 주문 범위, 데이터 모델
- **그룹 연결:** 없습니다. 다만 Group F 코어의 KpiCard, 차트, AppShell은 가져다 쓸 수 있습니다(`:94`).

### Toon-Factory (기획만)

| 기능 | 처리 | 근거 |
|---|---|---|
| 모듈형 캔버스(드래그앤드롭, 레이어 순서) | 유지 + 디벨롭: Zustand 문서 모델을 원천으로, Fabric은 뷰로만 | Toon-Factory.md:52,76 |
| 에셋 라이브러리(15행동, 표정, 말풍선) | 유지(MVP는 수작업, 상업 라이선스 확인) | Toon-Factory.md:54,97 |
| `layers[]` 단일 구조 | 디벨롭: project → cuts → layers 판별 유니온 | Toon-Factory.md:47-48,67-68 |
| 숏폼 9:16 MP4 | 디벨롭: 서버 렌더 워커 | Toon-Factory.md:77,123 |
| FFmpeg.wasm 브라우저 렌더 | 폐기(미리보기 용도로 2단계 검토) | Toon-Factory.md:45,51 |
| LoRA 화풍 통일, 자동 누끼, B2B 마스코트 | 폐기(2차 범위) | Toon-Factory.md:49-50,57 |
| GEO | 폐기(공개 작품 페이지가 생기면 재검토) | Toon-Factory.md:53 |
| 인스타툰 PNG/ZIP 내보내기, 에셋 등급 + signed URL, 요금제 수치, Toss 구독, 서버 워터마크 | 신규 | Toon-Factory.md:46,56,77,121-124 |

- **기획 공백 Top 3**
  1. 컷/레이어 데이터 모델
  2. 과금 경계: 클라이언트 렌더와 서버 렌더를 어떻게 나눌지, 에셋 접근 제어
  3. 에셋 명세와 라이선스
- **그룹 연결:** E·F와는 없습니다. 숏폼 내보내기는 NOMAD Shorts Maker의 미디어 모듈과 자연스럽게 이어집니다. `ken-burns.ts`, `layer-composite.ts`, `watermark.ts`가 "컷 PNG 배열 → 9:16 MP4"와 거의 일치합니다(`Toon-Factory.md:87`). 그래서 숏폼 그룹과의 공유 렌더 워커 후보로 봅니다.

### study-note-organizer-codex-01 (완성도 약 85%)

| 기능 | 처리 | 근거 |
|---|---|---|
| 원문 입력, 2모델 병렬 → 통합 모델, 카드별 메타 정보, 복사/TXT, 키워드 파일명, 히스토리, 초안, 테마 | 유지 | study-note-organizer-codex-01.md:19-24 |
| 실행 중 재실행(경쟁 상태), retry 클로저 문제 | 디벨롭: runId + AbortController | study-note-organizer-codex-01.md:54,60,97 |
| 설정 패널 draft 동기화, UTC 날짜, 저장 용량 초과 처리 | 디벨롭 | study-note-organizer-codex-01.md:55-57 |
| PRD 미구현 UI(optgroup, 무료 모델 툴팁, 경고 배너, lg 레이아웃) | 디벨롭 | study-note-organizer-codex-01.md:63,105 |
| `VITE_OPENROUTER_API_KEY` 폴백, `README copy.md`, `useLocalStorage` | 폐기 | study-note-organizer-codex-01.md:52,61-62 |
| `.gitignore`, 테스트, 린트, 공개 배포 시 서버 프록시 | 신규 | study-note-organizer-codex-01.md:53,64,108 |

- **기획 공백 Top 3**
  1. 개인용인지 공개 배포인지에 따른 키 관리 정책. PRD 16장은 `.env.example`에 `VITE_OPENROUTER_API_KEY`를 요구해(`study-note-organizer-codex-01/PRD.md:345`) 리뷰의 보안 지적과 정면으로 충돌합니다.
  2. 히스토리 보존 용량과 보존 정책
  3. 모델 목록 갱신 방식과 비용 상한
- **그룹 연결:** 없습니다. "2모델 병렬 후 통합" 패턴은 다른 곳에서 재사용될 때 추출하면 됩니다(`:125`).

### basic-master-module (→ platform-core 템플릿)

| 기능 | 처리 | 근거 |
|---|---|---|
| Next 16, React 19, Tailwind 4, TS strict, ESLint flat, `@/*` 별칭 | 유지 | basic-master-module.md:16 |
| 버전 16.2.4, 루트 기준 경로, body 폰트 버그 | 디벨롭: 16.2.9, `src/` 구조, 폰트 수정 | basic-master-module.md:58-59,66 |
| Vercel 기본 랜딩, 기본 svg, "Create Next App" 메타데이터 | 폐기 | basic-master-module.md:63-64 |
| Supabase 클라이언트 3종, proxy.ts, 인증 흐름, env 검증, shadcn + AppShell, providers, 테스트, CI, 보안 헤더, AGENTS 규약 | 신규 | basic-master-module.md:99-109 |
| Group F 코어 자산: requireRole, permissions 팩토리, `auth_role()` RLS 템플릿, handle_new_user, kstDayRange, useRealtimeTable, audit_logs, DataTable/FormModal | 신규(F에서 승격) | ERP-Wesite.md:100 |

- **기획 공백 Top 3**
  1. 코어 범위 확정: 무엇을 넣고 무엇을 앱에 둘지
  2. 배포 방식: Template Repository 복제인지, 모노레포 패키지인지. 복제 방식은 편차가 재발합니다.
  3. 표준 디렉토리와 인증 규약. 커밋이 0개라 기준점부터 만들어야 합니다(`:57`).
- **그룹 연결:** Group F 공통 코어 그 자체입니다. Group E도 Next.js 이전을 택하면 이 코어 위에 올라갑니다. Slido·Stock·Toon도 출발점으로 씁니다.
