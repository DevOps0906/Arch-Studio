// 데스크톱 인증 단계 판정(02_ARCHITECTURE.md 9.1절·위험 #14). `VITE_AUTH_MODE`를 읽는 데스크톱 쪽 유일한 파일이다.
// Mock은 개발 빌드(`import.meta.env.DEV`) + `VITE_AUTH_MODE=mock` 둘 다일 때만. 릴리스 빌드는 Vite가 DEV를 false로 치환해
// 아래 조건이 상수 거짓이 되고, 그 안의 동적 import(dev-mock.ts)가 번들에서 빠진다(scripts/dev/check-bundle-mock.mjs로 확인).
// Node 테스트에는 import.meta.env가 없어 거짓이다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DevMockAuth } from "./dev-mock.ts";

export type DesktopAuthMode = "mock" | "live";

/** 현재 빌드의 인증 단계. 개발 빌드 + mock일 때만 'mock', 그 밖은 모두 'live'(기본 닫힘). */
export function desktopAuthMode(): DesktopAuthMode {
  if (typeof import.meta.env !== "undefined" && import.meta.env.DEV === true && import.meta.env.VITE_AUTH_MODE === "mock") return "mock";
  return "live";
}

export interface DevMockOptions {
  supabase: SupabaseClient;
  /** createArchSupabaseClient에 준 URL. loopback이 아니면 Mock 로그인을 거부한다. */
  supabaseUrl: string;
}

/**
 * 개발 빌드 Mock 로그인 모듈을 연다. 릴리스 빌드에서는 항상 null이고 모듈 코드(시드 이메일 포함)가 번들에 없다.
 * 조건식은 반드시 이 함수 안에 글자 그대로 둔다(변수로 빼면 Vite 치환 후 상수 접기가 안 돼 청크가 남을 수 있다).
 */
export async function loadDevMockAuth(options: DevMockOptions): Promise<DevMockAuth | null> {
  if (typeof import.meta.env !== "undefined" && import.meta.env.DEV === true && import.meta.env.VITE_AUTH_MODE === "mock") {
    const mod = await import("./dev-mock.ts");
    return mod.createDevMockAuth(options);
  }
  return null;
}
