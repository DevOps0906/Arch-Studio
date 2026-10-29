// POST /api/site/lookup 입력 검증(04_API.md 2.1절: `{ query: { kind: 'address' | 'jibun' | 'pnu', value: string≤200 } }`).
// 사용자 값은 VWorld 요청의 쿼리 "값" 칸에만 들어간다(vworld.ts). 여기서는 형식을 좁혀 주입·남용 표면을 줄인다(로그 A1).
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";

export const SITE_QUERY_KINDS = ["address", "jibun", "pnu"] as const;
export type SiteQueryKind = (typeof SITE_QUERY_KINDS)[number];

export const QUERY_MAX_CHARS = 200;
export const QUERY_MIN_CHARS = 2;

/** PNU(필지고유번호) 19자리: 법정동 10 + 필지구분 1(1 일반·2 산) + 본번 4 + 부번 4. */
export const PNU_RE = /^\d{10}[12]\d{8}$/;

/**
 * 주소·지번 허용 문자: 한글(완성형·자모), 영숫자, 공백, `-` `.` `,` `(` `)` `·`.
 * 제어문자·`&` `=` `?` `#` `%` `/` `\` `:` `@` `<` `>` `"` `'` 같은 URL·마크업 의미 문자는 거부한다.
 */
const ADDRESS_CHARS = /^[0-9A-Za-zㄱ-ㆎ가-힣 \-.,()·]+$/u;
/** 지번에는 본번(숫자)이 하나 이상 있어야 한다(예: "운중동 123-4", "산 12"). */
const HAS_LOT_NUMBER = /\d/;

/** NFC 정규화 + 연속 공백 하나로 + 앞뒤 공백 제거. */
export function normalizeQueryValue(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export type SiteQuery = { kind: SiteQueryKind; value: string };

/** 종류별 형식 검사. 통과하면 정규화 값, 아니면 null(어느 칸이 틀렸는지 값은 돌려주지 않는다). */
export function validateQuery(kind: SiteQueryKind, raw: string): SiteQuery | null {
  if (raw.length > QUERY_MAX_CHARS * 2) return null; // 정규화 전 과대 입력
  if (/[\p{Cc}\p{Cf}]/u.test(raw)) return null; // 제어·서식 문자(줄바꿈·NUL·방향 제어 포함)는 공백으로 바꾸지 않고 거부
  const value = normalizeQueryValue(raw);
  if (value.length < QUERY_MIN_CHARS || value.length > QUERY_MAX_CHARS) return null;
  if (kind === "pnu") return PNU_RE.test(value) ? { kind, value } : null;
  if (!ADDRESS_CHARS.test(value)) return null;
  if (kind === "jibun" && !HAS_LOT_NUMBER.test(value)) return null;
  return { kind, value };
}

export const siteLookupBodySchema = z
  .object({
    query: z
      .object({
        kind: z.enum(SITE_QUERY_KINDS),
        value: z.string().max(QUERY_MAX_CHARS * 2),
      })
      .strict(),
  })
  .strict();

/** 본문(JSON 파싱 결과) → 검증된 질의. strict라 org_id 같은 필드가 섞이면 실패. */
export function parseLookupBody(body: unknown): SiteQuery | null {
  const parsed = siteLookupBodySchema.safeParse(body);
  if (!parsed.success) return null;
  return validateQuery(parsed.data.query.kind, parsed.data.query.value);
}
