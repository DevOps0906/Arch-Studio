"""`POST /tools/answer`(Dify HTTP 노드)·`POST /tools/answer-direct`(Dify 장애 시 `/api/ai/chat`) — 04_API.md 6.3·6.4절.

/tools/answer 순서: 내부 키 미설정 503 → `X-Internal-Key` 상수 시간 비교(401) → 본문 strict(422)
  → (platform_conversation_id, dify_user) 대화 매핑으로 org 확정(불일치 404, 존재 여부 숨김) → 답변.
  Dify 입력에는 토큰·org가 없다. org는 이 서버가 대화 매핑에서만 얻는다.
/tools/answer-direct 순서: 서명 토큰 검증(401) → 사용자 토큰·scope `chat`(403) → 본문 strict(422)
  → 토큰 `conv` == 본문 platform_conversation_id(403) → jti 1회(401) → 답변(org = 토큰 org).
응답 `{ ok, data: { answer, citations[{ law, article, effective_from, source_id }], no_source, usage } }`.
로그·응답에 질문·답변 원문·키·토큰을 넣지 않는다.
"""

from __future__ import annotations

import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.ai.tools.arch.answer import MAX_QUERY_CHARS, AnswerResult, answer_query
from app.ai.tools.arch.deps import ChatTools, NotConfigured, chat_tools
from app.auth.deps import consume_jti, token_claims
from app.auth.tokens import TokenClaims
from app.errors import ApiError, ok, validation_details
from app.log import logger

router = APIRouter()

_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
# 웹 서버가 만든 불투명 값(HMAC). 형식만 본다.
_DIFY_USER_PATTERN = r"^[A-Za-z0-9_-]{8,128}$"
CHAT_SCOPE = "chat"

Query = Annotated[str, Field(min_length=1, max_length=MAX_QUERY_CHARS)]


class AnswerRequest(BaseModel):
    """Dify HTTP 노드 본문. org·토큰 등 다른 키는 거부한다."""

    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)

    platform_conversation_id: Annotated[str, Field(pattern=_UUID_PATTERN)]
    dify_user: Annotated[str, Field(pattern=_DIFY_USER_PATTERN)]
    query: Query


class DirectAnswerRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)

    platform_conversation_id: Annotated[str, Field(pattern=_UUID_PATTERN)]
    query: Query


def _unavailable() -> ApiError:
    return ApiError(503, "AI_UNAVAILABLE", "지금은 답변할 수 없습니다")


def _parse[M: BaseModel](model: type[M], raw: bytes) -> M:
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        raise ApiError(422, "VALIDATION", "입력이 계약과 다릅니다", details=validation_details(exc.errors())) from None


def _view(result: AnswerResult) -> dict[str, Any]:
    return {
        "answer": result.answer,
        "citations": [
            {"law": c.law, "article": c.article, "effective_from": c.effective_from, "source_id": c.source_id}
            for c in result.citations
        ],
        "no_source": result.no_source,
        "usage": {"model": result.model, "input_tokens": result.input_tokens, "output_tokens": result.output_tokens},
    }


def _answer(tools: ChatTools, query: str, org: str, route: str) -> JSONResponse:
    try:
        result = answer_query(query, org=org, today=tools.today(), retriever=tools.retriever, generator=tools.generator)
    except NotConfigured:
        logger.warning("tools.answer unavailable: %s not_configured", route)
        raise _unavailable() from None
    except Exception:  # noqa: BLE001 — 제공자·검색 실패는 원문 없이 503(웹이 환불)
        logger.warning("tools.answer unavailable: %s upstream_failed", route)
        raise _unavailable() from None
    logger.info("tools.answer done: %s no_source=%s citations=%d", route, result.no_source, len(result.citations))
    return ok(_view(result))


@router.post("/tools/answer")
async def tools_answer(request: Request, tools: Annotated[ChatTools, Depends(chat_tools)]) -> JSONResponse:
    expected = tools.internal_key
    if expected is None:
        logger.warning("tools.answer unavailable: internal_key_unset")
        raise _unavailable()
    given = request.headers.get("x-internal-key", "")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        logger.info("auth rejected: %s", "INTERNAL_KEY")
        raise ApiError(401, "UNAUTHORIZED", "인증이 필요합니다")

    body = _parse(AnswerRequest, await request.body())
    try:
        org = tools.conversations.org_for(body.platform_conversation_id, body.dify_user)
    except NotConfigured:
        logger.warning("tools.answer unavailable: answer conversations_not_configured")
        raise _unavailable() from None
    if org is None:
        logger.info("auth rejected: %s", "CONVERSATION_MISMATCH")
        raise ApiError(404, "NOT_FOUND", "찾을 수 없습니다")
    return _answer(tools, body.query, org, "answer")


@router.post("/tools/answer-direct")
async def tools_answer_direct(
    request: Request,
    claims: Annotated[TokenClaims, Depends(token_claims)],
    tools: Annotated[ChatTools, Depends(chat_tools)],
) -> JSONResponse:
    # 잡 토큰은 거부(채팅은 사용자 서명 토큰만). 사유 코드만 기록한다.
    if claims.job_id is not None or claims.job is not None or claims.run is not None:
        logger.info("auth rejected: %s", "USER_TOKEN_REQUIRED")
        raise ApiError(403, "USER_TOKEN_REQUIRED", "권한이 없습니다")
    if claims.scope != CHAT_SCOPE:
        logger.info("auth rejected: %s", "SCOPE_MISMATCH")
        raise ApiError(403, "SCOPE_MISMATCH", "권한이 없습니다")

    body = _parse(DirectAnswerRequest, await request.body())
    if claims.conv is None or claims.conv != body.platform_conversation_id:
        logger.info("auth rejected: %s", "CONV_MISMATCH")
        raise ApiError(403, "CONV_MISMATCH", "권한이 없습니다")
    consume_jti(request, claims)
    return _answer(tools, body.query, claims.org, "answer-direct")
