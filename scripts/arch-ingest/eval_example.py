"""예시 코퍼스 색인 + 평가셋 재현율@k 출력(오프라인).

실행: apps/api 에서 `python ../../scripts/arch-ingest/eval_example.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

API = Path(__file__).resolve().parents[2] / "apps" / "api"
sys.path.insert(0, str(API))

from app.ai.products.arch.ingest.pipeline import ingest  # noqa: E402
from app.ai.products.arch.knowledge.embedding import HashEmbedder  # noqa: E402
from app.ai.products.arch.knowledge.example_corpus import EXAMPLE_DOCS  # noqa: E402
from app.ai.products.arch.knowledge.search import search_effective  # noqa: E402
from app.ai.products.arch.knowledge.store import InMemoryStore  # noqa: E402
from tests.arch.rag.eval_set import EVAL_SET  # noqa: E402

ORG = "11111111-1111-4111-8111-111111111111"
K = 3


def main() -> None:
    emb, store = HashEmbedder(), InMemoryStore()
    n = ingest(
        EXAMPLE_DOCS,
        store=store,
        embedder=emb,
        org_id=ORG,
        collections={"law": "law", "district_plan": "dp", "reply": "rp"},
    )
    hits = sum(
        want
        in {
            h.chunk.metadata["doc_id"]
            for h in search_effective(store, emb, org_id=ORG, query=q, application_date=d, k=K).hits
        }
        for q, d, want in EVAL_SET
    )
    print(f"chunks={n} questions={len(EVAL_SET)} recall@{K}={hits / len(EVAL_SET):.3f}")


if __name__ == "__main__":
    main()
