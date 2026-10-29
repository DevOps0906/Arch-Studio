// 라이선스 payload 정준화(04_API.md 2.4절: 키 정렬 JSON, UTF-8, 공백 없음).
// 규칙은 packages/drafting/src/sheet/hash.ts canonicalJson과 같다:
//   - 객체 키는 UTF-16 코드 단위 사전순(Array.prototype.sort 기본), 값이 undefined인 칸은 뺀다
//   - 배열의 undefined는 null, -0은 0, 유한하지 않은 수는 RangeError
//   - 공백·들여쓰기 없음, 문자열은 JSON.stringify 이스케이프
// 추가 규칙(서명 대상이라 더 엄격): 일반 객체(프로토타입 Object 또는 null)가 아닌 객체(Date·Map 등)와
// bigint·symbol·function은 TypeError. Rust 검증자(AR-06-041)는 이 바이트를 다시 만들지 않고 서명된 바이트 그대로 검증한다.
// 서명 입력은 이 바이트 앞에 용도 접두 "arch-license-v1\n"(signing.ts LICENSE_SIGNING_CONTEXT)를 붙인 것이다(도메인 분리).
// 파일의 payload 필드는 접두 없는 이 바이트의 base64url이다.

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new RangeError("유한하지 않은 수는 정준화할 수 없습니다.");
      return JSON.stringify(value + 0);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      if (!isPlainObject(value)) throw new TypeError("일반 객체가 아닌 값은 정준화할 수 없습니다.");
      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const k of Object.keys(obj).sort()) {
        if (obj[k] !== undefined) parts.push(`${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`JSON으로 나타낼 수 없는 값: ${typeof value}`);
  }
}

/** 정준 JSON의 UTF-8 바이트(서명 대상). */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}
