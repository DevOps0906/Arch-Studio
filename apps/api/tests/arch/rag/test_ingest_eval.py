"""수집 검증 + 평가 하니스(재현율@k). 코퍼스·평가셋은 예시(미확인) 픽스처다."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.ai.products.arch.ingest import (
    IngestError,
    SourceDocument,
    build_chunks,
    check_versions,
    chunk_text,
    document_hash,
    ingest,
    load_corpus,
)
from app.ai.products.arch.knowledge import KnowledgeIndex
from app.ai.products.arch.knowledge.evaluation import (
    TARGET_CASES,
    TARGET_RECALL,
    EvalCase,
    EvalSet,
    HashingEmbedder,
    evaluate,
    recall_at_k,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _doc(source_id: str, start: str, end: str | None = None, **meta: object) -> SourceDocument:
    m: dict[str, object] = {
        "kind": "law",
        "source_id": source_id,
        "title": "[예시] 문서",
        "effective_from": start,
        "retrieved_on": "2026-11-02",
        "is_example": True,
        **meta,
    }
    if end is not None:
        m["effective_to"] = end
    return SourceDocument.model_validate({"meta": m, "text": "제1조(목적) 예시 본문"}, strict=False)


# ---------------------------------------------------------------------------
# 청크·수집
# ---------------------------------------------------------------------------


def test_chunk_text_splits_on_articles() -> None:
    text = "머리말\n제1조(목적) 가\n제2조의2(정의) 나\n본문 제3조를 인용"
    assert chunk_text(text) == ["머리말", "제1조(목적) 가", "제2조의2(정의) 나\n본문 제3조를 인용"]


def test_chunk_text_bounds_long_article() -> None:
    long = "제1조 " + "가" * 200 + "\n\n" + "나" * 30
    parts = chunk_text(long, max_chars=100)
    assert all(len(p) <= 100 for p in parts)
    assert "".join(p.replace("\n\n", "") for p in parts) == long.replace("\n\n", "")


def test_chunks_are_deterministic() -> None:
    doc = _doc("a-law", "2020-01-01")
    assert build_chunks(doc) == build_chunks(doc)
    assert document_hash(doc) == document_hash(_doc("a-law", "2020-01-01"))
    assert document_hash(doc) != document_hash(_doc("a-law", "2020-01-01", "2021-01-01"))


def test_examples_rejected_without_flag() -> None:
    with pytest.raises(IngestError, match="예시"):
        ingest([_doc("a-law", "2020-01-01")])


def test_overlapping_versions_rejected() -> None:
    with pytest.raises(IngestError, match="겹칩니다"):
        check_versions([_doc("a-law", "2020-01-01"), _doc("a-law", "2022-01-01")])  # 구판이 열린 채
    with pytest.raises(IngestError, match="겹칩니다"):
        check_versions([_doc("a-law", "2020-01-01", "2023-01-01"), _doc("a-law", "2022-01-01")])
    with pytest.raises(IngestError, match="같은 시행일"):
        check_versions([_doc("a-law", "2020-01-01", "2021-01-01"), _doc("a-law", "2020-01-01")])
    with pytest.raises(IngestError, match="종류"):
        check_versions([_doc("a-law", "2020-01-01", "2021-01-01"), _doc("a-law", "2021-01-01", jurisdiction="11680")])
    check_versions([_doc("a-law", "2020-01-01", "2021-01-01"), _doc("a-law", "2021-01-01")])


def test_unknown_field_rejected() -> None:
    with pytest.raises(ValueError):
        SourceDocument.model_validate_json(
            '{"meta":{"kind":"law","source_id":"a","title":"t","effective_from":"2020-01-01",'
            '"retrieved_on":"2026-11-02","coordinates":[1,2]},"text":"x"}'
        )


def test_fixture_corpus_is_all_example_and_valid() -> None:
    docs = load_corpus(FIXTURES / "corpus")
    assert docs and all(d.meta.is_example for d in docs)
    assert all("예시(미확인)" in d.text for d in docs)
    kinds = {d.meta.kind for d in docs}
    assert kinds == {"law", "district_plan", "qa_reply"}
    assert ingest(docs, allow_examples=True)


# ---------------------------------------------------------------------------
# 평가 하니스
# ---------------------------------------------------------------------------


def test_recall_at_k() -> None:
    assert recall_at_k(["a@2020-01-01", "b@2020-01-01"], ["a@2020-01-01"]) == 1.0
    assert recall_at_k(["a@2020-01-01"], ["a@2020-01-01", "b@2020-01-01"]) == 0.5
    assert recall_at_k([], ["a@2020-01-01"]) == 0.0
    with pytest.raises(ValueError):
        recall_at_k(["a"], [])


def test_wrong_version_counts_as_miss() -> None:
    old = _doc("a-law", "2020-01-01", "2024-01-01")
    new = _doc("a-law", "2024-01-01")
    index = KnowledgeIndex(HashingEmbedder())
    index.add(ingest([old, new], allow_examples=True))
    case = EvalCase(id="c1", question="예시 본문", application_date=date(2025, 1, 1), expected=["a-law@2020-01-01"])
    report = evaluate(index, EvalSet(is_example=True, note="t", cases=[case]), k=5)
    assert report.recall == 0.0
    assert report.cases[0].retrieved == ("a-law@2024-01-01",)
    assert report.cases[0].missing == ("a-law@2020-01-01",)
    assert not report.passed()


def test_fixture_eval_set_shape() -> None:
    es = EvalSet.model_validate_json((FIXTURES / "eval_set.json").read_bytes())
    assert es.is_example
    assert len(es.cases) == TARGET_CASES
    assert len({c.id for c in es.cases}) == TARGET_CASES
    versions = {d.meta.version_key for d in load_corpus(FIXTURES / "corpus")}
    for c in es.cases:
        assert set(c.expected) <= versions, c.id


def test_fixture_eval_runs_and_meets_target() -> None:
    """하니스가 끝까지 돌고 결정적인지 확인한다. 예시 코퍼스 + 해시 임베더 수치라 운영 품질 지표가 아니다."""
    index = KnowledgeIndex(HashingEmbedder())
    index.add(ingest(load_corpus(FIXTURES / "corpus"), allow_examples=True))
    es = EvalSet.model_validate_json((FIXTURES / "eval_set.json").read_bytes())
    first = evaluate(index, es, k=5)
    assert first == evaluate(index, es, k=5)
    assert first.passed(TARGET_RECALL), [c for c in first.cases if c.recall < 1]
