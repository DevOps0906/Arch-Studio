"""임베딩 프로토콜과 결정적 가짜 임베더.

ai_chunks.embedding 은 vector(1024) 고정(core_lite.sql). 실제 oss-embed 클라이언트는 이 프로토콜만 구현하면 되고
아직 없다. 테스트·예시 평가는 `HashEmbedder`(해시 기반, 같은 입력 -> 같은 벡터, 오프라인)를 쓴다.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

EMBEDDING_DIM = 1024
_TOKEN = re.compile(r"[0-9A-Za-z]+|[가-힣]+")


class Embedder(Protocol):
    dim: int

    def embed(self, text: str) -> list[float]: ...


class HashEmbedder:
    """단어와 한글 2-gram 을 해시해 1024차원 단위 벡터로 만든다(의미 모델 아님, 재현용)."""

    dim = EMBEDDING_DIM

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in _TOKEN.findall(text):
            feats = [tok] if len(tok) == 1 else [tok[i : i + 2] for i in range(len(tok) - 1)]
            if len(tok) > 1:
                feats.append(tok)
            for f in feats:
                h = int.from_bytes(hashlib.sha256(f.encode()).digest()[:8], "big")
                vec[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm else vec


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))
