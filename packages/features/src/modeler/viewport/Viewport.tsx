// 3D 뷰포트(R3F, 지연 로드 청크). [DECISION] 구성: 매스마다 mesh 1개, 드래그 중에는 mesh 위치만 바꾼다(지오메트리 재생성·불린 없음),
// 매스 메시는 엔진 워커 결과(없으면 TS 폴백), 엔벨로프는 반투명 단일 패스(FrontSide), 초과분은 워커 불린 결과, 윤곽선은 DesignModel 데이터,
// 선택 레이캐스트는 drei Bvh(three-mesh-bvh). drei Text·DRACOLoader 등 blob 워커를 만드는 것은 쓰지 않는다(CSP worker-src 'self').
// 캔버스는 aria-hidden: 같은 정보를 레이어 패널·속성 인스펙터·판정 패널 글자로 준다(03장 6.1절). 좌표는 모두 mm 정수로 스냅해 명령에 넘긴다.
import type { Point } from "@arch-studio/domain";
import { Bvh } from "@react-three/drei/core/Bvh.js";
import { OrbitControls } from "@react-three/drei/core/OrbitControls.js";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentRef, type Dispatch, type Ref } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, GridHelper, Line, LineBasicMaterial, Plane, Spherical, Vector3, type Object3D } from "three";
import { snapMm, type Mass, type Model } from "../state/commands.ts";
import type { Action, CameraMode, LayerKey, Tool } from "../state/store.ts";
import type { EngineSnapshot } from "../engine/client.ts";
import { CAPTURE_MASS_LAYER, CAPTURE_OUTLINE_LAYER, captureDepthOutline, type CaptureOptions, type CaptureResult } from "./capture.ts";
import type { SceneColors } from "./colors.ts";
import { cameraPose, closesDraft, draftLine, massOutline, meshKey, sceneBounds, siteLoop, worldToModel, type MeshData } from "./geometry.ts";
import { prismMesh } from "./prism.ts";

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
  readonly engine: EngineSnapshot;
  readonly colors: SceneColors;
  readonly dispatch: Dispatch<Action>;
  readonly handleRef?: Ref<ViewportHandle>;
}

export default function Viewport(props: ViewportProps) {
  return (
    <Canvas
      aria-hidden="true"
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ fov: 40, near: 0.1, far: 5000, position: [30, 30, 30] }}
      className="touch-none"
    >
      <Scene {...props} />
    </Canvas>
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

/** 포인터 광선 → 지면 점(mm 정수, 격자 스냅). */
function groundPoint(e: ThreeEvent<PointerEvent | MouseEvent>, snap = SNAP_MM): Point | null {
  const hit = e.ray.intersectPlane(GROUND, new Vector3());
  if (!hit) return null;
  const [x, y] = worldToModel(hit.x, hit.z);
  return [snapMm(x, snap), snapMm(y, snap)];
}

function Scene(p: ViewportProps) {
  const { model, colors } = p;
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
  const top = useMemo(() => Math.max(...model.masses.map((m) => m.base_level_mm + m.floors.reduce((s, f) => s + f.height_mm, 0)), 3000), [model]);
  const pose = cameraPose(p.camera, bounds, top, model.site.north_angle_deg, size.height > 0 ? size.width / size.height : 1);

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

  const site = useLineGeometry(useMemo(() => siteLoop(model), [model]));
  const draft = useLineGeometry(useMemo(() => draftLine(p.draft, p.tool === "draw" ? hover : null), [p.draft, p.tool, hover]));
  const visible = (k: LayerKey) => !p.hidden.includes(k);
  const groundSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 10_000) * 20;

  const onGroundMove = (e: ThreeEvent<PointerEvent>) => {
    const pt = groundPoint(e);
    if (!pt) return;
    if (p.drag && dragStart.current) {
      p.dispatch({ type: "dragMove", dx: pt[0] - dragStart.current[0], dy: pt[1] - dragStart.current[1] });
    } else if (p.tool === "draw") {
      setHover((h) => (h && h[0] === pt[0] && h[1] === pt[1] ? h : pt));
    }
  };
  const onGroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // 궤도 회전 끌기
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
      <ambientLight intensity={1.6} />
      <directionalLight position={[40, 80, 30]} intensity={1.8} />
      <directionalLight position={[-30, 40, -50]} intensity={0.6} />
      <primitive object={grid} />
      <OrbitControls ref={controls} makeDefault enableRotate={pose.rotate} enableDamping={false} />
      <group rotation-x={-Math.PI / 2} scale={0.001}>
        {/* 지면(포인터 받기 전용, 보이지 않음) */}
        <mesh position={[(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0]} onPointerMove={onGroundMove} onClick={onGroundClick} onPointerUp={endDrag}>
          <planeGeometry args={[groundSpan, groundSpan]} />
          <meshBasicMaterial visible={false} side={DoubleSide} />
        </mesh>
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
        {visible("envelope") && p.engine.envelope ? <EnvelopeObject mesh={p.engine.envelope.mesh} colors={colors} /> : null}
        {visible("excess")
          ? [...p.engine.excess].map(([id, mesh]) => (visible(`mass:${id}`) ? <ExcessObject key={id} mesh={mesh} colors={colors} /> : null))
          : null}
        {p.tool === "draw" && (p.draft.length > 0 || hover) ? <DraftLine geometry={draft} color={colors.draft} /> : null}
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
  onDown,
  onHover,
}: {
  mass: Mass;
  mesh: MeshData | null;
  offset: readonly [number, number] | null;
  selected: boolean;
  highlighted: boolean;
  colors: SceneColors;
  onDown: (e: ThreeEvent<PointerEvent>) => void;
  onHover: (over: boolean) => void;
}) {
  // 워커 메시가 없으면(대기·워커 없음·실패) 같은 모양의 TS 폴백을 그린다.
  const fallback = useMemo(() => (mesh ? null : prismMesh(mass)), [mesh, mass]);
  const geometry = useGeometry(mesh ?? fallback);
  const outline = useLineGeometry(useMemo(() => massOutline(mass), [mass]));
  if (!geometry) return null;
  const edge = selected || highlighted ? colors.selection : colors.massEdge;
  return (
    // 드래그 중에는 그룹 위치(mm)만 바꾼다.
    <group position={offset ? [offset[0], offset[1], 0] : [0, 0, 0]}>
      <mesh geometry={geometry} onPointerDown={onDown} onPointerOver={() => onHover(true)} onPointerOut={() => onHover(false)} onUpdate={enableLayer(CAPTURE_MASS_LAYER)}>
        <meshStandardMaterial color={colors.mass} roughness={0.9} flatShading emissive={selected ? colors.selection : "black"} emissiveIntensity={selected ? 0.18 : 0} />
      </mesh>
      <lineSegments geometry={outline} onUpdate={enableLayer(CAPTURE_OUTLINE_LAYER)} raycast={() => null}>
        <lineBasicMaterial color={edge} />
      </lineSegments>
    </group>
  );
}

function EnvelopeObject({ mesh, colors }: { mesh: MeshData; colors: SceneColors }) {
  const g = useGeometry(mesh);
  if (!g) return null;
  // 반투명 단일 패스(FrontSide, [DECISION] 2절 L1). 레이캐스트에서 빼 매스 선택을 가리지 않는다.
  return (
    <mesh geometry={g} renderOrder={10} raycast={() => null}>
      <meshStandardMaterial color={colors.envelope} transparent opacity={colors.envelopeOpacity} depthWrite={false} side={FrontSide} flatShading />
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
