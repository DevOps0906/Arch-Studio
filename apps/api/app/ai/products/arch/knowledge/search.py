"""시행일 필터 검색(결정 2: API 후처리). DB 함수는 바꾸지 않는다.

청크 metadata 의 effective_from(필수)·effective_to(null = 현행)로 application_date in [from, to) 만 남긴다.
시행일을 알 수 없는 청크는 버린다(닫힌 쪽 실패: 틀린 시행본을 근거로 내는 것보다 낫다).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from app.ai.products.arch.knowledge.embedding import Embedder
from app.ai.products.arch.knowledge.store import Hit, KnowledgeStore, parse_iso_date

OVERSAMPLE = 4  # 제안값(결정 2). 개정 이력이 많은 코퍼스는 평가셋 개정 문항으로 재측정한다.


def in_effect(metadata: dict[str, Any], application_date: date) -> bool:
    try:
        start = parse_iso_date(metadata.get("effective_from"))
        end = parse_iso_date(metadata.get("effective_to"))
    except ValueError:
        return False
    if start is None:
        return False
    return start <= application_date and (end is None or application_date < end)


def search_effective(
    store: KnowledgeStore,
    embedder: Embedder,
    *,
    org_id: str,
    query: str,
    application_date: date,
    k: int = 5,
    collection_id: str | None = None,
    min_similarity: float = 0.0,
    oversample: int = OVERSAMPLE,
) -> list[Hit]:
    raw = store.search(org_id, embedder.embed(query), k * oversample, collection_id, min_similarity)
    return [h for h in raw if in_effect(h.chunk.metadata, application_date)][:k]
