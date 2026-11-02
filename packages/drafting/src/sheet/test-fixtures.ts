// 테스트·벤치 전용 고정 입력(배포 코드에서 import하지 않는다). 뷰 생성기(023~026)가 없어 단순 뷰를 직접 만든다.
import type { DesignModelV1, Polygon } from "@arch-studio/domain";
import { dimension, label } from "../annotate/index.ts";
import type { ViewModel } from "./build.ts";
import type { DraftingInput, Prim } from "./types.ts";

function rect(x: number, y: number, w: number, h: number): Polygon {
  return {
    outer: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

/** 대지 w×h(mm), 매스 masses개(격자), 실 rooms개(첫 매스 1층에 격자). */
export function sampleModel(opts: { w?: number; h?: number; masses?: number; rooms?: number } = {}): DesignModelV1 {
  const w = opts.w ?? 20_000;
  const h = opts.h ?? 15_000;
  const nm = opts.masses ?? 1;
  const nr = opts.rooms ?? 1;
  const cols = Math.ceil(Math.sqrt(nm));
  const cellW = Math.floor((w - 2_000) / cols);
  const cellH = Math.floor((h - 2_000) / Math.ceil(nm / cols));
  const masses: DesignModelV1["masses"] = [];
  for (let i = 0; i < nm; i++) {
    const cx = 1_000 + (i % cols) * cellW;
    const cy = 1_000 + Math.floor(i / cols) * cellH;
    const id = `m${String(i).padStart(3, "0")}`;
    masses.push({
      id,
      footprint: rect(cx + 200, cy + 200, cellW - 400, cellH - 400),
      base_level_mm: 0,
      floors: [{ id: `${id}-f1`, level: 1, height_mm: 3_000, use: "단독주택" }],
      roof: { type: "flat" },
    });
  }
  const rcols = Math.ceil(Math.sqrt(nr));
  const rw = Math.max(1, Math.floor((cellW - 400) / rcols));
  const rh = Math.max(1, Math.floor((cellH - 400) / Math.ceil(nr / rcols)));
  const rooms: DesignModelV1["floor_layouts"][number]["rooms"] = [];
  for (let i = 0; i < nr; i++) {
    rooms.push({
      id: `r${String(i).padStart(3, "0")}`,
      name: i % 2 === 0 ? "거실" : "침실",
      use: "거실",
      polygon: rect(1_200 + (i % rcols) * rw, 1_200 + Math.floor(i / rcols) * rh, rw, rh),
    });
  }
  return {
    schema_version: 1,
    units: "mm",
    site: {
      boundary: rect(0, 0, w, h),
      north_angle_deg: 0,
      roads: [{ edge_index: 0, width_mm: 6_000 }],
      zoning: { use_district: "제2종일반주거지역", districts: [] },
      parcel: { pnu: "1100000000000000000" },
    },
    rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-11-01", municipality_code: "11000", ordinance_applied: true },
    masses,
    floor_layouts: [{ floor_id: "m000-f1", rooms, openings: [] }],
    program: { checklist_answers: {}, targets: [], user_locked_rows: [] },
    meta: { created_by_engine_version: "0.0.0" },
  };
}

export function sampleInput(model: DesignModelV1 = sampleModel(), over: Partial<DraftingInput> = {}): DraftingInput {
  return {
    model,
    judgment: {
      engine_version: "0.0.0",
      rule_pack_version: model.rule_context.rule_pack_version,
      application_date: model.rule_context.application_date,
      items: [{ key: "setback", verdict: "PASS", value: 1200, limit: 1000, unit: "mm", basis: [] }],
      pending_changes: 0,
    },
    sheet: {
      id: "s1",
      kind: "site_plan",
      paper: "A3",
      orientation: "landscape",
      scale: "auto",
      include_in_proposal: false,
    },
    profile: { office_name: "테스트건축", layer_map: {}, default_paper: "A3", default_text_height_mm: 2.5, font_family: "Pretendard" },
    license: { drafting_watermark: false },
    engine_version: "0.0.0",
    project_name: "샘플 프로젝트",
    date: "2026-10-29",
    ...over,
  };
}

const ring = (p: Polygon) => p.outer.map(([x, y]) => [x, y] as [number, number]);

/** 대지·매스·실 외곽 pline + 매스별 이격 치수·실별 라벨 주석. */
export function sampleView(model: DesignModelV1): ViewModel {
  const prims: Prim<number>[] = [{ layer: "A-SITE-BNDY", key: "site", t: "pline", closed: true, pts: ring(model.site.boundary) }];
  for (const m of model.masses) prims.push({ layer: "A-MASS", key: `mass:${m.id}`, t: "pline", closed: true, pts: ring(m.footprint) });
  for (const l of model.floor_layouts) {
    for (const r of l.rooms) prims.push({ layer: "A-AREA", key: `room:${l.floor_id}:${r.id}`, t: "pline", closed: true, pts: ring(r.polygon) });
  }
  return {
    views: [{ view_id: "main", prims }],
    anchors: [
      { ref: "site", ring: ring(model.site.boundary) },
      ...model.masses.map((m) => ({ ref: m.id, ring: ring(m.footprint) })),
      ...model.floor_layouts.flatMap((l) => l.rooms.map((r) => ({ ref: r.id, ring: ring(r.polygon) }))),
    ],
    annotate: (ctx) => {
      const out = model.masses.map((m) => {
        const [x, y] = m.footprint.outer[0] as [number, number];
        return dimension(
          { anno_id: `dim:setback:edge0:mass-${m.id}`, view_id: "main", a: [x, 0], b: [x, y], offset: -500, value_mm: y, source_ref: `judgment.setback.${m.id}` },
          ctx,
        );
      });
      for (const l of model.floor_layouts) {
        for (const r of l.rooms) {
          const [x, y] = r.polygon.outer[0] as [number, number];
          out.push(
            label(
              {
                anno_id: `label:room:${r.id}`,
                kind: "label",
                view_id: "main",
                at: [x + 100, y + 100],
                lines: [{ s: r.name }, { kind: "value", s: "12.00㎡", source_ref: `geometry.area.${r.id}` }],
              },
              ctx,
            ),
          );
        }
      }
      return out;
    },
  };
}
