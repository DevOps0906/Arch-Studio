// 표제란 설정 화면 모델(03장 3.14절): DraftingProfile(04_API 4.7.3) 폼 값·검증·API 응답 해석·권한.
// 검증 규칙은 서버(apps/web/src/server/drafting-profile/schema.ts)와 같다 — 화면 검증은 안내일 뿐이고 서버가 다시 거부한다.
import { draftingProfileSchema, type DraftingProfile, type StdLayer } from "@arch-studio/domain";
import { LAYER_NAME_MAX, normalizeLayerMap, REJECT_CHARS, resolveLayerMap, type LayerMapWarning, type SaveLayerWarning } from "./layer-map.ts";

export const PAPERS = ["A3", "A2", "A1"] as const;
export type Paper = (typeof PAPERS)[number];
export const TEXT_LIMITS = { office_name: 100, architect_name: 50, contact: 100 } as const;
export const TEXT_HEIGHT = { min: 2.0, max: 5.0, step: 0.1 } as const;
export const FONT_RE = /^[A-Za-z0-9 가-힣_-]{1,64}$/;
/** 앱에 넣은 재배포 가능 글꼴(PRD 9.7절, THIRD_PARTY_NOTICES: Noto Sans KR OFL). DXF에는 이름만 기록. */
export const BUNDLED_FONTS = ["Noto Sans KR"] as const;
/** 프로필이 없는 조직의 기본값(DB 기본값: A3·2.5·Noto Sans KR). 사무소명은 비워 둔다(빈 상태). */
export const DEFAULT_PROFILE: DraftingProfile = Object.freeze({
  office_name: "",
  layer_map: {},
  default_paper: "A3",
  default_text_height_mm: 2.5,
  font_family: "Noto Sans KR",
}) as DraftingProfile;

/** 화면 폼 값(입력 칸 그대로의 문자열). */
export interface ProfileForm {
  office_name: string;
  architect_name: string;
  contact: string;
  logo_storage_path: string;
  default_paper: Paper;
  /** 입력 칸 문자열(예: "2.5"). */
  default_text_height_mm: string;
  font_family: string;
  layer_inputs: Partial<Record<StdLayer, string>>;
}

export function toForm(p: DraftingProfile): ProfileForm {
  return {
    office_name: p.office_name,
    architect_name: p.architect_name ?? "",
    contact: p.contact ?? "",
    logo_storage_path: p.logo_storage_path ?? "",
    default_paper: (PAPERS as readonly string[]).includes(p.default_paper) ? (p.default_paper as Paper) : "A3",
    default_text_height_mm: String(p.default_text_height_mm),
    font_family: p.font_family,
    layer_inputs: { ...p.layer_map },
  };
}

export type FieldName = "office_name" | "architect_name" | "contact" | "default_text_height_mm" | "font_family" | "layer_map";
export type FormErrors = Partial<Record<FieldName, string>>;

const len = (s: string) => [...s].length;

function textError(v: string, max: number, required: boolean): string | undefined {
  if (REJECT_CHARS.test(v)) return "줄바꿈·제어 문자는 쓸 수 없습니다.";
  if (required && v.trim() === "") return "사무소명을 입력하세요.";
  if (len(v) > max) return `${max}자 이하로 입력하세요.`;
  return undefined;
}

export function parseTextHeight(s: string): number | null {
  if (!/^\d+(\.\d)?$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return n >= TEXT_HEIGHT.min && n <= TEXT_HEIGHT.max ? n : null;
}

export type FormCheck =
  | { ok: true; profile: DraftingProfile; warnings: SaveLayerWarning[]; errors: FormErrors }
  | { ok: false; errors: FormErrors };

/** 폼 → 저장 본문(PUT = 전체 교체). 레이어 이름은 normalizeLayerMap 결과(서버와 같은 규칙)를 보낸다. */
export function checkForm(f: ProfileForm): FormCheck {
  const errors: FormErrors = {};
  const office = textError(f.office_name, TEXT_LIMITS.office_name, true);
  if (office) errors.office_name = office;
  const architect = textError(f.architect_name, TEXT_LIMITS.architect_name, false);
  if (architect) errors.architect_name = architect;
  const contact = textError(f.contact, TEXT_LIMITS.contact, false);
  if (contact) errors.contact = contact;
  const height = parseTextHeight(f.default_text_height_mm);
  if (height === null) errors.default_text_height_mm = "2.0~5.0mm, 0.1mm 단위로 입력하세요.";
  if (!FONT_RE.test(f.font_family)) errors.font_family = "글꼴 이름을 확인하세요.";
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.layer_inputs)) if (v !== undefined && v !== "") raw[k] = v;
  const layers = normalizeLayerMap(raw);
  if (!layers.ok) errors.layer_map = `레이어 이름은 ${LAYER_NAME_MAX}자 이하, 줄바꿈·제어 문자 없이 입력하세요.`;
  if (Object.keys(errors).length > 0 || !layers.ok || height === null) return { ok: false, errors };
  const profile: DraftingProfile = {
    office_name: f.office_name.trim(),
    layer_map: { ...layers.map },
    default_paper: f.default_paper,
    default_text_height_mm: height,
    font_family: f.font_family,
  };
  if (f.architect_name.trim() !== "") profile.architect_name = f.architect_name.trim();
  if (f.contact.trim() !== "") profile.contact = f.contact.trim();
  if (f.logo_storage_path !== "") profile.logo_storage_path = f.logo_storage_path;
  return { ok: true, profile, warnings: layers.warnings, errors };
}

/**
 * 프로필 값 검증(domain 스키마 + 서버와 같은 문자·길이 규칙 + 레이어 정규화가 바꾸지 않는 map).
 * 서버 응답과 로컬 캐시를 화면·엔진에 넣기 전에 쓴다. 실패하면 null(값을 버린다).
 */
export function validProfile(raw: unknown): DraftingProfile | null {
  const parsed = draftingProfileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  for (const [v, max, req] of [
    [p.office_name, TEXT_LIMITS.office_name, true],
    [p.architect_name ?? "", TEXT_LIMITS.architect_name, false],
    [p.contact ?? "", TEXT_LIMITS.contact, false],
  ] as const) {
    if (textError(v, max, req)) return null;
  }
  if (!(p.default_text_height_mm >= TEXT_HEIGHT.min && p.default_text_height_mm <= TEXT_HEIGHT.max)) return null;
  if (!FONT_RE.test(p.font_family)) return null;
  if (p.logo_storage_path !== undefined && !/^[0-9a-f-]{36}\/arch\/drafting-logo\/[0-9a-f-]{36}\.png$/.test(p.logo_storage_path)) return null;
  const layers = normalizeLayerMap(p.layer_map);
  if (!layers.ok || layers.warnings.some((w) => w.kind !== "name_conflict")) return null;
  return { ...p, layer_map: { ...layers.map } };
}

/** GET·PUT 응답 data(서버 handleGetProfile). 모르는 키는 버린다. */
export interface ProfileResponse {
  profile: DraftingProfile | null;
  updated_at: string | null;
  /** 서명 읽기 URL(10분). 설치형 CSP(img-src 'self' data: blob:)에서는 바로 쓸 수 없어 화면은 표시하지 않는다. */
  logo_url: string | null;
  can_edit: boolean;
  layer_warnings: SaveLayerWarning[];
}

export function parseProfileResponse(data: unknown): ProfileResponse {
  if (data === null || typeof data !== "object") throw new Error("invalid");
  const d = data as Record<string, unknown>;
  const profile = d.profile === null ? null : validProfile(d.profile);
  if (d.profile !== null && profile === null) throw new Error("invalid");
  const warnings = Array.isArray(d.layer_warnings)
    ? (d.layer_warnings as unknown[]).filter(
        (w): w is SaveLayerWarning =>
          w !== null && typeof w === "object" && ["invalid_name", "unsupported_name", "name_conflict"].includes((w as SaveLayerWarning).kind) && typeof (w as SaveLayerWarning).key === "string",
      )
    : [];
  return {
    profile,
    updated_at: typeof d.updated_at === "string" ? d.updated_at : null,
    logo_url: typeof d.logo_url === "string" ? d.logo_url : null,
    can_edit: d.can_edit === true,
    layer_warnings: warnings,
  };
}

/** 저장 가능 역할(04_API `:58` oa). 화면 표시용이고 서버가 AR042로 다시 거부한다. */
export function canEditProfile(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** 엔진 경고(내보낼 때 표준 이름으로 되돌아가는 레이어)만 — 미리보기 표시용. */
export function exportWarnings(p: DraftingProfile): LayerMapWarning[] {
  return resolveLayerMap(p.layer_map).warnings;
}
