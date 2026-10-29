// 뷰포트 색: packages/ui/src/tokens.css 토큰을 실행 중에 읽는다(소스에 색 값 없음). 테마(라이트·다크)가 바뀌면 다시 읽는다.
export interface SceneColors {
  readonly viewport: string;
  readonly grid: string;
  readonly siteLine: string;
  readonly mass: string;
  readonly massEdge: string;
  readonly selection: string;
  readonly envelope: string;
  readonly envelopeOpacity: number;
  readonly danger: string;
  readonly draft: string;
}

export const SCENE_TOKENS = {
  viewport: "--color-viewport",
  grid: "--color-grid",
  siteLine: "--color-site-line",
  mass: "--color-mass",
  massEdge: "--color-mass-edge",
  selection: "--color-selection",
  envelope: "--color-envelope",
  danger: "--color-danger",
  draft: "--color-info",
} as const;

/** 토큰 이름 → 값 조회 함수에서 장면 색을 만든다(값이 비면 이름 있는 CSS 색으로 대신, 순수). */
export function sceneColors(get: (name: string) => string): SceneColors {
  const v = (name: string, fallback: string) => get(name).trim() || fallback;
  const op = Number.parseFloat(get("--envelope-fill-opacity"));
  return {
    viewport: v(SCENE_TOKENS.viewport, "white"),
    grid: v(SCENE_TOKENS.grid, "silver"),
    siteLine: v(SCENE_TOKENS.siteLine, "black"),
    mass: v(SCENE_TOKENS.mass, "gray"),
    massEdge: v(SCENE_TOKENS.massEdge, "dimgray"),
    selection: v(SCENE_TOKENS.selection, "navy"),
    envelope: v(SCENE_TOKENS.envelope, "teal"),
    envelopeOpacity: Number.isFinite(op) && op > 0 && op < 1 ? op : 0.16,
    danger: v(SCENE_TOKENS.danger, "red"),
    draft: v(SCENE_TOKENS.draft, "navy"),
  };
}

export function readSceneColors(el: Element): SceneColors {
  const cs = getComputedStyle(el);
  return sceneColors((n) => cs.getPropertyValue(n));
}
