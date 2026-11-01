// 새 프로젝트 창의 대지 지도(MapLibre GL JS, 동적 import — 지도를 쓸 때만 청크를 받는다): 선택 대지를 반투명 토큰 색으로 칠하고 대지에 맞춰 보인다.
// 대체 경로(fallback = SitePreview SVG): 지도 원천 없음(설치형·스위치 꺼짐), WebGL 없음, 모듈·스타일 오류.
// 타일은 Bearer가 필요해 transformRequest로 Authorization을 붙인다(tile-auth.ts: 주기적·401 뒤 토큰 갱신, 401 연속·403이면 배경만 비움). 정적 그림(조작 없음).
// 타일 오류(404 범위 밖 등)는 배경만 빈다 — 대지 폴리곤은 계속 그린다. 경계 그림으로 바꾸는 것은 WebGL·모듈·스타일 오류·시간 초과뿐.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RasterTileSource } from "maplibre-gl";
import { buildSiteMapStyle, GRID_STEP_M, siteGeometry, TILE_MAX_ZOOM, type SiteMapColors, type SiteMapSource } from "./site-map-style.ts";
import { createMapLifecycle, type MapPhase } from "./map-lifecycle.ts";
import { createTileAuth } from "./tile-auth.ts";

type Phase = MapPhase;

/** 대지 둘레 여백(지도 폭 대비 비율). */
const FIT_PADDING_RATIO = 0.12;
/** 이 시간 안에 지도가 다 그려지지 않으면(워커·CSP·타일 지연) 경계 그림으로 바꾼다. */
const LOAD_TIMEOUT_MS = 8000;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** 토큰(CSS 변수) 값을 읽는다. 테마가 바뀌어도 지도를 다시 만들 때 따라간다. */
function readColors(el: HTMLElement): SiteMapColors {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return { background: v("--color-viewport"), grid: v("--color-grid"), fill: v("--color-accent-strong"), line: v("--color-site-line") };
}

export function SiteMap({ ringM, source, label, fallback }: { ringM: readonly (readonly [number, number])[]; source: SiteMapSource | null; label: string; fallback: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(source ? "loading" : "fallback");
  /** 타일 401 연속·403(권한·권리 없음)·토큰 없음: 배경만 비우고 대지는 계속 그린다. */
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!source || !el) return;
    if (!hasWebGL()) {
      setPhase("fallback");
      return;
    }
    // 실패(시간 초과·오류)는 확정 종료: 지도를 지우고 늦게 온 load는 무시한다(map-lifecycle.ts).
    const life = createMapLifecycle(setPhase);
    const alive = life.alive;
    setPhase("loading");
    setBackgroundFailed(false);
    const timer = setTimeout(() => life.fail(), LOAD_TIMEOUT_MS);
    const fail = () => {
      clearTimeout(timer);
      life.fail();
    };
    void (async () => {
      try {
        const auth = source.kind === "tiles" ? createTileAuth(source.token) : null;
        const firstToken = auth ? await auth.refresh(Date.now()) : null;
        // 워커는 번들러가 같은 출처 파일로 묶은 URL로 지정한다(기본값은 import.meta.url 기준 상대 경로라 Vite 사전 번들·빌드에서 깨진다, CSP worker-src 'self').
        const [{ Map, setWorkerUrl }, { default: workerUrl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"), import("maplibre-gl/dist/maplibre-gl.css")]);
        if (!alive()) return;
        setWorkerUrl(workerUrl);
        const tileUrl = source.kind === "tiles" ? source.tileUrl("base") : null;
        const tilePrefix = tileUrl ? tileUrl.split("{z}")[0] : null;
        const { bounds } = siteGeometry(ringM);
        const map = new Map({
          container: el,
          style: buildSiteMapStyle(ringM, source, "base", readColors(el)),
          bounds,
          fitBoundsOptions: { padding: Math.round(el.clientWidth * FIT_PADDING_RATIO), maxZoom: TILE_MAX_ZOOM },
          interactive: false,
          attributionControl: false,
          // 요청마다 현재 토큰(만료 전 주기적으로 다시 받음 — transformRequest는 동기라 받아 둔 값을 쓴다).
          transformRequest: (url) => {
            if (!auth || !tilePrefix || !url.startsWith(tilePrefix)) return { url };
            if (auth.due(Date.now())) void auth.refresh(Date.now());
            const headers = auth.headers(url);
            return headers ? { url, headers } : { url };
          },
        });
        // 창 열림·구간 전환으로 칸 크기가 바뀌면 캔버스를 맞춘다.
        const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.resize());
        resize?.observe(el);
        life.attach(() => {
          resize?.disconnect();
          map.remove();
        });
        const dropBackground = () => {
          const hide = () => {
            if (map.getLayer("tiles")) map.setLayoutProperty("tiles", "visibility", "none");
          };
          if (map.isStyleLoaded()) hide();
          else map.once("load", hide);
          if (alive()) setBackgroundFailed(true);
        };
        if (auth && !firstToken) dropBackground();
        map.on("error", (e) => {
          const sourceId = (e as { sourceId?: unknown }).sourceId;
          if (sourceId !== "tiles") return fail(); // 스타일·모듈 오류만 경계 그림으로
          if (!auth || !tileUrl) return;
          const status = (e.error as { status?: unknown } | undefined)?.status;
          const url = (e.error as { url?: unknown } | undefined)?.url;
          const action = auth.onError(typeof status === "number" ? status : undefined, typeof url === "string" ? url : undefined);
          if (action === "give-up") dropBackground();
          else if (action === "refresh") {
            // 새 토큰으로 타일을 다시 받는다.
            void auth.refresh(Date.now()).then((t) => {
              if (!alive()) return;
              if (!t) return dropBackground();
              (map.getSource("tiles") as RasterTileSource | undefined)?.setTiles([tileUrl]);
            });
          }
        });
        map.on("sourcedata", (e) => {
          if (e.sourceId === "tiles" && e.tile) auth?.onOk();
        });
        map.once("load", () => {
          clearTimeout(timer);
          life.ready();
        });
      } catch {
        fail();
      }
    })();
    return () => {
      clearTimeout(timer);
      life.dispose();
    };
  }, [ringM, source]);
  if (phase === "fallback") return <>{fallback}</>;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-panel border border-line bg-viewport">
        {/* MapLibre CSS가 지도 컨테이너에 position: relative를 덮어써(.maplibregl-map) absolute를 무력화한다 → 위치는 바깥 칸이 잡고 컨테이너는 크기만 채운다. */}
        <div className="absolute inset-0">
          <div ref={ref} role="img" aria-label={label} className="h-full w-full" />
        </div>
        {phase === "loading" ? <p className="absolute inset-0 flex items-center justify-center text-caption text-fg-2">지도를 불러오는 중입니다</p> : null}
      </div>
      {backgroundFailed ? <p role="status" className="text-caption text-fg-2">지도 배경을 불러오지 못했습니다. 대지 경계는 그대로 보입니다.</p> : null}
      <p className="text-caption text-fg-3">{source?.kind === "tiles" ? "배경 지도: 브이월드(국토교통부). 위쪽이 북쪽입니다." : `배경 지도 없음 · 모눈 한 칸 ${GRID_STEP_M}m · 위쪽이 북쪽입니다.`}</p>
    </div>
  );
}
