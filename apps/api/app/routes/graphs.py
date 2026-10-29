"""그래프 실행 경로(04_API.md 6.3절). 호출자는 workers/arch-jobs(잡 토큰)뿐이다.

순서: 토큰 검증(401) → 그래프 존재·제품 일치(404) → 잡 토큰·scope(403) → 본문 strict 검증(422)
→ 토큰 `run` == 본문 run_id(403, AR-06-047) → jti 1회 소비(401)
→ 실행 생성·재개(202). 본문은 직접 읽어 인증보다 먼저 파싱되지 않게 한다.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.ai.interfaces import GraphRunner
from app.ai.products import ProductConfig
from app.auth.deps import consume_jti, require_job_binding, require_job_scope, require_run_binding, token_claims
from app.auth.tokens import TokenClaims
from app.errors import ApiError, ok, validation_details
from app.runs import GraphRun, RunConflict, RunStore

router = APIRouter()

_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


class GraphRunRequest(BaseModel):
    """payload에는 id만(02_ARCHITECTURE.md 4장). org_id 등 다른 키는 거부한다."""

    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)

    run_id: Annotated[str, Field(pattern=_UUID_PATTERN)]


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "찾을 수 없습니다")


def _run_view(run: GraphRun) -> dict[str, str]:
    return {"graph_run_id": run.id, "graph": run.graph, "run_id": run.run_id, "status": run.status}


def _product_for(request: Request, claims: TokenClaims) -> ProductConfig:
    products: dict[str, ProductConfig] = request.app.state.products
    product = products.get(claims.app)
    if product is None:
        raise _not_found()
    return product


@router.post("/graphs/{graph_name}/runs")
async def start_graph_run(
    graph_name: str, request: Request, claims: Annotated[TokenClaims, Depends(token_claims)]
) -> JSONResponse:
    product = _product_for(request, claims)
    # 그래프 이름의 제품 접두어와 토큰 app이 같아야 한다(다른 제품 토큰으로 남의 그래프 실행 차단).
    if not product.graphs.get(graph_name, False) or not graph_name.startswith(f"{claims.app}."):
        raise _not_found()
    job_id = require_job_scope(claims, f"graph:{graph_name}")

    try:
        body = GraphRunRequest.model_validate_json(await request.body())
    except ValidationError as exc:
        raise ApiError(422, "VALIDATION", "입력이 계약과 다릅니다", details=validation_details(exc.errors())) from None

    require_run_binding(claims, body.run_id)
    consume_jti(request, claims)

    store: RunStore = request.app.state.runs
    try:
        run, created = store.create_or_get(
            app=claims.app, org=claims.org, graph=graph_name, run_id=body.run_id, job_id=job_id
        )
    except RunConflict:
        raise ApiError(409, "RUN_CONFLICT", "이미 다른 잡이 처리 중인 실행입니다") from None
    if created:
        runner: GraphRunner = request.app.state.runner
        runner.start(run)
    return ok(_run_view(run), status=202)


@router.get("/graphs/runs/{graph_run_id}")
async def get_graph_run(
    graph_run_id: str, request: Request, claims: Annotated[TokenClaims, Depends(token_claims)]
) -> JSONResponse:
    store: RunStore = request.app.state.runs
    # 쿼리의 org_id 등은 읽지 않는다. 다른 조직 실행은 존재 여부도 숨긴다(404).
    run = store.get(app=claims.app, org=claims.org, graph_run_id=graph_run_id)
    if run is None:
        raise _not_found()
    require_job_binding(claims, run.job_id)
    require_job_scope(claims, f"graph:{run.graph}")
    return ok(_run_view(run))
