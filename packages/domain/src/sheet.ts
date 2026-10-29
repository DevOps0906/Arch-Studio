// SheetSpec, DraftingProfile, StdLayer (04_API.md 4.7.3).
import { z } from "zod";
import { pointSchema } from "./design-model.ts";

export const STD_LAYERS = [
  "A-SITE-BNDY",
  "A-SITE-ROAD",
  "A-SITE-SETB",
  "A-ENVL",
  "A-MASS",
  "A-WALL",
  "A-DOOR",
  "A-GLAZ",
  "A-AREA",
  "A-AREA-IDEN",
  "A-PARK",
  "A-ANNO-DIMS",
  "A-ANNO-TEXT",
  "A-ANNO-NRTH",
  "A-TTLB",
  "A-REFR",
] as const;
export const stdLayerSchema = z.enum(STD_LAYERS);
export type StdLayer = z.infer<typeof stdLayerSchema>;

export const paperSchema = z.enum(["A3", "A2", "A1"]);

export const sheetSpecSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["site_plan", "area_plan", "sunlight_section", "floor_plan", "elevation"]), // elevation 은 Phase 2
    paper: paperSchema,
    orientation: z.enum(["landscape", "portrait"]),
    // auto: 용지에 맞는 가장 큰 축척
    scale: z.union([z.literal("auto"), z.literal(100), z.literal(200), z.literal(300), z.literal(500), z.literal(600)]),
    floor_id: z.string().optional(), // floor_plan, area_plan(층별)
    section_line: z.object({ a: pointSchema, b: pointSchema }).strict().optional(), // sunlight_section
    elevation_face: z.enum(["N", "S", "E", "W"]).optional(),
    // 주석만. 형상은 고칠 수 없다
    annotation_overrides: z.array(
      z
        .object({
          target: z.string(),
          dx_mm: z.number().optional(),
          dy_mm: z.number().optional(),
          text: z.string().optional(),
          hidden: z.boolean().optional(),
        })
        .strict(),
    ),
    include_in_proposal: z.boolean(),
  })
  .strict();
export type SheetSpec = z.infer<typeof sheetSpecSchema>;

/** Partial<Record<StdLayer, string>>: 표준 레이어 이름만 키로 허용, 빠진 키 허용. 표준 이름 → 사무소 이름. */
export const layerMapSchema = z.record(stdLayerSchema, z.string());

export const draftingProfileSchema = z
  .object({
    office_name: z.string(),
    architect_name: z.string().optional(),
    contact: z.string().optional(),
    logo_storage_path: z.string().optional(),
    layer_map: layerMapSchema,
    default_paper: paperSchema,
    default_text_height_mm: z.number().positive(), // 용지 mm. 2.0~5.0은 문서상 제안이라 강제하지 않는다
    font_family: z.string(), // 한글 TTF 글꼴 이름. DXF 에는 이름만 기록
  })
  .strict();
export type DraftingProfile = z.infer<typeof draftingProfileSchema>;
