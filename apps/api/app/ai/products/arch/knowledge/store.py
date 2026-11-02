"""청크 저장소 프로토콜과 메모리 구현.

`search` 는 DB 함수 `arch.match_public_knowledge(p_org, p_embedding, p_k, p_collection_id, p_min_similarity)` 와
같은 시그니처·의미(유사도 = 코사인, 조직·컬렉션 필터, 유사도 내림차순)를 흉내 낸다. DB 구현은 후속.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

from app.ai.products.arch.knowledge.embedding import EMBEDDING_DIM, cosine


@dataclass(frozen=True)
class Chunk:
    id: str
    org_id: str
    collection_id: str
    content: str
    embedding: list[float]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    similarity: float


class KnowledgeStore(Protocol):
    def upsert(self, chunks: list[Chunk]) -> None: ...

    def search(
        self,
        p_org: str,
        p_embedding: list[float],
        p_k: int,
        p_collection_id: str | None = None,
        p_min_similarity: float = 0.0,
    ) -> list[Hit]: ...


class InMemoryStore:
    def __init__(self) -> None:
        self._chunks: dict[str, Chunk] = {}

    def upsert(self, chunks: list[Chunk]) -> None:
        for c in chunks:
            if len(c.embedding) != EMBEDDING_DIM:
                raise ValueError(f"임베딩은 {EMBEDDING_DIM}차원이어야 합니다: {c.id}")
            self._chunks[c.id] = c

    def search(
        self,
        p_org: str,
        p_embedding: list[float],
        p_k: int,
        p_collection_id: str | None = None,
        p_min_similarity: float = 0.0,
    ) -> list[Hit]:
        hits = [
            Hit(c, cosine(p_embedding, c.embedding))
            for c in self._chunks.values()
            if c.org_id == p_org and (p_collection_id is None or c.collection_id == p_collection_id)
        ]
        hits = [h for h in hits if h.similarity >= p_min_similarity]
        hits.sort(key=lambda h: (-h.similarity, h.chunk.id))
        return hits[:p_k]


def parse_iso_date(value: object) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("날짜는 ISO 문자열이어야 합니다")
    return date.fromisoformat(value)
