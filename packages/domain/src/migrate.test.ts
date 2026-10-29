// schema_version 이주 가드(02_ARCHITECTURE.md 위험 #3): 이주 함수 없이 버전을 올리면 이 테스트가 CI에서 실패한다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  SchemaVersionError,
  designModelV1Schema,
  migrateDesignModel,
  migrateToCurrent,
  missingMigrations,
} from "./index.ts";
import { validDesignModel } from "./test-fixtures.ts";

test("현재 스키마의 schema_version literal이 CURRENT_SCHEMA_VERSION과 같다", () => {
  assert.equal(designModelV1Schema.shape.schema_version.value, CURRENT_SCHEMA_VERSION);
});

test("1..CURRENT_SCHEMA_VERSION-1 모든 버전에 이주 함수가 있다", () => {
  assert.deepEqual(missingMigrations(), []);
});

test("이주 함수 표에 현재 버전 이상 키가 없다", () => {
  const keys = Object.keys(MIGRATIONS).map(Number);
  assert.ok(
    keys.every((k) => Number.isInteger(k) && k >= 1 && k < CURRENT_SCHEMA_VERSION),
    `잘못된 이주 키: ${keys.join(",")}`,
  );
});

test("가드 자체 확인: 버전을 3으로 올리고 v2 이주가 없으면 누락으로 잡힌다", () => {
  assert.deepEqual(missingMigrations(3, { 1: (d) => ({ ...d, schema_version: 2 }) }), [2]);
  assert.throws(() => migrateToCurrent({ schema_version: 1 }, 2, {}), SchemaVersionError);
});

test("이주 함수가 버전을 올리지 않으면 실패한다", () => {
  assert.throws(() => migrateToCurrent({ schema_version: 1 }, 2, { 1: (d) => d }), SchemaVersionError);
});

test("이주는 순서대로 적용되고 입력을 바꾸지 않는다", () => {
  const input = { schema_version: 1, a: 1 };
  const out = migrateToCurrent(input, 3, {
    1: (d) => ({ ...d, schema_version: 2, b: 2 }),
    2: (d) => ({ ...d, schema_version: 3, c: 3 }),
  });
  assert.deepEqual(out, { schema_version: 3, a: 1, b: 2, c: 3 });
  assert.deepEqual(input, { schema_version: 1, a: 1 });
});

test("현재 버전 문서는 그대로 검증을 통과한다", () => {
  const model = validDesignModel();
  assert.deepEqual(migrateDesignModel(model), model);
});

test("엔진보다 새 버전·잘못된 버전은 거부한다", () => {
  for (const v of [CURRENT_SCHEMA_VERSION + 1, 0, 1.5, "1", undefined]) {
    assert.throws(() => migrateDesignModel({ ...validDesignModel(), schema_version: v }), SchemaVersionError);
  }
  assert.throws(() => migrateDesignModel(null), SchemaVersionError);
});
