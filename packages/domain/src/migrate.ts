// schema_version 이주 (02_ARCHITECTURE.md 위험 #3). 로컬 SQLite·클라우드 사본의 JSON을 현재 버전으로 올린 뒤 검증한다.
// 버전을 올릴 때: (1) 새 스키마의 schema_version literal을 CURRENT_SCHEMA_VERSION과 맞추고
// (2) MIGRATIONS[이전 버전]을 추가하고 (3) contract.test.ts 스냅샷을 새 버전 키로 추가한다. 하나라도 빠지면 테스트가 실패한다.
import { designModelV1Schema, type DesignModelV1 } from "./design-model.ts";

export const CURRENT_SCHEMA_VERSION = 1;

export type JsonObject = Record<string, unknown>;
/** 버전 n 문서 → 버전 n+1 문서. 순수 함수여야 한다: 입력(얕은 복사본)과 그 하위 객체를 변경하지 말고 새 객체를 반환한다. */
export type Migration = (doc: JsonObject) => JsonObject;
export type MigrationTable = Readonly<Record<number, Migration>>;

/** 키 n: n → n+1 이주. v1이 첫 버전이라 아직 비어 있다. */
export const MIGRATIONS: MigrationTable = Object.freeze({});

export class SchemaVersionError extends Error {
  override name = "SchemaVersionError";
}

/** 1..current-1 중 이주 함수가 없는 버전 목록. 비어 있어야 정상이다. */
export function missingMigrations(
  current: number = CURRENT_SCHEMA_VERSION,
  migrations: MigrationTable = MIGRATIONS,
): number[] {
  const missing: number[] = [];
  for (let v = 1; v < current; v += 1) {
    if (typeof migrations[v] !== "function") missing.push(v);
  }
  return missing;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 저장된 문서를 현재 버전까지 이주한다(스키마 검증 전 원시 JSON). 입력은 변경하지 않는다. */
export function migrateToCurrent(
  input: unknown,
  current: number = CURRENT_SCHEMA_VERSION,
  migrations: MigrationTable = MIGRATIONS,
): JsonObject {
  if (!isObject(input)) throw new SchemaVersionError("DesignModel 문서가 객체가 아닙니다");
  const version = input.schema_version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SchemaVersionError(`알 수 없는 schema_version: ${String(version)}`);
  }
  if (version > current) {
    throw new SchemaVersionError(`이 엔진보다 새 schema_version입니다: ${version} > ${current}`);
  }
  let doc: JsonObject = { ...input };
  for (let v = version; v < current; v += 1) {
    const step = migrations[v];
    if (typeof step !== "function") throw new SchemaVersionError(`이주 함수 없음: v${v} → v${v + 1}`);
    doc = step(doc);
    if (doc.schema_version !== v + 1) {
      throw new SchemaVersionError(`이주 함수 v${v}가 schema_version을 ${v + 1}로 바꾸지 않았습니다`);
    }
  }
  return doc;
}

/** 저장된 문서를 이주하고 현재 스키마로 검증한다. 검증 실패는 ZodError를 던진다. */
export function migrateDesignModel(input: unknown): DesignModelV1 {
  return designModelV1Schema.parse(migrateToCurrent(input));
}
