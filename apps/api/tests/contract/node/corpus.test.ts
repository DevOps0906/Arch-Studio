// 공유 코퍼스(../corpus/*.json)를 zod 정본에 돌려 기대(accept/reject)와 같은지 본다.
// 같은 코퍼스를 pydantic 쪽(test_zod_equivalence.py)도 돌리므로, 둘 다 통과하면 수락/거부가 같다.
// 실행: node --test apps/api/tests/contract/node/
import assert from "node:assert/strict";
import { test } from "node:test";
import { ZOD_SCHEMAS, dumpSchemas, loadCorpus } from "./zod-contract.ts";

for (const file of loadCorpus()) {
  const schema = ZOD_SCHEMAS[file.schema];
  test(`${file.schema}: zod 판정 = 코퍼스 기대`, { skip: schema ? false : "zod 정의 없음(packages/domain 추가 대기)" }, () => {
    for (const c of file.cases) {
      const ok = schema!.safeParse(c.value).success;
      assert.equal(ok, c.expect === "accept", `${file.schema}/${c.name}`);
    }
  });
}

test("zod → JSON Schema 변환이 모든 계약 스키마를 표현한다(미지원 구성 없음)", () => {
  const schemas = dumpSchemas();
  assert.deepEqual(Object.keys(schemas).sort(), Object.keys(ZOD_SCHEMAS).sort());
  for (const s of Object.values(schemas)) assert.equal(s.additionalProperties, false);
});
