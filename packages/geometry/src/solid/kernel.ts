// Manifold WASM 솔리드 래퍼(AR-06-016, 02_ARCHITECTURE 지오메트리 행). 3D 불리언·압출·볼록 껍질 + 2D 차집합·교집합.
// - 경계 규칙: 입력·출력은 정수 mm 일반 데이터(Polygon·IntMesh)만. Manifold 객체는 밖으로 내보내지 않는다.
// - 초기화: WASM은 비동기(loadSolidKernel). 이후 연산은 받은 kernel로 동기 실행한다(모듈 전역 상태 없음).
// - 메모리: embind 객체는 수동 delete — 평가 한 번에 만든 객체를 모아 finally에서 지운다.
// - 반올림: 출력 좌표는 roundHalfAway(정수 mm). 2D 결과는 정수 배치(fillPositive)로 다시 정리해 유효 다각형을 보장하고,
//   3D 결과는 정규화(꼭짓점 사전순·중복 제거, 퇴화 삼각형 제거, 삼각형 정렬)해 같은 입력 → 같은 바이트.
//   단, 식의 자식 순서가 바뀌면 꼭짓점·부피는 같아도 Manifold 삼각분할이 다를 수 있다 — 호출자는 자식 순서를 결정적으로 만든다.
// - Manifold 메시 출력(vertProperties)은 Float32Array: 정수 좌표는 |v| ≤ 2^24(16,777,216mm)에서 정확하다(COORD_LIMIT 1e7 안).
import type { Point, Polygon } from "@arch-studio/domain";
import Module from "manifold-3d";
import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";
import { fillPositive, type Seg } from "../arrangement.ts";
import { assertResultRange } from "../boolean.ts";
import { GeometryError } from "../errors.ts";
import { roundHalfAway } from "../round.ts";
import { COORD_LIMIT, normalizePolygon } from "../validate.ts";
import { canonicalMesh, closeMesh, type IntMesh, type Point3 } from "./mesh.ts";

/** 2D 영역 식(정수 다각형 입력). subtract는 base − ⋃minus. */
export type RegionNode =
  | { op: "polygons"; polygons: readonly Polygon[] }
  | { op: "union" | "intersect"; children: readonly RegionNode[] }
  | { op: "subtract"; base: RegionNode; minus: readonly RegionNode[] };

/** 3D 솔리드 식. extrude는 z0 < z1(정수 mm), hull은 점들의 볼록 껍질. */
export type SolidNode =
  | { op: "extrude"; region: RegionNode; z0: number; z1: number }
  | { op: "hull"; points: readonly Point3[] }
  | { op: "union" | "intersect"; children: readonly SolidNode[] }
  | { op: "subtract"; base: SolidNode; minus: readonly SolidNode[] };

export interface SolidKernel {
  /** 2D 식 평가 → 정수 다각형(외곽 반시계·구멍 시계, 정렬됨, 빈 배열 허용). */
  region(node: RegionNode): Polygon[];
  /** 3D 식 평가 → 정수 mm 삼각형 메시(정규화됨, 빈 메시 허용). */
  solid(node: SolidNode): IntMesh;
}

export interface LoadSolidOptions {
  /** 브라우저·Tauri에서 manifold.wasm 위치(번들러가 정한 URL). Node는 생략. */
  locateFile?: () => string;
}

/** Manifold WASM을 초기화한다(비동기, 호출마다 새 인스턴스). 받은 kernel을 재사용한다. */
export async function loadSolidKernel(options: LoadSolidOptions = {}): Promise<SolidKernel> {
  const wasm = await Module(options.locateFile ? { locateFile: options.locateFile } : undefined);
  wasm.setup();
  return createKernel(wasm);
}

function assertInt(v: number, label: string): void {
  if (!Number.isSafeInteger(v)) throw new GeometryError("INVALID_COORDINATE", `${label}: mm 정수가 아닙니다 (${v})`);
  if (v > COORD_LIMIT || v < -COORD_LIMIT) throw new GeometryError("OUT_OF_RANGE", `${label}: ±${COORD_LIMIT}mm 를 넘습니다 (${v})`);
}

function createKernel(wasm: ManifoldToplevel): SolidKernel {
  const { CrossSection: CS, Manifold: M } = wasm;

  function evalRegion(node: RegionNode, owned: { delete(): void }[]): CrossSection {
    const keep = <T extends { delete(): void }>(x: T): T => {
      owned.push(x);
      return x;
    };
    switch (node.op) {
      case "polygons": {
        const parts: CrossSection[] = [];
        for (const p of node.polygons) {
          const n = normalizePolygon(p); // 정수·범위·단순 다각형 검사, 외곽 반시계·구멍 시계
          const contours = [n.outer, ...(n.holes ?? [])].map((r) => r.map(([x, y]) => [x, y] as [number, number]));
          parts.push(keep(new CS(contours, "Positive")));
        }
        return parts.length === 1 ? (parts[0] as CrossSection) : keep(CS.union(parts));
      }
      case "union":
      case "intersect": {
        const parts = node.children.map((c) => evalRegion(c, owned));
        if (parts.length === 0) {
          if (node.op === "intersect") throw new GeometryError("INVALID_ARGUMENT", "intersect 항이 없습니다");
          return keep(CS.union([]));
        }
        if (parts.length === 1) return parts[0] as CrossSection;
        return keep(node.op === "union" ? CS.union(parts) : CS.intersection(parts));
      }
      case "subtract": {
        const base = evalRegion(node.base, owned);
        if (node.minus.length === 0) return base;
        const minus = node.minus.map((c) => evalRegion(c, owned));
        return keep(CS.difference([base, ...minus]));
      }
    }
  }

  function evalSolid(node: SolidNode, owned: { delete(): void }[]): Manifold {
    const keep = <T extends { delete(): void }>(x: T): T => {
      owned.push(x);
      return x;
    };
    switch (node.op) {
      case "extrude": {
        assertInt(node.z0, "z0");
        assertInt(node.z1, "z1");
        if (node.z1 <= node.z0) throw new GeometryError("INVALID_ARGUMENT", `압출 높이가 0 이하입니다 (${node.z0}..${node.z1})`);
        const cs = evalRegion(node.region, owned);
        if (cs.isEmpty()) return keep(M.union([]));
        const m = keep(cs.extrude(node.z1 - node.z0));
        return node.z0 === 0 ? m : keep(m.translate([0, 0, node.z0]));
      }
      case "hull": {
        node.points.forEach(([x, y, z], i) => {
          assertInt(x, `hull ${i}.x`);
          assertInt(y, `hull ${i}.y`);
          assertInt(z, `hull ${i}.z`);
        });
        return keep(M.hull(node.points.map(([x, y, z]) => [x, y, z] as [number, number, number])));
      }
      case "union":
      case "intersect": {
        const parts = node.children.map((c) => evalSolid(c, owned));
        if (parts.length === 0) {
          if (node.op === "intersect") throw new GeometryError("INVALID_ARGUMENT", "intersect 항이 없습니다");
          return keep(M.union([]));
        }
        if (parts.length === 1) return parts[0] as Manifold;
        return keep(node.op === "union" ? M.union(parts) : M.intersection(parts));
      }
      case "subtract": {
        const base = evalSolid(node.base, owned);
        if (node.minus.length === 0) return base;
        const minus = node.minus.map((c) => evalSolid(c, owned));
        return keep(M.difference([base, ...minus]));
      }
    }
  }

  function run<T>(fn: (owned: { delete(): void }[]) => T): T {
    const owned: { delete(): void }[] = [];
    try {
      return fn(owned);
    } finally {
      for (const o of owned) o.delete();
    }
  }

  return {
    region(node) {
      return run((owned) => {
        const cs = evalRegion(node, owned);
        const segs: Seg[] = [];
        for (const contour of cs.toPolygons()) {
          const ring: Point[] = contour.map(([x, y]) => [roundHalfAway(x), roundHalfAway(y)]);
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i] as Point;
            const b = ring[(i + 1) % ring.length] as Point;
            if (a[0] !== b[0] || a[1] !== b[1]) segs.push({ a, b, w: 1 });
          }
        }
        // Manifold 출력은 외곽 반시계·구멍 시계(positive). 반올림으로 생긴 접촉·교차는 정수 배치가 정리한다.
        return assertResultRange(fillPositive(segs));
      });
    },
    solid(node) {
      return run((owned) => {
        const m = evalSolid(node, owned);
        const status = m.status();
        if (status !== "NoError") throw new GeometryError("NUMERIC_FAILURE", `Manifold 상태 오류: ${status}`);
        const mesh = m.getMesh();
        const n = mesh.numProp;
        const verts: Point3[] = [];
        for (let i = 0; i < mesh.vertProperties.length; i += n) {
          verts.push([
            roundHalfAway(mesh.vertProperties[i] as number),
            roundHalfAway(mesh.vertProperties[i + 1] as number),
            roundHalfAway(mesh.vertProperties[i + 2] as number),
          ]);
        }
        const tris: [number, number, number][] = [];
        for (let i = 0; i < mesh.triVerts.length; i += 3) {
          tris.push([mesh.triVerts[i] as number, mesh.triVerts[i + 1] as number, mesh.triVerts[i + 2] as number]);
        }
        return closeMesh(canonicalMesh(verts, tris)); // 퇴화 정리 + 닫힘 검사(SOLID_DEGENERATE)
      });
    },
  };
}
