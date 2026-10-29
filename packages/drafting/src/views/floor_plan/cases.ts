// floor_plan 골든 케이스(테스트·골든 갱신 스크립트 전용, 배포 코드에서 import하지 않는다).
// 골든 = golden/floor_plan-<id>/{sheet.json, sheet.sha256, meta.json}, 거부 케이스는 {rejected.json, meta.json}.
import type { DesignModelV1, Polygon } from "@arch-studio/domain";
import { buildSheet } from "../../sheet/build.ts";
import { canonicalJson, sha256Hex } from "../../sheet/hash.ts";
import { sampleInput, sampleModel } from "../../sheet/test-fixtures.ts";
import type { DraftingInput, SheetModel } from "../../sheet/types.ts";
import { validateDraftingInput } from "../../sheet/validate.ts";
import { tryBuildFloorPlanView } from "./index.ts";

type Layout = DesignModelV1["floor_layouts"][number];

export const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  outer: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});

const flat = { type: "flat" as const };

/** 대지 20×15m, 매스(층 f1)와 실 배치 한 층. */
export function planModel(footprints: Polygon[], layout: Omit<Layout, "floor_id">, targets: DesignModelV1["program"]["targets"] = []): DesignModelV1 {
  const m = sampleModel();
  return {
    ...m,
    masses: footprints.map((footprint, i) => ({
      id: `m${i + 1}`,
      footprint,
      base_level_mm: 0,
      floors: [{ id: i === 0 ? "f1" : `m${i + 1}-1`, level: 1, height_mm: 3_000, use: "단독주택" }],
      roof: flat,
    })),
    floor_layouts: [{ floor_id: "f1", ...layout }],
    program: { ...m.program, targets },
  };
}

export function planInput(model: DesignModelV1, over: Partial<DraftingInput["sheet"]> = {}): DraftingInput {
  const base = sampleInput(model);
  return { ...base, sheet: { ...base.sheet, kind: "floor_plan", floor_id: "f1", ...over } };
}

const room = (id: string, name: string, polygon: Polygon) => ({ id, name, use: "주거", polygon });

export interface FloorPlanCase {
  id: string;
  note: string;
  input(): DraftingInput;
  /** true면 AR051 거부 케이스(rejected.json). */
  rejected?: boolean;
}

export const CASES: FloorPlanCase[] = [
  {
    id: "floor_plan-single-room",
    note: "단층 단순 평면: 외곽 8×6m 한 실, 문·창 없음, 외벽 200mm",
    input: () => planInput(planModel([rect(2_000, 2_000, 8_000, 6_000)], { rooms: [room("r1", "거실", rect(2_000, 2_000, 8_000, 6_000))], openings: [] })),
  },
  {
    id: "floor_plan-doors-windows",
    note: "두 실 + 현관문·내부 문(좌·우 경첩)·창 3개, 시계 방향 고리 실(국소 축 반전), 4방향 INSERT 회전",
    input: () =>
      planInput(
        planModel([rect(2_000, 2_000, 10_000, 6_000)], {
          rooms: [
            room("r1", "거실", rect(2_000, 2_000, 6_000, 6_000)),
            // 시계 방향으로 저장된 침실
            room("r2", "침실", { outer: [[8_000, 2_000], [8_000, 8_000], [12_000, 8_000], [12_000, 2_000]] }),
          ],
          openings: [
            { id: "d-entry", kind: "door", host: { room_id: "r1", edge_index: 0 }, offset_mm: 1_000, width_mm: 900, swing: "right" },
            { id: "d-inner", kind: "door", host: { room_id: "r1", edge_index: 1 }, offset_mm: 2_000, width_mm: 800, swing: "left" },
            { id: "w-living", kind: "window", host: { room_id: "r1", edge_index: 2 }, offset_mm: 1_500, width_mm: 2_400 },
            { id: "w-west", kind: "window", host: { room_id: "r1", edge_index: 3 }, offset_mm: 2_000, width_mm: 1_200 },
            { id: "w-bed", kind: "window", host: { room_id: "r2", edge_index: 2 }, offset_mm: 2_000, width_mm: 1_500 },
          ],
        }),
      ),
  },
  {
    id: "floor_plan-multi-room",
    note: "다실: 두 매스 합집합(ㄱ자 외곽)에 실 5개, 공유 내벽 1번만, 목표 면적, A3 세로",
    input: () =>
      planInput(
        planModel(
          [rect(1_000, 1_000, 12_000, 6_000), rect(7_000, 7_000, 6_000, 5_000)],
          {
            rooms: [
              room("living", "거실", rect(1_000, 1_000, 7_000, 6_000)),
              room("kitchen", "주방", rect(8_000, 1_000, 5_000, 3_000)),
              room("bath", "욕실", rect(8_000, 4_000, 2_000, 3_000)),
              room("hall", "복도", rect(10_000, 4_000, 3_000, 3_000)),
              room("bed", "침실1", rect(7_000, 7_000, 6_000, 5_000)),
            ],
            openings: [
              { id: "d1", kind: "door", host: { room_id: "living", edge_index: 0 }, offset_mm: 500, width_mm: 1_000 },
              { id: "d2", kind: "door", host: { room_id: "bath", edge_index: 3 }, offset_mm: 1_000, width_mm: 700, swing: "right" },
              { id: "d3", kind: "door", host: { room_id: "bed", edge_index: 0 }, offset_mm: 3_500, width_mm: 900 },
              { id: "w1", kind: "window", host: { room_id: "bed", edge_index: 2 }, offset_mm: 1_500, width_mm: 3_000 },
              { id: "w2", kind: "window", host: { room_id: "kitchen", edge_index: 1 }, offset_mm: 1_000, width_mm: 1_000 },
            ],
          },
          [
            { name: "거실", use: "주거", target_area_m2: 40 },
            { name: "침실1", use: "주거", target_area_m2: 28.5 },
          ],
        ),
        { orientation: "portrait" },
      ),
  },
  {
    id: "floor_plan-skew-wall",
    note: "대각선 외벽(3:4 방향)과 그 위 창·문: 미리 돌린 블록(rot 0), 꺾은선 문 호, 꼭짓점 half-away 반올림",
    input: () =>
      planInput(
        planModel([{ outer: [[2_000, 2_000], [10_000, 2_000], [10_000, 6_000], [5_000, 10_000], [2_000, 10_000]] }], {
          rooms: [room("r1", "작업실", { outer: [[2_000, 2_000], [10_000, 2_000], [10_000, 6_000], [5_000, 10_000], [2_000, 10_000]] })],
          openings: [
            // 2번 변 (10000,6000)→(5000,10000): 길이 √(5000²+4000²) ≈ 6403mm — 방향 (-5,4)
            { id: "w-diag", kind: "window", host: { room_id: "r1", edge_index: 2 }, offset_mm: 1_000, width_mm: 1_800 },
            { id: "d-diag", kind: "door", host: { room_id: "r1", edge_index: 2 }, offset_mm: 4_000, width_mm: 900, swing: "right" },
          ],
        }),
      ),
  },
  {
    id: "floor_plan-rejected-overlap",
    note: "AR051 거부: 실 겹침 + 외곽 이탈 + 변 범위 밖 창 → 시트 생성 거부(위반 목록 골든)",
    rejected: true,
    input: () =>
      planInput(
        planModel([rect(2_000, 2_000, 10_000, 6_000)], {
          rooms: [room("a", "거실", rect(2_000, 2_000, 6_000, 6_000)), room("b", "침실", rect(7_500, 2_000, 5_000, 6_000))],
          openings: [{ id: "w1", kind: "window", host: { room_id: "a", edge_index: 0 }, offset_mm: 5_500, width_mm: 1_000 }],
        }),
      ),
  },
];

/** 검증(AR050 없음) → 뷰(AR051이면 거부) → 시트. */
export function buildFloorPlanCase(c: FloorPlanCase): { ok: true; sheet: SheetModel } | { ok: false; code: "AR051"; issues: unknown[] } {
  const v = validateDraftingInput(c.input());
  if (!v.ok) throw new Error(`${v.code}: ${v.issues.join("; ")}`);
  const r = tryBuildFloorPlanView(v.input);
  if (!r.ok) return { ok: false, code: r.code, issues: r.issues };
  return { ok: true, sheet: buildSheet(v.input, r.view).sheet };
}

/** 골든 파일 본문. */
export function floorPlanGoldenFiles(c: FloorPlanCase): Record<string, string> {
  const r = buildFloorPlanCase(c);
  const meta = (engine_version: string) => `${canonicalJson({ case_id: c.id, note: c.note, engine_version, features: ["AR-F-032"] })}\n`;
  if (!r.ok) {
    return { "rejected.json": `${canonicalJson({ code: r.code, issues: r.issues })}\n`, "meta.json": meta(c.input().engine_version) };
  }
  const body = `${canonicalJson(r.sheet)}\n`;
  return { "sheet.json": body, "sheet.sha256": `${sha256Hex(body)}\n`, "meta.json": meta(r.sheet.engine_version) };
}
