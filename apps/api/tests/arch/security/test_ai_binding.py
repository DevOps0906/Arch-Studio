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
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from typing import Annotated, Any, get_args

import pytest
from fastapi import APIRouter, FastAPI, Header
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app import routes as app_routes
from app.ai.products.arch import PRODUCT
from app.main import create_app
from app.routes.graphs import GraphRunRequest
from app.settings import Settings
from tests.conftest import ORG_A, ORG_B, RUN_A

Auth = Callable[..., dict[str, str]]

API_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = API_ROOT.parents[1]
SIGNER_TS = REPO_ROOT / "apps/web/src/server/ai/token/signer.ts"

ENABLED_GRAPHS = sorted(name for name, on in PRODUCT.graphs.items() if on)
# 요청(경로·쿼리·헤더·쿠키·본문)에서 받으면 안 되는 이름(소문자·`-`/`_` 제거 후 대조).
# 조직·컬렉션은 토큰·서버 설정에서만 온다.
FORBIDDEN_NAME = re.compile(r"^x?(org|organization|collection|tenant)(id|ids|s)?$")


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


def is_forbidden_name(name: str) -> bool:
    """소문자화·`-`/`_` 제거 후 org·organization·collection·tenant(+id/ids/s, x- 접두) 이름이면 금지."""
    return bool(FORBIDDEN_NAME.match(re.sub(r"[-_]", "", name.lower())))


def _alias_names(info: Any) -> Iterator[str]:
    for attr in ("alias", "validation_alias", "serialization_alias"):
        value = getattr(info, attr, None)
        if isinstance(value, str):
            yield value
        elif value is not None:  # AliasChoices·AliasPath: 문자열 조각만
            for choice in getattr(value, "choices", None) or [value]:
                for part in getattr(choice, "path", None) or [choice]:
                    if isinstance(part, str):
                        yield part


def _annotation_names(annotation: Any, seen: set[type]) -> Iterator[str]:
    """주석 안의 BaseModel(list[Model]·Model | None 등 포함)을 재귀로 펼친 필드 이름·alias."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield from model_field_names(annotation, seen)
    for arg in get_args(annotation):
        yield from _annotation_names(arg, seen)


def model_field_names(model: type[BaseModel], seen: set[type] | None = None) -> Iterator[str]:
    seen = set() if seen is None else seen
    if model in seen:
        return
    seen.add(model)
    for name, info in model.model_fields.items():
        yield name
        yield from _alias_names(info)
        yield from _annotation_names(info.annotation, seen)


def _param_names(dependant: Any) -> Iterator[str]:
    for attr in ("path_params", "query_params", "header_params", "cookie_params", "body_params"):
        for field in getattr(dependant, attr, None) or []:
            yield field.name
            yield from _alias_names(field)
            info = getattr(field, "field_info", None)
            if info is not None:
                yield from _alias_names(info)
            yield from _annotation_names(getattr(info, "annotation", None) or getattr(field, "type_", None), set())
    for sub in getattr(dependant, "dependencies", None) or []:
        yield from _param_names(sub)


def _flatten_routes(items: Iterable[Any]) -> Iterator[APIRoute]:
    # FastAPI 0.16x는 include_router 결과를 래퍼(_IncludedRouter.original_router)로 둔다.
    # APIRoute가 나올 때까지 routes/original_router/router를 따라간다(include prefix는 이 앱에서 쓰지 않는다).
    for item in items:
        if isinstance(item, APIRoute):
            yield item
            continue
        inner = getattr(item, "routes", None)
        for attr in ("original_router", "router"):
            if inner is None:
                inner = getattr(getattr(item, attr, None), "routes", None)
        if inner is not None:
            yield from _flatten_routes(inner)


def forbidden_in_routes(routes: Iterable[Any]) -> list[tuple[str, str]]:
    bad: list[tuple[str, str]] = []
    for r in _flatten_routes(routes):
        bad += [(r.path, n) for n in _param_names(r.dependant) if is_forbidden_name(n)]
        bad += [(r.path, n) for n in re.findall(r"\{([^}:]+)", r.path) if is_forbidden_name(n)]
    return bad


def _route_module_models() -> list[type[BaseModel]]:
    # 본문을 직접 파싱하는 라우트(graphs)는 dependant에 모델이 안 보이므로 app.routes 모듈의 모델도 펼친다.
    models: list[type[BaseModel]] = []
    for info in pkgutil.iter_modules(app_routes.__path__):
        mod = importlib.import_module(f"{app_routes.__name__}.{info.name}")
        models += [
            v
            for v in vars(mod).values()
            if isinstance(v, type) and issubclass(v, BaseModel) and v is not BaseModel and v.__module__ == mod.__name__
        ]
    return models


def test_no_route_declares_org_or_collection_param(settings: Settings) -> None:
    app = create_app(settings)
    paths = {r.path for r in _flatten_routes(app.routes)}
    assert paths >= {"/graphs/{graph_name}/runs", "/graphs/runs/{graph_run_id}"}
    assert forbidden_in_routes(app.routes) == []


def test_route_module_models_have_no_org_or_collection_field() -> None:
    models = _route_module_models()
    assert GraphRunRequest in models
    bad = [(m.__name__, n) for m in models for n in model_field_names(m) if is_forbidden_name(n)]
    assert bad == []
    assert set(GraphRunRequest.model_fields) == {"run_id"}
    assert GraphRunRequest.model_config.get("extra") == "forbid"


# 자기 테스트: 회피 사례(본문 모델 org_id·orgId·중첩 모델·alias X-Org-Id·헤더 alias)를 실제로 잡는가.
class _BadSnake(BaseModel):
    org_id: str


class _BadCamel(BaseModel):
    orgId: str


class _BadAlias(BaseModel):
    value: str = Field(alias="X-Org-Id")


class _BadNested(BaseModel):
    items: list[_BadSnake] | None = None


class _Clean(BaseModel):
    run_id: str
    organizer: str  # org 접두어지만 금지 이름이 아니다


@pytest.mark.parametrize(
    "name", ["org", "org_id", "orgId", "X-Org-Id", "x_org", "organizationIds", "collection_id", "tenantId", "orgs"]
)
def test_self_forbidden_name_variants(name: str) -> None:
    assert is_forbidden_name(name)


@pytest.mark.parametrize("name", ["run_id", "organizer", "graph_name", "collected_at", "x_request_id"])
def test_self_allowed_names(name: str) -> None:
    assert not is_forbidden_name(name)


@pytest.mark.parametrize("model", [_BadSnake, _BadCamel, _BadAlias, _BadNested])
def test_self_model_evasions_detected(model: type[BaseModel]) -> None:
    assert any(is_forbidden_name(n) for n in model_field_names(model))
    assert not any(is_forbidden_name(n) for n in model_field_names(_Clean))


def test_self_route_evasions_detected() -> None:
    probe = FastAPI()
    router = APIRouter()

    @router.post("/a")
    def body_route(body: _BadNested) -> None: ...

    @router.post("/b")
    def header_route(x: Annotated[str, Header(alias="X-Org-Id")]) -> None: ...

    @router.get("/c/{orgId}")
    def path_route(orgId: str) -> None: ...

    probe.include_router(router)
    found = {p for p, _ in forbidden_in_routes(probe.routes)}
    assert found == {"/a", "/b", "/c/{orgId}"}


def test_app_code_reads_no_request_org_or_collection() -> None:
    # 보조 장치(문자열 스캔): 요청 쿼리·쿠키·경로·헤더 첨자·JSON 본문을 직접 읽는 코드를 잡는다.
    # 정본 검사는 위 라우트·모델 스캔이다(문자열 스캔은 우회 가능).
    pattern = re.compile(
        r"\.(query_params|cookies|path_params)\b|headers\[|\.json\(\)|\.url\.query"
        r"|headers\.get\(\s*['\"][^'\"]*(org|collection|tenant)[^'\"]*['\"]",
        re.I,
    )
    hits = [
        f"{p.relative_to(API_ROOT)}:{i}"
        for p in sorted((API_ROOT / "app").rglob("*.py"))
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
        if pattern.search(line)
    ]
    assert hits == []
