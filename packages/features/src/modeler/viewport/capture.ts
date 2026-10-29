// 렌더용 깊이·윤곽 캡처(AR-06-036 → AR-06-056 렌더 입력, 03장 3.9절 "깊이·윤곽 이미지(로컬 생성)").
// - 깊이: 매스(캡처 층 1)만 MeshDepthMaterial로 그린 회색조(가까울수록 밝음, 배경 검정).
// - 윤곽: 매스로 깊이만 채운 뒤(색 쓰기 끔·폴리곤 오프셋) 윤곽선(캡처 층 2)을 검정으로 그린 숨은선 제거 선화(배경 흰색).
// - 결과는 RGBA 바이트(위쪽 행부터). 이미지 파일 인코딩·업로드는 056이 한다. 색·좌표를 만들지 않고 지금 장면을 그대로 찍는다.
import { Color, LineBasicMaterial, MeshBasicMaterial, MeshDepthMaterial, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from "three";

/** 캡처 대상 표시 층(three Layers 번호). 매스 면 = 1, 매스 윤곽 = 2. 0은 화면 표시. */
export const CAPTURE_MASS_LAYER = 1;
export const CAPTURE_OUTLINE_LAYER = 2;
/** 캡처 한 변 상한(메모리 보호). */
export const CAPTURE_MAX_SIDE = 4096;

export interface CaptureOptions {
  readonly width: number;
  readonly height: number;
}

export interface CaptureResult {
  readonly width: number;
  readonly height: number;
  /** RGBA, 위쪽 행부터. 회색조 깊이(가까움 = 밝음). */
  readonly depth: Uint8ClampedArray;
  /** RGBA, 위쪽 행부터. 흰 바탕에 검정 윤곽선. */
  readonly outline: Uint8ClampedArray;
}

/** 캡처 크기 검사(정수 1..상한). */
export function captureSize(o: CaptureOptions): CaptureOptions {
  const ok = (v: number) => Number.isSafeInteger(v) && v >= 1 && v <= CAPTURE_MAX_SIDE;
  if (!ok(o.width) || !ok(o.height)) throw new RangeError(`캡처 크기는 1~${CAPTURE_MAX_SIDE} 정수입니다`);
  return o;
}

/** WebGL readPixels(아래쪽 행부터) → 위쪽 행부터(순수). */
export function flipRows(src: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
  const row = width * 4;
  const out = new Uint8ClampedArray(row * height);
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row;
    for (let i = 0; i < row; i++) out[y * row + i] = src[from + i] as number;
  }
  return out;
}

/** 윤곽 이진화(순수): 배경(흰색)에 가까운 픽셀은 흰색, 나머지는 검정. 안티에일리어싱 회색을 정리한다. */
export function binarizeOutline(rgba: Uint8ClampedArray, threshold = 200): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = ((rgba[i] as number) + (rgba[i + 1] as number) + (rgba[i + 2] as number)) / 3;
    const v = lum >= threshold ? 255 : 0;
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** 지금 카메라로 깊이·윤곽을 찍는다. 장면·카메라·렌더러 상태는 끝나면 되돌린다. */
export function captureDepthOutline(gl: WebGLRenderer, scene: Scene, camera: Camera, options: CaptureOptions): CaptureResult {
  const { width, height } = captureSize(options);
  const target = new WebGLRenderTarget(width, height);
  const depthMat = new MeshDepthMaterial();
  const maskMat = new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const lineMat = new LineBasicMaterial({ color: new Color(0, 0, 0) });
  const saved = {
    background: scene.background,
    override: scene.overrideMaterial,
    mask: camera.layers.mask,
    target: gl.getRenderTarget(),
    autoClear: gl.autoClear,
    clear: gl.getClearColor(new Color()),
    clearAlpha: gl.getClearAlpha(),
  };
  const read = () => {
    const buf = new Uint8Array(width * height * 4);
    gl.readRenderTargetPixels(target, 0, 0, width, height, buf);
    return flipRows(buf, width, height);
  };
  try {
    gl.setRenderTarget(target);
    gl.autoClear = true;
    // 1) 깊이
    scene.background = new Color(0, 0, 0);
    scene.overrideMaterial = depthMat;
    camera.layers.set(CAPTURE_MASS_LAYER);
    gl.render(scene, camera);
    const depth = read();
    // 2) 윤곽(숨은선 제거)
    scene.background = new Color(1, 1, 1);
    scene.overrideMaterial = maskMat;
    gl.render(scene, camera);
    gl.autoClear = false;
    scene.overrideMaterial = lineMat;
    camera.layers.set(CAPTURE_OUTLINE_LAYER);
    gl.render(scene, camera);
    const outline = binarizeOutline(read());
    return { width, height, depth, outline };
  } finally {
    scene.background = saved.background;
    scene.overrideMaterial = saved.override;
    camera.layers.mask = saved.mask;
    gl.setRenderTarget(saved.target);
    gl.autoClear = saved.autoClear;
    gl.setClearColor(saved.clear, saved.clearAlpha);
    target.dispose();
    depthMat.dispose();
    maskMat.dispose();
    lineMat.dispose();
  }
}
