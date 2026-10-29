// 로컬 표제란 캐시(03장 3.14절 `drafting_profile_cache`, AR-06-031 "오프라인이면 캐시로 시트 생성").
// 보관 방법: 웹뷰 localStorage(셸 표시 값 prefs.ts와 같은 방식). 이유 — 070 어댑터(ProjectStore·FileGateway·SecureStore)에
// 설정 저장 포트가 없고(SecureStore는 토큰 전용이라 쓰지 않는다), Rust `local_settings`는 아직 없다(셸 prefs.ts 주석).
// 담는 값은 표제란 문구·레이어 이름뿐이라 비밀이 아니고, 권한·역할·플랜은 담지 않는다(로컬 값은 권한을 정하지 않는다).
// 신뢰하지 않는다: 읽을 때 서버와 같은 검증(validProfile) + 세션 조직 일치 확인, 실패하면 버린다. 서버로 다시 보내지 않는다.
// 시트 화면(AR-06-030)은 이 파일의 readDraftingProfileCache만 쓴다(설정 폴더의 공개 파일).
import type { DraftingProfile } from "@arch-studio/domain";
import { validProfile } from "./profile.ts";

export const CACHE_KEY = "arch.drafting_profile_cache.v1";

export interface CachedProfile {
  readonly org_id: string;
  readonly profile: DraftingProfile;
  /** 마지막으로 서버와 맞춘 시각(ISO 8601). */
  readonly synced_at: string;
  /** 서버 updated_at(없으면 null). */
  readonly updated_at: string | null;
}

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
/** 캐시 문자열 상한(서버 본문 상한 16KB의 2배 — 이보다 크면 변조로 보고 버린다). */
const MAX_RAW = 32_768;

/** 저장 문자열 → 캐시. 깨진 JSON·추가 키·다른 조직·검증 실패는 null. */
export function parseCache(raw: string | null, orgId: string): CachedProfile | null {
  if (!raw || raw.length > MAX_RAW || !UUID.test(orgId)) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "org_id,profile,synced_at,updated_at") return null;
  if (o.org_id !== orgId) return null;
  if (typeof o.synced_at !== "string" || !ISO.test(o.synced_at)) return null;
  if (o.updated_at !== null && (typeof o.updated_at !== "string" || !ISO.test(o.updated_at))) return null;
  const profile = validProfile(o.profile);
  if (!profile) return null;
  return { org_id: orgId, profile, synced_at: o.synced_at, updated_at: o.updated_at as string | null };
}

export function readDraftingProfileCache(orgId: string, storage: StorageLike | null = defaultStorage()): CachedProfile | null {
  try {
    return parseCache(storage?.getItem(CACHE_KEY) ?? null, orgId);
  } catch {
    return null;
  }
}

/** 서버에서 받은(검증된) 프로필만 쓴다. 실패는 무시(캐시는 보조). */
export function writeDraftingProfileCache(entry: CachedProfile, storage: StorageLike | null = defaultStorage()): boolean {
  if (!UUID.test(entry.org_id) || !validProfile(entry.profile)) return false;
  try {
    storage?.setItem(CACHE_KEY, JSON.stringify({ org_id: entry.org_id, profile: entry.profile, synced_at: entry.synced_at, updated_at: entry.updated_at }));
    return storage !== null;
  } catch {
    return false;
  }
}

/** 로그아웃·조직 전환 때 지운다(같은 PC의 다음 사용자에게 사무소 정보가 남지 않게). */
export function clearDraftingProfileCache(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(CACHE_KEY);
  } catch {
    // 보조 값이라 실패해도 무시한다.
  }
}
