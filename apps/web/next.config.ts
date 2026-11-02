import type { NextConfig } from "next";
import { assertBuildAuthMode } from "./src/lib/auth/config.ts";

// 빌드 가드(AUTH_ROADMAP 2.4·B-4): Mock 인증 설정이 배포 빌드(VERCEL·VERCEL_ENV·RAILWAY_*)에 섞이면 설정 로드 단계에서 실패한다.
// 판정은 lib/auth/config.ts가 한다(이 파일은 인증 단계 변수를 직접 읽지 않는다).
assertBuildAuthMode();

// 기본 보안 헤더. 전체 CSP(스튜디오 `wasm-unsafe-eval` 등, 02_ARCHITECTURE.md 2장)는 별도 작업에서 추가한다.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@arch-studio/ui", "@arch-studio/rules", "@arch-studio/domain", "@arch-studio/geometry"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
