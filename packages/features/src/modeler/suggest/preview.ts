// 매스 제안 데모 미리보기 예시 데이터(종류는 preview-kind.ts).
// 개발 서버에서만 동적으로 불러온다(use-suggest.ts의 import.meta.env.DEV 분기 → 릴리스 번들에 들어가지 않는다, check:release로 확인).
// 판정 수치는 실제 엔진 출력(규칙 팩 2026.10.0 전 항목 미확인) 또는 "[예시]" 표시가 붙은 가짜 확정 값이다. 좌표는 대지 경계 상자에서 정수 mm로 나눈 예시다.
import type { Mass, Model } from "../state/commands.ts";
import { ENGINE_OUTPUTS, exampleConfirmed, toData } from "../../judgment/fixtures.ts";
import { INITIAL_SUGGEST_STATE, suggestInputKey, type SuggestState } from "./state.ts";
import type { SuggestPreviewKind } from "./preview-kind.ts";
import type { StrategyKey, SuggestCandidateView, SuggestView } from "./protocol.ts";

function bbox(model: Model): { x0: number; y0: number; x1: number; y1: number } {
  const xs = model.site.boundary.outer.map((p) => p[0]);
  const ys = model.site.boundary.outer.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function mass(x0: number, y0: number, x1: number, y1: number, floors: number): Mass {
  return {
    id: "m-1",
    footprint: { outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] },
    base_level_mm: 0,
    floors: Array.from({ length: floors }, (_, i) => ({ id: `m-1-f${i + 1}`, level: i + 1, height_mm: 3000, use: "단독주택" })),
    roof: { type: "flat" },
  };
}

const snap = (v: number) => Math.round(v / 100) * 100;

export function previewView(model: Model, kind: "ready" | "pass" | "short"): SuggestView {
  const b = bbox(model);
  const w = b.x1 - b.x0;
  const d = b.y1 - b.y0;
  const out = ENGINE_OUTPUTS[0];
  if (!out) throw new Error("엔진 출력 예시가 없습니다");
  const judge = kind === "pass" ? exampleConfirmed(out, "warn") : toData(out);
  const specs: { id: StrategyKey; title: string; box: [number, number, number, number]; floors: number; allowed: number; reasons: string[] }[] = [
    { id: "max_coverage", title: "건폐 최대", box: [b.x0 + snap(w * 0.1), b.y0 + snap(d * 0.12), b.x1 - snap(w * 0.1), b.y1 - snap(d * 0.35)], floors: 2, allowed: 2, reasons: ["엔벨로프 안에 들어가는 가장 큰 직사각형 바닥입니다(예시)."] },
    { id: "sunlight_margin", title: "일조 여유", box: [b.x0 + snap(w * 0.1), b.y0 + snap(d * 0.12), b.x1 - snap(w * 0.1), b.y1 - snap(d * 0.5)], floors: 2, allowed: 3, reasons: ["정북 쪽 변을 2,000mm 더 물렸습니다(예시).", "엔벨로프가 허용하는 3층 중 2층만 써서 1층 여유가 있습니다(예시)."] },
    { id: "regular_plan", title: "정형 평면", box: [b.x0 + snap(w * 0.15), b.y0 + snap(d * 0.12), b.x0 + snap(w * 0.15) + snap(w * 0.5), b.y0 + snap(d * 0.12) + snap(w * 0.45)], floors: 3, allowed: 3, reasons: ["긴 변이 짧은 변의 1.11배이고 두 변이 1,000mm 배수인 직사각형입니다(예시)."] },
  ];
  const candidates: SuggestCandidateView[] = specs.map((s) => {
    const m = mass(...s.box, s.floors);
    const cw = s.box[2] - s.box[0];
    const cd = s.box[3] - s.box[1];
    const fp = Math.floor((cw * cd) / 10_000) / 100;
    return {
      id: s.id,
      title: s.title,
      reasons: s.reasons,
      masses: [m],
      floors: s.floors,
      widthMm: cw,
      depthMm: cd,
      footprintAreaM2: fp,
      gfaM2: Math.floor(fp * s.floors * 100) / 100,
      allowedFloors: s.allowed,
      spareFloors: s.allowed - s.floors,
      status: kind === "pass" ? "pass" : "check",
      judge,
    };
  });
  const best = Math.max(...candidates.map((c) => c.gfaM2));
  return {
    candidates,
    maxGfaM2: best,
    targetMet: kind !== "short",
    notices:
      kind === "short"
        ? [{ code: "TARGET_NOT_MET", message: `엔벨로프 안에서 최대 ${best}㎡입니다.` }]
        : kind === "ready"
          ? [{ code: "LAW_UNVERIFIED", message: "규칙 팩에 확정된 법규 수치가 없어 법규 한도 없이 목표 기준으로만 탐색했습니다. 모든 판정이 '확인 필요'입니다." }]
          : [],
    rulePackVersion: kind === "pass" ? "[예시] 2000.01.1" : "2026.10.0",
    rulePackFallback: false,
    targets: { target_gfa_m2: kind === "short" ? best + 100 : best, floors: null, floor_height_mm: 3000, use: "단독주택" },
  };
}

export function previewState(model: Model, kind: SuggestPreviewKind): SuggestState {
  switch (kind) {
    case "empty":
      return INITIAL_SUGGEST_STATE;
    case "loading":
      return { ...INITIAL_SUGGEST_STATE, phase: "loading", seq: 0, pendingReqId: "preview" };
    case "error":
      return { ...INITIAL_SUGGEST_STATE, phase: "error", error: "규칙 팩이 없습니다.(AR050)" };
    default:
      return { ...INITIAL_SUGGEST_STATE, phase: "ready", view: previewView(model, kind), inputKey: suggestInputKey(model) };
  }
}
