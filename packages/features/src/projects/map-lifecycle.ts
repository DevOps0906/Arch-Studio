// 지도 한 번의 생명 주기(순수): 실패(시간 초과·오류)·정리 뒤에는 늦게 온 load가 지도를 되살리지 않고, 지도는 한 번만 지운다(WebGL 컨텍스트 반납).
export type MapPhase = "loading" | "ready" | "fallback";

export interface MapLifecycle {
  /** 아직 살아 있는가(실패·정리 전). 비동기 단계 사이마다 확인한다. */
  readonly alive: () => boolean;
  /** 만든 지도의 정리 함수를 붙인다. 이미 끝났으면 바로 지운다. */
  attach(remove: () => void): void;
  /** load: 살아 있을 때만 ready. */
  ready(): void;
  /** 실패: 확정 종료(지도 제거) + fallback. 두 번째부터는 무시. */
  fail(): void;
  /** 화면에서 빠질 때(상태는 바꾸지 않는다). */
  dispose(): void;
}

export function createMapLifecycle(setPhase: (p: MapPhase) => void): MapLifecycle {
  let alive = true;
  let remove: (() => void) | null = null;
  const end = () => {
    alive = false;
    const r = remove;
    remove = null;
    r?.();
  };
  return {
    alive: () => alive,
    attach(r) {
      if (!alive) return r();
      remove = r;
    },
    ready() {
      if (alive) setPhase("ready");
    },
    fail() {
      if (!alive) return;
      end();
      setPhase("fallback");
    },
    dispose: end,
  };
}
