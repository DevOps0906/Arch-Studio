// 브라우저에서도 쓰는 공개 변수. Next.js는 process.env.NEXT_PUBLIC_* 를 글자 그대로 쓸 때만 번들에 치환하므로 하나씩 적는다.
import { parseEnv, publicEnvSchema, type PublicEnv } from "./schema";

export const publicEnv: PublicEnv = parseEnv(publicEnvSchema, {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_TOSS_CLIENT_KEY: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
  NEXT_PUBLIC_HERO3D_ENABLED: process.env.NEXT_PUBLIC_HERO3D_ENABLED,
  NEXT_PUBLIC_HERO_VIDEO_ENABLED: process.env.NEXT_PUBLIC_HERO_VIDEO_ENABLED,
});
