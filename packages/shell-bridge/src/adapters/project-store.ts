// ProjectStore: 프로젝트 목록·열기·저장·삭제(ADR-001 2.1·3장). 설치형 로컬 모드는 Rust `local_db_*`(SQLite, `tauri/project-store.ts`),
// 웹은 072의 클라우드(`arch.cloud_projects`, 073) + IndexedDB 읽기 캐시. 두 구현은 같은 동시성 규칙을 따른다:
// - 새 프로젝트: `expectedVersion: null` → version 1. 이미 있는 id에 null이면 VERSION_CONFLICT.
// - 기존 프로젝트: 마지막으로 읽은 version을 보낸다. 다르면 VERSION_CONFLICT(병합 없음, 저장 안 됨). 없거나 삭제된 id면 NOT_FOUND.
// - 삭제는 소프트 삭제이고 version이 다르면 VERSION_CONFLICT. 삭제된 id로 다시 저장하면 NOT_FOUND.
// 오류에는 이름·설계 모델·버전 값을 넣지 않는다(코드만). 입력 검사는 이 파일의 함수를 두 구현이 같이 쓴다(Rust 검사와 같은 한도).
import { BridgeError } from "./errors.ts";

/** 목록 행(설계 모델 본문 없음). Rust `ProjectSummary`(camelCase). */
export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  /** ISO 8601. */
  readonly updatedAt: string;
  readonly version: number;
}

/** 최신 리비전 1건. Rust `ProjectRecord`. `designModel`은 JSON 원문(화면이 zod로 검증). */
export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  readonly clientName: string | null;
  readonly clientContact: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly designModel: string;
  /** designModel UTF-8 바이트의 SHA-256(소문자 16진수). */
  readonly sha256: string;
}

/** 저장 입력. Rust `SaveProjectInput`(deny_unknown_fields)과 같은 필드만. */
export interface SaveProjectInput {
  /** UUIDv7 소문자 하이픈 형식. 새 프로젝트도 화면이 만든다. */
  readonly id: string;
  readonly name: string;
  readonly siteLabel?: string | null;
  readonly clientName?: string | null;
  readonly clientContact?: string | null;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly designModel: string;
  readonly note?: string | null;
  /** 새 프로젝트 null, 기존은 마지막으로 읽은 version(≥1). */
  readonly expectedVersion: number | null;
}

export interface SaveProjectResult {
  readonly version: number;
  readonly sha256: string;
}

export interface ProjectStore {
  /** 삭제되지 않은 프로젝트(최근 수정 순). */
  list(): Promise<readonly ProjectSummary[]>;
  /** 없거나 삭제됐으면 null. */
  open(id: string): Promise<ProjectRecord | null>;
  /** 새 리비전 저장. version은 저장소가 올린다. */
  save(input: SaveProjectInput): Promise<SaveProjectResult>;
  /** 소프트 삭제. */
  delete(id: string, expectedVersion: number): Promise<void>;
}

/** Rust `local_db.rs` 한도와 같다. */
export const PROJECT_LIMITS = Object.freeze({
  nameChars: 200,
  textChars: 1000,
  engineVersionBytes: 64,
  designModelBytes: 64 * 1024 * 1024,
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** UTF-8 바이트 수(큰 문자열을 복사하지 않고 센다). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** 코드 포인트 수(Rust `chars().count()`와 같다). 짧은 필드에만 쓴다. */
function chars(s: string): number {
  return Array.from(s).length;
}

export function isProjectId(id: unknown): id is string {
  return typeof id === "string" && UUID_V7.test(id);
}

/** id 검사(오류에 id 원문 없음). */
export function assertProjectId(id: unknown): asserts id is string {
  if (!isProjectId(id)) throw new BridgeError("INVALID_INPUT");
}

export function assertExpectedVersion(v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw new BridgeError("INVALID_INPUT");
}

const optionalText = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && chars(v) <= PROJECT_LIMITS.textChars);

/**
 * 저장 입력 검사(Rust `SaveProjectInput::validate`와 같은 규칙). JSON 파싱은 하지 않고 첫 글자만 본다:
 * 객체 여부의 최종 판정은 저장소(Rust·서버) 몫이다.
 */
export function assertSaveProjectInput(input: unknown): asserts input is SaveProjectInput {
  const bad = (): never => {
    throw new BridgeError("INVALID_INPUT");
  };
  if (typeof input !== "object" || input === null) bad();
  const i = input as Record<string, unknown>;
  assertProjectId(i.id);
  if (typeof i.name !== "string" || i.name.trim() === "" || chars(i.name) > PROJECT_LIMITS.nameChars) bad();
  for (const k of ["siteLabel", "clientName", "clientContact", "note"]) if (!optionalText(i[k])) bad();
  if (typeof i.schemaVersion !== "number" || !Number.isSafeInteger(i.schemaVersion) || i.schemaVersion < 1) bad();
  if (
    typeof i.engineVersion !== "string" ||
    i.engineVersion.trim() === "" ||
    utf8Length(i.engineVersion) > PROJECT_LIMITS.engineVersionBytes
  )
    bad();
  if (typeof i.designModel !== "string" || utf8Length(i.designModel) > PROJECT_LIMITS.designModelBytes) bad();
  if (!(i.designModel as string).trimStart().startsWith("{")) bad();
  if (i.expectedVersion !== null) assertExpectedVersion(i.expectedVersion);
}
