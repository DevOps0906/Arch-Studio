"""그래프 실행 기록 저장소(골격). 모든 조회는 (app, org)로 범위를 좁힌다(조직 격리, 공격 A5).

메모리 구현이다. DB 연결 작업에서 같은 인터페이스로 교체한다.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, replace
from typing import Literal, Protocol

RunStatus = Literal["accepted", "running", "succeeded", "failed"]


@dataclass(frozen=True)
class GraphRun:
    id: str
    app: str
    org: str
    graph: str
    run_id: str  # 제품 실행 행 id(arch.reviews / arch.intake_runs ...)
    job_id: str
    status: RunStatus


class RunConflict(Exception):
    """같은 실행 행에 다른 잡이 붙으려 할 때."""


class RunStore(Protocol):
    def create_or_get(self, *, app: str, org: str, graph: str, run_id: str, job_id: str) -> tuple[GraphRun, bool]: ...

    def get(self, *, app: str, org: str, graph_run_id: str) -> GraphRun | None: ...

    def set_status(self, run: GraphRun, status: RunStatus) -> GraphRun: ...


class MemoryRunStore:
    def __init__(self) -> None:
        self._by_id: dict[str, GraphRun] = {}
        self._by_key: dict[tuple[str, str, str, str], str] = {}
        self._lock = threading.Lock()

    def create_or_get(self, *, app: str, org: str, graph: str, run_id: str, job_id: str) -> tuple[GraphRun, bool]:
        key = (app, org, graph, run_id)
        with self._lock:
            existing_id = self._by_key.get(key)
            if existing_id is not None:
                existing = self._by_id[existing_id]
                if existing.job_id != job_id:
                    raise RunConflict
                return existing, False
            run = GraphRun(
                id=str(uuid.uuid4()), app=app, org=org, graph=graph, run_id=run_id, job_id=job_id, status="accepted"
            )
            self._by_id[run.id] = run
            self._by_key[key] = run.id
            return run, True

    def get(self, *, app: str, org: str, graph_run_id: str) -> GraphRun | None:
        run = self._by_id.get(graph_run_id)
        if run is None or run.app != app or run.org != org:
            return None
        return run

    def set_status(self, run: GraphRun, status: RunStatus) -> GraphRun:
        with self._lock:
            updated = replace(run, status=status)
            self._by_id[run.id] = updated
            return updated
