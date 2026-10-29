# apps/api — AI 서비스(FastAPI)

공용 AI 서비스 설치 + 제품 확장 `arch`(02_ARCHITECTURE.md 2장 ai-service, 04_API.md 6.3절). pnpm 워크스페이스 밖(Python)이다.
현재 범위(AR-06-046): 서명·잡 토큰 검증, 그래프 실행 경로 골격(`POST /graphs/{name}/runs`, `GET /graphs/runs/{id}`),
계약 스키마(pydantic)와 zod 동치 테스트. 외부 LLM 호출은 없다(`app/ai/interfaces.py`에 자리만).

## 설치

```bash
cd apps/api
python3 -m venv .venv          # .venv는 apps/api/.gitignore
.venv/bin/pip install -e '.[dev]'
```

## 실행

```bash
AI_TOKEN_JWKS_URL=https://<web>/.well-known/ai-jwks.json .venv/bin/uvicorn --factory app.main:create_app
```

검증 키가 없거나 잘못되면 기동을 거부한다(ConfigError). 기본값·하드코딩 키는 없다.

## 환경변수 (값은 저장소에 두지 않는다)

| 이름 | 필수 | 내용 |
|---|---|---|
| `AI_TOKEN_JWKS_URL` | 둘 중 정확히 하나 | 토큰 검증 공개키 JWKS 주소(https만). 기동 시 조회, 모르는 `kid`는 60초에 한 번만 재조회 |
| `AI_TOKEN_JWKS` | 둘 중 정확히 하나 | JWKS JSON 문자열(공개키만, `d` 있으면 기동 거부). URL을 못 쓰는 환경용 |
| `AI_API_MAX_BODY_BYTES` | 아니오(기본 65536) | 요청 본문 상한(1KiB~1MiB). 넘으면 413 |
| `AI_TOKEN_LEEWAY_S` | 아니오(기본 30) | 시계 오차 허용(0~120초) |

JWKS 키 규격: `kty=OKP`, `crv=Ed25519`, `kid` 필수, `alg`가 있으면 `EdDSA`, `use`가 있으면 `sig`. 이 설치의 키는 제품 `arch`의
발급 키로 묶인다(토큰 `iss=arch`, `aud=platform-ai:arch`, `app=arch`).

## 토큰 규칙 (AI_ARCHITECTURE.md 2.1절)

- 알고리즘은 `EdDSA`만(헤더 단계에서 `none`·`HS*` 거부), `jku`·`x5u`·`jwk`·`x5c` 헤더 거부, `kid` 필수.
- 필수 클레임 `iss aud sub org app scope jti iat exp`. 수명 600초 이하, `org`는 UUID, `scope`는 공백 없는 문자열 하나.
- 그래프 경로는 잡 토큰(`sub=job:<uuid>`)과 `scope=graph:<그래프 이름>` 정확히 일치. 실행 시작은 `jti` 1회 소비.
- 조직은 토큰 `org`에서만. 본문 `org_id`는 422, 쿼리 `org_id`는 무시. 다른 조직 실행은 404.
- 응답 봉투 `{ ok, data }` / `{ ok: false, error: { code, message } }`. 401 본문은 사유를 구분하지 않는다(로그에 사유 코드만).

## 검사

```bash
cd apps/api
.venv/bin/python -m pytest          # 인증·격리·스키마·zod 동치(Node 필요: zod 덤프를 테스트 시 생성)
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/mypy app tests
```

Node 쪽 동치 테스트(저장소 루트에서, `pnpm install` 후):

```bash
node --test "apps/api/tests/contract/node/*.test.ts"
```

루트 `pnpm test`에는 아직 들어 있지 않다(apps/api는 워크스페이스 밖이고 루트 package.json은 이 작업 소유가 아님).
CI·루트 스크립트 연결은 후속 요청(tasks/logs/AR-06-046.md).

## 계약 동치 테스트 구조

- `app/ai/products/arch/schema.py`: DesignModelV1·JudgmentResult·SheetSpec·DraftingProfile(= `packages/domain` zod 사본),
  IntakeCandidateV1·ReviewResultV1·LayoutIntentV1(04_API.md 4.2·4.3·4.6절, LLM 출력 수용 모델, 좌표 필드 없음).
- `tests/contract/node/zod-json-schema.ts`: zod v3 `_def` → JSON Schema 변환(새 의존성 없음. zod 3.25의 `z.toJSONSchema`는 v4 스키마 전용).
- `tests/contract/corpus/*.json`: 유효·무효 사례 코퍼스(양쪽 공유). 사례를 추가하면 양쪽 테스트가 함께 돈다.
- `tests/contract/test_zod_equivalence.py`: 구조 비교 + 코퍼스 수락/거부 일치. `PENDING_ZOD`는 zod 정의가 아직 없는 모델이며,
  zod가 추가되면 이 목록에서 빼야 테스트가 통과한다.
