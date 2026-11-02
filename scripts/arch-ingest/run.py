"""`arch.knowledge` 수집·평가 CLI(외부 호출·DB 쓰기 없음).

    apps/api/.venv/Scripts/python scripts/arch-ingest/run.py validate <코퍼스 폴더> [--allow-examples]
    apps/api/.venv/Scripts/python scripts/arch-ingest/run.py recall <코퍼스 폴더> <평가셋.json> [--k 5]

validate: 원본 형식·시행 구간 겹침·예시 자료 여부를 검사하고 판·청크 수를 JSON으로 출력한다.
recall: 결정적 해시 임베더로 재현율@k를 잰다(하니스 동작 확인용). 운영 모델 재현율은 라우팅된 임베딩으로 다시 잰다.
종료 코드: 0 통과, 1 검증 실패 또는 목표 재현율 미달.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.ai.products.arch.ingest import IngestError, ingest, load_corpus
from app.ai.products.arch.knowledge import KnowledgeIndex
from app.ai.products.arch.knowledge.evaluation import (
    DEFAULT_K,
    TARGET_RECALL,
    EvalSet,
    HashingEmbedder,
    evaluate,
)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="arch.knowledge 수집·평가")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("corpus", type=Path)
    v.add_argument("--allow-examples", action="store_true")
    e = sub.add_parser("recall")
    e.add_argument("corpus", type=Path)
    e.add_argument("eval_set", type=Path)
    e.add_argument("--k", type=int, default=DEFAULT_K)
    e.add_argument("--allow-examples", action="store_true")
    args = p.parse_args(argv)

    try:
        docs = load_corpus(args.corpus)
        chunks = ingest(docs, allow_examples=args.allow_examples)
    except IngestError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    if args.cmd == "validate":
        print(json.dumps({"ok": True, "versions": len(docs), "chunks": len(chunks)}, ensure_ascii=False))
        return 0

    eval_set = EvalSet.model_validate_json(args.eval_set.read_bytes())
    if eval_set.is_example and not args.allow_examples:
        print(json.dumps({"ok": False, "error": "예시(미확인) 평가셋입니다(--allow-examples)"}, ensure_ascii=False))
        return 1
    index = KnowledgeIndex(HashingEmbedder(), allow_examples=args.allow_examples)
    index.add(chunks)
    report = evaluate(index, eval_set, k=args.k)
    out = {
        "ok": report.passed(),
        "k": report.k,
        "recall": round(report.recall, 4),
        "target": TARGET_RECALL,
        "cases": len(report.cases),
        "misses": [
            {"id": c.case_id, "recall": c.recall, "missing": list(c.missing)} for c in report.cases if c.missing
        ],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if report.passed() else 1


if __name__ == "__main__":
    raise SystemExit(main())
