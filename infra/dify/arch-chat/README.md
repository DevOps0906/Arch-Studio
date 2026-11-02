# arch-chat Dify 앱 (초안, 연결 안 됨)

AR-06-054 범위에서는 web이 서명 토큰(scope=chat)으로 FastAPI `/tools/answer`를 직접 호출한다. 이 폴더의 `app.draft.yml`은 후속 연결용 초안이며 어디에서도 가져오지(import) 않는다.

## 연결 전 조건 (모두 충족 전 연결 금지)
1. Dify 로그 보존 30일·처리위탁 고지 확정 (`AI_ARCHITECTURE.md` 69행).
2. DSL 검사: HTTP 노드의 answer 원문만 출력, 뒤에 LLM 노드 0개, 모델 공급자는 `/v1/chat/completions` 고정 (049 우회 방지).
3. `04_API.md`·`AI_ARCHITECTURE.md`를 직접 호출 구조에 맞게 정정.
4. Dify 경유 시에도 출처·숫자·compliance 검사는 FastAPI 응답 그대로 유지(재작성 금지).

계약: 요청 `{request_id, message, application_date?}`, 응답 `{ok, data:{answer:{sentences[{text,source_ids}]}, sources[], no_source}}`.
