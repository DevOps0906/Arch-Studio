"""AR-06-051: arch.review 그래프·compliance·실행 계약(가짜 LLM, 결정적)."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.ai.compliance.arch import severity_of
from app.ai.graphs.arch_review import ArchReviewRunner, ReviewDeps, ReviewError, run_review
from app.ai.products.arch.ingest.pipeline import ingest
from app.ai.products.arch.knowledge.embedding import HashEmbedder
from app.ai.products.arch.knowledge.example_corpus import EXAMPLE_DOCS
from app.ai.products.arch.knowledge.store import InMemoryStore
from app.ai.products.arch.schema import (
    ReviewLlmItem,
    ReviewLlmOutput,
    ReviewLlmRewrite,
    ReviewLlmSentence,
    ReviewRunInput,
)
from app.main import create_app
from app.runs import MemoryRunStore
from app.settings import Settings
from tests.conftest import ORG_A, ORG_B, RUN_A

COLS = {"law": "col-law", "district_plan": "col-dp", "reply": "col-rp"}
DATE = "2025-01-01"
Auth = Callable[..., dict[str, str]]
Handler = Callable[[str, type[BaseModel]], BaseModel]


class FakeLLM:
    """결정적 가짜. handler가 없으면 프롬프트의 chunk id 첫 개를 인용하고 {ref}만 쓴다."""

    def __init__(self, handler: Handler | None = None) -> None:
        self.handler = handler
        self.calls = 0
        self.timeouts: list[float | None] = []

    def generate(
        self, *, feature: str, org: str, prompt: str, output_model: type[Any], timeout_s: float | None = None
    ) -> Any:
        self.timeouts.append(timeout_s)
        self.calls += 1
        if self.handler is not None:
            return self.handler(prompt, output_model)
        return default_output(prompt)


def default_output(prompt: str) -> ReviewLlmOutput:
    items: list[ReviewLlmItem] = []
    for block in prompt.split("## item ")[1:]:
        key = re.search(r'key="(\w+)"', block)
        ids = re.findall(r'<chunk id="([^"]+)"', block)
        assert key is not None
        sent = ReviewLlmSentence(
            text=f"{{ref:{key.group(1)}.value}}이(가) 한도 {{ref:{key.group(1)}.limit}}와 비교됩니다.",
            source_ids=ids[:1],
        )
        items.append(ReviewLlmItem(key=key.group(1), sentences=[sent], needs_check=[]))
    return ReviewLlmOutput(items=items)


def judgment(application_date: str = DATE, **overrides: Any) -> dict[str, Any]:
    cov = {
        "key": "coverage",
        "verdict": "FAIL",
        "value": 65.0,
        "limit": 60.0,
        "unit": "pct",
        "basis": [{"law": "가상건축법", "article": "건폐율", "effective_from": "2024-07-01", "ordinance": False}],
    }
    far = {**cov, "key": "far", "verdict": "PASS", "value": 100.0, "limit": 200.0}  # 여유 충분: 선택 안 됨
    base = {
        "engine_version": "1.0.0",
        "rule_pack_version": "2025.1",
        "application_date": application_date,
        "items": [cov, far],
        "pending_changes": 0,
    }
    base.update(overrides)
    return base


def body(attempt: int = 1, **overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {"run_id": RUN_A, "attempt": attempt, "application_date": DATE, "judgment": judgment()}
    b.update(overrides)
    return b


@pytest.fixture
def kb() -> InMemoryStore:
    s = InMemoryStore()
    ingest(EXAMPLE_DOCS, store=s, embedder=HashEmbedder(), org_id=ORG_A, collections=COLS)
    return s


def make_client(
    settings: Settings, kb: InMemoryStore, llm: FakeLLM, clock: Callable[[], float] | None = None
) -> TestClient:
    runs = MemoryRunStore()
    deps = (
        ReviewDeps(llm=llm, store=kb, embedder=HashEmbedder())
        if clock is None
        else ReviewDeps(llm=llm, store=kb, embedder=HashEmbedder(), clock=clock)
    )
    return TestClient(create_app(settings, runs=runs, runner=ArchReviewRunner(runs=runs, deps=deps, inline=True)))


def post(client: TestClient, auth: Auth, payload: dict[str, Any], **claims: Any) -> Any:
    claims.setdefault("scope", "graph:arch.review")
    return client.post("/graphs/arch.review/runs", json=payload, headers=auth(**claims))


def get(client: TestClient, auth: Auth, gid: str, **claims: Any) -> Any:
    return client.get(f"/graphs/runs/{gid}", headers=auth(**claims))


def run_and_get(client: TestClient, auth: Auth, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    job = str(uuid.uuid4())
    res = post(client, auth, payload or body(), sub=f"job:{job}")
    assert res.status_code == 202, res.text
    got = get(client, auth, res.json()["data"]["graph_run_id"], sub=f"job:{job}", scope="graph:arch.review")
    assert got.status_code == 200
    data: dict[str, Any] = got.json()["data"]
    return data


def test_success_contract(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    llm = FakeLLM()
    data = run_and_get(make_client(settings, kb, llm), auth)
    assert data["status"] == "succeeded" and data["attempt"] == 1 and "error" not in data
    review = data["result"]["review"]
    assert review["schema_version"] == "review.v1" and review["rule_pack_version"] == "2025.1"
    (item,) = review["items"]  # FAIL 하나만 선택
    assert item["key"] == "coverage" and item["verdict"] == "FAIL"
    assert item["engine_value"] == {"value": 65.0, "limit": 60.0, "unit": "pct"}
    (sentence,) = item["sentences"]
    assert sentence["text"] == "65이(가) 한도 60와 비교됩니다."
    source_ids = {s["id"] for s in review["sources"]}
    assert sentence["source_ids"] and set(sentence["source_ids"]) <= source_ids
    assert data["result"]["refs"] == {"coverage.limit": 60.0, "coverage.value": 65.0}


def test_nothing_to_review_succeeds_without_llm(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    llm = FakeLLM()
    j = judgment()
    j["items"] = [j["items"][1]]
    data = run_and_get(make_client(settings, kb, llm), auth, body(judgment=j))
    assert data["status"] == "succeeded" and data["result"]["review"]["items"] == []
    assert llm.calls == 0


def test_cite_check_drops_invented_ids(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        real = re.findall(r'<chunk id="([^"]+)"', prompt)[0]
        return ReviewLlmOutput(
            items=[
                ReviewLlmItem(
                    key="coverage",
                    sentences=[
                        ReviewLlmSentence(text="지어낸 출처만 있는 문장", source_ids=["fake#0"]),
                        ReviewLlmSentence(text="진짜 출처가 섞인 문장", source_ids=["fake#1", real]),
                    ],
                    needs_check=[],
                )
            ]
        )

    data = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)
    (sentence,) = data["result"]["review"]["items"][0]["sentences"]
    assert sentence["text"] == "진짜 출처가 섞인 문장"
    assert all(not sid.startswith("fake") for sid in sentence["source_ids"])


def test_ar033_when_no_valid_source(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        s = ReviewLlmSentence(text="출처 없음", source_ids=["nope#0"])
        return ReviewLlmOutput(items=[ReviewLlmItem(key="coverage", sentences=[s], needs_check=[])])

    data = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)
    assert data["status"] == "failed" and "result" not in data
    assert data["error"]["code"] == "AR033" and data["error"]["retryable"] is False


def test_other_org_corpus_not_visible_ar033(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    # 코퍼스는 ORG_A에만 있다. ORG_B 토큰은 청크를 못 찾아 인용할 id가 없다.
    data = run_and_get_org(make_client(settings, kb, FakeLLM()), auth, ORG_B)
    assert data["error"]["code"] == "AR033"


def run_and_get_org(client: TestClient, auth: Auth, org: str) -> dict[str, Any]:
    job = str(uuid.uuid4())
    res = post(client, auth, body(), sub=f"job:{job}", org=org)
    assert res.status_code == 202
    got = get(client, auth, res.json()["data"]["graph_run_id"], sub=f"job:{job}", org=org, scope="graph:arch.review")
    data: dict[str, Any] = got.json()["data"]
    return data


def test_invented_number_rewritten_once_then_dropped(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="여전히 77로 쓴 문장")
        cid = re.findall(r'<chunk id="([^"]+)"', prompt)[0]
        return ReviewLlmOutput(
            items=[
                ReviewLlmItem(
                    key="coverage",
                    sentences=[
                        ReviewLlmSentence(text="건폐율은 99입니다", source_ids=[cid]),
                        ReviewLlmSentence(text="{ref:coverage.value} 입니다", source_ids=[cid]),
                    ],
                    needs_check=[],
                )
            ]
        )

    llm = FakeLLM(handler)
    data = run_and_get(make_client(settings, kb, llm), auth)
    (sentence,) = data["result"]["review"]["items"][0]["sentences"]
    assert sentence["text"] == "65 입니다"
    assert llm.calls == 2  # interpret 1 + 재작성 1회


def test_invented_number_fixed_by_rewrite(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="건폐율은 {ref:coverage.value}입니다")
        cid = re.findall(r'<chunk id="([^"]+)"', prompt)[0]
        s = ReviewLlmSentence(text="건폐율은 99입니다", source_ids=[cid])
        return ReviewLlmOutput(items=[ReviewLlmItem(key="coverage", sentences=[s], needs_check=[])])

    data = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)
    assert data["result"]["review"]["items"][0]["sentences"][0]["text"] == "건폐율은 65입니다"


def test_compliance_blocks_and_warns(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        cid = re.findall(r'<chunk id="([^"]+)"', prompt)[0]
        ss = [
            ReviewLlmSentence(text="이 계획은 허가 가능합니다", source_ids=[cid]),
            ReviewLlmSentence(text="큰 문제없습니다", source_ids=[cid]),
            ReviewLlmSentence(text="한도를 초과합니다", source_ids=[cid]),
        ]
        return ReviewLlmOutput(items=[ReviewLlmItem(key="coverage", sentences=ss, needs_check=[])])

    review = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)["result"]["review"]
    assert [s["text"] for s in review["items"][0]["sentences"]] == ["한도를 초과합니다"]
    assert [n["text"] for n in review["needs_check"]] == ["큰 문제없습니다"]


def test_compliance_all_blocked_is_ar033(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        cid = re.findall(r'<chunk id="([^"]+)"', prompt)[0]
        s = ReviewLlmSentence(text="인허가를 보장합니다", source_ids=[cid])
        return ReviewLlmOutput(items=[ReviewLlmItem(key="coverage", sentences=[s], needs_check=[])])

    data = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)
    assert data["error"] == {"code": "AR033", "retryable": False, "stage": "compliance"}


def test_provider_error_retryable_no_message_leak(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        raise RuntimeError("secret-key-sk-123")

    data = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)
    assert data["error"] == {"code": "PROVIDER", "retryable": True, "stage": "interpret"}
    assert "secret" not in str(data)


def test_timeout_is_retryable_provider(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    ticks = iter(range(0, 10_000, 100))  # 호출마다 100초 전진
    client = make_client(settings, kb, FakeLLM(), clock=lambda: float(next(ticks)))
    data = run_and_get(client, auth, body(timeout_s=150))
    assert data["error"]["code"] == "PROVIDER" and data["error"]["retryable"] is True


def test_invalid_input_date_mismatch(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    data = run_and_get(make_client(settings, kb, FakeLLM()), auth, body(application_date="2025-02-01"))
    assert data["error"] == {"code": "INVALID_INPUT", "retryable": False, "stage": "load"}


def test_attempt_is_new_run_same_attempt_is_idempotent(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    llm = FakeLLM()
    client = make_client(settings, kb, llm)
    job = str(uuid.uuid4())
    a1 = post(client, auth, body(1), sub=f"job:{job}").json()["data"]
    again = post(client, auth, body(1), sub=f"job:{job}").json()["data"]
    a2 = post(client, auth, body(2), sub=f"job:{job}").json()["data"]
    assert again["graph_run_id"] == a1["graph_run_id"] and a2["graph_run_id"] != a1["graph_run_id"]
    assert a2["attempt"] == 2 and llm.calls == 2  # 재시도는 처음부터 새 실행
    other = post(client, auth, body(2), sub=f"job:{uuid.uuid4()}")
    assert other.status_code == 409


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.pop("attempt"),
        lambda b: b.update(org=ORG_A),
        lambda b: b.update(attempt=0),
        lambda b: b.update(application_date="2025/01/01"),
        lambda b: b.pop("judgment"),
        lambda b: b["judgment"].update(extra=1),
    ],
)
def test_body_validation_422(
    settings: Settings, kb: InMemoryStore, auth: Auth, mutate: Callable[[dict[str, Any]], Any]
) -> None:
    b = body()
    mutate(b)
    res = post(make_client(settings, kb, FakeLLM()), auth, b)
    assert res.status_code == 422


def test_get_other_org_404(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    client = make_client(settings, kb, FakeLLM())
    job = str(uuid.uuid4())
    gid = post(client, auth, body(), sub=f"job:{job}").json()["data"]["graph_run_id"]
    assert get(client, auth, gid, sub=f"job:{job}", org=ORG_B).status_code == 404


def test_run_review_pure(kb: InMemoryStore) -> None:
    inp = ReviewRunInput.model_validate(body())
    deps = ReviewDeps(llm=FakeLLM(), store=kb, embedder=HashEmbedder())
    assert run_review(deps, org=ORG_A, inp=inp).refs["coverage.value"] == 65.0
    with pytest.raises(ReviewError):
        run_review(deps, org=ORG_B, inp=inp)


def test_compliance_rules() -> None:
    assert severity_of("허가 가능합니다") == "FAIL"
    assert severity_of("문제없습니다") == "WARN"
    assert severity_of("건폐율이 한도를 초과합니다") is None


def _out_with(prompt: str, sentences: list[tuple[str, bool]], needs: list[tuple[str, bool]] | None = None) -> BaseModel:
    cid = re.findall(r'<chunk id="([^"]+)"', prompt)[0]

    def mk(t: str, ok: bool) -> ReviewLlmSentence:
        return ReviewLlmSentence(text=t, source_ids=[cid] if ok else [])

    return ReviewLlmOutput(
        items=[
            ReviewLlmItem(
                key="coverage",
                sentences=[mk(t, ok) for t, ok in sentences],
                needs_check=[mk(t, ok) for t, ok in (needs or [])],
            )
        ]
    )


def test_bare_numbers_never_allowed_even_if_equal_to_engine_or_article(
    settings: Settings, kb: InMemoryStore, auth: Auth
) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="제61조에 따라 60입니다")  # 재작성도 맨숫자
        return _out_with(
            prompt,
            [
                ("제61조에 따라 건폐율 61%입니다", True),  # 조문 번호 → 값 우회
                ("건폐율 65%, 한도 60%입니다", True),  # 엔진 값과 같은 맨숫자
                ("{ref:coverage.value}입니다", True),
            ],
        )

    llm = FakeLLM(handler)
    data = run_and_get(make_client(settings, kb, llm), auth)
    (sentence,) = data["result"]["review"]["items"][0]["sentences"]
    assert sentence["text"] == "65입니다"
    assert llm.calls == 3  # interpret 1 + 맨숫자 문장 2개 각 1회 재작성


def test_needs_check_requires_source(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        return _out_with(
            prompt,
            [("{ref:coverage.value}입니다", True)],
            [("출처 없는 확인 사항", False), ("출처 있는 확인 사항", True)],
        )

    data = run_and_get(make_client(settings, kb, FakeLLM(handler)), auth)
    texts = [n["text"] for n in data["result"]["review"]["needs_check"]]
    assert texts == ["출처 있는 확인 사항"]
    assert all(n["source_ids"] for n in data["result"]["review"]["needs_check"])


def test_llm_calls_get_remaining_time_timeout(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="{ref:coverage.value}입니다")
        return _out_with(prompt, [("건폐율 99입니다", True)])

    llm = FakeLLM(handler)
    run_and_get(make_client(settings, kb, llm), auth, body(timeout_s=120))
    assert len(llm.timeouts) == 2
    assert all(t is not None and 0 < t <= 120 for t in llm.timeouts)


def test_resolve_refs_checks_deadline_before_rewrite(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    now = [0.0]

    def handler(prompt: str, model: type[BaseModel]) -> BaseModel:
        now[0] = 1000.0  # interpret 직후 시간 초과
        return _out_with(prompt, [("건폐율 99입니다", True)])

    llm = FakeLLM(handler)
    data = run_and_get(make_client(settings, kb, llm, clock=lambda: now[0]), auth, body(timeout_s=150))
    assert data["error"]["code"] == "PROVIDER" and data["error"]["retryable"] is True
    assert llm.calls == 1  # 재작성 호출 없음
