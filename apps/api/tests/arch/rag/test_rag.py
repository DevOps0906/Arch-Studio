"""AR-06-050: 시행일 필터 경계, 평가셋 재현율, 위키 lint, 색인 멱등·격리."""

from __future__ import annotations

from datetime import date

import pytest

from app.ai.products.arch.ingest.pipeline import SourceDocument, ingest, split_text, to_chunks
from app.ai.products.arch.knowledge.embedding import EMBEDDING_DIM, HashEmbedder
from app.ai.products.arch.knowledge.example_corpus import D2, EXAMPLE_DOCS
from app.ai.products.arch.knowledge.search import in_effect, search_effective
from app.ai.products.arch.knowledge.store import InMemoryStore
from app.ai.products.arch.wiki_config import (
    WikiConfig,
    WikiPage,
    lint_page,
    plan_ingest_pages,
    validate_page,
)
from tests.arch.rag.eval_set import EVAL_SET

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
    before = search_effective(store, EMB, org_id=ORG, query=q, application_date=date(2024, 6, 30), k=K)
    on = search_effective(store, EMB, org_id=ORG, query=q, application_date=D2, k=K)
    assert before[0].chunk.metadata["doc_id"] == "law-cov-v1"
    assert on[0].chunk.metadata["doc_id"] == "law-cov-v2"
    assert all(in_effect(h.chunk.metadata, D2) for h in on)


def test_org_and_collection_isolation(store: InMemoryStore) -> None:
    q = "건폐율"
    assert search_effective(store, EMB, org_id=OTHER, query=q, application_date=D2, k=K) == []
    hits = search_effective(store, EMB, org_id=ORG, query=q, application_date=D2, k=K, collection_id="col-rp")
    assert all(h.chunk.collection_id == "col-rp" for h in hits)


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
        found = search_effective(store, EMB, org_id=ORG, query=q, application_date=d, k=K)
        if want in {h.chunk.metadata["doc_id"] for h in found}:
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
