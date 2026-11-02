// 스키마 스냅샷: 04_API.md 4.7.1~4.7.3 필드와 일치하는지 고정한다. 문서·스키마를 바꾸면 여기도 함께 바꾼다.
// 실행: pnpm --filter @arch-studio/domain test (Node 내장 테스트 러너, TS 타입 제거 실행)
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import type { ZodTypeAny } from "zod";
import {
  CURRENT_SCHEMA_VERSION,
  designModelV1Schema,
  draftingProfileSchema,
  judgmentResultSchema,
  sheetSpecSchema,
} from "./index.ts";

type Shape = string | Shape[] | { [key: string]: Shape };

/** zod v3 스키마 → 필드 구조. Mm(정수)은 "int", 선택 필드는 키 끝에 "?". */
function describe(schema: ZodTypeAny): Shape {
  const def = schema._def;
  switch (def.typeName) {
    case "ZodObject": {
      const out: Record<string, Shape> = {};
      const shape = def.shape() as Record<string, ZodTypeAny>;
      for (const [key, value] of Object.entries(shape)) {
        if (value._def.typeName === "ZodOptional") out[`${key}?`] = describe(value._def.innerType);
        else out[key] = describe(value);
      }
      return out;
    }
    case "ZodEffects":
      return describe(def.schema); // 중복 id 검사 같은 refine 은 코퍼스가 고정한다
    case "ZodDiscriminatedUnion":
      return { [`oneOf(${def.discriminator})`]: [...def.options.values()].map((o: ZodTypeAny) => describe(o)) };
    case "ZodArray":
      return [describe(def.type)];
    case "ZodTuple":
      return ["tuple", ...def.items.map((item: ZodTypeAny) => describe(item))];
    case "ZodRecord":
      return { [`record<${describe(def.keyType) as string}>`]: describe(def.valueType) };
    case "ZodString":
      return "string";
    case "ZodBoolean":
      return "boolean";
    case "ZodNumber":
      return def.checks.some((c: { kind: string }) => c.kind === "int") ? "int" : "number";
    case "ZodLiteral":
      return JSON.stringify(def.value);
    case "ZodEnum":
      return def.values.map((v: string) => JSON.stringify(v)).join(" | ");
    case "ZodUnion":
      return def.options
        .map((o: ZodTypeAny) => {
          const d = describe(o);
          return typeof d === "string" ? d : JSON.stringify(d);
        })
        .join(" | ");
    default:
      throw new Error(`스냅샷에 없는 zod 타입: ${def.typeName}`);
  }
}

const point: Shape = ["tuple", "int", "int"];
const anchor: Shape = { ref: "string", part: '"vertex" | "edge" | "center"', "index?": "int", "at?": '"start" | "end" | "mid"' };
const polygon: Shape = { outer: [point], "holes?": [[point]] };

// 버전별 스냅샷. schema_version을 올리면 새 키를 추가한다(이전 키는 남긴다).
const DESIGN_MODEL_SNAPSHOT: Record<number, Shape> = {
  1: {
    schema_version: "1",
    units: '"mm"',
    site: {
      boundary: polygon,
      north_angle_deg: "number",
      roads: [{ edge_index: "int", width_mm: "int" }],
      zoning: { use_district: "string", districts: ["string"], "building_line?": [point] },
      parcel: { "pnu?": "string", "address_label?": "string" },
    },
    rule_context: {
      rule_pack_version: "string",
      application_date: "string",
      municipality_code: "string",
      ordinance_applied: "boolean",
    },
    masses: [
      {
        id: "string",
        footprint: polygon,
        base_level_mm: "int",
        floors: [{ id: "string", level: "int", height_mm: "int", use: "string" }],
        roof: { type: '"flat" | "gable" | "hip" | "shed"', "pitch?": "number" },
      },
    ],
    floor_layouts: [
      {
        floor_id: "string",
        rooms: [{ id: "string", name: "string", use: "string", polygon }],
        openings: [
          {
            id: "string",
            kind: '"door" | "window"',
            host: { room_id: "string", edge_index: "int" },
            offset_mm: "int",
            width_mm: "int",
            "swing?": '"left" | "right"',
          },
        ],
      },
    ],
    program: {
      checklist_answers: { "record<string>": 'string | number | boolean | ["string"]' },
      targets: [{ name: "string", use: "string", target_area_m2: "number" }],
      user_locked_rows: ["string"],
    },
    meta: { created_by_engine_version: "string" },
  },
};

test("DesignModel v1 스키마가 4.7.1 필드와 일치한다", () => {
  assert.deepEqual(describe(designModelV1Schema), DESIGN_MODEL_SNAPSHOT[1]);
});

test("현재 schema_version의 스냅샷이 있다(버전만 올리고 스냅샷을 빠뜨리면 실패)", () => {
  assert.ok(DESIGN_MODEL_SNAPSHOT[CURRENT_SCHEMA_VERSION], `스냅샷 없음: v${CURRENT_SCHEMA_VERSION}`);
});

test("JudgmentResult 스키마가 4.7.2 필드와 일치한다", () => {
  assert.deepEqual(describe(judgmentResultSchema), {
    engine_version: "string",
    rule_pack_version: "string",
    application_date: "string",
    items: [
      {
        key: '"coverage" | "far" | "height" | "sunlight" | "setback" | "parking" | "seismic" | "zero_energy" | "supervision"',
        verdict: '"PASS" | "FAIL" | "WARN" | "NA"',
        "value?": "number",
        "limit?": "number",
        unit: '"pct" | "mm" | "m2" | "count" | "bool"',
        basis: [{ law: "string", article: "string", effective_from: "string", ordinance: "boolean" }],
      },
    ],
    pending_changes: "int",
  });
});

test("SheetSpec 스키마가 4.7.3 필드와 일치한다", () => {
  assert.deepEqual(describe(sheetSpecSchema), {
    id: "string",
    kind: '"site_plan" | "area_plan" | "sunlight_section" | "floor_plan" | "elevation"',
    paper: '"A3" | "A2" | "A1"',
    orientation: '"landscape" | "portrait"',
    scale: '"auto" | 100 | 200 | 300 | 500 | 600',
    "floor_id?": "string",
    "section_line?": { a: point, b: point },
    "elevation_face?": '"N" | "S" | "E" | "W"',
    "annotations?": [
      {
        "oneOf(kind)": [
          { id: "string", kind: '"override"', target: "string", "dx_mm?": "number", "dy_mm?": "number", "text?": "string", "hidden?": "boolean" },
          { id: "string", kind: '"dim"', a: anchor, b: anchor, offset_mm: "number", "text?": "string" },
          { id: "string", kind: '"text"', "anchor?": anchor, dx_mm: "number", dy_mm: "number", text: "string" },
          { id: "string", kind: '"leader"', anchors: [anchor], dx_mm: "number", dy_mm: "number", text: "string" },
          { id: "string", kind: '"cloud"', anchors: [anchor], "text?": "string" },
        ],
      },
    ],
    include_in_proposal: "boolean",
  });
});

test("DraftingProfile 스키마가 4.7.3 필드와 일치한다", () => {
  const layers =
    '"A-SITE-BNDY" | "A-SITE-ROAD" | "A-SITE-SETB" | "A-ENVL" | "A-MASS" | "A-WALL" | "A-DOOR" | "A-GLAZ" | ' +
    '"A-AREA" | "A-AREA-IDEN" | "A-PARK" | "A-ANNO-DIMS" | "A-ANNO-TEXT" | "A-ANNO-NRTH" | "A-TTLB" | "A-REFR"';
  assert.deepEqual(describe(draftingProfileSchema), {
    office_name: "string",
    "architect_name?": "string",
    "contact?": "string",
    "logo_storage_path?": "string",
    layer_map: { [`record<${layers}>`]: "string" },
    default_paper: '"A3" | "A2" | "A1"',
    default_text_height_mm: "number",
    font_family: "string",
  });
});
