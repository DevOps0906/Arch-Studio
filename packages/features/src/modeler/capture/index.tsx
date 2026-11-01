// 렌더 화면용 모델러 공개 파일(AR-06-056, 03장 3.9절 "모델러 뷰포트 축소판, 현재 시점 쓰기"). render/는 이 파일 하나만 import한다.
// - 열람 전용 뷰포트(편집·선택 없음, 회전만)를 지연 로드하고, 지금 시점의 깊이·윤곽을 PNG 2장으로 돌려준다.
// - 보내는 것은 이미지 2장뿐: 설계 모델·도면 데이터는 이 함수 밖으로 나가지 않는다. 좌표·색을 만들지 않고 지금 장면을 그대로 찍는다.
// - three는 viewport 청크에만(정적 import 금지, 타입만).
import { Suspense, lazy, useImperativeHandle, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { LoadingState } from "../../shell/index.ts";
import type { EngineSnapshot } from "../engine/client.ts";
import { parseModelJson } from "../state/load.ts";
import type { LayerKey } from "../state/store.ts";
import { readSceneColors, type SceneColors } from "../viewport/colors.ts";
import type { ViewportHandle } from "../viewport/Viewport.tsx";
import { RENDER_STD_MAX_PX, encodeRenderInputs, renderCaptureSize, type RenderInputPngs } from "./png.ts";

export { RENDER_INPUT_MAX_BYTES, RENDER_STD_MAX_PX, RenderCaptureError, type RenderInputPngs } from "./png.ts";

const Viewport = lazy(() => import("../viewport/Viewport.tsx"));

export interface RenderViewHandle {
  /** 지금 시점의 깊이·윤곽 PNG. 뷰포트가 아직 없으면 null. 상한 초과는 RenderCaptureError. */
  capture(maxPx?: number): Promise<RenderInputPngs | null>;
}

const EMPTY_ENGINE: EngineSnapshot = {
  meshes: new Map(),
  failedKeys: new Set(),
  envelope: null,
  envelopeStatus: "idle",
  envelopeError: null,
  excess: new Map(),
  excessBusy: false,
};
const HIDDEN: readonly LayerKey[] = ["envelope", "excess"];
const NONE: readonly never[] = [];
const noop = () => undefined;

function hasWebGL2(): boolean {
  try {
    return typeof document !== "undefined" && document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export function RenderView({ designModel, handleRef }: { designModel: string; handleRef: Ref<RenderViewHandle> }) {
  const parsed = useMemo(() => parseModelJson(designModel), [designModel]);
  const viewport = useRef<ViewportHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [webgl] = useState(hasWebGL2);
  const [colors, setColors] = useState<SceneColors | null>(null);

  useEffect(() => {
    if (rootRef.current) setColors(readSceneColors(rootRef.current));
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      async capture(maxPx = RENDER_STD_MAX_PX) {
        const el = rootRef.current;
        const vp = viewport.current;
        if (!el || !vp || el.clientWidth < 1 || el.clientHeight < 1) return null;
        const shot = vp.capture(renderCaptureSize(el.clientWidth, el.clientHeight, maxPx));
        return shot ? encodeRenderInputs(shot, maxPx) : null;
      },
    }),
    [],
  );

  return (
    <div ref={rootRef} className="relative aspect-4/3 w-full overflow-hidden rounded-control border border-line bg-viewport">
      {!parsed.ok ? (
        <div className="flex h-full items-center justify-center p-pad text-center text-body text-fg-2">설계 모델을 읽지 못해 시점을 보여 줄 수 없습니다.</div>
      ) : !webgl ? (
        <div className="flex h-full items-center justify-center p-pad text-center text-body text-fg-2">이 환경에서는 3D 보기를 열 수 없습니다(WebGL2 필요).</div>
      ) : colors ? (
        <Suspense fallback={<LoadingState label="3D 보기를 여는 중" rows={1} />}>
          <Viewport
            handleRef={viewport}
            model={parsed.model}
            selection={null}
            highlight={NONE}
            drag={null}
            tool="select"
            draft={NONE}
            hidden={HIDDEN}
            camera="perspective"
            fitN={0}
            editable={false}
            measures={NONE}
            measureStart={null}
            section={null}
            sectionDraft={null}
            sectionView={false}
            engine={EMPTY_ENGINE}
            colors={colors}
            dispatch={noop}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
