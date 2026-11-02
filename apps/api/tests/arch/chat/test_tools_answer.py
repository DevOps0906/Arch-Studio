"""`/tools/answer`·`/tools/answer-direct`(AR-06-054): 출처 1개 이상 또는 "근거를 찾지 못했습니다", 내부 키·대화 매핑,
서명 토큰 scope `chat`·conv 바인딩·jti 1회, 미설정·제공자 장애 503.
색인은 050 예시 코퍼스(allow_examples=True, 테스트 전용)."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator, Sequence
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.products.arch.ingest import ingest, load_corpus
from app.ai.products.arch.knowledge import KnowledgeIndex
from app.ai.products.arch.knowledge.evaluation import HashingEmbedder
from app.ai.tools.arch import NO_SOURCE_ANSWER, ChatTools, GeneratedAnswer, SourceSnippet
from app.main import create_app
from app.settings import ConfigError, Settings, load_settings
from tests.conftest import ORG_A, Issuer

CORPUS = Path(__file__).resolve().parents[1] / "rag" / "fixtures" / "corpus"
KEY = "k" * 40
CONV = "44444444-4444-4444-8444-444444444444"
DIFY_USER = "du_abcdefghijklmnop"
TODAY = date(2026, 11, 2)


class EmptyRetriever:
    def search(self, query: str, *, application_date: date, k: int = 5, jurisdiction: str | None = None) -> list[Any]:
        return []


class FakeGenerator:
    def __init__(self, cite: str = "first", fail: bool = False) -> None:
        self.cite = cite
        self.fail = fail
        self.calls: list[dict[str, Any]] = []

    def generate(self, *, feature: str, org: str, query: str, sources: Sequence[SourceSnippet]) -> GeneratedAnswer:
        self.calls.append({"feature": feature, "org": org, "query": query, "sources": list(sources)})
        if self.fail:
            raise RuntimeError("provider down sk-secret")
        if self.cite == "none":
            ids: tuple[str, ...] = ()
        elif self.cite == "fake":
            ids = ("made-up@2020-01-01#0",)
        else:
            ids = (sources[0].id, sources[0].id, "made-up@2020-01-01#0")
        return GeneratedAnswer("일반 해설입니다. 개별 사안 적법성은 단정하지 않습니다.", ids, "fake-model", 10, 20)


class FakeConversations:
    def __init__(self) -> None:
        self.rows = {(CONV, DIFY_USER): ORG_A}

    def org_for(self, platform_conversation_id: str, dify_user: str) -> str | None:
        return self.rows.get((platform_conversation_id, dify_user))


@pytest.fixture(scope="module")
def index() -> KnowledgeIndex:
    idx = KnowledgeIndex(HashingEmbedder(), allow_examples=True)
    idx.add(ingest(load_corpus(CORPUS), allow_examples=True))
    return idx


@pytest.fixture
def make_client(settings: Settings) -> Iterator[Callable[[ChatTools], TestClient]]:
    clients: list[TestClient] = []

    def make(tools: ChatTools) -> TestClient:
        app = create_app(settings)
        app.state.arch_chat = tools
        c = TestClient(app, raise_server_exceptions=False)
        clients.append(c)
        return c

    yield make
    for c in clients:
        c.close()


def _tools(index: Any, gen: Any, key: str | None = KEY) -> ChatTools:
    return ChatTools(
        retriever=index, generator=gen, conversations=FakeConversations(), internal_key=key, today=lambda: TODAY
    )


def _body(**over: Any) -> dict[str, Any]:
    return {"platform_conversation_id": CONV, "dify_user": DIFY_USER, "query": "건폐율 상한은 어떻게 정하나요", **over}


def test_answer_has_at_least_one_citation_from_index(index: KnowledgeIndex, make_client: Any) -> None:
    gen = FakeGenerator()
    r = make_client(_tools(index, gen)).post("/tools/answer", json=_body(), headers={"X-Internal-Key": KEY})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["no_source"] is False
    # 중복·지어낸 id는 버리고 검색 결과의 청크 하나만 출처로 남는다.
    assert len(data["citations"]) == 1
    c = data["citations"][0]
    assert set(c) == {"law", "article", "effective_from", "source_id"}
    assert c["source_id"] and c["effective_from"]
    assert data["usage"] == {"model": "fake-model", "input_tokens": 10, "output_tokens": 20}
    # LLM 입력: feature arch.chat, org는 라우팅용, 근거 조각과 질문만.
    call = gen.calls[0]
    assert call["feature"] == "arch.chat" and call["org"] == ORG_A
    assert all(isinstance(s, SourceSnippet) for s in call["sources"])


@pytest.mark.parametrize("cite", ["none", "fake"])
def test_answer_without_valid_citation_becomes_no_source(index: KnowledgeIndex, make_client: Any, cite: str) -> None:
    r = make_client(_tools(index, FakeGenerator(cite))).post(
        "/tools/answer", json=_body(), headers={"X-Internal-Key": KEY}
    )
    data = r.json()["data"]
    assert data["no_source"] is True and data["citations"] == []
    assert data["answer"] == NO_SOURCE_ANSWER == "근거를 찾지 못했습니다"


def test_empty_retrieval_skips_llm(make_client: Any) -> None:
    gen = FakeGenerator()
    r = make_client(_tools(EmptyRetriever(), gen)).post("/tools/answer", json=_body(), headers={"X-Internal-Key": KEY})
    data = r.json()["data"]
    assert data["no_source"] is True and data["answer"] == NO_SOURCE_ANSWER
    assert gen.calls == []
    assert data["usage"] == {"model": None, "input_tokens": 0, "output_tokens": 0}


def test_internal_key_required(index: KnowledgeIndex, make_client: Any) -> None:
    c = make_client(_tools(index, FakeGenerator()))
    assert c.post("/tools/answer", json=_body()).status_code == 401
    assert c.post("/tools/answer", json=_body(), headers={"X-Internal-Key": KEY + "x"}).status_code == 401
    # 미설정이면 실패 닫힘(503), 키 비교 전에.
    c2 = make_client(_tools(index, FakeGenerator(), key=None))
    r = c2.post("/tools/answer", json=_body(), headers={"X-Internal-Key": KEY})
    assert r.status_code == 503 and r.json()["error"]["code"] == "AI_UNAVAILABLE"


def test_answer_rejects_org_or_token_in_body(index: KnowledgeIndex, make_client: Any) -> None:
    c = make_client(_tools(index, FakeGenerator()))
    for extra in ({"org_id": ORG_A}, {"token": "x"}):
        r = c.post("/tools/answer", json=_body(**extra), headers={"X-Internal-Key": KEY})
        assert r.status_code == 422


def test_answer_conversation_mapping_mismatch_is_404(index: KnowledgeIndex, make_client: Any) -> None:
    c = make_client(_tools(index, FakeGenerator()))
    r = c.post("/tools/answer", json=_body(dify_user="du_someoneelse00"), headers={"X-Internal-Key": KEY})
    assert r.status_code == 404
    r = c.post("/tools/answer", json=_body(platform_conversation_id=str(uuid.uuid4())), headers={"X-Internal-Key": KEY})
    assert r.status_code == 404


def test_provider_failure_is_503_without_detail(
    index: KnowledgeIndex, make_client: Any, caplog: pytest.LogCaptureFixture
) -> None:
    r = make_client(_tools(index, FakeGenerator(fail=True))).post(
        "/tools/answer", json=_body(), headers={"X-Internal-Key": KEY}
    )
    assert r.status_code == 503 and "sk-secret" not in r.text
    assert "sk-secret" not in caplog.text and "건폐율" not in caplog.text


def test_unwired_defaults_fail_closed(settings: Settings, dify_internal_key: str) -> None:
    # create_app은 설정의 내부 키만 넣는다. 대화 매핑·색인·생성기는 미배선 → 키가 맞아도 503.
    with TestClient(create_app(settings), raise_server_exceptions=False) as c:
        assert c.post("/tools/answer", json=_body(), headers={"X-Internal-Key": KEY}).status_code == 401
        r = c.post("/tools/answer", json=_body(), headers={"X-Internal-Key": dify_internal_key})
        assert r.status_code == 503


@pytest.mark.parametrize("value", [None, "", "short-key"])
def test_settings_require_internal_key(monkeypatch: pytest.MonkeyPatch, jwks_json: str, value: str | None) -> None:
    monkeypatch.delenv("AI_TOKEN_JWKS_URL", raising=False)
    monkeypatch.setenv("AI_TOKEN_JWKS", jwks_json)
    if value is None:
        monkeypatch.delenv("DIFY_INTERNAL_API_KEY", raising=False)
    else:
        monkeypatch.setenv("DIFY_INTERNAL_API_KEY", value)
    with pytest.raises(ConfigError) as exc:
        load_settings()
    assert "short-key" not in str(exc.value)


def test_settings_internal_key_not_in_repr(settings: Settings, dify_internal_key: str) -> None:
    assert dify_internal_key not in repr(settings)


# ---- /tools/answer-direct ----


def _user(issuer: Issuer, **over: Any) -> dict[str, str]:
    claims: dict[str, Any] = {
        "sub": str(uuid.uuid4()),
        "scope": "chat",
        "feat": "arch.chat",
        "conv": CONV,
        **over,
    }
    return {"Authorization": f"Bearer {issuer.token(**claims)}"}


def _direct(**over: Any) -> dict[str, Any]:
    return {"platform_conversation_id": CONV, "query": "건폐율 상한은 어떻게 정하나요", **over}


def test_direct_answers_with_citation(index: KnowledgeIndex, make_client: Any, issuer: Issuer) -> None:
    gen = FakeGenerator()
    r = make_client(_tools(index, gen)).post("/tools/answer-direct", json=_direct(), headers=_user(issuer))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["no_source"] is False and len(data["citations"]) >= 1
    assert gen.calls[0]["org"] == ORG_A


def test_direct_requires_chat_scope_user_token_and_conv(
    index: KnowledgeIndex, make_client: Any, issuer: Issuer
) -> None:
    c = make_client(_tools(index, FakeGenerator()))
    assert c.post("/tools/answer-direct", json=_direct()).status_code == 401
    assert c.post("/tools/answer-direct", json=_direct(), headers=_user(issuer, scope="voice")).status_code == 403
    job = {"Authorization": f"Bearer {issuer.token(scope='chat', conv=CONV)}"}  # 잡 토큰(sub=job:)
    assert c.post("/tools/answer-direct", json=_direct(), headers=job).status_code == 403
    r = c.post("/tools/answer-direct", json=_direct(), headers=_user(issuer, conv=str(uuid.uuid4())))
    assert r.status_code == 403 and r.json()["error"]["code"] == "CONV_MISMATCH"
    assert c.post("/tools/answer-direct", json=_direct(), headers=_user(issuer, conv=None)).status_code == 403
    r = c.post("/tools/answer-direct", json=_direct(org_id=ORG_A), headers=_user(issuer))
    assert r.status_code == 422


def test_direct_token_is_single_use(index: KnowledgeIndex, make_client: Any, issuer: Issuer) -> None:
    c = make_client(_tools(index, FakeGenerator()))
    h = _user(issuer)
    assert c.post("/tools/answer-direct", json=_direct(), headers=h).status_code == 200
    assert c.post("/tools/answer-direct", json=_direct(), headers=h).status_code == 401


def test_direct_no_source(make_client: Any, issuer: Issuer) -> None:
    r = make_client(_tools(EmptyRetriever(), FakeGenerator())).post(
        "/tools/answer-direct", json=_direct(), headers=_user(issuer)
    )
    data = r.json()["data"]
    assert data["no_source"] is True and data["answer"] == "근거를 찾지 못했습니다"
