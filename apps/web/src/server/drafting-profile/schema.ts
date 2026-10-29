// PUT /api/drafting-profile 본문 검사(04_API.md 4.7.3 DraftingProfile, `:58`). 모양은 packages/domain draftingProfileSchema와 같고
// (apps/web은 domain에 의존하지 않아 사본, schema.test.ts가 정본 스키마와 대조), 값 상한은 DB CHECK(2400_arch.sql:199-214)와 같게 좁힌다:
// 사무소 1~100자(앞뒤 공백 제외), 건축사 50, 연락처 100, 글자 높이 2.0~5.0(0.1 단위, numeric(3,1)), 글꼴 DB 정규식.
// 모든 문자열은 제어 문자·줄 구분·bidi 제어를 거부한다(DXF 그룹 코드 주입·표시 위장 차단).
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { normalizeLayerMap, REJECT_CHARS, type SaveLayerWarning, type StdLayer } from "./layers.ts";
import { isOwnLogoPath } from "./png.ts";

export const PAPERS = ["A3", "A2", "A1"] as const;
export type Paper = (typeof PAPERS)[number];

export const TEXT_LIMITS = { office_name: 100, architect_name: 50, contact: 100 } as const;
export const TEXT_HEIGHT = { min: 2.0, max: 5.0 } as const;
export const FONT_RE = /^[A-Za-z0-9 가-힣_-]{1,64}$/;

/** 저장·응답에 쓰는 정규화된 프로필(DraftingProfile 계약). 선택 항목이 없으면 키가 없다. */
export interface DraftingProfileOut {
  office_name: string;
  architect_name?: string;
  contact?: string;
  logo_storage_path?: string;
  layer_map: Partial<Record<StdLayer, string>>;
  default_paper: Paper;
  default_text_height_mm: number;
  font_family: string;
}

const codePoints = (s: string) => [...s].length;
const safeText = (max: number) =>
  z
    .string()
    .refine((s) => !REJECT_CHARS.test(s), "control")
    .refine((s) => codePoints(s) <= max, "length");

export const profileInputSchema = z
  .object({
    office_name: safeText(TEXT_LIMITS.office_name).refine((s) => s.trim() !== "", "required"),
    architect_name: safeText(TEXT_LIMITS.architect_name).optional(),
    contact: safeText(TEXT_LIMITS.contact).optional(),
    logo_storage_path: z.string().max(300).optional(),
    layer_map: z.unknown(),
    default_paper: z.enum(PAPERS),
    default_text_height_mm: z
      .number()
      .finite()
      .min(TEXT_HEIGHT.min)
      .max(TEXT_HEIGHT.max)
      .refine((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9, "step"),
    font_family: z.string().regex(FONT_RE),
  })
  .strict();

export type ProfileParse =
  | { ok: true; profile: DraftingProfileOut; warnings: SaveLayerWarning[] }
  | { ok: false; field: string; code: "invalid_input" | "23514" };

/** 본문 → 저장할 프로필. 실패는 필드 이름과 코드만(값은 싣지 않는다). orgId는 세션 조직(로고 경로 소유 확인). */
export function parseProfileInput(raw: unknown, orgId: string): ProfileParse {
  const parsed = profileInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, field: String(parsed.error.issues[0]?.path[0] ?? "body"), code: "invalid_input" };
  const p = parsed.data;
  const layers = normalizeLayerMap(p.layer_map);
  if (!layers.ok) return { ok: false, field: "layer_map", code: "invalid_input" };
  const logo = p.logo_storage_path ?? "";
  if (logo !== "" && !isOwnLogoPath(orgId, logo)) return { ok: false, field: "logo_storage_path", code: "23514" };
  const out: DraftingProfileOut = {
    office_name: p.office_name.trim(),
    layer_map: layers.map,
    default_paper: p.default_paper,
    default_text_height_mm: Math.round(p.default_text_height_mm * 10) / 10,
    font_family: p.font_family,
  };
  const architect = p.architect_name?.trim() ?? "";
  const contact = p.contact?.trim() ?? "";
  if (architect !== "") out.architect_name = architect;
  if (contact !== "") out.contact = contact;
  if (logo !== "") out.logo_storage_path = logo;
  return { ok: true, profile: out, warnings: layers.warnings };
}

/** RPC 인자(p jsonb): 8개 키를 모두 보낸다(PUT = 전체 교체, 빈 문자열은 선택 항목을 지운다 — RPC 규칙). */
export function toRpcPayload(p: DraftingProfileOut): Record<string, unknown> {
  return {
    office_name: p.office_name,
    architect_name: p.architect_name ?? "",
    contact: p.contact ?? "",
    logo_storage_path: p.logo_storage_path ?? "",
    layer_map: { ...p.layer_map },
    default_paper: p.default_paper,
    default_text_height_mm: p.default_text_height_mm,
    font_family: p.font_family,
  };
}

/** DB 행 → 응답 프로필(허용 키만: org_id·updated_by·created_at은 내보내지 않는다). 행이 깨졌으면 null. */
export function fromRow(row: unknown): { profile: DraftingProfileOut; updated_at: string | null } | null {
  if (row === null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const height = typeof r.default_text_height_mm === "string" ? Number(r.default_text_height_mm) : r.default_text_height_mm;
  if (typeof r.office_name !== "string" || typeof r.font_family !== "string" || typeof height !== "number" || !Number.isFinite(height)) return null;
  if (!(PAPERS as readonly unknown[]).includes(r.default_paper)) return null;
  const layers = normalizeLayerMap(r.layer_map ?? {});
  const profile: DraftingProfileOut = {
    office_name: r.office_name,
    layer_map: layers.ok ? layers.map : {},
    default_paper: r.default_paper as Paper,
    default_text_height_mm: height,
    font_family: r.font_family,
  };
  if (typeof r.architect_name === "string" && r.architect_name !== "") profile.architect_name = r.architect_name;
  if (typeof r.contact === "string" && r.contact !== "") profile.contact = r.contact;
  if (typeof r.logo_storage_path === "string" && r.logo_storage_path !== "") profile.logo_storage_path = r.logo_storage_path;
  return { profile, updated_at: typeof r.updated_at === "string" ? r.updated_at : null };
}
