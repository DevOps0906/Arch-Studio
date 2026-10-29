// GNB·프로젝트 탭 정의(03장 8.3·8.4절, D-31·D-32). 순서·이름은 문서 그대로. 화면 코드는 이 표를 바꾸지 않는다(셸 소유).
import type { EntitlementDecision, EntitlementFeature } from "@arch-studio/shell-bridge";
import type { ShellIconName } from "./icons.tsx";

export type NavGroup = "main" | "law" | "footer";

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly to: string;
  readonly icon: ShellIconName;
  readonly group: NavGroup;
  /** 현재 위치로 볼 경로 접두(설정은 두 경로). */
  readonly match: readonly string[];
  /** 클라우드를 부르는 메뉴: 오프라인이면 "오프라인" 배지(8.6절). */
  readonly cloud: boolean;
  /** 이 권리가 거부되면 잠금 배지(숨기지 않음, 1절 :37). */
  readonly feature?: EntitlementFeature;
}

/** 8.3절 순서. 라이선스는 GNB 아래 고정(D-32 a), 설정 목록에는 없다. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "projects", label: "프로젝트", to: "/projects", icon: "folder", group: "main", match: ["/projects"], cloud: false },
  { id: "chat", label: "법규 채팅", to: "/chat", icon: "message", group: "law", match: ["/chat"], cloud: true, feature: "ai_chat" },
  { id: "wiki", label: "법규 위키", to: "/wiki", icon: "book-open", group: "law", match: ["/wiki"], cloud: true },
  { id: "credits", label: "크레딧", to: "/credits", icon: "coins", group: "footer", match: ["/credits"], cloud: true },
  { id: "license", label: "라이선스", to: "/license", icon: "key", group: "footer", match: ["/license"], cloud: false },
  { id: "settings", label: "설정", to: "/settings/general", icon: "settings", group: "footer", match: ["/settings"], cloud: false },
];

export const NAV_GROUP_LABEL: Readonly<Record<NavGroup, string | null>> = { main: null, law: "법규", footer: null };

export interface ProjectTab {
  readonly id: string;
  readonly label: string;
  /** /projects/:id/ 뒤 경로. */
  readonly segment: string;
  /** 로그인 필수(클라우드) 탭. */
  readonly cloud: boolean;
  readonly feature?: EntitlementFeature;
  readonly p1?: boolean;
}

/**
 * 프로젝트 상단 탭 8개(1절 :15 순서). 탭 수가 많아 768~1199 구간과 레일 옆 헤더 한 줄에 다 들어가지 않을 수 있다:
 * 3.19절·COMPONENTS의 Tabs처럼 가로 스크롤(overflow-x-auto)로 처리하고 "더보기" 메뉴는 두지 않는다
 * (키보드·스크린리더에서 8개가 한 tablist로 보여야 하고, 숨긴 탭은 현재 위치 표시가 어긋난다).
 * 제안서 권리 키는 ADR-001 4.7 표에 따로 없어(미확인) 로그인만 요구한다 — AR-06-032가 확정한다.
 */
export const PROJECT_TABS: readonly ProjectTab[] = [
  { id: "site", label: "대지", segment: "site", cloud: false },
  { id: "model", label: "모델·판정", segment: "model", cloud: false },
  { id: "program", label: "프로그램", segment: "program", cloud: false },
  { id: "plans", label: "평면", segment: "plans", cloud: false, p1: true },
  { id: "sheets", label: "도면", segment: "sheets", cloud: false },
  { id: "render", label: "렌더", segment: "render", cloud: true, feature: "ai_render" },
  { id: "proposal", label: "제안서", segment: "proposal", cloud: true },
  { id: "review", label: "검토", segment: "review", cloud: true, feature: "cloud_review" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.match.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 프로젝트 안 경로면 프로젝트 id. GNB 레일 자동 접힘(D-31)과 탭 표시에 쓴다. */
export function projectIdOf(pathname: string): string | null {
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  return m ? decodeURIComponent(m[1] ?? "") || null : null;
}

export type LockState =
  | { readonly kind: "open" }
  | { readonly kind: "offline" }
  | { readonly kind: "locked"; readonly reason: string };

/** 거부 사유 → 짧은 이유(03장 5.1절 잠금 문구의 앞부분). 상세 문구는 각 화면의 LockedState가 보인다. */
export const DENY_TEXT: Readonly<Record<string, string>> = {
  expired: "이용 기간이 끝났습니다",
  fallback: "업데이트 플랜에서 씁니다",
  seat_unassigned: "배정된 좌석이 없습니다",
  seat_revoked: "좌석 배정이 해제되었습니다",
  no_product: "라이선스나 구독이 필요합니다",
  offline: "인터넷 연결 후 씁니다",
  unverified: "권한을 아직 확인하지 못했습니다",
};

/** 메뉴·탭 잠금 판정(순수). 오프라인이 먼저(클라우드 메뉴), 그다음 권리 판정. 판정 전(undefined)은 열림으로 그린다. */
export function lockOf(entry: { cloud: boolean; feature?: EntitlementFeature }, online: boolean, decision: EntitlementDecision | undefined): LockState {
  if (entry.cloud && !online) return { kind: "offline" };
  if (entry.feature && decision && !decision.allowed) return { kind: "locked", reason: DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified! };
  return { kind: "open" };
}
