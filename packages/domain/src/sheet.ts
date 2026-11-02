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
  // 사람 주석(AR-06-086). 맨 뒤에 둬 기존 레이어의 표 순서·매핑 결과를 바꾸지 않는다. 출력 레이어 표·SVG 그룹에는 쓸 때만 낸다.
  "A-ANNO-USER",
] as const;
export const stdLayerSchema = z.enum(STD_LAYERS);
export type StdLayer = z.infer<typeof stdLayerSchema>;

export const paperSchema = z.enum(["A3", "A2", "A1"]);

/* ---------- 도면 주석 편집층(AR-06-086, 03_SCREENS_UX.md 9.6절) ---------- */

/** 시트당 주석 상한·문자 상한(tasks/logs/AR-06-086.md [DECISION] 8). */
export const ANNOTATIONS_MAX = 500;
export const ANNOTATION_TEXT_MAX = 200;
/** 이행분 id 접두(`ov-` + 기존 target)와 사용자 주석 id 접두. 엔진 anno_id(`dim:`·`label:`…)와 겹치지 않는다. */
export const OVERRIDE_ID_PREFIX = "ov-";
export const USER_ID_PREFIX = "u-";
/** 기존 자유 메모 target 접두. 이행 후에는 `kind: "text"`(앵커 없음)로만 남는다. */
export const NOTE_TARGET_PREFIX = "note:";

const USER_ID = /^u-[A-Za-z0-9_.:-]{1,64}$/;
const annoText = z.string().max(ANNOTATION_TEXT_MAX);
/** 용지 mm 오프셋. 유한한 수만(엔진이 0.01mm로 반올림한다). */
const paperMm = z.number().finite();

/**
 * 앵커: 모델 객체 id(`ref`) + 부위. id가 없는 대상은 예약 ref `site:boundary`·`road:<edge_index>`·`line:setback`.
 * `snap`은 고를 때의 기준 좌표(모델 mm 정수). 해석 좌표가 다르면(인덱스 밀림 등) 고아로 본다 — 틀린 위치에 찍지 않는다.
 */
export const anchorSchema = z
  .object({
    ref: z.string().min(1).max(128),
    part: z.enum(["vertex", "edge", "center"]),
    index: z.number().int().nonnegative().optional(),
    at: z.enum(["start", "end", "mid", "foot"]).optional(),
    snap: pointSchema,
  })
  .strict();
export type Anchor = z.infer<typeof anchorSchema>;

export const annotationSchema = z.discriminatedUnion("kind", [
  // 자동 주석 1개 옮기기·숨기기(기존 annotation_overrides). id = "ov-" + target. 치수·면적 값 문구는 바꿀 수 없다(엔진이 거부).
  z
    .object({
      id: z.string(),
      kind: z.literal("override"),
      target: z.string().min(1).max(128),
      dx_mm: paperMm.optional(),
      dy_mm: paperMm.optional(),
      text: annoText.optional(),
      hidden: z.boolean().optional(),
    })
    .strict(),
  // 사람 치수: 값은 엔진이 두 앵커 사이 거리로 채운다(`{값}`). 사람이 숫자를 넣지 않는다.
  z
    .object({ id: z.string(), kind: z.literal("dim"), a: anchorSchema, b: anchorSchema, offset_mm: paperMm, text: annoText.optional() })
    .strict(),
  // 문자: 앵커가 없으면 용지 좌표(dx_mm, dy_mm)에 고정(이행한 자유 메모).
  z
    .object({
      id: z.string(),
      kind: z.literal("text"),
      anchor: anchorSchema.optional(),
      dx_mm: paperMm,
      dy_mm: paperMm,
      text: annoText,
      hidden: z.boolean().optional(),
    })
    .strict(),
  z.object({ id: z.string(), kind: z.literal("leader"), anchor: anchorSchema, dx_mm: paperMm, dy_mm: paperMm, text: annoText }).strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("cloud"),
      anchor: anchorSchema,
      dx_mm: paperMm,
      dy_mm: paperMm,
      text: annoText,
      size_mm: z.number().finite().positive().max(400).optional(),
    })
    .strict(),
]);
export type SheetAnnotation = z.infer<typeof annotationSchema>;

/** id 형식 위반 사유(없으면 null). override = "ov-" + target, 이행 메모 = "ov-note:…", 그 밖은 "u-…". */
export function annotationIdIssue(a: SheetAnnotation): string | null {
  if (a.kind === "override") {
    if (a.target.startsWith(NOTE_TARGET_PREFIX)) return "자유 메모는 kind \"text\"로 둡니다";
    return a.id === OVERRIDE_ID_PREFIX + a.target ? null : `override id는 "${OVERRIDE_ID_PREFIX}" + target이어야 합니다`;
  }
  if (a.kind === "text" && a.id.startsWith(OVERRIDE_ID_PREFIX + NOTE_TARGET_PREFIX)) {
    return a.id.length <= OVERRIDE_ID_PREFIX.length + 128 && a.anchor === undefined ? null : "이행 메모는 앵커가 없습니다";
  }
  return USER_ID.test(a.id) ? null : `사용자 주석 id는 "${USER_ID_PREFIX}"로 시작합니다`;
}

export const annotationsSchema = z
  .array(annotationSchema)
  .max(ANNOTATIONS_MAX)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((a, i) => {
      const issue = annotationIdIssue(a);
      if (issue !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "id"], message: issue });
      if (seen.has(a.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "id"], message: `주석 id 중복: ${a.id}` });
      seen.add(a.id);
    });
  });

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
    // 주석만. 형상은 고칠 수 없다. 그리기 순서는 id 사전순(배열 순서 무관)
    annotations: annotationsSchema,
    include_in_proposal: z.boolean(),
  })
  .strict();
export type SheetSpec = z.infer<typeof sheetSpecSchema>;

/* ---------- 이행: annotation_overrides(v1 저장본) → annotations ---------- */

interface LegacyOverride {
  target: string;
  dx_mm?: number;
  dy_mm?: number;
  text?: string;
  hidden?: boolean;
}

const LEGACY_KEYS = new Set(["target", "dx_mm", "dy_mm", "text", "hidden"]);

function asLegacyOverride(v: unknown): LegacyOverride | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !LEGACY_KEYS.has(k))) return null;
  if (typeof o.target !== "string" || o.target === "") return null;
  for (const k of ["dx_mm", "dy_mm"] as const) if (o[k] !== undefined && typeof o[k] !== "number") return null;
  if (o.text !== undefined && typeof o.text !== "string") return null;
  if (o.hidden !== undefined && typeof o.hidden !== "boolean") return null;
  return o as unknown as LegacyOverride;
}

/**
 * 기존 annotation_overrides 배열 → annotations(tasks/logs/AR-06-086.md [DECISION] 3).
 * 같은 target은 기존 의미대로 칸 단위로 합치고(뒤 항목이 이김) `id = "ov-" + target` 1건.
 * `note:` target은 앵커 없는 `kind: "text"`(용지 좌표 그대로, 위치 이동 0). 형식이 틀린 항목은 그 항목만 버리고 개수를 센다.
 */
export function migrateAnnotationOverrides(raw: unknown): { annotations: SheetAnnotation[]; dropped: number } {
  if (!Array.isArray(raw)) return { annotations: [], dropped: raw === undefined ? 0 : 1 };
  let dropped = 0;
  const merged = new Map<string, LegacyOverride>();
  for (const item of raw) {
    const o = asLegacyOverride(item);
    if (o === null) {
      dropped++;
      continue;
    }
    merged.set(o.target, { ...merged.get(o.target), ...o });
  }
  const out: SheetAnnotation[] = [];
  for (const [target, o] of merged) {
    let a: SheetAnnotation;
    if (target.startsWith(NOTE_TARGET_PREFIX)) {
      a = { id: OVERRIDE_ID_PREFIX + target, kind: "text", dx_mm: o.dx_mm ?? 0, dy_mm: o.dy_mm ?? 0, text: o.text ?? "" };
      if (o.hidden !== undefined) a.hidden = o.hidden;
    } else {
      a = { id: OVERRIDE_ID_PREFIX + target, kind: "override", target };
      if (o.dx_mm !== undefined) a.dx_mm = o.dx_mm;
      if (o.dy_mm !== undefined) a.dy_mm = o.dy_mm;
      if (o.text !== undefined) a.text = o.text;
      if (o.hidden !== undefined) a.hidden = o.hidden;
    }
    const r = annotationSchema.safeParse(a);
    if (!r.success || annotationIdIssue(r.data) !== null || out.length >= ANNOTATIONS_MAX) {
      dropped++;
      continue;
    }
    out.push(r.data);
  }
  return { annotations: out, dropped };
}

/**
 * v1 SheetSpec(annotation_overrides) → v2 SheetSpec 후보. `annotation_overrides`가 없으면(이미 v2) 그대로 돌려준다.
 * 결과는 호출자가 sheetSpecSchema로 다시 검사한다(이행 함수는 safeParse 앞에서 실행, [DECISION] 2).
 */
export function migrateSheetSpecV1(raw: unknown): { spec: unknown; dropped: number } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { spec: raw, dropped: 0 };
  const o = raw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(o, "annotation_overrides") || Object.prototype.hasOwnProperty.call(o, "annotations")) {
    return { spec: raw, dropped: 0 };
  }
  const { annotation_overrides, ...rest } = o;
  const m = migrateAnnotationOverrides(annotation_overrides);
  return { spec: { ...rest, annotations: m.annotations }, dropped: m.dropped };
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
