// 시리얼 정규화·해시(PRD 4.4절: ARCH-XXXXX-XXXXX-XXXXX-XXXXX, Crockford Base32 20자, 무작위 100비트).
// DB는 20자 본문의 SHA-256(hex)만 저장한다(2400_arch.sql 7-1 issue_license: digest(v_body, 'sha256')).
// 시리얼 원문은 이 모듈 밖으로 나가지 않는다: 화면·로그에는 serialLast5만.
import { createHash } from "node:crypto";

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{20}$/;
export const SERIAL_PREFIX = "ARCH";

/**
 * 사용자 입력 → 20자 본문. 대소문자 무시, 하이픈·공백 제거, Crockford 혼동 문자(I·L → 1, O → 0) 치환.
 * 형식이 틀리면 null(이유는 구분하지 않는다).
 */
export function normalizeSerial(input: string): string | null {
  const compact = input.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
  if (!compact.startsWith(SERIAL_PREFIX)) return null;
  const body = compact.slice(SERIAL_PREFIX.length).replace(/[IL]/g, "1").replace(/O/g, "0");
  return CROCKFORD.test(body) ? body : null;
}

/** 정규화한 20자 본문의 SHA-256 hex(DB serial_hash와 같은 값). */
export function serialHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** 화면·로그용 끝 5자. */
export function serialLast5(body: string): string {
  return body.slice(-5);
}
