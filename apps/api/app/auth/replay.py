"""jti 1회 사용 저장소(공격 A3).

주의: 프로세스 메모리 구현이다. 다중 인스턴스 배포 전에 공유 저장소(DB·Redis)로 바꿔야 한다(tasks/logs/AR-06-046.md).
가득 차면 새 토큰을 거부한다(fail-closed).
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Protocol


class JtiStore(Protocol):
    def consume(self, app: str, jti: str, exp: int) -> bool:
        """처음 보는 jti면 기록하고 True, 이미 쓴 jti면 False."""
        ...


class MemoryJtiStore:
    def __init__(self, *, max_entries: int = 100_000, clock: Callable[[], float] = time.time) -> None:
        self._seen: dict[tuple[str, str], int] = {}
        self._max = max_entries
        self._clock = clock
        self._lock = threading.Lock()

    def consume(self, app: str, jti: str, exp: int) -> bool:
        key = (app, jti)
        with self._lock:
            if key in self._seen:
                return False
            if len(self._seen) >= self._max:
                now = self._clock()
                self._seen = {k: v for k, v in self._seen.items() if v > now - 300}
                if len(self._seen) >= self._max:
                    return False
            self._seen[key] = exp
            return True
