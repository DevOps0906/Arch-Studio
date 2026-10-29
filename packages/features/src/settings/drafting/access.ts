// 화면 상태 판정(순수): 역할·온라인·데이터 출처 → 편집 가능 여부와 안내 문구(03장 3.14절 "member는 읽기 전용(저장 시 AR042),
// 오프라인이면 캐시를 읽기 전용으로 보여 주고 '온라인에서 저장합니다'"). 서버가 정본(AR042·402)이고 이 판정은 화면 표시만 정한다.
import { canEditProfile } from "./profile.ts";

export type DataSource = "server" | "cache" | "none";

export interface Access {
  /** 저장 버튼·입력 사용 가능. */
  readonly editable: boolean;
  /** 읽기 전용 이유(없으면 null). */
  readonly lock: "role" | "offline" | "cache" | null;
  readonly message: string | null;
}

export const ACCESS_TEXT = {
  role: "표제란 설정은 조직 owner·admin만 저장합니다. 이 화면은 보기만 할 수 있습니다.",
  offline: "오프라인입니다. 이 PC에 저장된 마지막 설정을 보여 주며, 시트는 이 설정으로 만들어집니다. 온라인에서 저장합니다.",
  cache: "서버에서 설정을 불러오지 못해 이 PC에 저장된 마지막 설정을 보여 줍니다. 온라인에서 저장합니다.",
} as const;

export function screenAccess(role: string | null | undefined, online: boolean, source: DataSource): Access {
  if (!canEditProfile(role)) return { editable: false, lock: "role", message: ACCESS_TEXT.role };
  if (!online) return { editable: false, lock: "offline", message: ACCESS_TEXT.offline };
  if (source === "cache") return { editable: false, lock: "cache", message: ACCESS_TEXT.cache };
  return { editable: true, lock: null, message: null };
}

/** "마지막 동기화" 표시(로컬 시각, 분 단위). 깨진 값은 "기록 없음". */
export function syncedLabel(iso: string | null | undefined): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "기록 없음";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
