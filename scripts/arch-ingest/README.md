# scripts/arch-ingest

`arch.knowledge`(법령·지구단위계획·질의회신) 코퍼스 검증과 검색 평가 CLI. 외부 API 호출·DB 쓰기는 없다.
구현은 `apps/api/app/ai/products/arch/{ingest,knowledge}`, 원본 형식은 `ingest/pipeline.py` 머리말.

```bash
PY=apps/api/.venv/Scripts/python   # macOS·Linux: apps/api/.venv/bin/python
$PY scripts/arch-ingest/run.py validate apps/api/tests/arch/rag/fixtures/corpus --allow-examples
$PY scripts/arch-ingest/run.py recall apps/api/tests/arch/rag/fixtures/corpus apps/api/tests/arch/rag/fixtures/eval_set.json --allow-examples
```

- 픽스처는 예시(미확인)다. 운영 코퍼스에는 `--allow-examples`를 쓰지 않는다(예시 자료가 섞이면 실패).
- 개정 시 이전 판 파일의 `effective_to`를 새 판 `effective_from`으로 닫고 새 파일을 추가한다. 겹치면 실패한다.
- 목표 재현율 0.8·평가 30문항은 제안값(06_AGENT_PLAN.md AR-06-050).
