# arch-studio Dify 채팅 앱 설정 설명서

공용 Dify 설치·운영은 `D:/WorkSpace/platform/docs/develop/_shared/dify/README.md`, 설계는 `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md` 2~3장을 따릅니다. 이 폴더에는 이 제품 앱의 설정 설명과, Dify에서 앱을 만든 뒤 내보낸 DSL 파일(`app.yml`)을 둡니다.

| 항목 | 값 |
|---|---|
| 앱 종류 | Chatflow (제품당 1개) |
| 앱 id(platform) | `arch` |
| 입력 변수 | `platform_conversation_id`(텍스트, 필수). Dify `user`는 Next.js가 만든 `dify_user` |
| 답변 생성 | HTTP 요청 노드 → `POST {FASTAPI}/tools/answer`, 헤더 `Authorization: Bearer {DIFY_INTERNAL_API_KEY}`, 본문에 `platform_conversation_id`, `sys.user`, 사용자 질문 |
| 보조 LLM 노드 | 모델 공급자 = 이 제품 FastAPI 라우터(OpenAI 호환). 조직 데이터 금지 |
| 외부 지식 API | 제품 공통 지식만(조직 데이터 금지) |
| 금지 | Dify 내장 지식베이스, 서명 토큰이나 개인정보를 입력 변수로 넘기는 것 |
| 내보내기 | 앱을 바꿀 때마다 DSL을 내보내 `infra/dify/app.yml`로 커밋합니다(키 값 제외) |

기능별 그래프와 라우팅 기본값은 `docs/file/03-설계/02_ARCHITECTURE.md`를 따릅니다.
