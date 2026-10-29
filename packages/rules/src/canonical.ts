// 정규 JSON: 키 사전순, 2칸 들여쓰기, 끝 줄바꿈. 골든·팩 해시가 같은 입력 → 같은 바이트가 되게 한다.

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** 값을 정규 JSON 문자열로 바꾼다(undefined 속성은 뺀다). */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}
