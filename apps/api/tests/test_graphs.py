"""그래프 경로: scope·재사용·조직 격리·본문 계약(공격 A3·A5·A7·A11)."""

from __future__ import annotations

import uuid
from collections.abc import Callable

import httpx
from fastapi.testclient import TestClient

from tests.conftest import ORG_A, ORG_B

RUN_ID = "33333333-3333-4333-8333-333333333333"
Auth = Callable[..., dict[str, str]]


def start(
    client: TestClient, auth: Auth, graph: str = "arch.review", body: object = None, **claims: object
) -> httpx.Response:
    claims.setdefault("scope", f"graph:{graph}")
    res: httpx.Response = client.post(f"/graphs/{graph}/runs", json=body or {"run_id": RUN_ID}, headers=auth(**claims))
    return res


def test_start_run_202(client: TestClient, auth: Auth) -> None:
    res = start(client, auth)
    assert res.status_code == 202
    data = res.json()["data"]
    assert data["status"] == "accepted" and data["graph"] == "arch.review" and data["run_id"] == RUN_ID


def test_scope_mismatch_403(client: TestClient, auth: Auth) -> None:
    res = start(client, auth, scope="graph:arch.intake")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "SCOPE_MISMATCH"


def test_scope_prefix_is_not_enough_403(client: TestClient, auth: Auth) -> None:
    assert start(client, auth, scope="graph:arch.review.extra").status_code == 403
    assert start(client, auth, scope="graph:").status_code == 403


def test_user_token_on_job_route_403(client: TestClient, auth: Auth) -> None:
    res = start(client, auth, sub=str(uuid.uuid4()))  # 사용자 서명 토큰(sub=<user id>)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "JOB_TOKEN_REQUIRED"


def test_jti_replay_401(client: TestClient, auth: Auth) -> None:
    headers = auth(scope="graph:arch.review")
    assert client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID}, headers=headers).status_code == 202
    again = client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID}, headers=headers)
    assert again.status_code == 401


def test_retry_with_new_token_resumes_same_run(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    first = start(client, auth, sub=f"job:{job}").json()["data"]
    second = start(client, auth, sub=f"job:{job}")
    assert second.status_code == 202
    assert second.json()["data"]["graph_run_id"] == first["graph_run_id"]


def test_same_run_different_job_409(client: TestClient, auth: Auth) -> None:
    assert start(client, auth).status_code == 202
    assert start(client, auth).status_code == 409


def test_unknown_graph_404(client: TestClient, auth: Auth) -> None:
    assert start(client, auth, graph="arch.unknown").status_code == 404


def test_phase2_layout_graph_disabled_404(client: TestClient, auth: Auth) -> None:
    assert start(client, auth, graph="arch.layout").status_code == 404


def test_other_product_graph_404(client: TestClient, auth: Auth) -> None:
    assert start(client, auth, graph="toon.review").status_code == 404


def test_body_org_id_rejected_422(client: TestClient, auth: Auth) -> None:
    res = start(client, auth, body={"run_id": RUN_ID, "org_id": ORG_B})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION"


def test_body_run_id_must_be_uuid_422(client: TestClient, auth: Auth) -> None:
    assert start(client, auth, body={"run_id": "1; drop table"}).status_code == 422
    assert start(client, auth, body={"run_id": 123}).status_code == 422


def test_invalid_body_does_not_burn_jti(client: TestClient, auth: Auth) -> None:
    headers = auth(scope="graph:arch.review")
    assert client.post("/graphs/arch.review/runs", json={"run_id": "x"}, headers=headers).status_code == 422
    assert client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID}, headers=headers).status_code == 202


def test_get_run_same_org(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    run = start(client, auth, sub=f"job:{job}").json()["data"]
    res = client.get(f"/graphs/runs/{run['graph_run_id']}", headers=auth(sub=f"job:{job}", scope="graph:arch.review"))
    assert res.status_code == 200
    assert res.json()["data"]["graph_run_id"] == run["graph_run_id"]


def test_get_run_does_not_consume_jti(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    run = start(client, auth, sub=f"job:{job}").json()["data"]
    headers = auth(sub=f"job:{job}", scope="graph:arch.review")
    for _ in range(2):
        assert client.get(f"/graphs/runs/{run['graph_run_id']}", headers=headers).status_code == 200


def test_other_org_run_404(client: TestClient, auth: Auth) -> None:
    run = start(client, auth, org=ORG_A).json()["data"]
    res = client.get(f"/graphs/runs/{run['graph_run_id']}", headers=auth(org=ORG_B, scope="graph:arch.review"))
    assert res.status_code == 404
    missing = client.get(f"/graphs/runs/{uuid.uuid4()}", headers=auth(org=ORG_B, scope="graph:arch.review"))
    assert res.json() == missing.json()  # 존재 여부를 응답으로 구분할 수 없다


def test_query_org_id_ignored(client: TestClient, auth: Auth) -> None:
    run = start(client, auth, org=ORG_A).json()["data"]
    res = client.get(
        f"/graphs/runs/{run['graph_run_id']}",
        params={"org_id": ORG_A, "org": ORG_A},
        headers=auth(org=ORG_B, scope="graph:arch.review"),
    )
    assert res.status_code == 404


def test_other_org_same_run_id_isolated(client: TestClient, auth: Auth) -> None:
    a = start(client, auth, org=ORG_A).json()["data"]
    b = start(client, auth, org=ORG_B)
    assert b.status_code == 202  # 다른 조직의 같은 run_id는 충돌(409)도 아니고 남의 실행 재개도 아니다
    assert b.json()["data"]["graph_run_id"] != a["graph_run_id"]


def test_get_run_scope_mismatch_403(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    run = start(client, auth, sub=f"job:{job}").json()["data"]
    res = client.get(f"/graphs/runs/{run['graph_run_id']}", headers=auth(sub=f"job:{job}", scope="graph:arch.intake"))
    assert res.status_code == 403


def test_intake_graph_scope(client: TestClient, auth: Auth) -> None:
    assert start(client, auth, graph="arch.intake", feat="arch.intake_consult").status_code == 202


# --- run·job 바인딩(AR-06-047, 046 보안 리뷰 후속) ---------------------------------


def test_run_claim_mismatch_403(client: TestClient, auth: Auth) -> None:
    other_run = str(uuid.uuid4())
    res = start(client, auth, run=other_run)  # 본문 run_id = RUN_ID, 토큰 run = 다른 실행
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "RUN_MISMATCH"


def test_run_mismatch_does_not_burn_jti(client: TestClient, auth: Auth) -> None:
    headers = auth(scope="graph:arch.review")  # run 클레임 = RUN_ID
    other = {"run_id": str(uuid.uuid4())}
    assert client.post("/graphs/arch.review/runs", json=other, headers=headers).status_code == 403
    assert client.post("/graphs/arch.review/runs", json={"run_id": RUN_ID}, headers=headers).status_code == 202


def test_run_binding_is_exact(client: TestClient, auth: Auth) -> None:
    # 대문자 표기는 정규 표기가 아니라 401(정확 일치 비교의 전제).
    res = start(client, auth, run="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")
    assert res.status_code == 401


def test_get_run_other_job_404(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    run = start(client, auth, sub=f"job:{job}").json()["data"]
    # 같은 조직·같은 scope라도 다른 잡의 토큰으로는 실행을 볼 수 없다(없는 실행과 같은 응답).
    res = client.get(f"/graphs/runs/{run['graph_run_id']}", headers=auth(scope="graph:arch.review"))
    missing = client.get(f"/graphs/runs/{uuid.uuid4()}", headers=auth(scope="graph:arch.review"))
    assert res.status_code == 404
    assert res.json() == missing.json()


def test_retry_resume_needs_same_job_and_run(client: TestClient, auth: Auth) -> None:
    job = str(uuid.uuid4())
    assert start(client, auth, sub=f"job:{job}").status_code == 202
    assert start(client, auth, sub=f"job:{job}", run=str(uuid.uuid4())).status_code == 403
