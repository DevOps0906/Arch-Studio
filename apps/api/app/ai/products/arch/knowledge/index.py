"""시행 범위 필터 → 코사인 순위 검색.

운영에서는 같은 순서(먼저 메타데이터 필터, 그다음 벡터 순위)를 DB 함수가 수행한다(제안 시그니처는
tasks/logs/AR-06-050.md). 이 메모리 색인은 평가 하니스·테스트와 DB 함수 결과 대조용 기준 구현이다.
필터를 순위 뒤에 적용하면 top-k가 폐지된 판으로 채워져 재현율이 떨어지므로 순서를 바꾸지 않는다.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from app.ai.products.arch.knowledge.metadata import KnowledgeChunk, filter_in_force


class Embedder(Protocol):
    """라우팅 `feature=arch.knowledge`로 고른 임베딩 모델. 컬렉션마다 모델·차원 고정."""

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


@dataclass(frozen=True)
class ScoredChunk:
    chunk: KnowledgeChunk
    score: float


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise ValueError("임베딩 차원이 다릅니다")
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class KnowledgeIndex:
    def __init__(self, embedder: Embedder, *, allow_examples: bool = False) -> None:
        """`allow_examples=False`(운영 기본)면 예시(미확인) 청크를 거부한다. 테스트·하니스만 True."""
        self._embedder = embedder
        self._allow_examples = allow_examples
        self._chunks: list[KnowledgeChunk] = []
        self._vectors: dict[str, list[float]] = {}

    def add(self, chunks: Sequence[KnowledgeChunk]) -> None:
        if not self._allow_examples:
            examples = sorted({c.meta.version_key for c in chunks if c.meta.is_example})
            if examples:
                raise ValueError(f"예시(미확인) 청크는 운영 색인에 넣지 않습니다: {', '.join(examples)}")
        new = [c for c in chunks if c.chunk_id not in self._vectors]
        if not new:
            return
        vectors = self._embedder.embed([c.content for c in new])
        if len(vectors) != len(new):
            raise ValueError("임베딩 개수가 청크 개수와 다릅니다")
        for chunk, vec in zip(new, vectors, strict=True):
            self._chunks.append(chunk)
            self._vectors[chunk.chunk_id] = vec

    def __len__(self) -> int:
        return len(self._chunks)

    def search(
        self, query: str, *, application_date: date, k: int = 5, jurisdiction: str | None = None
    ) -> list[ScoredChunk]:
        if k < 1:
            raise ValueError("k는 1 이상입니다")
        candidates = filter_in_force(self._chunks, application_date, jurisdiction)
        if not candidates:
            return []
        (qvec,) = self._embedder.embed([query])
        scored = [ScoredChunk(c, _cosine(qvec, self._vectors[c.chunk_id])) for c in candidates]
        # 점수 동률은 chunk_id로 정렬해 결과를 결정적으로 만든다.
        scored.sort(key=lambda s: (-s.score, s.chunk.chunk_id))
        return scored[:k]
