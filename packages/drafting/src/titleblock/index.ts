// 표제란(02_ARCHITECTURE.md 2.3절 "표제란", PRD 9.1·9.4·9.7절). 고지는 이 파일의 상수이고
// DraftingProfile·annotations(덮어쓰기) 어느 쪽에서도 바꾸거나 지울 경로가 없다(표제란은 paper_prims라 덮어쓰기 대상 밖).
// 건축사 날인·서명란은 만들지 않는다(PRD 9.7절).
import type { DraftingProfile } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import { DraftingError } from "../sheet/errors.ts";
import { frameRect, TITLE_BAND_H } from "../sheet/paper.ts";
import type { LicenseFlags, Orientation, PaperSize, PaperUm, Prim, Scale, SheetKind, TitleBlockValues } from "../sheet/types.ts";

export const DISCLAIMER = "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다" as const;
export const WATERMARK_TEXT = "체험판";
export const DISCLAIMER_KEY = "ttlb:disclaimer";

export function pendingLabel(n: number): string {
  return `이후 개정 ${n}건`;
}

export const SHEET_TITLES: Readonly<Record<SheetKind, string>> = Object.freeze({
  site_plan: "배치도",
  area_plan: "면적 산정도",
  sunlight_section: "일조사선 단면 개략도",
  floor_plan: "평면 개략도",
  elevation: "입면 개략도",
});

export interface TitleBlockInput {
  profile: Pick<DraftingProfile, "office_name" | "default_text_height_mm">;
  kind: SheetKind;
  paper: PaperSize;
  orientation: Orientation;
  scale: Scale;
  project_name: string;
  date: string;
  rule_pack_version: string;
  license: LicenseFlags;
}

/** 고지 글자 최소 높이 2.5mm. PRD 9.7절에 수치 기준이 없어 정한 값(근거 미확인, tasks/logs/AR-06-020.md). 프로필 값과 무관하게 이 값 이상. */
export const DISCLAIMER_MIN_H: PaperUm = 250;

const DISCLAIMER_ROW_H: PaperUm = 1_000; // 띠 아래 10mm 줄: 고지·체험판
const LABEL_H: PaperUm = 200;
const PAD: PaperUm = 150;

/** 문자 높이(용지 mm, 실수) → 0.01mm 정수. 0.01mm 반올림 결과가 0 이하면(예: 0.001mm) INVALID_ARGUMENT. */
export function textHeightUm(mm: number): PaperUm {
  const um = Number.isFinite(mm) ? roundHalfAway(mm * 100) : 0;
  if (!(um > 0)) throw new DraftingError("INVALID_ARGUMENT", `문자 높이는 0.01mm 이상이어야 합니다: ${mm}`);
  return um;
}

export function buildTitleBlock(input: TitleBlockInput): { values: TitleBlockValues; prims: Prim<PaperUm>[] } {
  const fb = input.license.fallback_revisions;
  if (fb !== undefined && !(Number.isSafeInteger(fb) && fb >= 0)) {
    throw new DraftingError("INVALID_ARGUMENT", `fallback_revisions는 0 이상 정수여야 합니다: ${fb}`);
  }
  const values: TitleBlockValues = {
    office_name: input.profile.office_name,
    project_name: input.project_name,
    sheet_title: SHEET_TITLES[input.kind],
    scale_label: `1/${input.scale}`,
    date: input.date,
    rule_pack_version: input.rule_pack_version,
    disclaimer: DISCLAIMER,
    watermark: input.license.drafting_watermark === true,
  };
  if (fb !== undefined) values.pending_changes = fb;

  const h = textHeightUm(input.profile.default_text_height_mm);
  const f = frameRect(input.paper, input.orientation);
  const bandTop = f.y0 + TITLE_BAND_H;
  const rowTop = f.y0 + DISCLAIMER_ROW_H;
  const L = "A-TTLB" as const;
  const prims: Prim<PaperUm>[] = [
    { layer: L, key: "ttlb:frame", t: "pline", closed: true, pts: [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]] },
    { layer: L, key: "ttlb:band", t: "line", a: [f.x0, bandTop], b: [f.x1, bandTop] },
    { layer: L, key: "ttlb:row", t: "line", a: [f.x0, rowTop], b: [f.x1, rowTop] },
  ];

  // 위 줄 6칸: [키, 칸 제목, 값, 값 출처(source_ref)].
  const fields: Array<[string, string, string, string]> = [
    ["office", "사무소", values.office_name, "profile.office_name"],
    ["project", "프로젝트", values.project_name, "input.project_name"],
    ["title", "도면명", values.sheet_title, "sheet.kind"],
    ["scale", "축척", values.scale_label, "sheet.scale"],
    ["date", "작성일", values.date, "input.date"],
    ["rule_pack", "규칙 팩", values.rule_pack_version, "judgment.rule_pack_version"],
  ];
  const cw = Math.floor((f.x1 - f.x0) / fields.length);
  fields.forEach(([id, label, value, ref], i) => {
    const cx = f.x0 + i * cw;
    const n = i + 1;
    if (i > 0) prims.push({ layer: L, key: `ttlb:col:${n}`, t: "line", a: [cx, rowTop], b: [cx, bandTop] });
    prims.push(
      { layer: L, key: `ttlb:f${n}:${id}:label`, t: "text", at: [cx + PAD, bandTop - PAD - LABEL_H], h: LABEL_H, s: label, align: "l" },
      { layer: L, key: `ttlb:f${n}:${id}:value`, t: "text", at: [cx + PAD, rowTop + 2 * h], h, s: value, align: "l", source_ref: ref },
    );
    if (id === "rule_pack" && fb !== undefined) {
      prims.push({
        layer: L,
        key: `ttlb:f${n}:${id}:pending`,
        t: "text",
        at: [cx + PAD, rowTop + PAD],
        h: LABEL_H,
        s: pendingLabel(fb),
        align: "l",
        source_ref: "license.fallback_revisions",
      });
    }
  });

  const dh = Math.max(h, DISCLAIMER_MIN_H);
  prims.push({ layer: L, key: DISCLAIMER_KEY, t: "text", at: [f.x0 + PAD, f.y0 + PAD * 2], h: dh, s: DISCLAIMER, align: "l" });
  if (values.watermark) {
    prims.push({ layer: L, key: "ttlb:watermark", t: "text", at: [f.x1 - PAD, f.y0 + PAD * 2], h, s: WATERMARK_TEXT, align: "r" });
  }
  return { values, prims };
}

/**
 * 고지 엔티티 확인: A-TTLB TEXT, 문구 동일, 높이 ≥ DISCLAIMER_MIN_H(> 0). 작성기(021·022)가 출력 직전에 다시 부른다.
 * 없으면 DISCLAIMER_MISSING.
 */
export function assertDisclaimer(paperPrims: readonly Prim<PaperUm>[]): void {
  const ok = paperPrims.some(
    (p) => p.t === "text" && p.layer === "A-TTLB" && p.s === DISCLAIMER && Number.isSafeInteger(p.h) && p.h >= DISCLAIMER_MIN_H,
  );
  if (!ok) throw new DraftingError("DISCLAIMER_MISSING", "표제란 고지 문구가 없습니다");
}
