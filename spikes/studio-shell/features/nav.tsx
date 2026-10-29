// packages/features 가 보는 라우터 계약. 화면은 react-router·next/* 를 import하지 않는다.
// 셸(Vite+React Router / Next App Router)이 이 계약을 구현해 Provider로 감싼다.
import { createContext, use, type ComponentType, type ReactNode } from "react";

export type Params = Readonly<Record<string, string | undefined>>;

export interface StudioNav {
  params: Params;
  /** 셸 basename을 뺀 앱 기준 경로(예: /projects/42/site) */
  pathname: string;
  search: URLSearchParams;
  /** 앱 기준 절대 경로만 받는다(상대 경로 해석 차이를 계약에서 제거) */
  navigate(to: string, opts?: { replace?: boolean }): void;
  Link: ComponentType<{ to: string; children: ReactNode; id?: string }>;
  /** route.loader 결과. 로더 없는 경로는 undefined */
  data: unknown;
}

export const NavContext = createContext<StudioNav | null>(null);

export function useNav(): StudioNav {
  const nav = use(NavContext);
  if (!nav) throw new Error("NavContext 없음: 셸 어댑터가 감싸지 않았다.");
  return nav;
}
