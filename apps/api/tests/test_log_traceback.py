"""트레이스백 누출(독립 보안 리뷰 지적): uvicorn은 Starlette가 다시 던진 예외를 exc_info로 통째로 기록한다.

필터가 `getMessage()`만 가리면 `RuntimeError("... Bearer ... prompt=...")`가 로그에 그대로 남는다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.log import RedactFilter, install_log_redaction
from app.main import create_app
from app.settings import Settings
from tests.conftest import review_body

RUN_ID = "33333333-3333-4333-8333-333333333333"
LEAK = "leak Bearer abc.def.ghi prompt=집 평면"
Auth = Callable[..., dict[str, str]]


@contextmanager
def captured() -> Iterator[list[str]]:
    """최종 핸들러·포매터 출력 문자열을 모은다(루트에 직접 붙인 핸들러: 자식 로거에서 전파된 레코드도 지난다)."""
    install_log_redaction()
    lines: list[str] = []

    class Collect(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(self.format(record))

    handler = Collect(level=logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(name)s %(message)s"))
    root = logging.getLogger()
    old_level = root.level
    root.setLevel(logging.DEBUG)
    root.addHandler(handler)
    try:
        yield lines
    finally:
        root.removeHandler(handler)
        root.setLevel(old_level)


def _raise_leak() -> None:
    raise RuntimeError(LEAK)


@pytest.mark.parametrize("name", ["uvicorn.error", "arch_api", "arch_api.graphs", "httpx", "unrelated.child"])
def test_traceback_in_exc_info_is_redacted(name: str) -> None:
    with captured() as lines:
        log = logging.getLogger(name)
        try:
            _raise_leak()
        except RuntimeError:
            log.error("Exception in ASGI application", exc_info=True)
    out = "\n".join(lines)
    assert "Traceback" in out  # 진단 정보(예외 종류·위치)는 남는다
    assert "RuntimeError" in out
    assert "abc.def.ghi" not in out
    assert "집 평면" not in out


def test_traceback_via_exception_object_and_chain_is_redacted() -> None:
    with captured() as lines:
        try:
            try:
                _raise_leak()
            except RuntimeError as inner:
                raise ValueError("outer wrapper") from inner
        except ValueError as exc:
            logging.getLogger("uvicorn.error").error("Exception in ASGI application", exc_info=exc)
    out = "\n".join(lines)
    assert "ValueError" in out
    assert "abc.def.ghi" not in out
    assert "집 평면" not in out


def test_traceback_from_real_app_500_is_redacted(settings: Settings, auth: Auth) -> None:
    class Boom:
        def start(self, run: object) -> None:
            raise RuntimeError(LEAK)

    with captured() as lines:
        with TestClient(create_app(settings, runner=Boom()), raise_server_exceptions=False) as c:
            res = c.post("/graphs/arch.review/runs", json=review_body(RUN_ID), headers=auth())
            assert res.status_code == 500
            try:  # uvicorn이 하는 일: 다시 던져진 예외를 exc_info로 기록
                Boom().start(object())
            except RuntimeError as exc:
                logging.getLogger("uvicorn.error").error("Exception in ASGI application", exc_info=exc)
    assert lines
    assert all("abc.def.ghi" not in line and "집 평면" not in line for line in lines)


def test_redact_filter_handles_exc_info_exc_text_and_stack_info() -> None:
    try:
        _raise_leak()
    except RuntimeError:
        import sys

        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "m", None, sys.exc_info())
    RedactFilter().filter(record)
    assert record.exc_info is None
    assert record.exc_text and "RuntimeError" in record.exc_text
    assert "abc.def.ghi" not in record.exc_text

    other = logging.LogRecord("x", logging.ERROR, __file__, 1, "m", None, None)
    other.exc_text = f"Traceback...\nRuntimeError: {LEAK}"
    other.stack_info = f"stack {LEAK}"
    RedactFilter().filter(other)
    assert "abc.def.ghi" not in (other.exc_text or "")
    assert "abc.def.ghi" not in (other.stack_info or "")
