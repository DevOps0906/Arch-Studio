"""AR-06-049 AI 보안(Python 계층): 토큰 org 바인딩·scope↔graph 일치·org·collection 요청 경로 0.

라우팅 강제(resolve_ai_route·ai_filter_chain·match_ai_chunks)는 SQL 계층이 정본이라
scripts/ai-routing/security.sql이 본다
(tasks/logs/AR-06-049.md [DECISION] 1·4). 여기서는 FastAPI가 요청 값으로 조직·컬렉션을 고를 수 없음을 고정한다.
"""

from __future__ import annotations

import importlib
import pkgutil
import re
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import routes as app_routes
from app.ai.products.arch import PRODUCT
from app.routes.graphs import GraphRunRequest
from tests.conftest import ORG_A, ORG_B, RUN_A

Auth = Callable[..., dict[str, str]]

API_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = API_ROOT.parents[1]
SIGNER_TS = REPO_ROOT / "apps/web/src/server/ai/token/signer.ts"

ENABLED_GRAPHS = sorted(name for name, on in PRODUCT.graphs.items() if on)
# 요청(경로·쿼리·헤더·쿠키·본문)에서 받으면 안 되는 이름: 조직·컬렉션은 토큰·서버 설정에서만 온다.
FORBIDDEN_PARAM = re.compile(
    r"^(x[-_])?(org|org_id|organization|organization_id|collection|collection_id|collections)$", re.I
)


def ts_job_scopes() -> list[str]:
    """웹 발급기(signer.ts JOB_SCOPES)가 낼 수 있는 잡 scope 목록."""
    m = re.search(r"export const JOB_SCOPES = \[([^\]]*)\] as const;", SIGNER_TS.read_text(encoding="utf-8"))
    assert m, "signer.ts JOB_SCOPES 선언을 찾지 못했다"
    return re.findall(r'"([^"]+)"', m.group(1))


# --- scope ↔ graph ---------------------------------------------------------------------


def test_enabled_graphs_are_issuable_by_web_signer() -> None:
    # Python에 켜진 그래프는 웹이 그 scope 토큰을 발급할 수 있어야 한다(발급 불가 그래프 = 죽은 경로).
    scopes = ts_job_scopes()
    assert ENABLED_GRAPHS, "활성 그래프가 없다"
    for graph in ENABLED_GRAPHS:
        assert f"graph:{graph}" in scopes, graph


@pytest.mark.parametrize("graph", ENABLED_GRAPHS)
def test_every_other_job_scope_rejected_403(client: TestClient, auth: Auth, graph: str) -> None:
    for scope in [*ts_job_scopes(), "graph:*", f"graph:{graph} graph:arch.review", "chat", "wiki", "voice"]:
        if scope == f"graph:{graph}":
            continue
        res = client.post(f"/graphs/{graph}/runs", json={"run_id": RUN_A}, headers=auth(scope=scope))
        assert res.status_code in (401, 403), (graph, scope, res.status_code)


@pytest.mark.parametrize("graph", ENABLED_GRAPHS)
def test_exact_scope_accepted_202(client: TestClient, auth: Auth, graph: str) -> None:
    res = client.post(f"/graphs/{graph}/runs", json={"run_id": RUN_A}, headers=auth(scope=f"graph:{graph}"))
    assert res.status_code == 202


# --- 토큰 org 바인딩 -------------------------------------------------------------------


def test_start_ignores_query_and_header_org(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    res = client.post(
        "/graphs/arch.review/runs",
        params={"org_id": ORG_B, "org": ORG_B, "collection_id": str(uuid.uuid4())},
        json={"run_id": RUN_A},
        headers={**auth(sub=f"job:{job}", org=ORG_A), "X-Org-Id": ORG_B, "X-Org": ORG_B},
    )
    assert res.status_code == 202
    graph_run_id = res.json()["data"]["graph_run_id"]
    # 실행은 토큰 org(A)에 묶인다: A의 같은 잡 토큰으로만 보이고, B로는 없는 실행과 같다.
    own = client.get(f"/graphs/runs/{graph_run_id}", headers=auth(sub=f"job:{job}", org=ORG_A))
    other = client.get(f"/graphs/runs/{graph_run_id}", headers=auth(sub=f"job:{job}", org=ORG_B))
    assert own.status_code == 200
    assert other.status_code == 404


@pytest.mark.parametrize("key", ["org", "collection_id", "collection", "app"])
def test_body_scope_keys_rejected_422(client: TestClient, auth: Auth, key: str) -> None:
    value = "arch" if key == "app" else str(uuid.uuid4())
    res = client.post("/graphs/arch.review/runs", json={"run_id": RUN_A, key: value}, headers=auth())
    assert res.status_code == 422


# --- 요청에 org·collection을 받는 경로 0(코드 스캔, DECISION 4) ---------------------------


def _param_names(dependant: object) -> Iterator[str]:
    for attr in ("path_params", "query_params", "header_params", "cookie_params", "body_params"):
        for field in getattr(dependant, attr, []):
            yield field.name
            alias = getattr(field, "alias", None)
            if alias:
                yield alias
    for sub in getattr(dependant, "dependencies", []):
        yield from _param_names(sub)


def _all_routes() -> list[APIRoute]:
    # app.routes 패키지의 모든 모듈 `router`(main.py가 include하는 단위). 새 라우트 모듈도 자동으로 스캔된다.
    routes: list[APIRoute] = []
    for info in pkgutil.iter_modules(app_routes.__path__):
        router = getattr(importlib.import_module(f"{app_routes.__name__}.{info.name}"), "router", None)
        if isinstance(router, APIRouter):
            routes += [r for r in router.routes if isinstance(r, APIRoute)]
    return routes


def test_no_route_declares_org_or_collection_param() -> None:
    routes = _all_routes()
    assert {r.path for r in routes} >= {"/graphs/{graph_name}/runs", "/graphs/runs/{graph_run_id}"}
    bad = [(r.path, n) for r in routes for n in _param_names(r.dependant) if FORBIDDEN_PARAM.match(n)]
    assert bad == []
    for r in routes:
        assert not re.search(r"\{(org|org_id|collection|collection_id)\}", r.path), r.path


def test_graph_body_model_is_run_id_only() -> None:
    assert set(GraphRunRequest.model_fields) == {"run_id"}
    assert GraphRunRequest.model_config.get("extra") == "forbid"


def test_app_code_reads_no_request_org_or_collection() -> None:
    # 요청 객체에서 쿼리·쿠키·경로 값을 직접 읽거나 org·collection 이름의 헤더를 읽는 코드가 없다.
    pattern = re.compile(
        r"\.(query_params|cookies|path_params)\b|headers\.get\(\s*['\"][^'\"]*(org|collection)[^'\"]*['\"]", re.I
    )
    hits = [
        f"{p.relative_to(API_ROOT)}:{i}"
        for p in sorted((API_ROOT / "app").rglob("*.py"))
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
        if pattern.search(line)
    ]
    assert hits == []
