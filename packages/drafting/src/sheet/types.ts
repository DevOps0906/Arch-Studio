// SheetModel 계약(04_API.md 4.7.4, 02_ARCHITECTURE.md 2.3절). 뷰 안 형상은 모델 mm 정수, 용지 고정 요소는 0.01mm 정수.
import type { DesignModelV1, DraftingProfile, JudgmentResult, SheetSpec } from "@arch-studio/domain";
import type { DraftLayer } from "../layers/index.ts";

/** 모델 좌표(정수 mm). */
export type Mm = number;
/** 용지 좌표·문자 높이(정수 0.01mm). */
export type PaperUm = number;
export type Vec<U> = [U, U];

export type Scale = 100 | 200 | 300 | 500 | 600;
export type PaperSize = SheetSpec["paper"];
export type Orientation = SheetSpec["orientation"];
export type SheetKind = SheetSpec["kind"];

/** 엔티티 종류. 이 배열 순서가 조립 정렬의 "엔티티 종류" 순서다. */
export const PRIM_KINDS = ["line", "pline", "arc", "circle", "text", "mtext", "hatch", "insert"] as const;
export type PrimKind = (typeof PRIM_KINDS)[number];

/** key: 결정적 정렬 키(같은 컨테이너 안에서 유일). 수치 TEXT는 source_ref 필수. */
export type Prim<U> = { layer: DraftLayer; key: string } & (
  | { t: "line"; a: Vec<U>; b: Vec<U> }
  | { t: "pline"; pts: Vec<U>[]; closed: boolean }
  | { t: "arc"; c: Vec<U>; r: U; a0: number; a1: number }
  | { t: "circle"; c: Vec<U>; r: U }
  | { t: "text"; at: Vec<U>; h: PaperUm; s: string; align: "l" | "c" | "r"; source_ref?: string }
  | { t: "mtext"; at: Vec<U>; h: PaperUm; width: PaperUm; s: string }
  | { t: "hatch"; loops: Vec<U>[][]; pattern: "SOLID" | "ANSI31" }
  | { t: "insert"; block: string; at: Vec<U>; rot_deg: 0 | 90 | 180 | 270 }
);

export type AnnotationKind = "dim" | "label" | "warning" | "note";

/**
 * 주석. view_id가 있으면 prims는 그 뷰의 모델 mm, 없으면 용지 0.01mm(계약 4.7.4의 `Prim<Mm | PaperUm>`를 구분하려고 추가).
 */
export interface Annotation {
  anno_id: string;
  kind: AnnotationKind;
  view_id?: string;
  prims: Prim<Mm | PaperUm>[];
  overridable: Array<"offset" | "hide">;
}

export interface SheetView {
  view_id: string;
  origin: Vec<PaperUm>;
  prims: Prim<Mm>[];
}

export interface BlockDef {
  name: string;
  entities: Prim<Mm>[];
}

export interface TitleBlockValues {
  office_name: string;
  project_name: string;
  sheet_title: string;
  scale_label: string;
  date: string;
  rule_pack_version: string;
  pending_changes?: number;
  disclaimer: "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다";
  watermark: boolean;
}

export interface SheetChecks {
  area_table_m2: Record<string, number>;
  parking_count?: number;
  min_setback_mm?: number;
}

export interface SheetWarning {
  code: "AR057" | "AR058";
  detail: string;
}

export interface SheetModel {
  sheet_id: string;
  kind: SheetKind;
  engine_version: string;
  input_hash: string;
  paper: { size: PaperSize; orientation: Orientation; w: PaperUm; h: PaperUm };
  scale: Scale;
  views: SheetView[];
  paper_prims: Prim<PaperUm>[];
  annotations: Annotation[];
  blocks: BlockDef[];
  title_block: TitleBlockValues;
  warnings: SheetWarning[];
  checks: SheetChecks;
}

export interface LicenseFlags {
  drafting_watermark: boolean;
  /** 폴백(업데이트 만료) 상태일 때만 넣는다 → 표제란 "이후 개정 n건". */
  fallback_revisions?: number;
}

/**
 * 도면 엔진 입력(02_ARCHITECTURE.md 2.3절 DraftingInput). project_name·date는 표제란 값이라 호출자가 넘긴다
 * (엔진은 시각을 읽지 않는다. date = SheetSpec 저장 시각의 날짜 YYYY-MM-DD).
 */
export interface DraftingInput {
  model: DesignModelV1;
  judgment: JudgmentResult;
  sheet: SheetSpec;
  profile: DraftingProfile;
  license: LicenseFlags;
  engine_version: string;
  project_name: string;
  date: string;
}
