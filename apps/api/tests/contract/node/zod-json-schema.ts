// zod v3 스키마(_def) → JSON Schema(2020-12 부분집합). 동치 테스트 전용, 새 의존성 없음.
// packages/domain 은 zod 3.25(v3 API)를 쓴다. `z.toJSONSchema`는 v4 스키마만 받으므로 _def 를 직접 걷는다.
// 표현할 수 없는 타입(transform 등)을 만나면 조용히 넘기지 않고 예외를 던진다. refine은 구조에서 빼고 코퍼스로 동작을 맞춘다.

export type JsonSchema = { [key: string]: unknown };

interface ZodLike {
  _def: { typeName: string; [key: string]: unknown };
  isOptional(): boolean;
}

interface Check {
  kind: string;
  value?: unknown;
  inclusive?: boolean;
}

function unsupported(what: string): never {
  throw new Error(`동치 테스트가 지원하지 않는 zod 구성: ${what}`);
}

export function zodToJsonSchema(schema: ZodLike): JsonSchema {
  const def = schema._def;
  switch (def.typeName) {
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      for (const c of def.checks as Check[]) {
        if (c.kind === "min") out.minLength = c.value;
        else if (c.kind === "max") out.maxLength = c.value;
        else if (c.kind === "length") {
          out.minLength = c.value;
          out.maxLength = c.value;
        } else unsupported(`string.${c.kind}`);
      }
      return out;
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      for (const c of def.checks as Check[]) {
        const v = c.value as number;
        if (c.kind === "int") out.type = "integer";
        else if (c.kind === "finite") continue; // JSON 에는 Infinity 가 없다
        else if (c.kind === "min") {
          if (c.inclusive) out.minimum = Math.max((out.minimum as number | undefined) ?? -Infinity, v);
          else out.exclusiveMinimum = Math.max((out.exclusiveMinimum as number | undefined) ?? -Infinity, v);
        } else if (c.kind === "max") {
          if (c.inclusive) out.maximum = Math.min((out.maximum as number | undefined) ?? Infinity, v);
          else out.exclusiveMaximum = Math.min((out.exclusiveMaximum as number | undefined) ?? Infinity, v);
        } else unsupported(`number.${c.kind}`);
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodEnum":
      return { enum: [...(def.values as unknown[])] };
    case "ZodArray": {
      const out: JsonSchema = { type: "array", items: zodToJsonSchema(def.type as ZodLike) };
      const min = def.minLength as { value: number } | null;
      const max = def.maxLength as { value: number } | null;
      const exact = def.exactLength as { value: number } | null;
      if (min) out.minItems = min.value;
      if (max) out.maxItems = max.value;
      if (exact) {
        out.minItems = exact.value;
        out.maxItems = exact.value;
      }
      return out;
    }
    case "ZodTuple": {
      const items = (def.items as ZodLike[]).map(zodToJsonSchema);
      if (def.rest) unsupported("tuple.rest");
      return { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
    }
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, ZodLike>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!value.isOptional()) required.push(key);
      }
      const catchall = def.catchall as ZodLike;
      if (catchall._def.typeName !== "ZodNever") unsupported("object.catchall");
      // strict → 추가 필드 거부, strip/passthrough → 추가 필드 허용(동치 비교에서 차이로 드러난다)
      const additionalProperties = def.unknownKeys === "strict" ? false : true;
      return { type: "object", properties, required, additionalProperties };
    }
    case "ZodOptional":
      return zodToJsonSchema(def.innerType as ZodLike); // 필수 여부는 부모 객체가 정한다
    case "ZodNullable":
      return { anyOf: [zodToJsonSchema(def.innerType as ZodLike), { type: "null" }] };
    case "ZodUnion":
    case "ZodDiscriminatedUnion": // 판별 키(kind)는 각 멤버의 const로 드러난다
      return { anyOf: (def.options as ZodLike[]).map(zodToJsonSchema) };
    case "ZodEffects": {
      // superRefine(시트 내 id 유일·형식, AR-06-086)은 JSON Schema로 표현하지 않는다 — 동작은 코퍼스가 양쪽에서 고정한다.
      const effect = def.effect as { type: string };
      if (effect.type !== "refinement") unsupported(`effects.${effect.type}`);
      return zodToJsonSchema(def.schema as ZodLike);
    }
    case "ZodRecord": {
      const out: JsonSchema = { type: "object", additionalProperties: zodToJsonSchema(def.valueType as ZodLike) };
      const key = zodToJsonSchema(def.keyType as ZodLike);
      const plainString = key.type === "string" && Object.keys(key).length === 1;
      if (!plainString) out.propertyNames = key;
      return out;
    }
    default:
      return unsupported(def.typeName);
  }
}
