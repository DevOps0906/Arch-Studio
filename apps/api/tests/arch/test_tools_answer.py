"""AR-06-054: POST /tools/answer 계약(가짜 LLM, 인메모리 저장소)."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

import app.ai.tools.arch.answer as answer_mod
from app.ai.products.arch.ingest.pipeline import ingest
from app.ai.products.arch.knowledge.embedding import HashEmbedder
from app.ai.products.arch.knowledge.example_corpus import EXAMPLE_DOCS
from app.ai.products.arch.knowledge.store import InMemoryStore
from app.ai.products.arch.schema import ChatLlmOutput, ReviewLlmRewrite, ReviewLlmSentence
from app.ai.tools.arch.answer import ChatDeps
from app.main import create_app
from app.settings import Settings
from tests.conftest import ORG_A, ORG_B

COLS = {"law": "col-law", "district_plan": "col-dp", "reply": "col-rp"}
Auth = Callable[..., dict[str, str]]
Handler = Callable[[str, type[BaseModel]], BaseModel]
USER = "44444444-4444-4444-8444-444444444444"
CONV = "55555555-5555-4555-8555-555555555555"


class FakeLLM:
    def __init__(self, handler: Handler) -> None:
        self.handler = handler
        self.calls = 0
        self.timeouts: list[float | None] = []

    def generate(
        self, *, feature: str, org: str, prompt: str, output_model: Any, timeout_s: float | None = None
    ) -> Any:
        self.calls += 1
        self.timeouts.append(timeout_s)
        return self.handler(prompt, output_model)


def cov_id(prompt: str) -> str:
    """프롬프트 청크 중 '100분의 50'이 든 건폐율 청크 id."""
    m = re.search(r'<chunk id="([^"]+)">[^<]*100분의 50', prompt)
    assert m is not None
    return m.group(1)


@pytest.fixture
def kb() -> InMemoryStore:
    s = InMemoryStore()
    ingest(EXAMPLE_DOCS, store=s, embedder=HashEmbedder(), org_id=ORG_A, collections=COLS)
    return s


def make(settings: Settings, kb: InMemoryStore, handler: Handler) -> tuple[TestClient, FakeLLM]:
    llm = FakeLLM(handler)
    deps = ChatDeps(llm=llm, store=kb, embedder=HashEmbedder())
    return TestClient(create_app(settings, chat=deps)), llm


def body(**kw: Any) -> dict[str, Any]:
    b = {"request_id": str(uuid.uuid4()), "message": "일반주거지역 건폐율 한도", "application_date": "2025-01-01"}
    b.update(kw)
    return b


def post(client: TestClient, auth: Auth, payload: dict[str, Any], **claims: Any) -> Any:
    claims.setdefault("sub", USER)
    claims.setdefault("scope", "chat")
    claims.setdefault("req", payload.get("request_id"))
    claims.setdefault("conv", CONV)
    return client.post("/tools/answer", json=payload, headers=auth(**claims))


def sentences(*items: tuple[str, list[str]]) -> ChatLlmOutput:
    return ChatLlmOutput(sentences=[ReviewLlmSentence(text=t, source_ids=i) for t, i in items])


def test_success(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        return sentences(("건폐율은 100분의 50 이하입니다.", [cov_id(prompt)]))

    client, _ = make(settings, kb, h)
    res = post(client, auth, body())
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["no_source"] is False
    (s,) = data["answer"]["sentences"]
    assert s["source_ids"] == [data["sources"][0]["chunk_id"]]
    assert data["sources"][0]["effective_from"] == "2024-07-01"


def test_body_org_rejected(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    client, llm = make(settings, kb, lambda p, m: sentences())
    assert post(client, auth, body(org_id=ORG_B)).status_code == 422
    assert llm.calls == 0


@pytest.mark.parametrize("bad", [{"scope": "graph:arch.review"}, {"scope": "chat", "sub": f"job:{USER}"}])
def test_scope_mismatch_403(settings: Settings, kb: InMemoryStore, auth: Auth, bad: dict[str, Any]) -> None:
    client, llm = make(settings, kb, lambda p, m: sentences())
    assert post(client, auth, body(), **bad).status_code == 403
    assert llm.calls == 0


def test_no_token_401(settings: Settings, kb: InMemoryStore) -> None:
    client, _ = make(settings, kb, lambda p, m: sentences())
    assert client.post("/tools/answer", json=body()).status_code == 401


@pytest.mark.parametrize(
    "bad", [{"message": ""}, {"message": "가" * 2001}, {"request_id": "x"}, {"application_date": "2025-13-40"}]
)
def test_validation_422(settings: Settings, kb: InMemoryStore, auth: Auth, bad: dict[str, Any]) -> None:
    client, _ = make(settings, kb, lambda p, m: sentences())
    assert post(client, auth, body(**bad)).status_code == 422


def test_not_configured_503(settings: Settings, auth: Auth) -> None:
    client = TestClient(create_app(settings))
    assert post(client, auth, body()).status_code == 503


def test_other_org_no_source(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    client, llm = make(settings, kb, lambda p, m: sentences(("x", ["a"])))
    data = post(client, auth, body(), org=ORG_B).json()["data"]
    assert data == {"answer": {"sentences": []}, "sources": [], "no_source": True}
    assert llm.calls == 0


def test_invented_ids_removed_then_no_source(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    client, _ = make(settings, kb, lambda p, m: sentences(("지어낸 출처", ["fake#0"])))
    data = post(client, auth, body()).json()["data"]
    assert data["no_source"] is True and data["answer"]["sentences"] == [] and data["sources"] == []


def test_invented_id_stripped_keeps_real(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        return sentences(("건폐율 기준입니다.", ["fake#1", cov_id(prompt)]))

    client, _ = make(settings, kb, h)
    (s,) = post(client, auth, body()).json()["data"]["answer"]["sentences"]
    assert all(not i.startswith("fake") for i in s["source_ids"])


def test_number_outside_chunk_rewritten_once_then_removed(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="여전히 건폐율은 77입니다.")
        return sentences(
            ("건폐율은 77입니다.", [cov_id(prompt)]), ("건폐율은 100분의 50 이하입니다.", [cov_id(prompt)])
        )

    client, llm = make(settings, kb, h)
    data = post(client, auth, body()).json()["data"]
    assert [s["text"] for s in data["answer"]["sentences"]] == ["건폐율은 100분의 50 이하입니다."]
    assert llm.calls == 2  # 생성 1 + 재작성 1회


def test_number_rewrite_success(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="건폐율은 100분의 50 이하입니다.")
        return sentences(("건폐율은 77입니다.", [cov_id(prompt)]))

    client, _ = make(settings, kb, h)
    (s,) = post(client, auth, body()).json()["data"]["answer"]["sentences"]
    assert s["text"] == "건폐율은 100분의 50 이하입니다."


def test_assertion_blocked(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        c = cov_id(prompt)
        return sentences(("이 계획은 허가 가능합니다.", [c]), ("이 계획은 적법합니다.", [c]), ("문제 없습니다.", [c]))

    client, _ = make(settings, kb, h)
    data = post(client, auth, body()).json()["data"]
    assert data["no_source"] is True and data["answer"]["sentences"] == []


def test_llm_failure_502(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        raise RuntimeError("secret detail")

    client, _ = make(settings, kb, h)
    res = post(client, auth, body())
    assert res.status_code == 502 and "secret" not in res.text


@pytest.mark.parametrize(
    ("claims", "status"),
    [({"req": "99999999-9999-4999-8999-999999999999"}, 403), ({"req": 123}, 403), ({"conv": ""}, 401)],
)
def test_token_binding_rejected(
    settings: Settings, kb: InMemoryStore, auth: Auth, claims: dict[str, Any], status: int
) -> None:
    client, llm = make(settings, kb, lambda p, m: sentences())
    res = post(client, auth, body(), **claims)
    assert res.status_code == status
    if status == 403:
        assert res.json()["error"]["code"] == "TOKEN_BINDING"
    assert llm.calls == 0


def test_rewrites_capped(settings: Settings, kb: InMemoryStore, auth: Auth) -> None:
    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="여전히 77입니다.")
        c = cov_id(prompt)
        return sentences(*[(f"건폐율은 7{i}입니다.", [c]) for i in range(5)])

    client, llm = make(settings, kb, h)
    data = post(client, auth, body()).json()["data"]
    assert data["no_source"] is True
    assert llm.calls == 1 + answer_mod.MAX_REWRITES


def test_deadline_stops_llm_calls(kb: InMemoryStore) -> None:
    t = [0.0]

    def h(prompt: str, model: type[BaseModel]) -> BaseModel:
        t[0] += 49.5  # 생성 한 번에 49.5초 소모 -> 재작성 차례엔 남은 시간 < 1초
        if model is ReviewLlmRewrite:
            return ReviewLlmRewrite(text="건폐율은 100분의 50 이하입니다.")
        return sentences(("건폐율은 77입니다.", [cov_id(prompt)]))

    llm = FakeLLM(h)
    deps = ChatDeps(llm=llm, store=kb, embedder=HashEmbedder(), clock=lambda: t[0])
    res = answer_mod.answer(deps, org=ORG_A, message="일반주거지역 건폐율 한도", application_date=date(2025, 1, 1))
    assert res.no_source is True
    assert llm.calls == 1
    first = llm.timeouts[0]
    assert first is not None and first <= answer_mod.ANSWER_DEADLINE_S


def test_deadline_exceeded_before_generate(kb: InMemoryStore) -> None:
    t = iter([0.0, 100.0, 100.0])
    llm = FakeLLM(lambda p, m: sentences())
    deps = ChatDeps(llm=llm, store=kb, embedder=HashEmbedder(), clock=lambda: next(t))
    with pytest.raises(answer_mod.AnswerError):
        answer_mod.answer(deps, org=ORG_A, message="일반주거지역 건폐율 한도", application_date=date(2025, 1, 1))
    assert llm.calls == 0
