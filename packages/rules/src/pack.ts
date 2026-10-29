// 규칙 팩 로더·선택(AR-F-005). 팩은 엔진 밖 데이터(02_ARCHITECTURE.md rule-pack-data) — src는 packs/를 import하지 않는다.
// 불변식(11_LEGAL_RULE_REVIEW.md 4·5절):
//  - 모든 규칙에 근거(법령·조문·시행일) 1개 이상. 빈 문자열 금지.
//  - status "unverified"(원문 대조 전): 수치(params) 금지 → 판정은 항상 WARN "확인 필요".
//  - status "confirmed": 조문·시행일이 "미확인"이 아니고, 시행일(from)·수치·사람 검토(review)가 있어야 한다.
import { judgmentBasisSchema } from "@arch-studio/domain";
import { z } from "zod";
import { RulesError } from "./errors.ts";

/** 근거 칸이 원문 대조 전임을 나타내는 값(11_LEGAL_RULE_REVIEW.md 2절 "현재 상태"). */
export const UNVERIFIED = "미확인";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD 이고 달력상 있는 날짜인지(그레고리력, 시간대 없음). */
export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] as number;
  return d <= days;
}

const dateSchema = z.string().refine(isIsoDate, "YYYY-MM-DD 날짜가 아닙니다");
const nonBlank = z.string().refine((s) => s.trim().length > 0, "빈 문자열입니다");
/** 소수 둘째 자리까지의 양수(%, ㎡). 내부에서는 ×100 정수로 쓴다. */
const hundredths = z
  .number()
  .positive()
  .refine((x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-9, "소수 둘째 자리까지만 씁니다");
const mmPositive = z.number().int().positive();

const basisSchema = judgmentBasisSchema.extend({ law: nonBlank, article: nonBlank, effective_from: nonBlank });

const common = {
  id: z.string().regex(/^[a-z0-9_.-]+$/, "규칙 id는 소문자·숫자·_.-만"),
  title: nonBlank,
  status: z.enum(["confirmed", "unverified"]),
  basis: z.array(basisSchema).min(1),
  /** 시행일(포함). 미확인 규칙은 null. */
  effective_from: dateSchema.nullable(),
  /** 폐지일(이 날부터 적용 안 함). 없으면 null. */
  effective_to: dateSchema.nullable(),
  /** 적용 지자체 코드. "*" = 전국. */
  municipalities: z.array(nonBlank).min(1),
  /** 조례로 강화·완화될 수 있는 규칙이면 true — 조례 미확인 지자체에서는 정량 판정을 막는다. */
  ordinance_dependent: z.boolean(),
  /** 이 행을 넣은 근거 문서(경로#장). */
  source: nonBlank,
  note: z.string().optional(),
  /** 사람 법규 검토(AI는 서명할 수 없다). confirmed만. */
  review: z.object({ reviewer: nonBlank, reviewed_at: dateSchema }).strict().optional(),
};

const ratioParams = z.object({ max_pct_by_district: z.record(nonBlank, hundredths) }).strict();
/** 용적률 산정 연면적에서 뺄 항목. 지금 모델로 계산할 수 있는 것은 지하층(level ≤ 0)뿐. */
const farParams = z
  .object({
    max_pct_by_district: z.record(nonBlank, hundredths),
    far_floor_area_exclusions: z.array(z.enum(["basement"])),
  })
  .strict();
const thresholdParams = z
  .object({ min_floors: z.number().int().positive().optional(), min_gross_area_m2: hundredths.optional() })
  .strict()
  .refine((p) => p.min_floors !== undefined || p.min_gross_area_m2 !== undefined, "기준이 하나 이상 있어야 합니다");

const ruleSchema = z.discriminatedUnion("key", [
  z.object({ ...common, key: z.literal("coverage"), params: ratioParams.optional() }).strict(),
  z.object({ ...common, key: z.literal("far"), params: farParams.optional() }).strict(),
  z
    .object({
      ...common,
      key: z.literal("height"),
      params: z.object({ max_mm_by_district: z.record(nonBlank, mmPositive) }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      key: z.literal("setback"),
      /** road = site.roads[].edge_index(정규화 전 원래 변 순서)의 변, adjacent = 나머지 외곽 변. */
      edge_class: z.enum(["road", "adjacent"]),
      params: z.object({ min_mm: mmPositive }).strict().optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      key: z.literal("parking"),
      params: z
        .object({
          /** 용도별 소수 대수를 합한 뒤 한 번 처리한다. */
          rounding: z.enum(["ceil", "floor", "half_up"]),
          by_use: z.array(z.object({ use: nonBlank, floor_area_m2_per_space: hundredths }).strict()).min(1),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z.object({ ...common, key: z.literal("seismic"), params: thresholdParams.optional() }).strict(),
  z.object({ ...common, key: z.literal("zero_energy"), params: thresholdParams.optional() }).strict(),
  z.object({ ...common, key: z.literal("supervision"), params: thresholdParams.optional() }).strict(),
  z
    .object({
      ...common,
      key: z.literal("sunlight"),
      /** 엔벨로프(AR-06-016)용. 이 판정 엔진은 일조사선 수치를 계산하지 않는다. */
      params: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);

const municipalitySchema = z
  .object({
    code: nonBlank,
    name: nonBlank,
    /** 조례 원문 대조·서명 여부. unverified면 조례 의존 규칙은 WARN. */
    ordinance: z.enum(["verified", "unverified"]),
    source: nonBlank,
  })
  .strict();

const packShape = z
  .object({
    format: z.literal(1),
    /** YYYY.MM.n (05_DATA_MODEL.md rule_packs.version) */
    version: z.string().regex(/^\d{4}\.(0[1-9]|1[0-2])\.(0|[1-9]\d{0,2})$/, "버전은 YYYY.MM.n"),
    /** 규칙 팩이 반영한 법령·조례 시점. */
    basis_date: dateSchema,
    title: nonBlank,
    /** 지원 지역. 없는 지자체는 "미지원: 직접 확인 필요". */
    municipalities: z.array(municipalitySchema),
    rules: z.array(ruleSchema),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const codes = new Set<string>();
    pack.municipalities.forEach((m, i) => {
      if (codes.has(m.code)) issue(["municipalities", i, "code"], `지자체 코드 중복: ${m.code}`);
      codes.add(m.code);
    });
    const ids = new Set<string>();
    pack.rules.forEach((r, i) => {
      const at = (...p: (string | number)[]) => ["rules", i, ...p];
      if (ids.has(r.id)) issue(at("id"), `규칙 id 중복: ${r.id}`);
      ids.add(r.id);
      if (r.effective_from && r.effective_to && r.effective_to <= r.effective_from) {
        issue(at("effective_to"), "폐지일은 시행일보다 뒤여야 합니다");
      }
      if (r.basis.some((b) => b.ordinance) && !r.ordinance_dependent) {
        issue(at("ordinance_dependent"), "조례 근거가 있는 규칙은 ordinance_dependent가 true여야 합니다");
      }
      if (r.status === "unverified") {
        if (r.params !== undefined) issue(at("params"), "미확인 규칙에는 수치(params)를 넣지 않습니다");
        if (r.review !== undefined) issue(at("review"), "미확인 규칙에는 검토 서명이 없습니다");
        return;
      }
      if (r.params === undefined) issue(at("params"), "확정 규칙에는 수치(params)가 필요합니다");
      if (r.review === undefined) issue(at("review"), "확정 규칙에는 사람 법규 검토(review)가 필요합니다");
      if (r.effective_from === null) issue(at("effective_from"), "확정 규칙에는 시행일이 필요합니다");
      r.basis.forEach((b, j) => {
        if (b.law === UNVERIFIED || b.article === UNVERIFIED) issue(at("basis", j), "확정 규칙의 법령·조문이 미확인입니다");
        if (!isIsoDate(b.effective_from)) issue(at("basis", j, "effective_from"), "확정 규칙 근거의 시행일이 날짜가 아닙니다");
      });
    });
  })
  .brand<"RulePack">();

export type RulePack = z.infer<typeof packShape>;
export type Rule = RulePack["rules"][number];
export type RuleKey = Rule["key"];

/** 서명·자격 확인을 마친 팩 JSON(unknown)을 검사해 RulePack으로 만든다. 위반이면 RulesError(INVALID_PACK). */
export function loadRulePack(raw: unknown): RulePack {
  const r = packShape.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new RulesError("INVALID_PACK", `규칙 팩 검사 실패 — ${first}`);
  }
  return r.data;
}

/** YYYY.MM.n 버전 비교(-1·0·1). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface PackSelection {
  pack: RulePack;
  /** 요청한 버전이 없어 가장 최신 팩으로 대신했으면 true(화면 경고용). */
  fallback: boolean;
}

/**
 * 프로젝트 rule_context의 팩 버전을 고른다. 없으면 받은 팩 중 최신 버전(자격 확인은 호출자 몫).
 * 신청 예정일에 따른 규칙 선택은 judge가 팩 안에서 한다(selectRules).
 */
export function selectRulePack(packs: readonly RulePack[], requestedVersion: string): PackSelection {
  if (packs.length === 0) throw new RulesError("NO_PACK", "사용할 수 있는 규칙 팩이 없습니다");
  const exact = packs.find((p) => p.version === requestedVersion);
  if (exact) return { pack: exact, fallback: false };
  const latest = [...packs].sort((a, b) => compareVersions(b.version, a.version))[0] as RulePack;
  return { pack: latest, fallback: true };
}

export interface RuleSelection {
  /** 판정에 쓸 규칙(확정은 슬롯마다 1개, 미확인은 모두 — 신·구 병행 표시). */
  active: Rule[];
  /** 신청 예정일 뒤에 시행되는 확정 규칙("예정 규칙", 참고 표시만). */
  scheduled: Rule[];
}

const KEY_ORDER: readonly RuleKey[] = [
  "coverage",
  "far",
  "height",
  "sunlight",
  "setback",
  "parking",
  "seismic",
  "zero_energy",
  "supervision",
];
const EDGE_ORDER = ["road", "adjacent"];

function slot(r: Rule): string {
  return r.key === "setback" ? `setback:${r.edge_class}` : r.key;
}

function ruleOrder(a: Rule, b: Rule): number {
  const k = KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key);
  if (k !== 0) return k;
  const ea = a.key === "setback" ? EDGE_ORDER.indexOf(a.edge_class) : -1;
  const eb = b.key === "setback" ? EDGE_ORDER.indexOf(b.edge_class) : -1;
  if (ea !== eb) return ea - eb;
  if (a.status !== b.status) return a.status === "confirmed" ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 신청 예정일·지자체로 팩 안의 규칙을 고른다(결정적, 팩 안 규칙 순서와 무관).
 * 확정 규칙: from ≤ 신청일 < to 인 것 중 슬롯(key, setback은 변 종류)마다 지자체 지정 > 전국("*"), 그다음 늦은 시행일, id 순.
 * 미확인 규칙: 날짜를 모르므로 지자체가 맞으면 모두(WARN 행).
 */
export function selectRules(pack: RulePack, applicationDate: string, municipalityCode: string): RuleSelection {
  if (!isIsoDate(applicationDate)) {
    throw new RulesError("INVALID_INPUT", `신청 예정일이 YYYY-MM-DD 날짜가 아닙니다: ${applicationDate}`);
  }
  const local = (r: Rule) => r.municipalities.includes(municipalityCode);
  const matches = pack.rules.filter((r) => local(r) || r.municipalities.includes("*"));
  const best = new Map<string, Rule>();
  const scheduled: Rule[] = [];
  const unverified: Rule[] = [];
  for (const r of matches) {
    if (r.status === "unverified") {
      unverified.push(r);
      continue;
    }
    const from = r.effective_from as string;
    if (applicationDate < from) {
      scheduled.push(r);
      continue;
    }
    if (r.effective_to !== null && applicationDate >= r.effective_to) continue;
    const cur = best.get(slot(r));
    if (!cur || better(r, cur)) best.set(slot(r), r);
  }
  function better(a: Rule, b: Rule): boolean {
    if (local(a) !== local(b)) return local(a);
    const fa = a.effective_from as string;
    const fb = b.effective_from as string;
    if (fa !== fb) return fa > fb;
    return a.id < b.id;
  }
  return { active: [...best.values(), ...unverified].sort(ruleOrder), scheduled: scheduled.sort(ruleOrder) };
}
