"""AR-06-050: 시행일 필터 경계, 평가셋 재현율, 위키 lint, 색인 멱등·격리."""

from __future__ import annotations

from datetime import date

import pytest

from app.ai.products.arch.ingest.pipeline import SourceDocument, ingest, split_text, to_chunks
from app.ai.products.arch.knowledge.embedding import EMBEDDING_DIM, HashEmbedder
from app.ai.products.arch.knowledge.example_corpus import D2, EXAMPLE_DOCS
from app.ai.products.arch.knowledge.search import in_effect, search_effective
from app.ai.products.arch.knowledge.store import Chunk, InMemoryStore
from app.ai.products.arch.wiki_config import (
    WikiConfig,
    WikiPage,
    lint_page,
    plan_ingest_pages,
    validate_page,
)
from tests.arch.rag.eval_set import EVAL_SET, WRONG_VERSION

ORG = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
COLS = {"law": "col-law", "district_plan": "col-dp", "reply": "col-rp"}
K = 3
EMB = HashEmbedder()


@pytest.fixture(scope="module")
def store() -> InMemoryStore:
    s = InMemoryStore()
    ingest(EXAMPLE_DOCS, store=s, embedder=EMB, org_id=ORG, collections=COLS)
    return s


def test_embedding_deterministic_and_1024() -> None:
    a, b = EMB.embed("건폐율 상한"), EMB.embed("건폐율 상한")
    assert a == b
    assert len(a) == EMBEDDING_DIM == 1024
    assert abs(sum(x * x for x in a) - 1.0) < 1e-9


def test_in_effect_boundaries() -> None:
    m = {"effective_from": "2024-07-01", "effective_to": "2025-07-01"}
    assert not in_effect(m, date(2024, 6, 30))
    assert in_effect(m, date(2024, 7, 1))  # from 포함
    assert in_effect(m, date(2025, 6, 30))
    assert not in_effect(m, date(2025, 7, 1))  # to 제외
    assert in_effect({"effective_from": "2024-07-01", "effective_to": None}, date(2999, 1, 1))  # 현행


def test_in_effect_fails_closed() -> None:
    assert not in_effect({}, date(2025, 1, 1))
    assert not in_effect({"effective_from": "not-a-date"}, date(2025, 1, 1))
    assert not in_effect({"effective_from": 20240701}, date(2025, 1, 1))


def test_revision_boundary_picks_right_version(store: InMemoryStore) -> None:
    q = "일반주거지역 건폐율 상한은 얼마인가"
    before = search_effective(store, EMB, org_id=ORG, query=q, application_date=date(2024, 6, 30), k=K).hits
    on = search_effective(store, EMB, org_id=ORG, query=q, application_date=D2, k=K).hits
    assert before[0].chunk.metadata["doc_id"] == "law-cov-v1"
    assert on[0].chunk.metadata["doc_id"] == "law-cov-v2"
    assert "law-cov-v2" not in [h.chunk.metadata["doc_id"] for h in before]
    assert "law-cov-v1" not in [h.chunk.metadata["doc_id"] for h in on]
    assert all(in_effect(h.chunk.metadata, D2) for h in on)


def test_filter_matters_unfiltered_returns_wrong_version(store: InMemoryStore) -> None:
    """대조: 필터 없이 DB 만 거치면 오답 버전이 상위에 섞인다(필터를 끄면 개정 문항 단언이 실패한다)."""
    leaked = 0
    for q, _d, want in EVAL_SET:
        wrong = WRONG_VERSION.get(want)
        if wrong:
            raw = store.search(ORG, EMB.embed(q), K)
            leaked += wrong in {h.chunk.metadata["doc_id"] for h in raw}
    assert leaked > 0


def test_org_and_collection_isolation(store: InMemoryStore) -> None:
    q = "건폐율"
    own = search_effective(store, EMB, org_id=ORG, query=q, application_date=D2, k=K)
    assert len(own.hits) > 0
    assert search_effective(store, EMB, org_id=OTHER, query=q, application_date=D2, k=K).hits == []
    hits = search_effective(store, EMB, org_id=ORG, query=q, application_date=D2, k=K, collection_id="col-rp").hits
    assert len(hits) > 0
    assert all(h.chunk.collection_id == "col-rp" for h in hits)


def _expired_chunks(n: int, query: str, org: str = ORG) -> list[Chunk]:
    return [
        Chunk(
            f"old{i}#0",
            org,
            "col-law",
            query,
            EMB.embed(query),
            {"doc_id": f"old{i}", "effective_from": "2000-01-01", "effective_to": "2010-01-01"},
        )
        for i in range(n)
    ]


def test_expired_versions_dominating_top_are_retried() -> None:
    q = "건폐율 상한 시험 문장"
    s = InMemoryStore()
    s.upsert(_expired_chunks(10, q))  # 질의와 동일 -> 유사도 1.0, 만료
    cur = Chunk(
        "cur#0",
        ORG,
        "col-law",
        q + " 현행 개정 추가 단어들",
        EMB.embed(q + " 현행 개정 추가 단어들"),
        {"doc_id": "cur", "effective_from": "2020-01-01", "effective_to": None},
    )
    s.upsert([cur])
    assert [h.chunk.id for h in s.search(ORG, EMB.embed(q), 4)] != ["cur#0"]  # 첫 조회(k*4=4)는 만료본뿐
    res = search_effective(s, EMB, org_id=ORG, query=q, application_date=date(2025, 1, 1), k=1)
    assert [h.chunk.id for h in res.hits] == ["cur#0"]
    assert not res.insufficient
    assert not res.truncated


def test_insufficient_and_truncated_flags() -> None:
    q = "건폐율 상한 시험 문장"
    s = InMemoryStore()
    s.upsert(_expired_chunks(60, q))
    res = search_effective(s, EMB, org_id=ORG, query=q, application_date=date(2025, 1, 1), k=1)
    assert res.hits == []
    assert res.insufficient
    assert res.truncated  # 50 상한에 막힘: 뒤에 현행본이 있을 수 있다
    s2 = InMemoryStore()
    s2.upsert(_expired_chunks(3, q))
    res2 = search_effective(s2, EMB, org_id=ORG, query=q, application_date=date(2025, 1, 1), k=1)
    assert res2.insufficient
    assert not res2.truncated  # 전부 보았다


def test_k_and_date_contract(store: InMemoryStore) -> None:
    from datetime import datetime

    for bad_k in (0, 51):
        with pytest.raises(ValueError, match="k"):
            search_effective(store, EMB, org_id=ORG, query="건폐율", application_date=D2, k=bad_k)
    with pytest.raises(TypeError):
        search_effective(store, EMB, org_id=ORG, query="건폐율", application_date=datetime(2025, 1, 1, 9), k=K)
    with pytest.raises(ValueError, match="22023"):
        store.search(ORG, EMB.embed("x"), 51)
    with pytest.raises(ValueError, match="22023"):
        store.search(ORG, EMB.embed("x"), 0)
    # oversample 이 커도 DB 에는 50 을 넘기지 않는다
    res = search_effective(store, EMB, org_id=ORG, query="건폐율", application_date=D2, k=40, oversample=100)
    assert len(res.hits) <= 40


def test_same_doc_id_in_other_org_not_overwritten() -> None:
    s = InMemoryStore()
    doc = EXAMPLE_DOCS[0]
    ingest([doc], store=s, embedder=EMB, org_id=ORG, collections=COLS)
    ingest([doc], store=s, embedder=EMB, org_id=OTHER, collections=COLS)
    assert len(s._chunks) == 2
    # 다른 컬렉션이면 같은 org·id 도 별개
    ingest(
        [doc], store=s, embedder=EMB, org_id=ORG, collections={"law": "col-other", "district_plan": "x", "reply": "y"}
    )
    assert len(s._chunks) == 3
    assert {k[0] for k in s._chunks} == {ORG, OTHER}


def test_reindex_shrunk_document_drops_stale_chunks() -> None:
    s = InMemoryStore()
    long_text = "\n\n".join(f"가상 문단 {i} " + "가나다라마바사 " * 40 for i in range(4))
    d1 = SourceDocument("big", "law", "제목", long_text, date(2020, 1, 1), None, True)
    n1 = ingest([d1], store=s, embedder=EMB, org_id=ORG, collections=COLS)
    assert n1 > 1
    d2 = SourceDocument("big", "law", "제목", "짧아진 본문", date(2020, 1, 1), None, True)
    assert ingest([d2], store=s, embedder=EMB, org_id=ORG, collections=COLS) == 1
    assert [k[2] for k in s._chunks] == ["big#0"]


def test_ingest_idempotent_and_synthetic_marked() -> None:
    s = InMemoryStore()
    n1 = ingest(EXAMPLE_DOCS, store=s, embedder=EMB, org_id=ORG, collections=COLS)
    n2 = ingest(EXAMPLE_DOCS, store=s, embedder=EMB, org_id=ORG, collections=COLS)
    assert n1 == n2
    assert len(s._chunks) == n1
    assert all(c.metadata["synthetic"] and "[가상 조문" in c.content for c in s._chunks.values())


def test_invalid_range_rejected() -> None:
    bad = SourceDocument("x", "law", "t", "본문", date(2025, 1, 1), date(2025, 1, 1), True)
    with pytest.raises(ValueError, match="시행 범위"):
        to_chunks(bad, org_id=ORG, collection_id="c", embedder=EMB)


def test_split_text_respects_limit() -> None:
    parts = split_text("가나다라마. " * 100, limit=60)
    assert len(parts) > 1
    assert all(len(p) <= 60 for p in parts)


def test_eval_set_size_and_recall(store: InMemoryStore) -> None:
    assert len(EVAL_SET) == 30
    hits = 0
    misses: list[str] = []
    for q, d, want in EVAL_SET:
        found = [
            h.chunk.metadata["doc_id"]
            for h in search_effective(store, EMB, org_id=ORG, query=q, application_date=d, k=K).hits
        ]
        wrong = WRONG_VERSION.get(want)
        if wrong:  # 개정 문항: 정답 버전 1위 + 오답 버전은 결과에 없음(재현율 평균에 묻지 않는다)
            assert found[:1] == [want], f"{q} @{d}: {found}"
            assert wrong not in found, f"{q} @{d}: {found}"
        if want in found:
            hits += 1
        else:
            misses.append(f"{q} @{d} -> {want}")
    recall = hits / len(EVAL_SET)
    assert recall >= 0.8, f"recall@{K}={recall:.2f} misses={misses}"


def test_wiki_lint_rejects_missing_source_and_date() -> None:
    today = date(2026, 11, 2)
    ok = WikiPage(slug="a", title="A", sources=["가상건축법 예시"], confirmed_on=date(2026, 10, 1))
    assert lint_page(ok, today=today) == []
    validate_page(ok, today=today)
    no_src = WikiPage(slug="b", title="B", sources=[" "], confirmed_on=date(2026, 10, 1))
    no_date = WikiPage(slug="c", title="C", sources=["x"])
    future = WikiPage(slug="d", title="D", sources=["x"], confirmed_on=date(2027, 1, 1))
    for page, code in ((no_src, "missing_source"), (no_date, "missing_confirmed_on"), (future, "future_confirmed_on")):
        assert code in lint_page(page, today=today)
        with pytest.raises(ValueError, match=code):
            validate_page(page, today=today)


def test_wiki_stale_warns_not_rejects() -> None:
    page = WikiPage(slug="e", title="E", sources=["x"], confirmed_on=date(2024, 1, 1))
    assert lint_page(page, today=date(2026, 11, 2)) == ["stale"]
    validate_page(page, today=date(2026, 11, 2))


def test_wiki_ingest_page_cap() -> None:
    pages = [WikiPage(slug=f"p{i}", title="t") for i in range(8)]
    now, later = plan_ingest_pages(pages)
    assert (len(now), len(later)) == (5, 3)
    assert WikiConfig().credit_cap("wiki.ingest") > 0
