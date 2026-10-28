// 환경 변수 zod 스키마 (02_ARCHITECTURE.md 8절·9.3절). 순수 모듈: 테스트에서 직접 import한다.
// "기동 실패" 변수는 required, 누락 시 다른 동작이 정해진 변수는 optional.
import { z } from "zod";

const required = z.string().trim().min(1);
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));
const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value !== "false");

/** 브라우저 번들에 들어가는 공개 변수(NEXT_PUBLIC_*만). */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required,
  NEXT_PUBLIC_TOSS_CLIENT_KEY: required,
  NEXT_PUBLIC_HERO3D_ENABLED: flag,
  NEXT_PUBLIC_HERO_VIDEO_ENABLED: flag,
});

/** web 서버 전용 변수. */
export const serverEnvSchema = publicEnvSchema
  .extend({
    SUPABASE_SERVICE_ROLE_KEY: required,
    SUPABASE_DB_SCHEMA: z.enum(["core", "public"]),
    APP_URL: z.string().url(),
    TOSS_SECRET_KEY: required,
    TOSS_WEBHOOK_SECRET: required,
    LICENSE_SIGNING_PRIVATE_KEY: required,
    LICENSE_SIGNING_KID: required,
    SITE_LOOKUP_HASH_KEY: required,
    AI_TOKEN_PRIVATE_KEY: required,
    AI_TOKEN_KID: required,
    ARCH_WORKER_INTERNAL_KEY: required,
    OSS_VOICE_BASE_URL: z.string().url(),
    AI_CROSS_BORDER_NOTICE_VERSION: required,
    VOICE_NOTICE_VERSION: required,
    ARCH_RECORDING_NOTICE_VERSION: required,
    RATE_LIMIT_IP_SALT: required,
    // 누락 시 정해진 대체 동작이 있는 변수
    DESKTOP_CORS_ORIGINS: optional,
    VWORLD_API_KEY: optional,
    AI_SERVICE_URL: optional,
    DIFY_API_URL: optional,
    DIFY_APP_KEY_ARCH: optional,
    DIFY_USER_HMAC_SECRET: optional,
    ELEVENLABS_API_KEY: optional,
    // 인증 단계(9.3절). mock 허용 여부(isMockAuthAllowed)는 lib/auth가 검사한다.
    AUTH_MODE: z.enum(["mock", "live"]).default("live"),
    AUTH_PROVIDERS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    DEV_SEED_PASSWORD: optional,
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "live" && env.AUTH_PROVIDERS.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_PROVIDERS"], message: "live 모드에는 1개 이상 필요" });
    }
    if (env.AUTH_MODE === "mock" && !env.DEV_SEED_PASSWORD) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DEV_SEED_PASSWORD"], message: "mock 모드에는 필수" });
    }
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** 검증 실패 시 누락·잘못된 변수 이름만 담아 throw한다(값은 메시지에 넣지 않는다). */
export function parseEnv<T extends z.ZodTypeAny>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].sort();
    throw new Error(`환경 변수 검증 실패(기동 중단): ${names.join(", ")}`);
  }
  return result.data;
}
