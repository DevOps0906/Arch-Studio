# LLM Wiki 설계 (제품 지식 위키 + 개발용 프로젝트 위키)

작성일 2026-10-13. 확정 결정 13의 일부다. LLM이 원본 자료를 읽고 서로 링크된 마크다운 위키로 정리하며, 새 자료가 오면 관련 페이지를 갱신하는 방식(Karpathy식 "LLM Wiki" 패턴)을 두 곳에 쓴다.

| 구분 | 목적 | 저장 | 실행 |
|---|---|---|---|
| 제품 지식 위키 | 제품 기능. 사용자 자료나 제품 지식을 위키로 정리해 채팅·그래프의 근거로 쓴다 | DB `core.wiki_pages`, `core.wiki_links`, `core.wiki_revisions` | FastAPI `apps/api/app/ai/wiki/` |
| 개발용 프로젝트 위키 | 개발 환경. 기획서·코드·결정을 에이전트가 정리해 다음 작업의 맥락으로 쓴다 | 각 개발 폴더 `docs/wiki/`(마크다운 파일, git 추적) | 스킬 `.claude/skills/llm-wiki/` |

RAG와의 차이: RAG는 질문마다 원본 조각을 찾는다. 위키는 원본을 미리 정리해 둔 "합성된 지식"이다. 답변은 둘을 함께 근거로 쓰고, 위키가 원본과 다르면 원본이 이긴다(위키 페이지에 출처 문서 id를 남긴다).

## 1. 공통 작업 4가지

| 작업 | 입력 | 동작 | 출력 |
|---|---|---|---|
| ingest(수집) | 새 원본 자료 | 자료를 요약한 source 페이지를 만들고, 관련된 기존 topic·entity·concept 페이지를 찾아 갱신하거나 새로 만든다. 페이지 간 링크를 갱신한다 | 갱신된 페이지, 수정 이력, log 1행 |
| compile(정리) | 위키 전체 또는 일부 | 흩어진 내용을 주제 페이지로 합치고, index 페이지(목차)를 다시 만든다 | index, 통합된 페이지 |
| query(질의) | 질문 | index → 관련 페이지 → 필요하면 RAG 원본 순서로 읽고 답한다. 답이 재사용할 가치가 있으면 새 페이지로 저장을 제안한다 | 출처 포함 답변 |
| lint(점검) | 위키 전체 | 모순, 낡은 내용(원본보다 오래됨), 고아 페이지(링크 없음), 깨진 링크, 출처 없는 주장을 찾는다 | 점검 보고, 수정 제안 |

## 2. 페이지 규칙

| 항목 | 규칙 |
|---|---|
| 종류 | `index`(목차), `topic`(주제), `entity`(인물·상품·종목 같은 대상), `concept`(용어·개념), `source`(원본 요약), `log`(변경 기록) |
| 이름 | slug는 소문자·숫자·하이픈, 하위 경로는 `/`(예: `concepts/ohaeng`). DB CHECK로 강제 |
| 본문 | 마크다운. 첫 줄 요약 1~2문장, 본문, "출처" 절(문서 id 또는 원본 경로), "관련" 절(위키 링크) |
| 링크 | `[[slug]]` 표기를 쓰고 저장 시 `core.wiki_links`로 정규화한다 |
| 편집 주체 | 에이전트 편집과 사람 편집을 구분한다(`last_editor`, `wiki_revisions.editor_kind`). 사람이 고친 문단은 에이전트가 덮어쓰지 않고 제안만 한다 |
| 블록 단위 소유 | 페이지 단위가 아니라 블록(문단, 목록, 표) 단위로 소유를 표시한다. 사용자가 고친 블록 앞에 마크다운 주석 `<!-- owner:user -->`를 붙여 저장한다(화면에 보이지 않는 마크다운 문법이며 UI HTML이 아니다). ingest·compile은 이 표시가 붙은 블록을 수정하지 않고, 바꿀 내용은 제안(별도 개정 초안)으로만 남긴다. 사용자가 블록을 에이전트에게 돌려주려면 표시를 지운다 |
| 동시 쓰기 | 쓰기 API(`/wiki/ingest`, 사용자 편집 저장)는 `expected_version`을 필수로 받는다(낙관적 잠금). 저장 시 현재 `version`과 다르면 충돌(409)로 거부하고 호출자가 최신본을 읽어 다시 병합한다 |
| 이력 | 모든 변경은 `core.wiki_revisions`에 남는다(수정·삭제 불가) |
| 개인정보 | 위키에는 개인 식별 정보를 정리해 넣지 않는다. 민감 원본(`contains_pii`)에서 만든 페이지는 `derived_from_pii=true`로 표시하고, 그 페이지의 ingest·compile·query·lint는 라우터가 오픈소스 모델로만 보낸다(상용으로 대체하지 않음) |
| 출처 추적 | 페이지에 `source_document_ids`(근거 문서 id 배열)를 기록한다. lint는 근거 문서의 `ai_documents.updated_at`이 페이지 `updated_at`보다 새로우면 `stale_since`를 채우고 갱신 제안을 만든다. 갱신하면 `stale_since`를 비운다 |
| 삭제 | 페이지 삭제는 기본이 보관(archive)이며 개정 이력은 유지한다. 개인정보 삭제 요청은 `core.purge_wiki_page`(service_role)로 페이지와 개정 이력, 링크를 실제 삭제하고 감사 기록을 남긴다. 해당 페이지에서 파생된 다른 페이지는 `source_document_ids`로 찾아 함께 점검한다 |

## 3. 제품 지식 위키 (DB + FastAPI)

| 항목 | 규칙 |
|---|---|
| 범위 | 조직·앱 단위. 조직 간 공유 없음. 제품 공통 지식(해설집 등)은 운영자 조직의 위키로 두고 외부 지식 API로만 노출 |
| 실행 | ingest는 문서 색인(RAG) 직후 잡으로 실행. lint는 주 1회 잡(제안). query는 채팅 `/tools/answer` 안에서 |
| 모델 | 라우터의 `feature=wiki.ingest`, `wiki.lint`, `wiki.query` 기본값을 따른다(대량 처리는 오픈소스 기본, 제안) |
| 검색 | 위키 페이지도 `kind=wiki` 컬렉션으로 임베딩해 `match_ai_chunks`로 찾는다 |
| 화면 | 위키 목록·페이지 보기·변경 이력·점검 결과. 사용자 편집은 FastAPI를 거쳐 저장(직접 DB 쓰기 없음) |
| 크레딧 | ingest·lint는 사용량만큼 차감. 비용이 큰 전체 compile은 관리자 실행만 |
| 수집 상한(제안) | 문서 1건당 갱신하는 페이지는 최대 5개. 초과분은 다음 배치로 미룬다. 같은 조직의 ingest 배치 간격은 최소 N분(구현 시 결정). 기능별 일일 크레딧 상한(`wiki.ingest`, `wiki.lint`)을 두고 도달하면 대기열에 남긴다. 연쇄 갱신으로 비용이 폭증하는 것을 막기 위한 값이며 모두 제안이다 |

## 4. 개발용 프로젝트 위키 (`docs/wiki/` + 스킬)

```
docs/wiki/
├── WIKI_SCHEMA.md      위키 규칙(이 문서 2절을 개발용으로 옮긴 것), 페이지 종류, 갱신 시점
├── index.md            목차(에이전트가 유지)
├── log.md              변경 기록(append-only, 날짜·task·페이지)
├── modules/            모듈별 페이지(경로, 책임, 주요 파일, 의존)
├── decisions/          결정 기록(산출물 ID, task, 이유)
├── concepts/           도메인 용어
└── sources/            산출물 요약(docs/file의 문서별)
```

| 항목 | 규칙 |
|---|---|
| 근거 | `docs/file/`(등록 산출물)과 코드. 위키는 산출물을 대체하지 않는다. 충돌하면 산출물이 정본이고 위키를 고친다 |
| 갱신 시점 | task 완료 시 오케스트레이터가 스킬을 실행해 관련 modules·decisions 페이지와 log를 갱신한다. 산출물이 바뀌면 sources 페이지를 갱신한다 |
| 점검 | 웨이브가 끝날 때 lint를 실행해 낡은 페이지와 깨진 링크를 정리한다 |
| 초기 페이지 | `D:/WorkSpace/platform/docs/develop/<제품>/<제품>-root/docs/wiki/`에 기획서로부터 만든 초기 페이지를 넣어 둔다 |
| 스킬 | `.claude/skills/llm-wiki/SKILL.md`: ingest·query·lint 절차와 페이지 템플릿. 정본은 멀티에이전트 베이스(`MultiAgent-Service-Fullstack-Tree-Framwork`)의 `.claude/skills/llm-wiki/`와 `docs/wiki/WIKI_SCHEMA.md`이며, 개발 폴더는 setup이 베이스를 복사할 때 함께 받는다 |
| 비밀 | 키·토큰 값, 개인정보를 위키에 쓰지 않는다 |
