// 채팅 중계 설정(env → 값). 비밀 값은 존재·형식만 보고 로그에 넣지 않는다.
// DIFY_API_URL·DIFY_APP_KEY_ARCH·DIFY_USER_HMAC_SECRET·AI_SERVICE_URL은 serverEnv 스키마(소유 밖)에 없어 process.env에서 읽는다(053 voice와 같은 방식).
// - Dify(URL·앱 키)·dify_user HMAC 비밀·폴백 경로(AI_SERVICE_URL)는 모두 필수: 하나라도 없으면 /api/ai/chat 503(인증·차감 전).
//   설정 누락을 폴백으로 돌리지 않는다(실패 닫힘). answer-direct 폴백은 Dify가 설정돼 있는데 런타임 장애가 났을 때만.
// server-only를 import하지 않는다(node --test 대상).
import { createHmac } from "node:crypto";

export const DIFY_URL_ENV = "DIFY_API_URL";
export const DIFY_KEY_ENV = "DIFY_APP_KEY_ARCH";
export const DIFY_HMAC_ENV = "DIFY_USER_HMAC_SECRET";
export const AI_SERVICE_URL_ENV = "AI_SERVICE_URL";

/** HMAC 비밀 최소 길이(32바이트 상당). 짧으면 설정 없음으로 본다. */
const MIN_SECRET_LEN = 32;

type Env = Readonly<Record<string, string | undefined>>;

export interface DifyConfig {
  baseUrl: string;
  appKey: string;
}

export interface ChatConfig {
  hmacSecret: string;
  aiServiceUrl: string;
  dify: DifyConfig;
}

function httpUrl(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return v.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** 설정이 모자라면 null(→ 503 AI_UNAVAILABLE, 차감 0). */
export function chatConfigOf(env: Env): ChatConfig | null {
  const hmacSecret = env[DIFY_HMAC_ENV]?.trim() ?? "";
  const aiServiceUrl = httpUrl(env[AI_SERVICE_URL_ENV]);
  const difyUrl = httpUrl(env[DIFY_URL_ENV]);
  const appKey = env[DIFY_KEY_ENV]?.trim() ?? "";
  if (hmacSecret.length < MIN_SECRET_LEN || !aiServiceUrl || !difyUrl || !appKey) return null;
  return { hmacSecret, aiServiceUrl, dify: { baseUrl: difyUrl, appKey } };
}

/**
 * Dify `user` 값(불투명). 조직·사용자 id를 드러내지 않는 HMAC이고, FastAPI는 (플랫폼 대화 id, dify_user) 대화 매핑으로만 org를 정한다.
 * 형식은 apps/api `_DIFY_USER_PATTERN`(^[A-Za-z0-9_-]{8,128}$)과 맞춘다.
 */
export function difyUserOf(secret: string, orgId: string, userId: string): string {
  const mac = createHmac("sha256", secret).update(`arch:dify_user:${orgId}:${userId}`).digest("base64url");
  return `du_${mac.slice(0, 32)}`;
}
