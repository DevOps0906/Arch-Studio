"""로그 가리기(04_API.md 1장 "로그"): 토큰·프롬프트 전문을 남기지 않는다.

코드는 토큰·본문을 로그에 쓰지 않는 것이 1차 방어이고, 이 필터는 실수 방어(2차)다.
"""

from __future__ import annotations

import logging
import re
import traceback
from types import TracebackType

logger = logging.getLogger("arch_api")

_PATTERNS = (
    re.compile(r"\b(Bearer|Basic)\s+[\w.~+/=-]+", re.IGNORECASE),
    re.compile(r"\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*"),  # JWT 형태(header.payload.signature)
)


def redact(text: str) -> str:
    for pattern in _PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def format_exc_safe(exc: BaseException, _seen: set[int] | None = None) -> str:
    """예외 체인을 종류와 호출 위치(프레임)만으로 포맷한다. **예외 메시지는 쓰지 않는다**.

    메시지에는 토큰·프롬프트가 섞일 수 있고(패턴으로 못 잡는 자유 문장 포함) 정규식 가리기는 최선일 뿐이다.
    진단에는 예외 종류·모듈 경로·줄 번호면 충분하다.
    """
    seen = _seen if _seen is not None else set()
    seen.add(id(exc))
    parts: list[str] = []
    chained = exc.__cause__ or (None if exc.__suppress_context__ else exc.__context__)
    if chained is not None and id(chained) not in seen:
        note = (
            "The above exception was the direct cause of the following exception:"
            if exc.__cause__ is not None
            else "During handling of the above exception, another exception occurred:"
        )
        parts.append(format_exc_safe(chained, seen) + f"\n\n{note}\n\n")
    tb: TracebackType | None = exc.__traceback__
    frames = "".join(traceback.format_tb(tb)) if tb is not None else ""
    parts.append("Traceback (most recent call last):\n" + frames + f"{type(exc).__module__}.{type(exc).__qualname__}")
    return "".join(parts)


def _scrub_record(record: logging.LogRecord) -> None:
    """메시지·트레이스백·스택 문자열을 가린다. `exc_info`는 여기서 직접 포맷해 `exc_text`에 넣고 비운다.

    uvicorn은 Starlette가 다시 던진 예외를 `exc_info`로 통째로 기록한다. 예외 메시지에 토큰·프롬프트가
    섞여 있을 수 있으므로 포매터가 원문을 만들기 전에 가린 문자열로 바꿔 둔다.
    """
    try:
        message = record.getMessage()
    except (TypeError, ValueError):
        message = str(record.msg)
    cleaned = redact(message)
    if cleaned != message:
        record.msg = cleaned
        record.args = None
    if record.exc_info and not record.exc_text:
        try:
            exc = record.exc_info[1]
            raw = format_exc_safe(exc) if exc is not None else "[traceback unavailable]"
        except Exception:  # noqa: BLE001
            raw = "[traceback unavailable]"
        record.exc_text = redact(raw)
    elif record.exc_text:
        record.exc_text = redact(record.exc_text)
    record.exc_info = None
    if record.stack_info:
        record.stack_info = redact(record.stack_info)


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        _scrub_record(record)
        return True


_FILTER = RedactFilter()
_factory_installed = False


def _install_record_factory() -> None:
    """모든 로거의 레코드가 만들어질 때 가린다. 로거 필터는 자식 로거에서 전파된 레코드에 적용되지 않고,
    나중에 붙는 핸들러도 놓치므로 레코드 생성 지점이 가장 확실하다."""
    global _factory_installed
    if _factory_installed:
        return
    previous = logging.getLogRecordFactory()

    def factory(*args: object, **kwargs: object) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        _scrub_record(record)
        return record

    logging.setLogRecordFactory(factory)
    _factory_installed = True


def install_log_redaction() -> None:
    """레코드 팩토리(1차)와 이 앱·uvicorn·루트 로거 및 그 핸들러 필터(2차)를 설치한다(중복 설치 안전)."""
    _install_record_factory()
    for name in ("arch_api", "uvicorn", "uvicorn.error", "uvicorn.access", ""):
        target = logging.getLogger(name)
        if _FILTER not in target.filters:
            target.addFilter(_FILTER)
        for handler in target.handlers:
            if _FILTER not in handler.filters:
                handler.addFilter(_FILTER)
