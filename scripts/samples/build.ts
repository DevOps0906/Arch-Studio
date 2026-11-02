// 랜딩 샘플 도면 생성(AR-06-033): 도면 엔진(뷰 생성기 → buildSheet → writeDxf)의 실제 출력만 apps/web/public/samples/ 에 쓴다.
// 실행: pnpm --filter ./apps/web samples:build   (직접: node scripts/samples/build.ts [--out <dir>])
// 입력은 결정적 고정값(예시 대지 3건, 가상). 법규 수치는 예시이며 법규 판정이 아니다. 시각·난수 없음 → 같은 입력, 같은 바이트.
// scripts/*는 워크스페이스 패키지가 아니므로 drafting 소스를 상대 경로로 import한다(린트 경계: scripts에는 제한 없음).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildAreaPlanView,
  buildSheet,
  buildSitePlanView,
  buildSunlightSectionView,
  validateDraftingInput,
  type DraftingInput,
  type SheetModel,
  type SunlightEnvelopeInput,
} from "../../packages/drafting/src/index.ts";
import { DXF_WRITER_VERSION, writeDxf } from "../../packages/drafting/src/writers/dxf/index.ts";

type Model = DraftingInput["model"];
type Pt = [number, number];

export const NOTICE = "체험용 예시 도면입니다. 가상 대지와 예시 수치로 만들었으며 법규 판정이 아니고 인허가 설계도서가 아닙니다.";
const EXAMPLE_BASIS = [{ law: "예시 수치(법규 판정 아님)", article: "-", effective_from: "2026-01-01", ordinance: false }];
const ENGINE_VERSION = "0.0.0";
const DATE = "2026-10-29";
const RULE_PACK = "2026.10.0";

const rect = (x: number, y: number, w: number, h: number): { outer: Pt[] } => ({
  outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
});
const m2 = (w_mm: number, h_mm: number) => (w_mm * h_mm) / 1_000_000;
/** 비율(%) 소수 둘째 자리 반올림 */
const pct = (a: number, b: number) => Math.round((a / b) * 10_000) / 100;

function baseModel(w: number, h: number, masses: Model["masses"], label: string, zoning = "제2종일반주거지역"): Model {
  return {
    schema_version: 1,
    units: "mm",
    site: {
      boundary: rect(0, 0, w, h),
      north_angle_deg: 0,
      roads: [{ edge_index: 0, width_mm: 6_000 }],
      zoning: { use_district: zoning, districts: [] },
      parcel: { pnu: "0000000000000000000", address_label: label },
    },
    rule_context: { rule_pack_version: RULE_PACK, application_date: "2026-11-01", municipality_code: "00000", ordinance_applied: true },
    masses,
    floor_layouts: [],
    program: { checklist_answers: {}, targets: [], user_locked_rows: [] },
    meta: { created_by_engine_version: ENGINE_VERSION },
  };
}

const floors = (id: string, uses: string[]) => uses.map((use, i) => ({ id: `${id}-f${i + 1}`, level: i + 1, height_mm: 3_000, use }));

function inputOf(model: Model, kind: DraftingInput["sheet"]["kind"], projectName: string, items: DraftingInput["judgment"]["items"]): DraftingInput {
  return {
    model,
    judgment: { engine_version: ENGINE_VERSION, rule_pack_version: RULE_PACK, application_date: model.rule_context.application_date, items, pending_changes: 0 },
    sheet: { id: `sample-${kind}`, kind, paper: "A3", orientation: "landscape", scale: "auto", annotations: [], include_in_proposal: false },
    profile: { office_name: "예시 사무소(가상)", layer_map: {}, default_paper: "A3", default_text_height_mm: 2.5, font_family: "Pretendard" },
    license: { drafting_watermark: true },
    engine_version: ENGINE_VERSION,
    project_name: projectName,
    date: DATE,
  };
}

function validated(input: DraftingInput): DraftingInput {
  const r = validateDraftingInput(input);
  if (!r.ok) throw new Error(`${r.code}: ${r.issues.join("; ")}`);
  return r.input;
}

export interface SampleDef {
  id: "site-plan" | "area-plan" | "sunlight-section";
  file: string;
  title: string;
  site: string;
  sheet_kind: string;
  build(): SheetModel;
}

function sitePlan(): SheetModel {
  const mass = rect(5_000, 8_000, 15_000, 8_000);
  const site = m2(30_000, 20_000);
  const cov = pct(m2(15_000, 8_000), site);
  const model = baseModel(
    30_000,
    20_000,
    [{ id: "m1", footprint: mass, base_level_mm: 0, floors: floors("m1", ["단독주택"]), roof: { type: "flat" } }],
    "예시 대지 1(가상 지번)",
  );
  const input = validated(
    inputOf(model, "site_plan", "예시 대지 1(가상)", [
      { key: "coverage", verdict: "WARN", value: cov, unit: "pct", basis: EXAMPLE_BASIS },
      { key: "far", verdict: "WARN", value: cov, unit: "pct", basis: EXAMPLE_BASIS },
      { key: "setback", verdict: "WARN", value: 4_000, unit: "mm", basis: EXAMPLE_BASIS },
      { key: "parking", verdict: "WARN", value: 6, unit: "count", basis: EXAMPLE_BASIS },
    ]),
  );
  return buildSheet(input, buildSitePlanView(input, { parking_accessible: 1 })).sheet;
}

function areaPlan(): SheetModel {
  const a = rect(1_000, 1_000, 9_000, 7_000);
  const b = rect(8_000, 5_000, 6_000, 6_000);
  const model = baseModel(
    20_000,
    15_000,
    [
      { id: "m1", footprint: a, base_level_mm: 0, floors: floors("m1", ["근린생활시설", "단독주택"]), roof: { type: "flat" } },
      { id: "m2", footprint: b, base_level_mm: 0, floors: floors("m2", ["창고"]), roof: { type: "flat" } },
    ],
    "예시 대지 2(가상 지번)",
    "제1종일반주거지역",
  );
  const site = m2(20_000, 15_000);
  // 건축면적 = 1층 합집합 = 63 + 36 - 겹침(x 8000~10000, y 5000~8000 = 6) = 93㎡. 연면적 = 93 + 63 = 156㎡.
  const building = m2(9_000, 7_000) + m2(6_000, 6_000) - m2(2_000, 3_000);
  const gross = building + m2(9_000, 7_000);
  const input = validated(
    inputOf(model, "area_plan", "예시 대지 2(가상)", [
      { key: "coverage", verdict: "WARN", value: pct(building, site), unit: "pct", basis: EXAMPLE_BASIS },
      { key: "far", verdict: "WARN", value: pct(gross, site), unit: "pct", basis: EXAMPLE_BASIS },
    ]),
  );
  return buildSheet(input, buildAreaPlanView(input)).sheet;
}

function sunlightSection(): SheetModel {
  const model = baseModel(
    20_000,
    15_000,
    [{ id: "m1", footprint: rect(2_000, 2_000, 12_000, 10_000), base_level_mm: 0, floors: floors("m1", ["단독주택", "단독주택", "단독주택"]), roof: { type: "flat" } }],
    "예시 대지 3(가상 지번)",
  );
  const input = validated(inputOf(model, "sunlight_section", "예시 대지 3(가상)", [{ key: "sunlight", verdict: "WARN", unit: "mm", basis: EXAMPLE_BASIS }]));
  // 예시 구간 값(법규 값 아님): 4m까지 1.2m, 7m까지 3m, 그 위는 거리 ≥ 높이 × 2/3.
  const envelope: SunlightEnvelopeInput = {
    rule_pack_version: RULE_PACK,
    application_date: model.rule_context.application_date,
    top_mm: 12_000,
    constraints: [
      {
        key: "sunlight",
        status: "applied",
        applied: true,
        rule_ids: ["sunlight.example"],
        basis: EXAMPLE_BASIS,
        reasons: [],
        applied_params: {
          bands: [
            { up_to_mm: 4_000, min_distance_mm: 1_200 },
            { up_to_mm: 7_000, min_distance_mm: 3_000 },
            { up_to_mm: null, distance_ratio: { num: 2, den: 3 } },
          ],
          road_edges: "exempt",
        },
      },
    ],
  };
  return buildSheet(input, buildSunlightSectionView(input, envelope)).sheet;
}

export const SAMPLES: readonly SampleDef[] = [
  { id: "site-plan", file: "site-plan.dxf", title: "배치도", site: "예시 대지 1", sheet_kind: "site_plan", build: sitePlan },
  { id: "area-plan", file: "area-plan.dxf", title: "면적 산정도", site: "예시 대지 2", sheet_kind: "area_plan", build: areaPlan },
  { id: "sunlight-section", file: "sunlight-section.dxf", title: "일조사선 단면", site: "예시 대지 3", sheet_kind: "sunlight_section", build: sunlightSection },
];

export interface SamplesOutput {
  files: Map<string, Buffer>;
  manifest: Record<string, unknown>;
}

/** 파일 이름 → 바이트, 그리고 manifest.json. 생성일 없음(결정적). */
export function generate(): SamplesOutput {
  const files = new Map<string, Buffer>();
  const entries = SAMPLES.map((s) => {
    const sheet = s.build();
    const bytes = Buffer.from(writeDxf(sheet).text, "utf8");
    files.set(s.file, bytes);
    return {
      id: s.id,
      file: s.file,
      title: s.title,
      site: s.site,
      sheet_kind: s.sheet_kind,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      input_hash: sheet.input_hash,
    };
  });
  const manifest = {
    schema_version: 1,
    notice: NOTICE,
    format: "DXF(AutoCAD 2013, AC1027)",
    engine_version: ENGINE_VERSION,
    dxf_writer_version: DXF_WRITER_VERSION,
    samples: entries,
  };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
  return { files, manifest };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const out = i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fileURLToPath(new URL("../../apps/web/public/samples/", import.meta.url));
  mkdirSync(out, { recursive: true });
  const { files } = generate();
  for (const [name, bytes] of files) writeFileSync(`${out}/${name}`, bytes);
  console.log(`샘플 ${files.size - 1}건 + manifest.json -> ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
