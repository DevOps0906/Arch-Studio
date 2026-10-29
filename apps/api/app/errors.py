"""응답 봉투와 예외 처리(04_API.md 1장 "응답 봉투").

성공 `{ ok: true, data }`, 실패 `{ ok: false, error: { code, message, details? } }`.
예외 원문·스택·입력값·라이브러리 메시지는 내보내지 않는다.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.log import logger


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse({"ok": True, "data": data}, status_code=status)


def error_response(
    status: int,
    code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    err: dict[str, Any] = {"code": code, "message": message}
    if details:
        err["details"] = details
    return JSONResponse({"ok": False, "error": err}, status_code=status, headers=headers)


_STATUS_CODES = {
    400: ("BAD_REQUEST", "잘못된 요청입니다"),
    401: ("UNAUTHORIZED", "인증이 필요합니다"),
    403: ("FORBIDDEN", "권한이 없습니다"),
    404: ("NOT_FOUND", "찾을 수 없습니다"),
    405: ("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다"),
    413: ("PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다"),
}


def validation_details(errors: list[Any]) -> dict[str, Any]:
    """검증 오류는 위치·종류만 남긴다(입력값·메시지 원문 제외: 프롬프트·좌표가 되돌아오지 않게)."""
    fields = []
    for e in errors[:20]:
        loc = [p for p in e.get("loc", ()) if isinstance(p, str | int)]
        fields.append({"loc": loc, "type": str(e.get("type", "invalid"))})
    return {"fields": fields}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message, details=exc.details, headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _STATUS_CODES.get(exc.status_code, ("ERROR", "요청을 처리할 수 없습니다"))
        return error_response(exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            422, "VALIDATION", "입력이 계약과 다릅니다", details=validation_details(list(exc.errors()))
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # 예외 종류만 기록한다(메시지·스택에 토큰·프롬프트가 섞일 수 있다).
        # 주의: Starlette ServerErrorMiddleware는 이 핸들러 뒤에도 예외를 다시 던지고 uvicorn이 exc_info
        # 트레이스백을 기록한다. 그 경로는 app.log의 레코드 팩토리(예외 메시지 제거)가 막는다.
        logger.error("unhandled error: %s", type(exc).__name__)
        return error_response(500, "INTERNAL", "내부 오류가 발생했습니다")
