"""검색 평가 하니스: 평가셋(질문 + 신청 기준일 + 정답 판) → 문항별 재현율@k와 평균.

정답은 판 단위(`source_id@effective_from`)다. 같은 원본이라도 기준일에 시행 중이 아닌 판을 가져오면 맞힌 것으로
치지 않는다. 목표 재현율 0.8·문항 30개는 06_AGENT_PLAN.md AR-06-050 행의 제안값이다.

`HashingEmbedder`는 외부 호출 없는 결정적 임베더(글자 2-gram 해시)다. 하니스 동작 확인용이며 운영 임베딩 모델의
품질을 대신하지 않는다. 운영 재현율은 실제 코퍼스·평가셋(사람 확인)과 라우팅된 모델로 다시 잰다.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Annotated

from pydantic import Field

from app.ai.products.arch.knowledge.index import KnowledgeIndex
from app.ai.products.arch.knowledge.metadata import JURISDICTION_RE
from app.ai.products.arch.schema import Strict

TARGET_RECALL = 0.8  # 제안
TARGET_CASES = 30  # 제안
DEFAULT_K = 5


class EvalCase(Strict):
    id: Annotated[str, Field(pattern=r"^[a-z0-9-]+$")]
    question: Annotated[str, Field(min_length=1, max_length=500)]
    application_date: date
    jurisdiction: Annotated[str, Field(pattern=JURISDICTION_RE)] | None = None
    # 정답 판 키 `source_id@YYYY-MM-DD`.
    expected: Annotated[list[Annotated[str, Field(pattern=r"^[a-z0-9-]+@\d{4}-\d{2}-\d{2}$")]], Field(min_length=1)]


class EvalSet(Strict):
    # 사람 확인 전 평가셋은 is_example=true. 운영 품질 판정에 쓰지 않는다.
    is_example: bool
    note: str
    cases: Annotated[list[EvalCase], Field(min_length=1)]


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    recall: float
    retrieved: tuple[str, ...]
    missing: tuple[str, ...]


@dataclass(frozen=True)
class EvalReport:
    k: int
    recall: float
    cases: tuple[CaseResult, ...]

    def passed(self, target: float = TARGET_RECALL) -> bool:
        return self.recall >= target


def recall_at_k(retrieved_versions: Sequence[str], expected: Sequence[str]) -> float:
    want = set(expected)
    if not want:
        raise ValueError("정답이 비어 있습니다")
    return len(want & set(retrieved_versions)) / len(want)


def evaluate(index: KnowledgeIndex, eval_set: EvalSet, *, k: int = DEFAULT_K) -> EvalReport:
    results: list[CaseResult] = []
    for case in eval_set.cases:
        hits = index.search(case.question, application_date=case.application_date, k=k, jurisdiction=case.jurisdiction)
        versions: list[str] = []
        for hit in hits:
            key = hit.chunk.meta.version_key
            if key not in versions:
                versions.append(key)
        r = recall_at_k(versions, case.expected)
        missing = tuple(sorted(set(case.expected) - set(versions)))
        results.append(CaseResult(case.id, r, tuple(versions), missing))
    mean = sum(c.recall for c in results) / len(results)
    return EvalReport(k=k, recall=mean, cases=tuple(results))


_TOKEN_RE = re.compile(r"[0-9A-Za-z가-힣]+")


class HashingEmbedder:
    """결정적 오프라인 임베더(하니스·테스트 전용)."""

    def __init__(self, dim: int = 512) -> None:
        if dim < 16:
            raise ValueError("dim은 16 이상입니다")
        self.dim = dim

    def _features(self, text: str) -> list[str]:
        feats: list[str] = []
        for tok in _TOKEN_RE.findall(text.lower()):
            feats.append(tok)
            feats.extend(tok[i : i + 2] for i in range(len(tok) - 1))
        return feats

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            vec = [0.0] * self.dim
            for feat in self._features(text):
                h = int.from_bytes(hashlib.sha256(feat.encode()).digest()[:4], "big")
                vec[h % self.dim] += 1.0
            out.append(vec)
        return out
