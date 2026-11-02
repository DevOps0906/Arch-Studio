"""법규 질의 답변 본체(AR-F-009, 04_API.md 6.4절). `/tools/answer`·`/tools/answer-direct`가 같이 쓴다.

순서: 시행 중인 지식 검색(`arch.knowledge`, 플랫폼 공통 지식만) → 근거가 없으면 LLM을 부르지 않고
"근거를 찾지 못했습니다" → LLM(feature `arch.chat`)은 검색된 조각과 질문만 받는다(조직 데이터·대지 주소·토큰 없음)
→ LLM이 인용한 조각 id 중 이번 검색 결과에 있는 것만 출처로 남긴다 → 남은 출처가 0개면 LLM 문장을 버리고 no_source.
즉 답변 문장은 출처가 1개 이상일 때만 나간다.
출처 메타데이터는 서버가 청크에서 만든다(LLM이 만든 조문 번호를 믿지 않는다).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from app.ai.products.arch.knowledge import ScoredChunk

FEATURE = "arch.chat"
NO_SOURCE_ANSWER = "근거를 찾지 못했습니다"
MAX_QUERY_CHARS = 2000
MAX_ANSWER_CHARS = 4000
SEARCH_K = 5

# 청크는 조문 제목 앞에서 잘린다(ingest.chunk_text). 첫 줄 머리의 "제12조"·"제12조의2"를 조문 표기로 쓴다.
_ARTICLE_RE = re.compile(r"^\s*(제\d+조(?:의\d+)?)")


class Retriever(Protocol):
    """`KnowledgeIndex.search`와 같은 모양(운영은 DB 함수가 같은 순서로 수행)."""

    def search(
        self, query: str, *, application_date: date, k: int = 5, jurisdiction: str | None = None
    ) -> list[ScoredChunk]: ...


@dataclass(frozen=True)
class SourceSnippet:
    """LLM에 넘기는 근거 조각. id는 chunk_id(판 단위 안정 id)."""

    id: str
    title: str
    content: str


@dataclass(frozen=True)
class GeneratedAnswer:
    answer: str
    cited_ids: tuple[str, ...]
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


class AnswerGenerator(Protocol):
    """라우팅 `feature=arch.chat`로 고른 제공자. org는 라우팅(국외 이전 동의) 판정에만 쓰고 프롬프트에 넣지 않는다."""

    def generate(self, *, feature: str, org: str, query: str, sources: Sequence[SourceSnippet]) -> GeneratedAnswer: ...


@dataclass(frozen=True)
class Citation:
    law: str
    article: str | None
    effective_from: str
    source_id: str


@dataclass(frozen=True)
class AnswerResult:
    answer: str
    citations: tuple[Citation, ...]
    no_source: bool
    model: str | None
    input_tokens: int
    output_tokens: int


def _article_of(content: str) -> str | None:
    m = _ARTICLE_RE.match(content)
    return m.group(1) if m else None


def _citation(sc: ScoredChunk) -> Citation:
    meta = sc.chunk.meta
    return Citation(
        law=meta.title,
        article=_article_of(sc.chunk.content),
        effective_from=meta.effective_from.isoformat(),
        source_id=meta.source_id,
    )


def _no_source(model: str | None = None, input_tokens: int = 0, output_tokens: int = 0) -> AnswerResult:
    return AnswerResult(NO_SOURCE_ANSWER, (), True, model, input_tokens, output_tokens)


def answer_query(
    query: str, *, org: str, today: date, retriever: Retriever, generator: AnswerGenerator
) -> AnswerResult:
    """출처가 1개 이상이면 답변, 아니면 NO_SOURCE_ANSWER. 검색·생성 예외는 호출자에게 그대로 올린다(503)."""
    hits = retriever.search(query, application_date=today, k=SEARCH_K)
    if not hits:
        return _no_source()
    by_id = {sc.chunk.chunk_id: sc for sc in hits}
    snippets = [SourceSnippet(sc.chunk.chunk_id, sc.chunk.meta.title, sc.chunk.content) for sc in hits]
    gen = generator.generate(feature=FEATURE, org=org, query=query, sources=snippets)

    citations: list[Citation] = []
    seen: set[str] = set()
    for cid in gen.cited_ids:
        sc = by_id.get(cid)
        if sc is None or cid in seen:
            continue  # 검색 결과 밖 id(지어낸 출처)는 버린다
        seen.add(cid)
        citations.append(_citation(sc))
    text = gen.answer.strip()[:MAX_ANSWER_CHARS]
    if not citations or not text:
        return _no_source(gen.model, gen.input_tokens, gen.output_tokens)
    return AnswerResult(text, tuple(citations), False, gen.model, gen.input_tokens, gen.output_tokens)
