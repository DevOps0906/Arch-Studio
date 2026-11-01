// 새 프로젝트 입력 검증과 첫 DesignModel v1 조립(03장 3.3절 "새 프로젝트", 순수 함수).
// 좌표는 ① 창에서 조회한 대지 경계(site-lookup.ts, 조회 응답 그대로) 또는 ② 사용자가 넣은 대지 가로·세로(m)의 원점 (0,0) 반시계 직사각형(mm 정수)만 쓴다.
// 대지 탭(035)에서 실제 경계로 고친다.
// LLM·추정 좌표 없음(AGENTS.md 3장). 같은 입력 → 같은 JSON(키 순서 고정).
import type { SaveProjectInput } from "@arch-studio/shell-bridge";
import type { LookupSite } from "./site-lookup.ts";

/** 이름 상한: 클라우드 사본 이름 제약(arch.cloud_projects 1..120자)에 맞춘다(로컬은 200자까지 받지만 올릴 때 잘리지 않게). */
export const NAME_MAX_CHARS = 120;
export const SITE_LABEL_MAX_CHARS = 200;
/** 대지 한 변 상한(m). 1km를 넘는 대지는 이 도구의 대상(소형 사무소 단독·다가구·근생)이 아니다. */
export const SITE_SIDE_MAX_M = 1000;
/** 이 화면이 만든 첫 모델의 생성 표식(meta.created_by_engine_version · engineVersion). 엔진 계산 결과가 아니라 빈 모델이다. */
export const NEW_MODEL_ENGINE_VERSION = "projects-new-1";

/** 국토계획법 용도지역 21종(시행령 30조). 판정 지원 여부는 규칙 팩이 정한다(지원 밖이면 판정 화면이 알린다). */
export const USE_DISTRICTS = [
  "제1종전용주거지역",
  "제2종전용주거지역",
  "제1종일반주거지역",
  "제2종일반주거지역",
  "제3종일반주거지역",
  "준주거지역",
  "중심상업지역",
  "일반상업지역",
  "근린상업지역",
  "유통상업지역",
  "전용공업지역",
  "일반공업지역",
  "준공업지역",
  "보전녹지지역",
  "생산녹지지역",
  "자연녹지지역",
  "보전관리지역",
  "생산관리지역",
  "계획관리지역",
  "농림지역",
  "자연환경보전지역",
] as const;
export type UseDistrict = (typeof USE_DISTRICTS)[number];

/** 폼 원문(문자열 그대로). */
export interface NewProjectForm {
  readonly name: string;
  readonly siteLabel: string;
  readonly useDistrict: string;
  readonly widthM: string;
  readonly depthM: string;
}

export const EMPTY_FORM: NewProjectForm = Object.freeze({ name: "", siteLabel: "", useDistrict: "", widthM: "", depthM: "" });

export type FormField = keyof NewProjectForm;
export type FormErrors = Partial<Record<FormField, string>>;

export interface NewProjectValues {
  readonly name: string;
  readonly siteLabel: string | null;
  readonly useDistrict: UseDistrict;
  /** mm 정수. 조회 대지면 경계의 최소 면적 회전 직사각형 두 변(표시용). */
  readonly widthMm: number;
  readonly depthMm: number;
  /** 창에서 조회한 대지(있으면 직사각형 대신 이 경계로 만든다). */
  readonly site: LookupSite | null;
}

/** 조회 성공 결과 중 생성에 쓰는 부분(site-lookup.ts LookupSummary가 만족한다). */
export interface LookupChoice {
  readonly site: LookupSite;
  readonly widthMm: number;
  readonly depthMm: number;
}

const chars = (s: string) => Array.from(s).length;
// 제어 문자(줄바꿈 포함)는 이름·라벨에 받지 않는다(목록 한 줄 표시·파일 이름 안전).
const CONTROL = /[\u0000-\u001f\u007f]/;
/** 소수 둘째 자리까지(cm). 지수·부호·공백 표기는 받지 않는다. */
const METERS = /^\d{1,4}(\.\d{1,2})?$/;

function meters(raw: string, field: "widthM" | "depthM", errors: FormErrors): number | null {
  const label = field === "widthM" ? "가로" : "세로";
  const v = raw.trim();
  if (v === "") {
    errors[field] = `대지 ${label}를 m 단위로 넣으세요.`;
    return null;
  }
  if (!METERS.test(v)) {
    errors[field] = `숫자만 넣으세요(소수 둘째 자리까지, 예: 18.5).`;
    return null;
  }
  const m = Number(v);
  if (!(m > 0) || m > SITE_SIDE_MAX_M) {
    errors[field] = `0보다 크고 ${SITE_SIDE_MAX_M}m 이하로 넣으세요.`;
    return null;
  }
  return Math.round(m * 1000);
}

/** 이름 검사(새 프로젝트·이름 바꾸기 공용). 문제가 없으면 null. */
export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name === "") return "프로젝트 이름을 넣으세요.";
  if (chars(name) > NAME_MAX_CHARS) return `이름은 ${NAME_MAX_CHARS}자까지입니다.`;
  if (CONTROL.test(name)) return "줄바꿈·제어 문자는 쓸 수 없습니다.";
  return null;
}

/**
 * 입력 검증. 성공이면 값, 실패면 필드별 문구(값을 문구에 넣지 않는다).
 * 조회 대지(lookup)가 있으면 가로·세로 입력은 보지 않고, 대지 이름이 비면 조회 주소 라벨을 쓴다.
 */
export function validateNewProject(form: NewProjectForm, lookup: LookupChoice | null = null): { ok: true; values: NewProjectValues } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const name = form.name.trim();
  const nameError = validateName(name);
  if (nameError) errors.name = nameError;

  const siteLabel = form.siteLabel.trim() || (lookup?.site.addressLabel ?? "");
  if (chars(siteLabel) > SITE_LABEL_MAX_CHARS) errors.siteLabel = `대지 이름은 ${SITE_LABEL_MAX_CHARS}자까지입니다.`;
  else if (CONTROL.test(siteLabel)) errors.siteLabel = "줄바꿈·제어 문자는 쓸 수 없습니다.";

  const useDistrict = (USE_DISTRICTS as readonly string[]).includes(form.useDistrict) ? (form.useDistrict as UseDistrict) : null;
  if (!useDistrict) errors.useDistrict = "용도지역을 고르세요.";

  const widthMm = lookup ? lookup.widthMm : meters(form.widthM, "widthM", errors);
  const depthMm = lookup ? lookup.depthMm : meters(form.depthM, "depthM", errors);

  if (Object.keys(errors).length > 0 || !useDistrict || widthMm === null || depthMm === null) return { ok: false, errors };
  return { ok: true, values: { name, siteLabel: siteLabel === "" ? null : siteLabel, useDistrict, widthMm, depthMm, site: lookup ? lookup.site : null } };
}

/**
 * 첫 DesignModel v1(04_API 4.7.1, packages/domain designModelV1Schema 통과). 도로·매스·실은 비어 있고,
 * 경계는 조회 대지가 있으면 그 경계(PNU·지구 포함), 없으면 가로·세로 직사각형. 규칙 맥락(rule_context)은 빈 값(대지 탭에서 지자체·적용일을 정한다 — 판정 화면은 빈 값이면 "조례 미확인"으로 알린다).
 */
export function buildInitialModel(values: NewProjectValues) {
  const w = values.widthMm;
  const d = values.depthMm;
  const site = values.site;
  const outer: [number, number][] = site
    ? site.outer.map((p) => [p[0], p[1]])
    : [
        [0, 0],
        [w, 0],
        [w, d],
        [0, d],
      ];
  const parcel: { pnu?: string; address_label?: string } = {};
  if (site?.pnu) parcel.pnu = site.pnu;
  if (values.siteLabel) parcel.address_label = values.siteLabel;
  return {
    schema_version: 1 as const,
    units: "mm" as const,
    site: {
      boundary: { outer },
      north_angle_deg: 0,
      roads: [],
      zoning: { use_district: values.useDistrict, districts: site ? [...site.districts] : [] },
      parcel,
    },
    rule_context: { rule_pack_version: "", application_date: "", municipality_code: "", ordinance_applied: false },
    masses: [],
    floor_layouts: [],
    program: { checklist_answers: {}, targets: [], user_locked_rows: [] },
    meta: { created_by_engine_version: NEW_MODEL_ENGINE_VERSION },
  };
}

/** ProjectStore.save 입력(새 프로젝트: expectedVersion null). id는 호출자가 uuidV7로 만든다. */
export function newProjectInput(id: string, values: NewProjectValues): SaveProjectInput {
  return {
    id,
    name: values.name,
    siteLabel: values.siteLabel,
    schemaVersion: 1,
    engineVersion: NEW_MODEL_ENGINE_VERSION,
    designModel: JSON.stringify(buildInitialModel(values)),
    note: "새 프로젝트",
    expectedVersion: null,
  };
}

/**
 * UUIDv7(RFC 9562) 문자열. 시각(ms)과 난수 10바이트 이상을 주입받는 순수 함수(ProjectStore id 규칙: 소문자 하이픈 형식, 버전 7, 변형 10xx).
 */
export function uuidV7(ms: number, random: Uint8Array): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || random.length < 10) throw new RangeError("uuidV7 입력");
  const b = new Uint8Array(16);
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(random.subarray(0, 10), 6);
  b[6] = 0x70 | ((b[6] as number) & 0x0f);
  b[8] = 0x80 | ((b[8] as number) & 0x3f);
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 충돌 때 "내 변경을 사본으로 저장"의 이름(ADR-001 3.2: "<이름> (내 변경)"). 상한을 넘으면 원래 이름을 줄인다. */
export function copyName(name: string): string {
  const suffix = " (내 변경)";
  const room = NAME_MAX_CHARS - chars(suffix);
  const base = Array.from(name.trim()).slice(0, room).join("");
  return `${base}${suffix}`;
}
