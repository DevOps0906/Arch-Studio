// 매스 제안 ↔ 엔진 워커(suggest 레인, 02_ARCHITECTURE 2.4절 suggest_mass) — 순수.
// - 요청은 모델 + 목표. 좌표·판정은 워커의 결정적 순수 함수만 만든다(이 화면은 계산하지 않는다).
// - 응답은 신뢰 경계 밖으로 본다: zod(도메인 스키마)로 매스·판정을 검사하고, 틀리면 버린다(null).
// - seq는 모듈 전체에서 단조 증가한다(화면을 다시 열어도 워커의 최신 seq보다 작아지지 않게).
import { judgmentResultSchema, massSchema } from "@arch-studio/domain";
import type { JudgmentData, JudgmentDetailLike, JudgmentWarningLike } from "../../judgment/index.ts";
import type { Mass, Model } from "../state/commands.ts";

export type StrategyKey = "max_coverage" | "sunlight_margin" | "regular_plan";
export const STRATEGIES: readonly StrategyKey[] = ["max_coverage", "sunlight_margin", "regular_plan"];

export interface SuggestTargets {
  /** 목표 연면적(㎡). 없으면 null. */
  readonly target_gfa_m2: number | null;
  /** 목표 지상 층 수. 없으면 null. */
  readonly floors: number | null;
  readonly floor_height_mm: number;
  readonly use: string;
}

export const TARGET_LIMITS = { gfaMax: 1_000_000, floorsMax: 60, floorHeightMin: 1500, floorHeightMax: 10_000, useMax: 40 } as const;

let seq = -1;
export function nextSuggestSeq(): number {
  seq += 1;
  return seq;
}
let reqN = 0;
export function nextSuggestReqId(): string {
  reqN += 1;
  return `modeler:suggest:${reqN}`;
}

export function buildSuggestRequest(reqId: string, seqNo: number, model: Model, targets: SuggestTargets) {
  return { op: "suggest_mass" as const, req_id: reqId, lane: "suggest" as const, seq: seqNo, model, targets };
}

/** 목표 입력 검사(워커와 같은 범위). 문제가 있으면 화면 문구, 없으면 null. */
export function targetsIssue(t: SuggestTargets): string | null {
  if (t.target_gfa_m2 !== null && !(Number.isFinite(t.target_gfa_m2) && t.target_gfa_m2 > 0 && t.target_gfa_m2 <= TARGET_LIMITS.gfaMax)) return "목표 연면적은 0보다 크고 1,000,000㎡ 이하로 넣으세요.";
  if (t.floors !== null && !(Number.isSafeInteger(t.floors) && t.floors >= 1 && t.floors <= TARGET_LIMITS.floorsMax)) return `목표 층수는 1~${TARGET_LIMITS.floorsMax}층 정수입니다.`;
  if (!(Number.isSafeInteger(t.floor_height_mm) && t.floor_height_mm >= TARGET_LIMITS.floorHeightMin && t.floor_height_mm <= TARGET_LIMITS.floorHeightMax)) return "층고는 1,500~10,000mm 정수입니다.";
  if (t.use.trim().length < 1 || t.use.length > TARGET_LIMITS.useMax) return `용도는 1~${TARGET_LIMITS.useMax}자로 넣으세요.`;
  return null;
}

/** 면적표 목표(program.targets)와 첫 매스 용도에서 만든 대화상자 기본값. */
export function defaultTargets(model: Model): SuggestTargets {
  const rows = model.program.targets.filter((t) => Number.isFinite(t.target_area_m2) && t.target_area_m2 > 0);
  const sum = rows.reduce((s, t) => s + t.target_area_m2, 0);
  const use = (rows[0]?.use ?? model.masses[0]?.floors[0]?.use ?? "단독주택").slice(0, TARGET_LIMITS.useMax);
  return { target_gfa_m2: sum > 0 ? Math.round(sum * 100) / 100 : null, floors: null, floor_height_mm: 3000, use };
}

export type SuggestStatus = "pass" | "check";
export type NoticeCode = "TARGET_NOT_MET" | "ENVELOPE_EMPTY" | "NO_CANDIDATE" | "LAW_UNVERIFIED";
const NOTICE_CODES: readonly NoticeCode[] = ["TARGET_NOT_MET", "ENVELOPE_EMPTY", "NO_CANDIDATE", "LAW_UNVERIFIED"];

export interface SuggestCandidateView {
  readonly id: StrategyKey;
  readonly title: string;
  readonly reasons: readonly string[];
  readonly masses: readonly Mass[];
  readonly floors: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly footprintAreaM2: number;
  /** 제안 산정 연면적(㎡). 법규 판정 수치가 아니다 — 건폐·용적·높이는 judge만 쓴다. */
  readonly gfaM2: number;
  readonly allowedFloors: number;
  readonly spareFloors: number;
  readonly status: SuggestStatus;
  readonly judge: JudgmentData;
}

export interface SuggestNoticeView {
  readonly code: NoticeCode;
  readonly message: string;
}

export interface SuggestView {
  readonly candidates: readonly SuggestCandidateView[];
  readonly maxGfaM2: number;
  readonly targetMet: boolean;
  readonly notices: readonly SuggestNoticeView[];
  readonly rulePackVersion: string;
  readonly rulePackFallback: boolean;
  readonly targets: SuggestTargets;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseJudge(v: unknown): JudgmentData | null {
  if (!isRecord(v)) return null;
  const parsed = judgmentResultSchema.safeParse(v.result);
  if (!parsed.success) return null;
  const details = Array.isArray(v.details) ? (v.details as JudgmentDetailLike[]) : [];
  const warnings = Array.isArray(v.warnings) ? (v.warnings as JudgmentWarningLike[]) : [];
  return { result: parsed.data, details, warnings, modelRev: null, elapsedMs: null };
}

function parseCandidate(v: unknown): SuggestCandidateView | null {
  if (!isRecord(v)) return null;
  const id = STRATEGIES.find((s) => s === v.id);
  const judge = parseJudge(v.judge);
  const floors = num(v.floors);
  const w = num(v.width_mm);
  const d = num(v.depth_mm);
  const fa = num(v.footprint_area_m2);
  const gfa = num(v.gfa_m2);
  const allowed = num(v.allowed_floors);
  const spare = num(v.spare_floors);
  if (!id || !judge || floors === null || w === null || d === null || fa === null || gfa === null || allowed === null || spare === null) return null;
  if (!Array.isArray(v.masses) || v.masses.length < 1 || v.masses.length > 20) return null;
  const masses: Mass[] = [];
  for (const m of v.masses as unknown[]) {
    const p = massSchema.safeParse(m);
    if (!p.success) return null;
    masses.push(p.data);
  }
  // FAIL 후보는 받지 않는다(엔진 계약: 후보는 FAIL 0). 화면은 계약을 한 번 더 확인한다.
  if (judge.result.items.some((i) => i.verdict === "FAIL")) return null;
  return {
    id,
    title: str(v.title, 40),
    reasons: (Array.isArray(v.reasons) ? v.reasons : []).map((r) => str(r)).filter((r) => r !== "").slice(0, 6),
    masses,
    floors,
    widthMm: w,
    depthMm: d,
    footprintAreaM2: fa,
    gfaM2: gfa,
    allowedFloors: allowed,
    spareFloors: spare,
    status: v.status === "pass" ? "pass" : "check",
    judge,
  };
}

/** 워커 결과 → 화면 데이터. 형식이 틀리면 null. */
export function parseSuggestResult(result: unknown): SuggestView | null {
  if (!isRecord(result) || !Array.isArray(result.candidates) || result.candidates.length > 3) return null;
  const candidates: SuggestCandidateView[] = [];
  for (const c of result.candidates as unknown[]) {
    const p = parseCandidate(c);
    if (!p) return null;
    candidates.push(p);
  }
  const maxGfa = num(result.max_gfa_m2);
  if (maxGfa === null) return null;
  const t = isRecord(result.targets) ? result.targets : {};
  return {
    candidates,
    maxGfaM2: maxGfa,
    targetMet: result.target_met === true,
    notices: (Array.isArray(result.notices) ? result.notices : [])
      .filter(isRecord)
      .map((n) => ({ code: NOTICE_CODES.find((c) => c === n.code), message: str(n.message) }))
      .filter((n): n is SuggestNoticeView => n.code !== undefined && n.message !== ""),
    rulePackVersion: str(result.rule_pack_version, 40),
    rulePackFallback: result.rule_pack_fallback === true,
    targets: {
      target_gfa_m2: num(t.target_gfa_m2),
      floors: num(t.floors),
      floor_height_mm: num(t.floor_height_mm) ?? 3000,
      use: str(t.use, TARGET_LIMITS.useMax),
    },
  };
}
