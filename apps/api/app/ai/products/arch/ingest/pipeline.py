"""수집 파이프라인(외부 호출 없음, 같은 입력 → 같은 청크).

원본 파일 형식(JSON, UTF-8): `{"meta": SourceMeta, "text": "본문"}`. 한 파일이 한 판(version)이다.
개정되면 이전 판의 `effective_to`를 새 판의 `effective_from`으로 닫고 새 파일을 추가한다(덮어쓰지 않음).
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Sequence
from itertools import pairwise
from pathlib import Path
from typing import Annotated

from pydantic import Field

from app.ai.products.arch.knowledge.metadata import KnowledgeChunk, SourceMeta
from app.ai.products.arch.schema import Strict

MAX_CHUNK_CHARS = 800  # 제안
MAX_TEXT_CHARS = 2_000_000

# 줄 머리의 조문 제목: "제12조", "제12조의2".
_ARTICLE_RE = re.compile(r"^(?=제\d+조(?:의\d+)?(?:\s|\(|$))", re.MULTILINE)


class IngestError(ValueError):
    pass


class SourceDocument(Strict):
    meta: SourceMeta
    text: Annotated[str, Field(min_length=1, max_length=MAX_TEXT_CHARS)]


def _split_long(segment: str, max_chars: int) -> list[str]:
    if len(segment) <= max_chars:
        return [segment]
    parts: list[str] = []
    buf = ""
    for para in (p.strip() for p in segment.split("\n\n")):
        if not para:
            continue
        while len(para) > max_chars:
            if buf:
                parts.append(buf)
                buf = ""
            parts.append(para[:max_chars])
            para = para[max_chars:]
        if buf and len(buf) + 2 + len(para) > max_chars:
            parts.append(buf)
            buf = ""
        buf = f"{buf}\n\n{para}" if buf else para
    if buf:
        parts.append(buf)
    return parts


def chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """조문 제목 앞에서 자르고, 긴 조문은 문단 → 글자 수로 다시 자른다."""
    if max_chars < 50:
        raise ValueError("max_chars는 50 이상입니다")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    out: list[str] = []
    for seg in _ARTICLE_RE.split(normalized):
        seg = seg.strip()
        if seg:
            out.extend(_split_long(seg, max_chars))
    return out


def _build_chunks(doc: SourceDocument, max_chars: int = MAX_CHUNK_CHARS) -> list[KnowledgeChunk]:
    chunks: list[KnowledgeChunk] = []
    for i, body in enumerate(chunk_text(doc.text, max_chars)):
        # 제목을 앞에 붙여 조문만으로는 모르는 법령명을 검색에 반영한다.
        content = f"{doc.meta.title}\n{body}"
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        chunks.append(KnowledgeChunk(meta=doc.meta, chunk_index=i, content=content, content_hash=digest))
    return chunks


def document_hash(doc: SourceDocument) -> str:
    """`ai_documents.content_hash`. 메타데이터가 바뀌어도(시행 종료일 기록 등) 새 해시가 된다."""
    canonical = json.dumps(doc.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def check_versions(docs: Sequence[SourceDocument]) -> None:
    """같은 `source_id`의 판들: 판 키 중복·시행 구간 겹침·종류/관할 불일치를 거부한다."""
    by_source: dict[str, list[SourceMeta]] = defaultdict(list)
    for d in docs:
        by_source[d.meta.source_id].append(d.meta)
    for source_id, metas in sorted(by_source.items()):
        if len({(m.kind, m.jurisdiction) for m in metas}) > 1:
            raise IngestError(f"{source_id}: 판마다 종류·관할이 다릅니다")
        metas = sorted(metas, key=lambda m: m.effective_from)
        for prev, cur in pairwise(metas):
            if prev.effective_from == cur.effective_from:
                raise IngestError(f"{source_id}: 같은 시행일의 판이 둘입니다({cur.version_key})")
            if prev.effective_to is None or prev.effective_to > cur.effective_from:
                raise IngestError(f"{source_id}: 시행 구간이 겹칩니다({prev.version_key} / {cur.version_key})")


def ingest(
    docs: Sequence[SourceDocument], *, allow_examples: bool = False, max_chars: int = MAX_CHUNK_CHARS
) -> list[KnowledgeChunk]:
    """검증을 모두 통과해야 청크를 돌려준다(부분 색인 없음). `allow_examples`는 테스트·하니스 전용."""
    if not allow_examples:
        examples = sorted(d.meta.version_key for d in docs if d.meta.is_example)
        if examples:
            raise IngestError(f"예시(미확인) 자료는 운영 색인에 넣지 않습니다: {', '.join(examples)}")
    check_versions(docs)
    out: list[KnowledgeChunk] = []
    for d in sorted(docs, key=lambda d: d.meta.version_key):
        out.extend(_build_chunks(d, max_chars))
    return out


def load_corpus(directory: Path) -> list[SourceDocument]:
    files = sorted(directory.glob("*.json"))
    if not files:
        raise IngestError(f"원본 파일이 없습니다: {directory}")
    docs: list[SourceDocument] = []
    for f in files:
        try:
            docs.append(SourceDocument.model_validate_json(f.read_bytes()))
        except ValueError as exc:
            raise IngestError(f"{f.name}: 형식 오류 {exc}") from exc
    return docs
