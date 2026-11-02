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

/** 주석 상한(zod·pydantic 동일, AR-06-086 결정 8). */
export const ANNOTATION_LIMITS = Object.freeze({ count: 500, text: 200, id: 200, ref: 128, cloud_points: 64, leader_points: 16, offset_mm: 10_000 });

// 앵커: 모델 객체(ref) 위의 한 점. vertex = 꼭짓점 index, edge = index번째 변(index → index+1)의 at(start·end·mid, 기본 mid), center = 외곽 상자 중심.
export const anchorSchema = z
  .object({
    ref: z.string().min(1).max(ANNOTATION_LIMITS.ref),
    part: z.enum(["vertex", "edge", "center"]),
    index: z.number().int().nonnegative().optional(),
    at: z.enum(["start", "end", "mid"]).optional(),
  })
  .strict();
export type Anchor = z.infer<typeof anchorSchema>;

const idSchema = z.string().min(1).max(ANNOTATION_LIMITS.id);
const textSchema = z.string().max(ANNOTATION_LIMITS.text);
// 용지 mm. 엔진이 0.01mm 로 반올림한다.
const paperMm = z.number().min(-ANNOTATION_LIMITS.offset_mm).max(ANNOTATION_LIMITS.offset_mm);

// 주석 편집층(03_SCREENS_UX.md 9.6절). override = 자동 주석 1개의 이동·문구·숨김(옛 annotation_overrides), 나머지는 사람 주석(A-ANNO-USER).
export const annotationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: idSchema,
      kind: z.literal("override"),
      target: z.string(),
      dx_mm: paperMm.optional(),
      dy_mm: paperMm.optional(),
      text: textSchema.optional(),
      hidden: z.boolean().optional(),
    })
    .strict(),
  // 치수 값은 사람이 넣지 않는다: 두 앵커 사이 거리를 엔진이 채운다. text 의 {값} 자리에 들어간다(기본 "{값}").
  z.object({ id: idSchema, kind: z.literal("dim"), a: anchorSchema, b: anchorSchema, offset_mm: paperMm, text: textSchema.optional() }).strict(),
  // anchor 가 없으면 용지 좌표(dx_mm, dy_mm) 자유 메모, 있으면 앵커 + 용지 mm 오프셋.
  z.object({ id: idSchema, kind: z.literal("text"), anchor: anchorSchema.optional(), dx_mm: paperMm, dy_mm: paperMm, text: textSchema }).strict(),
  z
    .object({
      id: idSchema,
      kind: z.literal("leader"),
      anchors: z.array(anchorSchema).min(1).max(ANNOTATION_LIMITS.leader_points),
      dx_mm: paperMm,
      dy_mm: paperMm,
      text: textSchema,
    })
    .strict(),
  z.object({ id: idSchema, kind: z.literal("cloud"), anchors: z.array(anchorSchema).min(3).max(ANNOTATION_LIMITS.cloud_points), text: textSchema.optional() }).strict(),
]);
export type SheetAnnotation = z.infer<typeof annotationSchema>;

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
    // 주석만. 형상은 고칠 수 없다. 빈 배열은 저장하지 않는다(normalizeSheetSpec).
    annotations: z.array(annotationSchema).max(ANNOTATION_LIMITS.count).optional(),
    include_in_proposal: z.boolean(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const [i, a] of (spec.annotations ?? []).entries()) {
      if (seen.has(a.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["annotations", i, "id"], message: "주석 id 중복" });
      seen.add(a.id);
    }
  });
export type SheetSpec = z.infer<typeof sheetSpecSchema>;

/** 빈 annotations 는 키를 뺀다(canonical 입력이 같아야 해시가 같다). 새 객체를 돌려준다. */
export function normalizeSheetSpec(spec: SheetSpec): SheetSpec {
  if (spec.annotations === undefined || spec.annotations.length > 0) return spec;
  const rest: SheetSpec = { ...spec };
  delete rest.annotations;
  return rest;
}

// ---- v1(annotation_overrides) 이행: 읽기 전용. 새 스키마는 옛 키를 거부한다. ----
const legacySheetSpecSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["site_plan", "area_plan", "sunlight_section", "floor_plan", "elevation"]),
    paper: paperSchema,
    orientation: z.enum(["landscape", "portrait"]),
    scale: z.union([z.literal("auto"), z.literal(100), z.literal(200), z.literal(300), z.literal(500), z.literal(600)]),
    floor_id: z.string().optional(),
    section_line: z.object({ a: pointSchema, b: pointSchema }).strict().optional(),
    elevation_face: z.enum(["N", "S", "E", "W"]).optional(),
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

const NOTE_TARGET = "note:";

/**
 * 옛 SheetSpec(annotation_overrides) → 새 SheetSpec. 같은 target 은 뒤 항목의 칸이 이기는 병합 결과 하나(`ov-<target>`),
 * `note:<id>` 는 text 주석 `note-<id>`(숨김·빈 문구 메모는 출력이 없었으므로 뺀다). id 사전순. 실패하면 null(그 시트만 버린다).
 */
export function migrateLegacySheetSpec(raw: unknown): SheetSpec | null {
  const old = legacySheetSpecSchema.safeParse(raw);
  if (!old.success) return null;
  const { annotation_overrides, ...rest } = old.data;
  const merged = new Map<string, (typeof annotation_overrides)[number]>();
  for (const o of annotation_overrides) merged.set(o.target, { ...merged.get(o.target), ...o });
  const list: SheetAnnotation[] = [];
  for (const [target, o] of merged) {
    if (target.startsWith(NOTE_TARGET)) {
      if (o.hidden === true || typeof o.text !== "string" || o.text.trim() === "") continue;
      list.push({ id: `note-${target.slice(NOTE_TARGET.length)}`, kind: "text", dx_mm: o.dx_mm ?? 0, dy_mm: o.dy_mm ?? 0, text: o.text });
      continue;
    }
    list.push({
      id: `ov-${target}`,
      kind: "override",
      target,
      ...(o.dx_mm === undefined ? {} : { dx_mm: o.dx_mm }),
      ...(o.dy_mm === undefined ? {} : { dy_mm: o.dy_mm }),
      ...(o.text === undefined ? {} : { text: o.text }),
      ...(o.hidden === undefined ? {} : { hidden: o.hidden }),
    });
  }
  list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = sheetSpecSchema.safeParse({ ...rest, ...(list.length > 0 ? { annotations: list } : {}) });
  return next.success ? next.data : null;
}

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
