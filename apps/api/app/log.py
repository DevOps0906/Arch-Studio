"""로그 가리기(04_API.md 1장 "로그"): 토큰·프롬프트 전문을 남기지 않는다.

코드는 토큰·본문을 로그에 쓰지 않는 것이 1차 방어이고, 이 필터는 실수 방어(2차)다.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("arch_api")

_PATTERNS = (
    re.compile(r"\b(Bearer|Basic)\s+[\w.~+/=-]+", re.IGNORECASE),
    re.compile(r"\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*"),  # JWT 형태(header.payload.signature)
)


def redact(text: str) -> str:
    for pattern in _PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except (TypeError, ValueError):
            message = str(record.msg)
        cleaned = redact(message)
        if cleaned != message:
            record.msg = cleaned
            record.args = None
        return True


_FILTER = RedactFilter()


def install_log_redaction() -> None:
    """이 앱 로거와 uvicorn 로거, 그 핸들러에 가리기 필터를 붙인다(중복 설치 안전)."""
    for name in ("arch_api", "uvicorn", "uvicorn.error", "uvicorn.access", ""):
        target = logging.getLogger(name)
        if _FILTER not in target.filters:
            target.addFilter(_FILTER)
        for handler in target.handlers:
            if _FILTER not in handler.filters:
                handler.addFilter(_FILTER)
