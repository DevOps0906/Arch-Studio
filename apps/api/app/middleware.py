"""본문 크기 상한(공격 A10). Content-Length 선검사 + 실제 수신 바이트 누계(chunked·거짓 길이 대비)."""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import ApiError, error_response


def _too_large() -> ApiError:
    return ApiError(413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다")


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = -1
                if declared < 0 or declared > self.max_bytes:
                    status, code = (400, "BAD_REQUEST") if declared < 0 else (413, "PAYLOAD_TOO_LARGE")
                    message = "잘못된 요청입니다" if declared < 0 else "요청 본문이 너무 큽니다"
                    await error_response(status, code, message)(scope, receive, send)
                    return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _too_large()
            return message

        await self.app(scope, limited_receive, send)
