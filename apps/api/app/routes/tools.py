"""도구 경로. POST /tools/answer: 법규 질의 답변(AR-06-054). 호출자는 web 서버(서명 토큰 scope=chat)뿐이다.

순서: 토큰 검증(401) → 사용자 토큰·scope=chat(403) → 본문 strict 검증(422, 본문 org 거부)
→ 설정 확인(503) → jti 1회 소비(401) → 답변 생성. 조직은 토큰 org만 쓴다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.ai.products.arch.schema import ChatRequest
from app.ai.tools.arch.answer import AnswerError, ChatDeps, answer
from app.auth.deps import consume_jti, token_claims
from app.auth.tokens import TokenClaims
from app.errors import ApiError, ok, validation_details

router = APIRouter()

CHAT_SCOPE = "chat"
_KST = timezone(timedelta(hours=9))


def _forbidden() -> ApiError:
    return ApiError(403, "SCOPE_MISMATCH", "권한이 없습니다")


@router.post("/tools/answer")
async def tools_answer(request: Request, claims: Annotated[TokenClaims, Depends(token_claims)]) -> JSONResponse:
    if claims.job_id is not None or claims.scope != CHAT_SCOPE:
        raise _forbidden()
    try:
        body = ChatRequest.model_validate_json(await request.body())
        applied = date.fromisoformat(body.application_date) if body.application_date else None
    except ValidationError as exc:
        raise ApiError(422, "VALIDATION", "입력이 계약과 다릅니다", details=validation_details(exc.errors())) from None
    except ValueError:
        raise ApiError(422, "VALIDATION", "입력이 계약과 다릅니다") from None
    deps: ChatDeps | None = getattr(request.app.state, "chat", None)
    if deps is None:
        raise ApiError(503, "NOT_CONFIGURED", "일시적으로 사용할 수 없습니다")
    consume_jti(request, claims)
    try:
        result = await run_in_threadpool(
            answer,
            deps,
            org=claims.org,
            message=body.message,
            application_date=applied or datetime.now(_KST).date(),
        )
    except AnswerError:
        raise ApiError(502, "PROVIDER", "답변을 만들지 못했습니다") from None
    return ok(result.model_dump())
