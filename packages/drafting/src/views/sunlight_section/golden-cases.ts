// sunlight_section 골든 케이스 정의(AR-06-025). 골든 = golden/sunlight_section-<id>/{sheet.json, sheet.sha256, meta.json}.
import { buildSheet, canonicalJson, sha256Hex, validateDraftingInput, type SheetModel } from "../../index.ts";
import { buildSunlightSectionView } from "./index.ts";
import { envelopeOf, sectionInput, sectionModel } from "./fixtures.ts";

export interface SunlightGoldenCase {
  id: string;
  note: string;
  build(): SheetModel;
}

function make(
  model: ReturnType<typeof sectionModel>,
  kind: "old" | "new" | "unverified",
  sheet: Parameters<typeof sectionInput>[1] = {},
  standard?: "new" | "old",
): SheetModel {
  const v = validateDraftingInput(sectionInput(model, sheet));
  if (!v.ok) throw new Error(`${v.code}: ${v.issues.join("; ")}`);
  const env = envelopeOf(kind, { application_date: model.rule_context.application_date });
  return buildSheet(v.input, buildSunlightSectionView(v.input, env, standard ? { standard } : {})).sheet;
}

export const SUNLIGHT_CASES: readonly SunlightGoldenCase[] = [
  {
    id: "sunlight_section-new",
    note: "신 기준(시행 2000-07-01) 신청일 2000-08-01, 2층 매스 — 초과 없음",
    build: () => make(sectionModel({ date: "2000-08-01" }), "new", {}, "new"),
  },
  {
    id: "sunlight_section-old",
    note: "구 기준(시행 2000-01-01) 신청일 2000-06-30, 같은 매스 — 사선 초과 있음(신 기준과 쌍)",
    build: () => make(sectionModel({ date: "2000-06-30" }), "old", {}, "old"),
  },
  {
    id: "sunlight_section-excess",
    note: "신 기준, 3층 매스(9m) — 7m 위 비율 구간에서 사선 초과",
    build: () => make(sectionModel({ date: "2000-08-01", floors: 3 }), "new", {}, "new"),
  },
  {
    id: "sunlight_section-line",
    note: "section_line 지정(x=5000 정북 직선), 구 기준 3층",
    build: () =>
      make(sectionModel({ date: "2000-06-30", floors: 3 }), "old", { section_line: { a: [5000, 0], b: [5000, 15_000] } }, "old"),
  },
  {
    id: "sunlight_section-unverified",
    note: "일조사선 미확인(적용 안 함) — 사선·초과 없이 미적용 라벨",
    build: () => make(sectionModel({ date: "2026-11-02" }), "unverified"),
  },
];

export interface SunlightGoldenFiles {
  "sheet.json": string;
  "sheet.sha256": string;
  "meta.json": string;
}

export function sunlightGoldenFiles(c: SunlightGoldenCase): SunlightGoldenFiles {
  const sheet = c.build();
  const json = canonicalJson(sheet) + "\n";
  const meta = { case_id: c.id, note: c.note, engine_version: sheet.engine_version, features: ["AR-F-031"] };
  return { "sheet.json": json, "sheet.sha256": sha256Hex(json) + "\n", "meta.json": JSON.stringify(meta, null, 2) + "\n" };
}
