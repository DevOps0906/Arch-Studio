"""청크 저장소 프로토콜과 메모리 구현.

`search` 는 DB 함수 `arch.match_public_knowledge(p_org, p_embedding, p_k, p_collection_id, p_min_similarity)` 와
같은 시그니처·의미(유사도 = 코사인, 조직·컬렉션 필터, 유사도 내림차순)를 흉내 낸다. DB 구현은 후속.

계약:
- p_k 는 1..50 (DB 함수 상한, 밖이면 SQLSTATE 22023 에 해당하는 ValueError).
- 청크 키는 (org_id, collection_id, id). 다른 조직이 같은 id 를 써도 덮어쓰지 않는다.
- 비범위: DB 는 자기 조직 + 등록된 공개 컬렉션을 보고 타 조직 컬렉션은 42501 로 거부한다. 메모리 구현은
  p_org 의 청크만 본다(공개 컬렉션 경로 없음).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

from app.ai.products.arch.knowledge.embedding import EMBEDDING_DIM, cosine

MAX_K = 50  # arch.match_public_knowledge 의 p_k 상한(2403_arch_ai_routing.sql)


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

    def replace_document(self, org_id: str, collection_id: str, doc_id: str, chunks: list[Chunk]) -> None:
        """doc 단위 교체: 같은 문서의 기존 청크를 모두 지우고 chunks 를 넣는다(줄어든 청크 잔존 방지)."""
        ...

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
        self._chunks: dict[tuple[str, str, str], Chunk] = {}

    def upsert(self, chunks: list[Chunk]) -> None:
        for c in chunks:
            if len(c.embedding) != EMBEDDING_DIM:
                raise ValueError(f"임베딩은 {EMBEDDING_DIM}차원이어야 합니다: {c.id}")
            self._chunks[(c.org_id, c.collection_id, c.id)] = c

    def replace_document(self, org_id: str, collection_id: str, doc_id: str, chunks: list[Chunk]) -> None:
        for key in [
            k
            for k, c in self._chunks.items()
            if k[0] == org_id and k[1] == collection_id and c.metadata.get("doc_id") == doc_id
        ]:
            del self._chunks[key]
        self.upsert(chunks)

    def search(
        self,
        p_org: str,
        p_embedding: list[float],
        p_k: int,
        p_collection_id: str | None = None,
        p_min_similarity: float = 0.0,
    ) -> list[Hit]:
        if not 1 <= p_k <= MAX_K:
            raise ValueError(f"p_k 는 1..{MAX_K} 이어야 합니다(22023): {p_k}")
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
