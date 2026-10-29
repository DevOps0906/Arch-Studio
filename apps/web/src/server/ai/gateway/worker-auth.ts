// 워커 전용 내부 경로 인증(Authorization: Bearer <ARCH_WORKER_INTERNAL_KEY>, 04_API.md 6.3절).
// 비교는 SHA-256 다이제스트끼리 timingSafeEqual(길이·앞부분 일치 여부가 시간으로 새지 않음).
// 키가 32자 미만이면 설정 오류로 보고 경로를 닫는다(503). 키·헤더 값은 예외·로그에 넣지 않는다.
import { createHash, timingSafeEqual } from "node:crypto";
import { GatewayError } from "./http.ts";

export const MIN_WORKER_KEY_LENGTH = 32;
const MAX_HEADER = 1024;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 통과하면 반환, 아니면 GatewayError(unauthorized 401 / worker_key_unconfigured 503). */
export function requireWorkerKey(req: Request, configuredKey: string | undefined): void {
  const key = configuredKey?.trim() ?? "";
  if (key.length < MIN_WORKER_KEY_LENGTH) throw new GatewayError("worker_key_unconfigured");
  const raw = req.headers.get("authorization") ?? "";
  if (raw.length === 0 || raw.length > MAX_HEADER) throw new GatewayError("unauthorized");
  const match = /^Bearer ([^\s]+)$/.exec(raw);
  const presented = match?.[1] ?? "";
  // 일치하지 않아도 같은 일을 하도록 항상 비교한다.
  const ok = timingSafeEqual(digest(presented), digest(key));
  if (!ok || presented.length === 0) throw new GatewayError("unauthorized");
}
