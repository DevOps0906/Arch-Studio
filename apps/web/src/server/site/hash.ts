// 지번(PNU) HMAC-SHA-256(04_API.md 2.1절, 02장 445행). PNU 공간은 작아 단순 SHA-256은 사전 대입으로 되돌릴 수 있으므로
// 서버 비밀 `SITE_LOOKUP_HASH_KEY`로 HMAC한다. 결과는 DB check(`^[0-9a-f]{64}$`)와 같은 64자 소문자 hex.
// 입력은 제공자가 돌려준 정규 PNU 19자리만 받는다(표기만 다른 입력으로 상한을 새로 세지 못하게, 로그 A3).
import { createHmac } from "node:crypto";
import { PNU_RE } from "./schema.ts";

/** 키 최소 길이(문자). 짧은 키는 사전 대입 비용을 낮추므로 거부한다. */
export const HASH_KEY_MIN_CHARS = 32;

export class SiteHashKeyError extends Error {
  constructor() {
    super("site lookup hash key unavailable"); // 키 값은 담지 않는다
    this.name = "SiteHashKeyError";
  }
}

export function pnuHash(pnu: string, key: string): string {
  if (typeof key !== "string" || key.length < HASH_KEY_MIN_CHARS) throw new SiteHashKeyError();
  if (!PNU_RE.test(pnu)) throw new RangeError("pnu format");
  // 도메인 분리 접두: 같은 키를 다른 용도로 잘못 써도 해시가 겹치지 않게.
  return createHmac("sha256", key).update(`arch:site_lookup:pnu:v1:${pnu}`, "utf8").digest("hex");
}
