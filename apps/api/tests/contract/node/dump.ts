// zod 쪽 JSON Schema 와 코퍼스 판정을 표준 출력으로 낸다. pytest(tests/contract/test_zod_equivalence.py)가 부른다.
// 실행: node apps/api/tests/contract/node/dump.ts
import { dumpSchemas, runCorpus } from "./zod-contract.ts";

process.stdout.write(JSON.stringify({ schemas: dumpSchemas(), verdicts: runCorpus() }));
