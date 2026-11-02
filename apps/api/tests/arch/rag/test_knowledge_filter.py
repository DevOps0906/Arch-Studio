"""`application_date` 시행 범위 필터(02_ARCHITECTURE.md `arch.review` retrieve 노드)."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError

from app.ai.products.arch.ingest import SourceDocument, ingest
from app.ai.products.arch.knowledge import KnowledgeIndex, SourceMeta, filter_in_force, in_force
from app.ai.products.arch.knowledge.evaluation import HashingEmbedder


def meta(**over: Any) -> SourceMeta:
    base: dict[str, Any] = {
        "kind": "law",
        "source_id": "sample-law",
        "title": "[예시] 법령",
        "effective_from": date(2020, 1, 1),
        "retrieved_on": date(2026, 11, 2),
        "is_example": True,
    }
    base.update(over)
    return SourceMeta(**base)


def test_half_open_range() -> None:
    m = meta(effective_to=date(2024, 7, 1))
    assert not in_force(m, date(2019, 12, 31))
    assert in_force(m, date(2020, 1, 1))
    assert in_force(m, date(2024, 6, 30))
    assert not in_force(m, date(2024, 7, 1))  # 다음 판 시행일부터 적용 안 됨


def test_open_ended_current_version() -> None:
    m = meta()
    assert in_force(m, date(2099, 1, 1))


def test_jurisdiction_scoped_only_matches_same_code() -> None:
    local = meta(jurisdiction="11680")
    assert in_force(local, date(2024, 1, 1), "11680")
    assert not in_force(local, date(2024, 1, 1), "26350")
    assert not in_force(local, date(2024, 1, 1), None)
    national = meta()
    assert in_force(national, date(2024, 1, 1), "26350")


def test_invalid_range_rejected() -> None:
    with pytest.raises(ValidationError):
        meta(effective_to=date(2020, 1, 1))
    with pytest.raises(ValidationError):
        meta(effective_to=None)  # 명시적 null 거부(키 생략만 허용)


def test_filter_rejects_bad_jurisdiction() -> None:
    with pytest.raises(ValueError):
        filter_in_force([], date(2024, 1, 1), "seoul")


def _two_versions() -> list[SourceDocument]:
    old = SourceDocument(meta=meta(effective_to=date(2024, 7, 1)), text="제1조(이격) 정북 방향 이격 구판 문구")
    new = SourceDocument(
        meta=meta(effective_from=date(2024, 7, 1), title="[예시] 법령(개정)"),
        text="제1조(이격) 정북 방향 이격 개정 문구",
    )
    return [old, new]


@pytest.mark.parametrize(
    ("application_date", "expected"),
    [
        (date(2024, 6, 30), "sample-law@2020-01-01"),
        (date(2024, 7, 1), "sample-law@2024-07-01"),
        (date(2030, 1, 1), "sample-law@2024-07-01"),
    ],
)
def test_search_returns_only_version_in_force(application_date: date, expected: str) -> None:
    index = KnowledgeIndex(HashingEmbedder())
    index.add(ingest(_two_versions(), allow_examples=True))
    hits = index.search("정북 방향 이격", application_date=application_date, k=10)
    assert {h.chunk.meta.version_key for h in hits} == {expected}


def test_search_before_any_version_is_empty() -> None:
    index = KnowledgeIndex(HashingEmbedder())
    index.add(ingest(_two_versions(), allow_examples=True))
    assert index.search("정북", application_date=date(2010, 1, 1)) == []


def test_filter_happens_before_top_k() -> None:
    """폐지된 판이 더 비슷해도 top-1 자리를 차지하지 않는다."""
    old = SourceDocument(meta=meta(effective_to=date(2024, 7, 1)), text="주차 주차 주차 주차 기준")
    new = SourceDocument(meta=meta(effective_from=date(2024, 7, 1)), text="완전히 다른 개정 문구")
    index = KnowledgeIndex(HashingEmbedder())
    index.add(ingest([old, new], allow_examples=True))
    (hit,) = index.search("주차 주차 주차 주차 기준", application_date=date(2025, 1, 1), k=1)
    assert hit.chunk.meta.version_key == "sample-law@2024-07-01"


def test_search_is_deterministic() -> None:
    index = KnowledgeIndex(HashingEmbedder())
    index.add(ingest(_two_versions(), allow_examples=True))
    a = [h.chunk.chunk_id for h in index.search("이격", application_date=date(2025, 1, 1))]
    b = [h.chunk.chunk_id for h in index.search("이격", application_date=date(2025, 1, 1))]
    assert a == b
