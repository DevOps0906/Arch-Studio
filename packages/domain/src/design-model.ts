// DesignModel v1 (04_API.md 4.7.1). 정본은 이 파일 하나(02_ARCHITECTURE.md 위험 #3).
// 판정 필수 필드(north_angle_deg, 도로 폭, 용도지역)는 필수로 둔다(위험 #2).
// 모든 객체는 strict: 모르는 필드는 거부해 저장 누락·오타를 드러낸다.
import { z } from "zod";
import { mmSchema } from "./units.ts";

export const pointSchema = z.tuple([mmSchema, mmSchema]);
export type Point = z.infer<typeof pointSchema>;

/** 외곽 반시계, 구멍 시계, 닫는 점 중복 없음(문서상 제안 — 방향은 여기서 검사하지 않는다). */
export const polygonSchema = z
  .object({
    outer: z.array(pointSchema),
    holes: z.array(z.array(pointSchema)).optional(),
  })
  .strict();
export type Polygon = z.infer<typeof polygonSchema>;

export const roadSchema = z
  .object({
    edge_index: z.number().int().nonnegative(),
    width_mm: mmSchema.nonnegative(),
  })
  .strict();

export const siteSchema = z
  .object({
    boundary: polygonSchema,
    north_angle_deg: z.number().finite(),
    roads: z.array(roadSchema),
    zoning: z
      .object({
        use_district: z.string().min(1),
        districts: z.array(z.string()),
        building_line: z.array(pointSchema).optional(),
      })
      .strict(),
    parcel: z
      .object({
        pnu: z.string().optional(),
        address_label: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const ruleContextSchema = z
  .object({
    rule_pack_version: z.string(),
    application_date: z.string(),
    municipality_code: z.string(),
    ordinance_applied: z.boolean(),
  })
  .strict();

export const floorSchema = z
  .object({
    id: z.string(),
    level: z.number().int(), // 지하 -1, 1층 1
    height_mm: mmSchema,
    use: z.string(),
  })
  .strict();

export const massSchema = z
  .object({
    id: z.string(),
    footprint: polygonSchema,
    base_level_mm: mmSchema,
    floors: z.array(floorSchema),
    roof: z
      .object({
        type: z.enum(["flat", "gable", "hip", "shed"]),
        pitch: z.number().optional(),
      })
      .strict(),
  })
  .strict();

export const roomSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    use: z.string(),
    polygon: polygonSchema,
  })
  .strict();

export const openingSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["door", "window"]),
    host: z.object({ room_id: z.string(), edge_index: z.number().int().nonnegative() }).strict(),
    offset_mm: mmSchema,
    width_mm: mmSchema,
    swing: z.enum(["left", "right"]).optional(),
  })
  .strict();

export const floorLayoutSchema = z
  .object({
    floor_id: z.string(),
    rooms: z.array(roomSchema),
    openings: z.array(openingSchema),
  })
  .strict();

export const programSchema = z
  .object({
    checklist_answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
    targets: z.array(z.object({ name: z.string(), use: z.string(), target_area_m2: z.number() }).strict()),
    user_locked_rows: z.array(z.string()), // 사용자 수정 행. 재계산이 덮어쓰지 않는다(AR-F-011)
  })
  .strict();

export const designModelV1Schema = z
  .object({
    schema_version: z.literal(1),
    units: z.literal("mm"),
    site: siteSchema,
    rule_context: ruleContextSchema,
    masses: z.array(massSchema),
    floor_layouts: z.array(floorLayoutSchema),
    program: programSchema,
    meta: z.object({ created_by_engine_version: z.string() }).strict(),
  })
  .strict();

export type DesignModelV1 = z.infer<typeof designModelV1Schema>;
