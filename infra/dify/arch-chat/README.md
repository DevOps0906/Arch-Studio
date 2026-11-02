# Dify `arch-chat` 앱 설정 (AR-06-054)

법규 질의 채팅(AR-F-009)의 Dify Chatflow 설정입니다. 계약 정본은 `docs/file/03-설계/04_API.md` 6.4절, 공용 설치는 `../README.md`를 따릅니다.
Dify는 질문을 받아 FastAPI `/tools/answer`에 넘기고, 그 응답 JSON을 그대로 돌려주는 중계 역할만 합니다. 근거 검색·답변 생성·출처 검사는 FastAPI가, 출처 재검사·크레딧은 Next.js(`/api/ai/chat`)가 합니다.

> 노드 이름·변수 문법(`{{#node.var#}}`, `sys.user`, `sys.query`)과 `/chat-messages` 스트리밍 이벤트 이름은 Dify 공개 문서 기준이며, **설치한 Dify 버전 문서로 아직 확인하지 않았습니다(미확인)**. 그래서 DSL(`app.yml`)은 손으로 쓰지 않고, 아래대로 앱을 만든 뒤 Dify에서 내보내 이 폴더에 `app.yml`로 커밋합니다(키 값 제외).

## 1. 앱

| 항목 | 값 |
|---|---|
| 종류 | Chatflow, 이름 `arch-chat` |
| 입력 변수 | `platform_conversation_id`(텍스트, 필수) 하나만. 다른 입력 변수를 만들지 않습니다 |
| `user` | Next.js가 만든 `dify_user`(HMAC, `du_` + 32자). 조직·사용자 id가 드러나지 않습니다 |
| 넣지 않는 것 | 서명 토큰, org id, 사용자 id, 프로젝트 내용, 대지 주소. Dify 내장 지식베이스·LLM 노드의 직접 답변 |
| 대화 기록 | Dify 로그 30일(`02_ARCHITECTURE.md` dify 행) |

## 2. 노드 (시작 → HTTP 요청 → 답변)

1. **시작**: 입력 변수 `platform_conversation_id`.
2. **HTTP 요청** `tools_answer`
   - `POST {AI_SERVICE_URL}/tools/answer` (Dify 환경 변수로 주소를 둡니다)
   - 헤더 `X-Internal-Key: {DIFY_INTERNAL_API_KEY}`(Dify 환경 변수·비밀, apps/api와 같은 값, 32자 이상)
   - 본문(JSON): `{ "platform_conversation_id": "{{#start.platform_conversation_id#}}", "dify_user": "{{#sys.user#}}", "query": "{{#sys.query#}}" }`
   - 시간 제한 25초, 재시도 0회(웹은 Dify 무응답 10초·5xx면 `/tools/answer-direct`로 바꿉니다)
3. **답변**: `{{#tools_answer.body#}}` 를 그대로 출력합니다(가공·LLM 요약 금지).
   - 출력은 FastAPI 봉투 `{ "ok": true, "data": { "answer", "citations": [{ "law", "article", "effective_from", "source_id" }], "no_source", "usage" } }` 입니다.
   - Next.js가 `message` 조각을 모아 `message_end`에서 한 번에 파싱하고, 출처가 0개면 문장을 버리고 "근거를 찾지 못했습니다"로 바꿉니다.
   - HTTP 노드 오류 처리는 "실패 시 계속"으로 두어 FastAPI 4xx 봉투(`{ ok:false, error:{ code } }`)도 답변 노드로 보냅니다. 웹은 code가 `AI_UNAVAILABLE`이 아니면 거절로 보고 폴백하지 않습니다(환불). 그 밖의 비정상 출력·Dify 장애는 `/tools/answer-direct`로 폴백합니다.
   - 본문 템플릿에 `sys.query`를 문자열로 끼우면 질문의 따옴표·줄바꿈이 JSON을 깨 422가 납니다. 설치 버전에서 JSON 본문 변수 이스케이프 방식을 확인해 설정합니다(미확인).

보조 LLM 노드(질문 분류 등, `dify.aux` 오픈소스 강제)는 MVP에서 두지 않습니다.

## 3. FastAPI 쪽 확인 (`apps/api/app/ai/tools/arch/`)

| 경로 | 인증 | 동작 |
|---|---|---|
| `POST /tools/answer` | `X-Internal-Key` 상수 시간 비교. 키 미설정이면 503 | (platform_conversation_id, dify_user)가 `core.ai_conversations`와 일치할 때만 org 확정(불일치 404) |
| `POST /tools/answer-direct` | 서명 토큰 scope `chat`, 사용자 토큰만, `conv` == 본문 대화 id, jti 1회 | 같은 처리, org = 토큰 org |

두 경로 모두 시행 중인 지식(`arch.knowledge`)만 검색하고, 검색 결과가 없으면 LLM을 부르지 않으며, LLM이 인용한 조각 중 검색 결과에 있는 것만 출처로 남깁니다. 출처가 0개면 `no_source=true`, 답변 "근거를 찾지 못했습니다".

## 4. 크레딧 (Next.js `/api/ai/chat`)

| 결과 | 크레딧 |
|---|---|
| Dify 경로, 출처 1개 이상 | 1 (선차감 확정) |
| 출처 없음 | 0 (전액 환불, 04_API "제안") |
| Dify 런타임 장애 → answer-direct(폴백), 출처 있음 | 1 |
| FastAPI 거절(4xx, 예: 본문 JSON 깨짐 422) | 0 (환불, 폴백 안 함, 422·503) |
| 둘 다 실패 | 0 (환불 + 503 `AI_UNAVAILABLE`) |
| Dify 설정 누락(URL·앱 키·HMAC 비밀·AI_SERVICE_URL) | 503 `AI_UNAVAILABLE`, 차감 전 거부(폴백 없음) |

멱등 키 `chat:<org_id>:<request_id>`(환불 `...:refund`). 같은 request_id 재사용은 원장 nonce 대조로 409.

## 5. 운영 점검

- Dify 장애 시 웹 로그 `ai_chat.dify_unavailable`(`alert: true`, 사유 코드만)로 운영 알림을 겁니다.
- 키 교체: `DIFY_INTERNAL_API_KEY`는 Dify와 apps/api를 같이 바꿉니다. `DIFY_USER_HMAC_SECRET`을 바꾸면 새 대화부터 새 `dify_user`가 쓰입니다(기존 대화는 저장된 값을 씁니다).
