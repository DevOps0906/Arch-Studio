// 화면 표시 값(D-34 테마·밀도, 8.2절 GNB 접기). 상태·플랜·권한·토큰은 담지 않는다(로컬 값은 권한을 정하지 않는다).
// 보관: 지금은 웹뷰 localStorage(실패해도 기본값). 설치형 `local_settings` 어댑터가 생기면 그쪽으로 옮긴다(후속).
export type ThemePref = "system" | "light" | "dark";
export type DensityPref = "default" | "compact";

export interface DisplayPrefs {
  readonly theme: ThemePref;
  readonly density: DensityPref;
  /** 1200px 이상에서 GNB를 레일로 접었는가. */
  readonly gnbCollapsed: boolean;
}

export const DEFAULT_PREFS: DisplayPrefs = Object.freeze({ theme: "system", density: "default", gnbCollapsed: false });

const KEY = "arch.display.v1";

/** 저장 문자열 → 값. 모르는 값·깨진 JSON은 기본값(여기 들어오는 값은 신뢰하지 않는다). */
export function parsePrefs(raw: string | null): DisplayPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof DisplayPrefs, unknown>>;
    return {
      theme: v.theme === "light" || v.theme === "dark" || v.theme === "system" ? v.theme : DEFAULT_PREFS.theme,
      density: v.density === "compact" ? "compact" : "default",
      gnbCollapsed: v.gnbCollapsed === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const storage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadPrefs(): DisplayPrefs {
  try {
    return parsePrefs(storage()?.getItem(KEY) ?? null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: DisplayPrefs): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(p));
  } catch {
    // 표시 값이라 실패해도 무시한다.
  }
}

/** OS 설정 + 선택 → 실제 다크 여부. */
export function resolveDark(theme: ThemePref, osDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && osDark);
}
