// 열린 프로젝트 맥락(ProjectShell이 한 번 열고 탭 화면이 공유). 데이터 정본은 ProjectStore(070)이고 여기는 읽기만 한다.
// 저장(save·버전 충돌)은 각 화면/034가 adapters.projects.save로 하고, 끝나면 reload()로 이 맥락을 갱신한다.
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAdapters } from "./context.tsx";
import { bridgeErrorCode, type BridgeErrorCode } from "./errors.ts";

export type ProjectLoad =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "error"; readonly code: BridgeErrorCode | null }
  | { readonly status: "ready"; readonly record: ProjectRecord };

export interface ProjectValue {
  readonly id: string;
  readonly load: ProjectLoad;
  reload(): void;
}

const ProjectContext = createContext<ProjectValue | null>(null);

export function ProjectProvider({ id, children }: { id: string; children: ReactNode }) {
  const { projects } = useAdapters();
  const [load, setLoad] = useState<ProjectLoad>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad({ status: "loading" });
    projects.open(id).then(
      (record) => alive && setLoad(record ? { status: "ready", record } : { status: "missing" }),
      (e: unknown) => {
        if (!alive) return;
        const code = bridgeErrorCode(e);
        // 형식이 틀린 id(INVALID_INPUT)는 없는 프로젝트와 같게 보인다(id 원문을 화면에 되풀이하지 않는다).
        setLoad(code === "INVALID_INPUT" || code === "NOT_FOUND" ? { status: "missing" } : { status: "error", code });
      },
    );
    return () => {
      alive = false;
    };
  }, [projects, id, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return <ProjectContext.Provider value={{ id, load, reload }}>{children}</ProjectContext.Provider>;
}

/** 프로젝트 탭 화면에서 현재 프로젝트. ProjectShell 밖에서 부르면 오류. */
export function useProject(): ProjectValue {
  const v = useContext(ProjectContext);
  if (!v) throw new Error("useProject는 /projects/:id 아래 화면에서만 쓴다.");
  return v;
}
