// 3D 뷰포트(R3F, 지연 로드 청크). [DECISION] 구성: 매스마다 mesh 1개, 드래그 중에는 mesh 위치만 바꾼다(지오메트리 재생성·불린 없음),
// 매스 메시는 엔진 워커 결과(없으면 TS 폴백), 엔벨로프는 반투명 단일 패스(FrontSide), 초과분은 워커 불린 결과, 윤곽선은 DesignModel 데이터,
// 선택 레이캐스트는 drei Bvh(three-mesh-bvh). drei Text·DRACOLoader 등 blob 워커를 만드는 것은 쓰지 않는다(CSP worker-src 'self').
// 캔버스는 aria-hidden: 같은 정보를 레이어 패널·속성 인스펙터·판정 패널 글자로 준다(03장 6.1절). 좌표는 모두 mm 정수로 스냅해 명령에 넘긴다.
// 측정·단면(AR-06-084, 표시 전용): 측정 점은 tools/measure.ts 스냅(꼭짓점·변·바닥 100mm), 거리 글자는 캔버스 위 DOM 겹침(aria-hidden, 같은 값은 측정 목록 글자).
// 단면은 재질 clippingPlanes(월드 평면)로 매스·윤곽·엔벨로프를 자르고 매스는 양면으로 그린다. 초과분 강조는 자르지 않는다(항상 보임).
// 표시 값(AR-06-085, display/settings.ts): 조명 프리셋·그림자(주광 1개)·재질 프리셋·층 라벨(DOM 겹침)·층 숨김·분해도.
// 층 숨김·분해도는 층별 판(slabMesh, TS)으로 나눠 그리고, 삼각형 수가 MAX_TRIANGLES를 넘으면 나누지 않는다(매스 메시 그대로).
// 엔벨로프·초과분은 판정 표시라 분해도·층 숨김과 무관하게 원래 자리에 그린다.
import type { Point } from "@arch-studio/domain";
import { Bvh } from "@react-three/drei/core/Bvh.js";
import { OrbitControls } from "@react-three/drei/core/OrbitControls.js";
import { Canvas, useFrame, useThree, type ThreeElements, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentRef, type Dispatch, type ReactElement, type Ref } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, GridHelper, Line, LineBasicMaterial, Object3D, Plane, Spherical, Vector3, type DirectionalLight } from "three";
import { snapMm, type Mass, type Model } from "../state/commands.ts";
import type { Action, CameraMode, LayerKey, Tool } from "../state/store.ts";
import type { EngineSnapshot } from "../engine/client.ts";
import { CAPTURE_MASS_LAYER, CAPTURE_OUTLINE_LAYER, captureDepthOutline, type CaptureOptions, type CaptureResult } from "./capture.ts";
import type { SceneColors } from "./colors.ts";
import { formatMm, measureDistance, measureSegments, snapMeasurePoint, snapTargets, type Measurement, type Point3, type SnapKind } from "../tools/measure.ts";
import { keepsPoint, sectionPlane, worldClipPlane, type SectionLine } from "../tools/section.ts";
import {
  cameraPose,
  closesDraft,
  draftLine,
  floorLabelAnchor,
  massOutline,
  meshKey,
  modelToWorld,
  sceneBounds,
  sectionLineSegments,
  sectionViewPose,
  siteLoop,
  slabOutline,
  worldToModel,
  type Bounds,
  type MeshData,
} from "./geometry.ts";
import { prismMesh, slabMesh } from "./prism.ts";
import {
  DEFAULT_DISPLAY,
  LIGHT_RIGS,
  MATERIAL_LOOKS,
  MAX_FLOOR_LABELS,
  effectiveFloorOnly,
  floorSlabs,
  needsSplit,
  splitAllowed,
  type DisplaySettings,
  type FloorSlab,
  type MaterialLook,
} from "../display/settings.ts";

/** 바닥 점·드래그 스냅 격자(mm). */
export const SNAP_MM = 100;
/** 그리기: 첫 점에서 이 거리 안을 찍으면 닫는다(mm). */
const CLOSE_TOLERANCE_MM = 400;

export interface ViewportHandle {
  /** 렌더용 깊이·윤곽 캡처(AR-06-056 입력). 크기를 주지 않으면 지금 캔버스 크기. */
  capture(options?: CaptureOptions): CaptureResult | null;
  /** 키보드 카메라 회전(Ctrl+화살표). */
  orbit(dAzimuth: number, dPolar: number): void;
}

export interface ViewportProps {
  readonly model: Model;
  readonly selection: string | null;
  readonly highlight: readonly string[];
  readonly drag: { readonly id: string; readonly dx: number; readonly dy: number } | null;
  readonly tool: Tool;
  readonly draft: readonly Point[];
  readonly hidden: readonly LayerKey[];
  readonly camera: CameraMode;
  readonly fitN: number;
  readonly editable: boolean;
  readonly measures: readonly Measurement[];
  readonly measureStart: Point3 | null;
  readonly section: SectionLine | null;
  readonly sectionDraft: Point | null;
  readonly sectionView: boolean;
  /** 표시 값(조명·그림자·재질·층 라벨·층 숨김·분해도). 없으면 기본값(렌더 캡처). */
  readonly display?: DisplaySettings;
  readonly engine: EngineSnapshot;
  readonly colors: SceneColors;
  readonly dispatch: Dispatch<Action>;
  readonly handleRef?: Ref<ViewportHandle>;
}

/** 캔버스 위 글자 위치(캔버스 CSS 좌표): 측정 거리(찍는 중 미리보기 포함)·층 라벨. */
interface MeasureLabel {
  readonly key: string;
  readonly kind: "measure" | "floor";
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export default function Viewport(props: ViewportProps) {
  const [labels, setLabels] = useState<readonly MeasureLabel[]>([]);
  return (
    <>
      <Canvas
        aria-hidden="true"
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true }}
        shadows
        camera={{ fov: 40, near: 0.1, far: 5000, position: [30, 30, 30] }}
        className="touch-none"
      >
        <Scene {...props} onLabels={setLabels} />
      </Canvas>
      {labels.length > 0 ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {labels.map((l) => (
            <span
              key={l.key}
              className={
                l.kind === "floor"
                  ? "absolute -translate-y-1/2 whitespace-nowrap px-1 text-caption font-semibold text-fg-2 text-num"
                  : "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-control border border-line bg-surface px-1 text-caption text-fg text-num"
              }
              style={{ left: l.x, top: l.y }}
            >
              {l.text}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function toGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(m.positions, 3));
  g.setIndex(new BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function useGeometry(data: MeshData | null): BufferGeometry | null {
  const g = useMemo(() => (data ? toGeometry(data) : null), [data]);
  useEffect(() => () => g?.dispose(), [g]);
  return g;
}

function useLineGeometry(positions: Float32Array): BufferGeometry {
  const g = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.computeBoundingSphere();
    return geo;
  }, [positions]);
  useEffect(() => () => g.dispose(), [g]);
  return g;
}

const enableLayer = (n: number) => (o: Object3D) => o.layers.enable(n);
const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const NO_CLIP: Plane[] = [];

/** 월드 점(m) → 모델 mm 실수 [x, y, z]. */
const worldPointToModel = (w: Vector3): Point3 => [w.x * 1000, -w.z * 1000, w.y * 1000];

/** 포인터 광선 → 지면 점(mm 정수, 격자 스냅). */
function groundPoint(e: ThreeEvent<PointerEvent | MouseEvent>, snap = SNAP_MM): Point | null {
  const hit = e.ray.intersectPlane(GROUND, new Vector3());
  if (!hit) return null;
  const [x, y] = worldToModel(hit.x, hit.z);
  return [snapMm(x, snap), snapMm(y, snap)];
}

function Scene(p: ViewportProps & { readonly onLabels: (labels: readonly MeasureLabel[]) => void }) {
  const { model, colors } = p;
  const display = p.display ?? DEFAULT_DISPLAY;
  const floorOnly = effectiveFloorOnly(model, display.floorOnly);
  // 층별 판으로 나눠 그리기(분해도·층 숨김). 삼각형 상한을 넘으면 매스 메시 그대로(패널이 안내).
  const split = needsSplit(display.explodeMm, floorOnly) && splitAllowed(model, display.explodeMm, floorOnly);
  const explodeMm = split ? display.explodeMm : 0;
  const slabsOf = (m: Mass): FloorSlab[] | null => (split ? floorSlabs(m, explodeMm, floorOnly) : null);
  const look = MATERIAL_LOOKS[display.material];
  const { gl, scene, camera, invalidate, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const dragStart = useRef<Point | null>(null);
  /** 포인터가 편집 가능한 매스 위에 있음(궤도 제어 꺼 둠). */
  const overMass = useRef(false);
  const setOrbit = () => {
    if (controls.current) controls.current.enabled = !overMass.current && dragStart.current === null;
  };
  const [hover, setHover] = useState<Point | null>(null);
  const bounds = useMemo(() => sceneBounds(model), [model]);
  // 맞춤은 대지·매스 기준(엔벨로프 표시 상한 60m는 맞춤에 넣지 않는다).
  const top = useMemo(
    () => Math.max(...model.masses.map((m) => m.base_level_mm + m.floors.reduce((s, f) => s + f.height_mm, 0) + Math.max(0, m.floors.length - 1) * explodeMm), 3000),
    [model, explodeMm],
  );
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const basePose = cameraPose(p.camera, bounds, top, model.site.north_angle_deg, aspect);
  const pose = (p.sectionView && p.section ? sectionViewPose(p.section.a, p.section.b, bounds, top, aspect) : null) ?? basePose;

  // 카메라 맞춤: 뷰 전환·F·처음. 매스 편집으로는 카메라를 움직이지 않는다(폭이 바뀌어도 카메라 유지, 6.4절).
  useEffect(() => {
    const c = controls.current;
    camera.position.set(...pose.position);
    if (c) {
      c.target.set(...pose.target);
      c.update();
    } else camera.lookAt(...pose.target);
    invalidate();
    // pose는 fitN·camera가 바뀔 때만 적용한다(매스 편집으로 카메라가 튀지 않게)
  }, [p.fitN, p.camera]);

  useImperativeHandle(
    p.handleRef,
    () => ({
      capture(options) {
        const w = Math.min(options?.width ?? Math.round(size.width), 4096);
        const h = Math.min(options?.height ?? Math.round(size.height), 4096);
        if (w < 1 || h < 1) return null;
        const r = captureDepthOutline(gl, scene, camera, { width: w, height: h });
        invalidate();
        return r;
      },
      orbit(dAz, dPolar) {
        const c = controls.current;
        if (!c || !pose.rotate) return;
        const off = camera.position.clone().sub(c.target);
        const s = new Spherical().setFromVector3(off);
        s.theta += dAz;
        s.phi = Math.min(Math.PI / 2 - 0.05, Math.max(0.05, s.phi + dPolar));
        off.setFromSpherical(s);
        camera.position.copy(c.target).add(off);
        c.update();
        invalidate();
      },
    }),
    [gl, scene, camera, invalidate, size, pose.rotate],
  );

  // 놓친 pointerup(캔버스 밖에서 놓음)도 드래그를 끝낸다.
  const dragging = p.drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const up = () => {
      dragStart.current = null;
      setOrbit();
      p.dispatch({ type: "dragEnd" });
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [dragging, p]);

  const grid = useMemo(() => {
    const span = Math.ceil(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 10_000) / 1000) * 2 + 10;
    const g = new GridHelper(span, span, colors.grid, colors.grid);
    const cx = (bounds.minX + bounds.maxX) / 2000;
    const cz = -(bounds.minY + bounds.maxY) / 2000;
    g.position.set(Math.round(cx), -0.002, Math.round(cz));
    return g;
  }, [bounds, colors.grid]);
  useEffect(() => () => grid.dispose(), [grid]);

  // 단면 클리핑(표시 전용): 재질 clippingPlanes는 월드 평면이다.
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  const plane = useMemo(() => (p.section ? sectionPlane(p.section) : null), [p.section]);
  const clip = useMemo(() => {
    if (!plane) return null;
    const [x, y, z, c] = worldClipPlane(plane);
    return new Plane(new Vector3(x, y, z), c);
  }, [plane]);
  const clipping = clip ? [clip] : NO_CLIP;

  // 측정: 스냅 후보는 모델이 바뀔 때만 다시 만든다. 허용 거리는 카메라 거리에 비례(화면에서 비슷한 크기).
  // 단면이 있으면 남는 쪽 후보만, 레이캐스트도 남는 쪽 첫 교점만 쓴다(잘라 낸 면을 찍지 않게).
  const targets = useMemo(() => snapTargets(model, plane), [model, plane]);
  const [measureHover, setMeasureHover] = useState<{ point: Point3; kind: SnapKind } | null>(null);
  const tolerance = () => {
    const d = controls.current ? camera.position.distanceTo(controls.current.target) : 30;
    return Math.min(1500, Math.max(150, d * 15));
  };
  const measureAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    // 분해도 중에는 띄운 판을 찍지 않는다(리듀서도 측정을 막는다).
    if (explodeMm > 0) return null;
    for (const hit of e.intersections) {
      const raw = worldPointToModel(hit.point);
      if (!plane || keepsPoint(plane, raw[0], raw[1])) return snapMeasurePoint(raw, targets, tolerance());
    }
    return null;
  };
  useEffect(() => {
    if (p.tool !== "measure") setMeasureHover(null);
  }, [p.tool]);
  const measureLines = useLineGeometry(
    useMemo(() => measureSegments(p.measures, p.measureStart, p.tool === "measure" ? (measureHover?.point ?? null) : null), [p.measures, p.measureStart, p.tool, measureHover]),
  );

  // 층 라벨 자리(mm, 표시 전용): 보이는 매스의 보이는 층마다 1개, 상한 MAX_FLOOR_LABELS.
  const floorAnchors = useMemo(() => {
    const out: { key: string; at: Point3; text: string; massId: string }[] = [];
    if (!display.floorLabels) return out;
    for (const m of model.masses) {
      if (p.hidden.includes(`mass:${m.id}`)) continue;
      const slabs = split ? floorSlabs(m, explodeMm, floorOnly) : floorSlabs(m, 0, null);
      for (const sl of slabs) {
        if (out.length >= MAX_FLOOR_LABELS) return out;
        out.push({ key: `f:${m.id}:${sl.floorId}`, at: floorLabelAnchor(m, sl.z0, sl.z1), text: sl.label, massId: m.id });
      }
    }
    return out;
  }, [model, p.hidden, display.floorLabels, split, explodeMm, floorOnly]);

  // 측정 거리 글자·층 라벨: 렌더된 프레임마다 화면 좌표로 투영하고, 바뀌었을 때만 겹침 DOM을 갱신한다.
  const labelKey = useRef("");
  const { onLabels } = p;
  useEffect(() => () => onLabels([]), [onLabels]);
  useFrame(() => {
    const out: MeasureLabel[] = [];
    const push = (key: string, kind: MeasureLabel["kind"], at: Point3, text: string) => {
      const v = new Vector3(...modelToWorld(at[0], at[1], at[2])).project(camera);
      if (v.z > 1 || v.z < -1) return;
      out.push({ key, kind, x: Math.round(((v.x + 1) / 2) * size.width), y: Math.round(((1 - v.y) / 2) * size.height), text });
    };
    for (const f of floorAnchors) {
      const off = p.drag && p.drag.id === f.massId ? p.drag : null;
      push(f.key, "floor", [f.at[0] + (off?.dx ?? 0), f.at[1] + (off?.dy ?? 0), f.at[2]], f.text);
    }
    const items: { id: number; a: Point3; b: Point3 }[] = p.measures.map((m) => ({ id: m.id, a: m.a, b: m.b }));
    if (p.tool === "measure" && p.measureStart && measureHover) items.push({ id: 0, a: p.measureStart, b: measureHover.point });
    for (const it of items) {
      const mid: Point3 = [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2, (it.a[2] + it.b[2]) / 2];
      const d = formatMm(measureDistance(it.a, it.b).distance);
      push(`m:${it.id}`, "measure", mid, it.id > 0 ? `${it.id}. ${d}` : d);
    }
    const key = JSON.stringify(out);
    if (key !== labelKey.current) {
      labelKey.current = key;
      onLabels(out);
    }
  });

  const site = useLineGeometry(useMemo(() => siteLoop(model), [model]));
  const draft = useLineGeometry(useMemo(() => draftLine(p.draft, p.tool === "draw" ? hover : null), [p.draft, p.tool, hover]));
  const sectionLine = useLineGeometry(useMemo(() => (p.section ? sectionLineSegments(p.section.a, p.section.b) : new Float32Array(0)), [p.section]));
  const sectionDraftLine = useLineGeometry(useMemo(() => sectionLineSegments(p.sectionDraft, p.tool === "section" ? hover : null), [p.sectionDraft, p.tool, hover]));
  const visible = (k: LayerKey) => !p.hidden.includes(k);
  const groundSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 10_000) * 20;

  const onGroundMove = (e: ThreeEvent<PointerEvent>) => {
    const pt = groundPoint(e);
    if (!pt) return;
    if (p.drag && dragStart.current) {
      p.dispatch({ type: "dragMove", dx: pt[0] - dragStart.current[0], dy: pt[1] - dragStart.current[1] });
    } else if (p.tool === "draw" || p.tool === "section") {
      setHover((h) => (h && h[0] === pt[0] && h[1] === pt[1] ? h : pt));
    } else if (p.tool === "measure") {
      onMeasureMove(e);
    }
  };
  const onMeasureMove = (e: ThreeEvent<PointerEvent>) => {
    const m = measureAt(e);
    setMeasureHover((h) => (m === null ? null : h && h.kind === m.kind && h.point.every((v, i) => v === m.point[i]) ? h : m));
  };
  const onMeasureClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const m = measureAt(e);
    if (m) p.dispatch({ type: "measurePoint", point: m.point });
  };
  const onGroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // 궤도 회전 끌기
    if (p.tool === "measure") {
      onMeasureClick(e);
      return;
    }
    if (p.tool === "section") {
      const pt = groundPoint(e);
      if (pt) p.dispatch({ type: "sectionPoint", point: pt });
      return;
    }
    if (p.tool === "draw" && p.editable) {
      const pt = groundPoint(e);
      if (!pt) return;
      if (closesDraft(p.draft, pt, CLOSE_TOLERANCE_MM)) p.dispatch({ type: "draftClose" });
      else p.dispatch({ type: "draftPoint", point: pt });
      return;
    }
    if (p.tool === "select" && p.drag === null) p.dispatch({ type: "select", id: null });
  };
  const endDrag = () => {
    if (!p.drag) return;
    dragStart.current = null;
    setOrbit();
    p.dispatch({ type: "dragEnd" });
  };

  return (
    <>
      <color attach="background" args={[colors.viewport]} />
      <Lights display={display} bounds={bounds} top={top} />
      <primitive object={grid} />
      <OrbitControls ref={controls} makeDefault enableRotate={pose.rotate} enableDamping={false} />
      <group rotation-x={-Math.PI / 2} scale={0.001}>
        {/* 지면(포인터 받기 전용, 보이지 않음) */}
        <mesh position={[(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0]} onPointerMove={onGroundMove} onClick={onGroundClick} onPointerUp={endDrag}>
          <planeGeometry args={[groundSpan, groundSpan]} />
          <meshBasicMaterial visible={false} side={DoubleSide} />
        </mesh>
        {display.shadows ? (
          // 그림자 받는 바닥(표시 전용, 포인터를 받지 않는다). ShadowMaterial은 그림자 부분만 어둡게 그린다.
          <mesh position={[(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0]} receiveShadow raycast={() => null}>
            <planeGeometry args={[groundSpan / 10, groundSpan / 10]} />
            <shadowMaterial transparent opacity={0.22} depthWrite={false} />
          </mesh>
        ) : null}
        {visible("site") ? (
          <lineLoop geometry={site}>
            <lineBasicMaterial color={colors.siteLine} />
          </lineLoop>
        ) : null}
        <Bvh firstHitOnly>
          {model.masses.map((m) =>
            visible(`mass:${m.id}`) ? (
              <MassObject
                key={m.id}
                mass={m}
                mesh={p.engine.meshes.get(meshKey(m)) ?? null}
                offset={p.drag && p.drag.id === m.id ? [p.drag.dx, p.drag.dy] : null}
                selected={p.selection === m.id}
                highlighted={p.highlight.includes(m.id)}
                colors={colors}
                clipping={clipping}
                slabs={slabsOf(m)}
                look={look}
                shadows={display.shadows}
                onMeasureMove={
                  p.tool === "measure"
                    ? (e) => {
                        e.stopPropagation();
                        onMeasureMove(e);
                      }
                    : undefined
                }
                onMeasureClick={p.tool === "measure" ? onMeasureClick : undefined}
                onHover={(over) => {
                  // 편집 가능한 선택 도구에서 매스 위에 있으면 궤도 제어를 미리 끈다(같은 pointerdown에서 회전이 시작되지 않게).
                  overMass.current = over && p.tool === "select" && p.editable;
                  setOrbit();
                }}
                onDown={(e) => {
                  if (p.tool !== "select") return;
                  e.stopPropagation();
                  if (!p.editable) {
                    p.dispatch({ type: "select", id: m.id });
                    return;
                  }
                  const pt = groundPoint(e);
                  if (!pt) return;
                  dragStart.current = pt;
                  setOrbit(); // 드래그 중 궤도 회전 끔
                  p.dispatch({ type: "select", id: m.id });
                  p.dispatch({ type: "dragStart", id: m.id });
                }}
              />
            ) : null,
          )}
        </Bvh>
        {visible("envelope") && p.engine.envelope ? <EnvelopeObject mesh={p.engine.envelope.mesh} colors={colors} clipping={clipping} /> : null}
        {visible("excess")
          ? [...p.engine.excess].map(([id, mesh]) => (visible(`mass:${id}`) ? <ExcessObject key={id} mesh={mesh} colors={colors} /> : null))
          : null}
        {p.tool === "draw" && (p.draft.length > 0 || hover) ? <DraftLine geometry={draft} color={colors.draft} /> : null}
        {p.section ? (
          <lineSegments geometry={sectionLine} renderOrder={30} raycast={() => null}>
            <lineBasicMaterial color={colors.danger} depthTest={false} />
          </lineSegments>
        ) : null}
        {p.tool === "section" && p.sectionDraft && hover ? (
          <lineSegments geometry={sectionDraftLine} renderOrder={30} raycast={() => null}>
            <lineBasicMaterial color={colors.draft} depthTest={false} />
          </lineSegments>
        ) : null}
        {p.measures.length > 0 || (p.tool === "measure" && p.measureStart && measureHover) ? (
          <lineSegments geometry={measureLines} renderOrder={30} raycast={() => null}>
            <lineBasicMaterial color={colors.draft} depthTest={false} />
          </lineSegments>
        ) : null}
        {p.tool === "measure" && measureHover ? (
          <mesh position={[measureHover.point[0], measureHover.point[1], measureHover.point[2]]} renderOrder={31} raycast={() => null}>
            <octahedronGeometry args={[measureHover.kind === "grid" ? 80 : 160]} />
            <meshBasicMaterial color={measureHover.kind === "grid" ? colors.draft : colors.selection} depthTest={false} />
          </mesh>
        ) : null}
      </group>
    </>
  );
}

function DraftLine({ geometry, color }: { geometry: BufferGeometry; color: string }) {
  const line = useMemo(() => new Line(geometry, new LineBasicMaterial({ color })), [geometry, color]);
  useEffect(() => () => (line.material as LineBasicMaterial).dispose(), [line]);
  return <primitive object={line} />;
}

function MassObject({
  mass,
  mesh,
  offset,
  selected,
  highlighted,
  colors,
  clipping,
  slabs,
  look,
  shadows,
  onDown,
  onHover,
  onMeasureMove,
  onMeasureClick,
}: {
  mass: Mass;
  mesh: MeshData | null;
  offset: readonly [number, number] | null;
  selected: boolean;
  highlighted: boolean;
  colors: SceneColors;
  clipping: Plane[];
  /** 층별 판(분해도·층 숨김). null이면 매스 메시 1개. */
  slabs: FloorSlab[] | null;
  look: MaterialLook;
  shadows: boolean;
  onDown: (e: ThreeEvent<PointerEvent>) => void;
  onHover: (over: boolean) => void;
  onMeasureMove?: ((e: ThreeEvent<PointerEvent>) => void) | undefined;
  onMeasureClick?: ((e: ThreeEvent<MouseEvent>) => void) | undefined;
}) {
  // 워커 메시가 없으면(대기·워커 없음·실패) 같은 모양의 TS 폴백을 그린다. 층별 판으로 그릴 때는 둘 다 쓰지 않는다.
  const fallback = useMemo(() => (mesh || slabs ? null : prismMesh(mass)), [mesh, mass, slabs]);
  const geometry = useGeometry(slabs ? null : (mesh ?? fallback));
  const outline = useLineGeometry(useMemo(() => (slabs ? new Float32Array(0) : massOutline(mass)), [mass, slabs]));
  const edge = selected || highlighted ? colors.selection : colors.massEdge;
  const solid = {
    onPointerDown: onDown,
    onPointerOver: () => onHover(true),
    onPointerOut: () => onHover(false),
    onPointerMove: onMeasureMove,
    onClick: onMeasureClick,
    onUpdate: enableLayer(CAPTURE_MASS_LAYER),
    castShadow: shadows,
    receiveShadow: shadows,
  };
  const material = <MassMaterial colors={colors} look={look} selected={selected} clipping={clipping} />;
  if (!slabs && !geometry) return null;
  return (
    // 드래그 중에는 그룹 위치(mm)만 바꾼다.
    <group position={offset ? [offset[0], offset[1], 0] : [0, 0, 0]}>
      {slabs ? (
        slabs.map((sl) => <SlabObject key={sl.floorId} mass={mass} slab={sl} edge={edge} clipping={clipping} solid={solid} material={material} />)
      ) : (
        <>
          <mesh geometry={geometry ?? undefined} {...solid}>
            {material}
          </mesh>
          <lineSegments geometry={outline} onUpdate={enableLayer(CAPTURE_OUTLINE_LAYER)} raycast={() => null}>
            <lineBasicMaterial color={edge} clippingPlanes={clipping} />
          </lineSegments>
        </>
      )}
    </group>
  );
}

function MassMaterial({ colors, look, selected, clipping }: { colors: SceneColors; look: MaterialLook; selected: boolean; clipping: Plane[] }) {
  const clip = clipping.length > 0;
  const translucent = look.opacity < 1;
  // 단면으로 자르면 안쪽 면이 보이도록 양면(재질을 새로 만들어 셰이더를 다시 고른다). 반투명 재질은 깊이를 쓰지 않는다.
  return (
    <meshStandardMaterial
      key={`${clip ? "clip" : "solid"}-${translucent ? "t" : "o"}`}
      color={colors[look.color]}
      roughness={look.roughness}
      transparent={translucent}
      opacity={look.opacity}
      depthWrite={!translucent}
      flatShading
      emissive={selected ? colors.selection : "black"}
      emissiveIntensity={selected ? 0.18 : 0}
      clippingPlanes={clipping}
      side={clip || translucent ? DoubleSide : FrontSide}
    />
  );
}

/** 층 판 1장(분해도·층 숨김). 지오메트리는 이 층의 바닥·높이로 TS에서 만든다(표시 전용). */
function SlabObject({
  mass,
  slab,
  edge,
  clipping,
  solid,
  material,
}: {
  mass: Mass;
  slab: FloorSlab;
  edge: string;
  clipping: Plane[];
  solid: ThreeElements["mesh"];
  material: ReactElement;
}) {
  const geometry = useGeometry(useMemo(() => slabMesh(mass, slab.z0, slab.z1), [mass, slab.z0, slab.z1]));
  const outline = useLineGeometry(useMemo(() => slabOutline(mass, slab.z0, slab.z1), [mass, slab.z0, slab.z1]));
  if (!geometry) return null;
  return (
    <>
      <mesh geometry={geometry} {...solid}>
        {material}
      </mesh>
      <lineSegments geometry={outline} onUpdate={enableLayer(CAPTURE_OUTLINE_LAYER)} raycast={() => null}>
        <lineBasicMaterial color={edge} clippingPlanes={clipping} />
      </lineSegments>
    </>
  );
}

/**
 * 조명(프리셋 세기·방향, 흰빛 기본값). 주광은 장면 중심을 겨누고, 그림자를 켜면 장면을 덮는 정사영 그림자 카메라를 쓴다.
 * 그림자를 끄면 그림자 지도 패스가 없다(castShadow 끔).
 */
function Lights({ display, bounds, top }: { display: DisplaySettings; bounds: Bounds; top: number }) {
  const rig = LIGHT_RIGS[display.lighting];
  const target = useMemo(() => new Object3D(), []);
  const sun = useRef<DirectionalLight>(null);
  const center = modelToWorld((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0);
  // 장면 반경(m): 바닥 대각선 절반과 높이 중 큰 값 + 여유.
  const radius = Math.max(Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2, top, 10_000) / 1000 + 5;
  const at = (dir: readonly [number, number, number]): [number, number, number] => {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = radius * 2;
    return [center[0] + (dir[0] / len) * d, center[1] + (dir[1] / len) * d, center[2] + (dir[2] / len) * d];
  };
  useEffect(() => {
    target.position.set(...center);
    target.updateMatrixWorld();
  }, [target, center[0], center[2]]);
  // 그림자 카메라 범위가 바뀌면 투영을 다시 계산한다.
  useEffect(() => {
    sun.current?.shadow.camera.updateProjectionMatrix();
  }, [radius, display.shadows]);
  return (
    <>
      <ambientLight intensity={rig.ambient} />
      <primitive object={target} />
      <directionalLight
        ref={sun}
        position={at(rig.sun.dir)}
        intensity={rig.sun.intensity}
        target={target}
        castShadow={display.shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={0.5}
        shadow-camera-far={radius * 4}
      />
      <directionalLight position={at(rig.fill.dir)} intensity={rig.fill.intensity} target={target} />
    </>
  );
}

function EnvelopeObject({ mesh, colors, clipping }: { mesh: MeshData; colors: SceneColors; clipping: Plane[] }) {
  const g = useGeometry(mesh);
  if (!g) return null;
  // 반투명 단일 패스(FrontSide, [DECISION] 2절 L1). 레이캐스트에서 빼 매스 선택을 가리지 않는다.
  return (
    <mesh geometry={g} renderOrder={10} raycast={() => null}>
      <meshStandardMaterial color={colors.envelope} transparent opacity={colors.envelopeOpacity} depthWrite={false} side={FrontSide} flatShading clippingPlanes={clipping} />
    </mesh>
  );
}

function ExcessObject({ mesh, colors }: { mesh: MeshData; colors: SceneColors }) {
  const g = useGeometry(mesh);
  if (!g) return null;
  return (
    <mesh geometry={g} renderOrder={20} raycast={() => null}>
      <meshBasicMaterial color={colors.danger} transparent opacity={0.85} depthTest={false} />
    </mesh>
  );
}
