"""시행일 필터 검색(결정 2: API 후처리). DB 함수는 바꾸지 않는다.

청크 metadata 의 effective_from(필수)·effective_to(null = 현행)로 application_date in [from, to) 만 남긴다.
시행일을 알 수 없는 청크는 버린다(닫힌 쪽 실패: 틀린 시행본을 근거로 내는 것보다 낫다).

계약:
- k 는 1..50 (DB p_k 상한). 밖이면 ValueError.
- application_date 는 KST 기준 `date`. `datetime` 은 TypeError(시간대 모호).
- DB 에는 min(k * 배수, 50) 개를 요청한다. 필터 후 k 미달이면 배수를 2배씩 늘려 재조회하고(상한 50),
  그래도 모자라면 `insufficient=True`. 상한(50)까지 받고도 모자라면 더 있을 수 있어 `truncated=True`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.ai.products.arch.knowledge.embedding import Embedder
from app.ai.products.arch.knowledge.store import MAX_K, Hit, KnowledgeStore, parse_iso_date

OVERSAMPLE = 4  # 제안값(결정 2). 개정 이력이 많은 코퍼스는 평가셋 개정 문항으로 재측정한다.


@dataclass(frozen=True)
class SearchResult:
    hits: list[Hit] = field(default_factory=list)
    insufficient: bool = False  # 필터 후 k 개에 못 미침
    truncated: bool = False  # DB 상한(50)까지 받고도 미달: 코퍼스에 더 있을 수 있음


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
) -> SearchResult:
    if isinstance(application_date, datetime) or not isinstance(application_date, date):
        raise TypeError("application_date 는 KST 기준 date 여야 합니다(datetime 불가)")
    if not 1 <= k <= MAX_K:
        raise ValueError(f"k 는 1..{MAX_K} 이어야 합니다: {k}")
    vec = embedder.embed(query)
    mult = max(1, oversample)
    while True:
        fetch = min(k * mult, MAX_K)
        raw = store.search(org_id, vec, fetch, collection_id, min_similarity)
        kept = [h for h in raw if in_effect(h.chunk.metadata, application_date)]
        exhausted = len(raw) < fetch  # DB 에 더 없음
        if len(kept) >= k or exhausted or fetch >= MAX_K:
            break
        mult *= 2
    return SearchResult(
        hits=kept[:k],
        insufficient=len(kept) < k,
        truncated=len(kept) < k and not exhausted,
    )
