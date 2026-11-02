"""`arch.knowledge` 수집: 원본 검증 → 판 겹침 검사 → 조문 단위 청크(결정적). 임베딩·DB 쓰기는 호출자 몫."""

from __future__ import annotations

from app.ai.products.arch.ingest.pipeline import (
    IngestError,
    SourceDocument,
    check_versions,
    chunk_text,
    document_hash,
    ingest,
    load_corpus,
)

__all__ = [
    "IngestError",
    "SourceDocument",
    "check_versions",
    "chunk_text",
    "document_hash",
    "ingest",
    "load_corpus",
]
