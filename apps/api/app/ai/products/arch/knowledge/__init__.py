"""법령 RAG 지식(`arch.knowledge`, 02_ARCHITECTURE.md 라우팅 표·`arch.review` retrieve 노드).

컬렉션 하나에 법령·지구단위계획·질의회신을 담고, 청크마다 시행 범위 메타데이터를 둔다. 검색은 항상
`application_date`(허가 신청 기준일)로 시행 중인 판만 남긴 뒤 순위를 매긴다. 임베딩 모델은 라우팅
`feature=arch.knowledge`(oss-embed, 컬렉션 모델 고정)가 정하고 이 패키지는 `Embedder` 인터페이스만 쓴다.
"""

from __future__ import annotations

from app.ai.products.arch.knowledge.index import Embedder, KnowledgeIndex, ScoredChunk
from app.ai.products.arch.knowledge.metadata import (
    COLLECTION_NAME,
    FEATURE,
    KnowledgeChunk,
    KnowledgeKind,
    SourceMeta,
    filter_in_force,
    in_force,
)

__all__ = [
    "COLLECTION_NAME",
    "FEATURE",
    "Embedder",
    "KnowledgeChunk",
    "KnowledgeIndex",
    "KnowledgeKind",
    "ScoredChunk",
    "SourceMeta",
    "filter_in_force",
    "in_force",
]
