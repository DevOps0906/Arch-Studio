"""문서 -> 청크 -> 임베딩 -> 색인. 원문 수집기(DRF 등)는 `SourceDocument` 를 내놓는 쪽의 몫이며 D-14 뒤 연결한다."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.ai.products.arch.knowledge.embedding import Embedder
from app.ai.products.arch.knowledge.store import Chunk, KnowledgeStore

SourceKind = Literal["law", "district_plan", "reply"]
MAX_CHUNK_CHARS = 600


@dataclass(frozen=True)
class SourceDocument:
    doc_id: str
    kind: SourceKind
    title: str
    text: str
    effective_from: date
    effective_to: date | None  # None = 현행
    synthetic: bool  # True = 가상 조문(실제 원문 아님)
    source_note: str = ""  # 출처 표기 문구: D-14 확인 뒤 채운다


def split_text(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """빈 줄 단위 문단을 limit 이하로 합친다. 문단 하나가 limit 을 넘으면 문장 단위로 쪼갠다."""
    parts: list[str] = []
    for para in (p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()):
        parts.extend(re.split(r"(?<=[.다])\s+", para) if len(para) > limit else [para])
    out: list[str] = []
    cur = ""
    for p in parts:
        if cur and len(cur) + len(p) + 1 > limit:
            out.append(cur)
            cur = p
        else:
            cur = f"{cur}\n{p}" if cur else p
    if cur:
        out.append(cur)
    return out


def to_chunks(doc: SourceDocument, *, org_id: str, collection_id: str, embedder: Embedder) -> list[Chunk]:
    if doc.effective_to is not None and doc.effective_to <= doc.effective_from:
        raise ValueError(f"시행 범위가 비었습니다: {doc.doc_id}")
    return [
        Chunk(
            id=f"{doc.doc_id}#{i}",
            org_id=org_id,
            collection_id=collection_id,
            content=piece,
            embedding=embedder.embed(f"{doc.title} {piece}"),
            metadata={
                "source_kind": doc.kind,
                "doc_id": doc.doc_id,
                "title": doc.title,
                "effective_from": doc.effective_from.isoformat(),
                "effective_to": doc.effective_to.isoformat() if doc.effective_to else None,
                "synthetic": doc.synthetic,
                "source_note": doc.source_note,
            },
        )
        for i, piece in enumerate(split_text(doc.text))
    ]


def ingest(
    docs: list[SourceDocument], *, store: KnowledgeStore, embedder: Embedder, org_id: str, collections: dict[str, str]
) -> int:
    """collections: SourceKind -> collection_id. 색인한 청크 수. 문서 단위로 교체한다(멱등, 줄어든 청크 잔존 없음)."""
    total = 0
    for doc in docs:
        cid = collections[doc.kind]
        chunks = to_chunks(doc, org_id=org_id, collection_id=cid, embedder=embedder)
        store.replace_document(org_id, cid, doc.doc_id, chunks)
        total += len(chunks)
    return total
