// 로그·last_error에 토큰·키가 남지 않게 가린다(AGENTS.md 3장).
const PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT(service_role·잡 토큰)
  /\bsb_(secret|publishable)_[\w-]+/g, // Supabase 신형 키
  /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, // Authorization 헤더 값
];

export const MASK = "***";

/** 알려진 비밀 값(8자 이상)과 토큰 모양 문자열을 가린다. */
export function maskSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join(MASK);
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match) => (/^(bearer|basic)\s/i.test(match) ? `${match.split(/\s+/)[0]} ${MASK}` : MASK));
  }
  return out;
}
