// 판정 패널 표시 모델(순수). 엔진 JudgmentResult(+ details)를 행 목록으로 바꾼다. 값을 새로 계산하지 않는다(판정·기하는 엔진만).
// 규칙: 근거(basis)가 없는 행은 만들지 않는다(AR-F-004). 확정 수치가 없으면 PASS를 만들지 않고 "미확인"으로 보인다.
import type { JudgmentResult } from "@arch-studio/domain";
import { REASON_TEXT, UNVERIFIED_BASIS } from "./messages.ts";

type Item = JudgmentResult["items"][number];
export type JudgmentKey = Item["key"];

/** 엔진 응답 details 한 칸(packages/rules JudgmentDetail의 구조적 최소형). items와 같은 순서·길이. */
export interface JudgmentDetailLike {
  readonly key: JudgmentKey;
  readonly rule_id?: string;
  readonly title?: string;
  readonly status?: "confirmed" | "unverified";
  readonly edge_class?: "road" | "adjacent";
  readonly reasons: readonly string[];
}

export interface JudgmentWarningLike {
  readonly code: string;
  readonly message: string;
  readonly rule_ids?: readonly string[];
}

/** 패널이 받는 판정 한 건(엔진 응답 한 번). */
export interface JudgmentData {
  readonly result: JudgmentResult;
  readonly details: readonly JudgmentDetailLike[];
  readonly warnings: readonly JudgmentWarningLike[];
  /** 이 판정이 만들어진 모델 판(요청의 model_rev). */
  readonly modelRev: string | null;
  /** 판정 소요(ms). 엔진 응답의 elapsed_ms. */
  readonly elapsedMs: number | null;
}

export type DisplayStatus = "pass" | "warn" | "fail" | "unverified" | "na" | "target" | "not_target";

export interface BasisView {
  readonly law: string;
  readonly article: string;
  readonly effectiveFrom: string;
  readonly ordinance: boolean;
  /** 법령·조문·시행일이 모두 확인된 근거인가(미확인이면 거짓). */
  readonly verified: boolean;
}

export interface RowView {
  /** 목록 안에서 유일한 id(key + 순번). */
  readonly id: string;
  readonly key: JudgmentKey;
  readonly label: string;
  readonly status: DisplayStatus;
  readonly section: "quant" | "target";
  /** "측정 30.30%" 같은 현재 값 칸. 값이 없으면 null. */
  readonly valueText: string | null;
  /** "한도 미확인"·"한도 60.00%"·"기준 5,000mm 이상". */
  readonly limitText: string | null;
  /** FAIL일 때 초과·부족량. */
  readonly excessText: string | null;
  readonly reasons: readonly string[];
  readonly basis: readonly BasisView[];
  /** 해당 매스 강조 버튼을 보이는 행(기하 항목). */
  readonly highlightable: boolean;
}

export const TARGET_KEYS: readonly JudgmentKey[] = ["seismic", "zero_energy", "supervision"];
const HIGHLIGHT_KEYS: readonly JudgmentKey[] = ["coverage", "far", "height", "sunlight", "setback"];

const LABEL: Record<JudgmentKey, string> = {
  coverage: "건폐율",
  far: "용적률",
  height: "높이",
  sunlight: "정북 일조사선",
  setback: "이격",
  parking: "주차",
  seismic: "내진설계",
  zero_energy: "제로에너지건축물",
  supervision: "허가권자 지정감리",
};

/** 천 단위 쉼표(로캘 무관, ui formatInt와 같은 결과). */
export function formatInt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 단위별 표기: pct 소수 둘째 자리, mm 정수(천 단위 쉼표), 대(count), ㎡ 소수 둘째 자리. */
export function formatValue(value: number, unit: Item["unit"]): string {
  switch (unit) {
    case "pct":
      return `${value.toFixed(2)}%`;
    case "mm":
      return `${formatInt(value)}mm`;
    case "count":
      return `${formatInt(value)}대`;
    case "m2":
      return `${value.toFixed(2)}㎡`;
    case "bool":
      return value === 0 ? "아님" : "해당";
  }
}

export function isTargetKey(key: JudgmentKey): boolean {
  return TARGET_KEYS.includes(key);
}

/** 근거 한 칸이 법령·조문·시행일 모두 확인된 값인가. */
export function basisVerified(b: { law: string; article: string; effective_from: string }): boolean {
  return [b.law, b.article, b.effective_from].every((s) => s.trim() !== "" && s.trim() !== UNVERIFIED_BASIS);
}

/** 보일 수 있는 근거가 하나라도 있는가(빈 배열·빈 문자열뿐이면 거짓 → 행을 만들지 않는다). */
export function hasBasis(item: Pick<Item, "basis">): boolean {
  return item.basis.some((b) => b.law.trim() !== "" || b.article.trim() !== "" || b.effective_from.trim() !== "");
}

function statusOf(item: Item, detail: JudgmentDetailLike | undefined): DisplayStatus {
  const unverified =
    detail?.status === "unverified" ||
    (detail?.reasons ?? []).includes("UNVERIFIED_RULE") ||
    (item.verdict === "WARN" && item.basis.every((b) => !basisVerified(b)));
  switch (item.verdict) {
    case "PASS":
      return "pass";
    case "FAIL":
      return "fail";
    case "NA":
      return isTargetKey(item.key) ? "not_target" : "na";
    case "WARN":
      if (unverified) return "unverified";
      if (isTargetKey(item.key) && (detail?.reasons ?? []).includes("TARGET")) return "target";
      return "warn";
  }
}

function labelOf(item: Item, detail: JudgmentDetailLike | undefined): string {
  if (item.key === "setback") {
    if (detail?.edge_class === "road") return "이격(도로)";
    if (detail?.edge_class === "adjacent") return "이격(인접대지)";
  }
  return LABEL[item.key];
}

function valueTexts(item: Item, status: DisplayStatus): Pick<RowView, "valueText" | "limitText" | "excessText"> {
  if (isTargetKey(item.key)) return { valueText: null, limitText: null, excessText: null };
  const hasLimit = item.limit !== undefined;
  const unitIsMin = item.key === "setback";
  let valueText: string | null = null;
  if (item.value !== undefined) {
    const v = formatValue(item.value, item.unit);
    valueText = item.key === "parking" ? `필요 ${v}(산정)` : `측정 ${v}`;
  }
  let limitText: string | null = null;
  if (item.key === "parking" || item.key === "sunlight") {
    limitText = null;
  } else if (hasLimit) {
    limitText = unitIsMin ? `기준 ${formatValue(item.limit as number, item.unit)} 이상` : `한도 ${formatValue(item.limit as number, item.unit)}`;
  } else if (status === "unverified" || status === "warn") {
    limitText = "한도 미확인";
  }
  let excessText: string | null = null;
  if (status === "fail" && item.value !== undefined && hasLimit) {
    const diff = unitIsMin ? (item.limit as number) - item.value : item.value - (item.limit as number);
    const amount = item.unit === "pct" ? `${diff.toFixed(2)}%p` : formatValue(diff, item.unit);
    excessText = unitIsMin ? `부족 ${amount}` : `초과 ${amount}`;
  }
  return { valueText, limitText, excessText };
}

export interface BuiltRows {
  readonly quant: readonly RowView[];
  readonly target: readonly RowView[];
  /** 근거가 없어 표시하지 않은 항목 수(진단용 — 화면에는 행으로 나오지 않는다). */
  readonly hidden: number;
}

/** 판정 → 행. 근거 없는 항목은 건너뛴다(AR-F-004, 테스트로 고정). */
export function buildRows(data: Pick<JudgmentData, "result" | "details">): BuiltRows {
  const quant: RowView[] = [];
  const target: RowView[] = [];
  let hidden = 0;
  data.result.items.forEach((item, i) => {
    if (!hasBasis(item)) {
      hidden += 1;
      return;
    }
    const detail = data.details[i]?.key === item.key ? data.details[i] : undefined;
    const status = statusOf(item, detail);
    const section = isTargetKey(item.key) ? "target" : "quant";
    const row: RowView = {
      id: `${item.key}-${i}`,
      key: item.key,
      label: labelOf(item, detail),
      status,
      section,
      ...valueTexts(item, status),
      reasons: (detail?.reasons ?? []).map((r) => REASON_TEXT[r]).filter((t): t is string => t !== undefined),
      basis: item.basis.map((b) => ({
        law: b.law,
        article: b.article,
        effectiveFrom: b.effective_from,
        ordinance: b.ordinance,
        verified: basisVerified(b),
      })),
      highlightable: HIGHLIGHT_KEYS.includes(item.key),
    };
    (section === "quant" ? quant : target).push(row);
  });
  return { quant, target, hidden };
}

export interface StatusCounts {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly unverified: number;
}

/** 머리 요약(통과·확인 필요·기준 초과·미확인). 대상 여부·산정값은 세지 않는다. */
export function countStatuses(rows: readonly RowView[]): StatusCounts {
  const c = { pass: 0, warn: 0, fail: 0, unverified: 0 };
  for (const r of rows) {
    if (r.status === "pass" || r.status === "warn" || r.status === "fail" || r.status === "unverified") c[r.status] += 1;
  }
  return c;
}

/** 예정 규칙(참고) 건수: 엔진 경고 SCHEDULED_RULES의 규칙 수. */
export function scheduledRuleCount(warnings: readonly JudgmentWarningLike[]): number {
  return warnings.filter((w) => w.code === "SCHEDULED_RULES").reduce((n, w) => n + (w.rule_ids?.length ?? 0), 0);
}

/** 예정 규칙 경고를 뺀 안내 경고(조례 미확인 지자체 등). */
export function noticeWarnings(warnings: readonly JudgmentWarningLike[]): readonly JudgmentWarningLike[] {
  return warnings.filter((w) => w.code !== "SCHEDULED_RULES");
}
