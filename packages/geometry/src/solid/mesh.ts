// 정수 mm 삼각형 메시: 정규화(결정적 바이트)와 정확한 부피. 사칙연산·bigint만 쓴다.
import { SolidError } from "./errors.ts";

export type Point3 = readonly [number, number, number];

export interface IntMesh {
  /** 정수 mm 꼭짓점, 사전순(x, y, z) 정렬·중복 없음. */
  vertices: [number, number, number][];
  /** 바깥에서 볼 때 반시계(오른손 법칙 법선이 바깥). 각 삼각형은 가장 작은 번호부터, 목록은 사전순. */
  triangles: [number, number, number][];
}

function cmp3(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

/** 정수 꼭짓점·삼각형 → 정규 메시. 반올림으로 두 꼭짓점이 합쳐진 퇴화 삼각형은 뺀다. */
export function canonicalMesh(vertices: readonly Point3[], triangles: readonly (readonly [number, number, number])[]): IntMesh {
  const keyOf = (p: Point3) => `${p[0]},${p[1]},${p[2]}`;
  const unique = new Map<string, Point3>();
  for (const v of vertices) unique.set(keyOf(v), v);
  const sorted = [...unique.values()].sort(cmp3);
  const index = new Map<string, number>();
  sorted.forEach((v, i) => index.set(keyOf(v), i));
  const remap = vertices.map((v) => index.get(keyOf(v)) as number);
  const tris: [number, number, number][] = [];
  for (const [a, b, c] of triangles) {
    const t = [remap[a] as number, remap[b] as number, remap[c] as number] as const;
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
    const m = t[0] < t[1] ? (t[0] < t[2] ? 0 : 2) : t[1] < t[2] ? 1 : 2;
    tris.push([t[m] as number, t[(m + 1) % 3] as number, t[(m + 2) % 3] as number]);
  }
  tris.sort(cmp3);
  // 쓰이지 않는 꼭짓점(퇴화 삼각형만 쓰던 점)은 남겨도 결정적이지만 정리한다.
  const used = new Set<number>();
  for (const t of tris) for (const i of t) used.add(i);
  if (used.size === sorted.length) return { vertices: sorted.map((v) => [v[0], v[1], v[2]]), triangles: tris };
  const keep: number[] = [];
  const next = new Map<number, number>();
  sorted.forEach((_, i) => {
    if (used.has(i)) {
      next.set(i, keep.length);
      keep.push(i);
    }
  });
  return {
    vertices: keep.map((i) => {
      const v = sorted[i] as Point3;
      return [v[0], v[1], v[2]];
    }),
    triangles: tris.map((t) => [next.get(t[0]) as number, next.get(t[1]) as number, next.get(t[2]) as number]),
  };
}

/** 메시 부피 ×6(정확한 정수, 닫힌 메시 가정). */
export function meshVolume6(mesh: IntMesh): bigint {
  let s = 0n;
  for (const [i, j, k] of mesh.triangles) {
    const [ax, ay, az] = (mesh.vertices[i] as Point3).map(BigInt) as [bigint, bigint, bigint];
    const [bx, by, bz] = (mesh.vertices[j] as Point3).map(BigInt) as [bigint, bigint, bigint];
    const [cx, cy, cz] = (mesh.vertices[k] as Point3).map(BigInt) as [bigint, bigint, bigint];
    s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return s;
}

/** 메시 부피(mm³, half-away 반올림). safe int를 넘을 수 있어 bigint(1km×1km×30m ≈ 3e16). */
export function meshVolume(mesh: IntMesh): bigint {
  const v6 = meshVolume6(mesh);
  const q = v6 / 6n;
  const rem = v6 - q * 6n;
  const twice = rem < 0n ? -2n * rem : 2n * rem;
  return twice >= 6n ? q + (v6 < 0n ? -1n : 1n) : q;
}

/** 부피를 JSON용 10진 문자열로. */
export function volumeToString(volume: bigint): string {
  return volume.toString();
}

const MAX_REPAIR_ROUNDS = 64;

function collinear(p: Point3, q: Point3, r: Point3): boolean {
  // |좌표| ≤ 2^24 → 차 ≤ 2^25, 곱 ≤ 2^50: number 정확
  const ux = q[0] - p[0];
  const uy = q[1] - p[1];
  const uz = q[2] - p[2];
  const vx = r[0] - p[0];
  const vy = r[1] - p[1];
  const vz = r[2] - p[2];
  return uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0;
}

/**
 * 닫힘 검사: 모든 변에서 방향 변 (a,b) 개수 = 반대 변 (b,a) 개수(같은 방향 중복은 짝이 맞을 때만 허용).
 * 보통은 변마다 정확히 두 면이다. 네 면 이상은 Manifold가 서로 다른 꼭짓점으로 둔 "모서리로 맞닿은 두 솔리드"
 * (예: 꼭짓점이 맞닿은 지면 영역의 압출)가 같은 정수 좌표로 합쳐진 경우뿐이라 기하는 닫혀 있다. 통과하면 null, 아니면 사유.
 */
export function closedMeshIssue(mesh: IntMesh): string | null {
  const count = new Map<string, number>();
  for (const [a, b, c] of mesh.triangles) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = `${p},${q}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of count) {
    const [p, q] = k.split(",");
    const back = count.get(`${q},${p}`) ?? 0;
    if (back !== n) return `방향 변 ${k} ${n}개, 반대 변 ${back}개`;
  }
  return null;
}

/**
 * 정수화 뒤 퇴화 정리: 면적 0 삼각형 제거(일직선이면 맞은편 삼각형을 가운데 꼭짓점에서 나눠 T자 접합을 메운다),
 * 방향이 반대인 중복 면 쌍 제거, 그다음 닫힘 재검사(closedMeshIssue). 닫히지 않으면 SolidError(SOLID_DEGENERATE). 빈 메시는 그대로.
 */
export function closeMesh(mesh: IntMesh): IntMesh {
  if (mesh.triangles.length === 0) return mesh;
  const V = mesh.vertices as Point3[];
  let tris = mesh.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]);
  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    let changed = false;
    // 1) 면적 0 삼각형 → 제거 + 긴 변 맞은편 삼각형 분할
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i] as [number, number, number];
      if (!collinear(V[t[0]] as Point3, V[t[1]] as Point3, V[t[2]] as Point3)) continue;
      // 가운데 꼭짓점 m: 나머지 두 점 사이(내적 판정)
      let m = -1;
      for (let j = 0; j < 3; j++) {
        const pm = V[t[j] as number] as Point3;
        const pp = V[t[(j + 1) % 3] as number] as Point3;
        const pq = V[t[(j + 2) % 3] as number] as Point3;
        const dot = (pp[0] - pm[0]) * (pq[0] - pm[0]) + (pp[1] - pm[1]) * (pq[1] - pm[1]) + (pp[2] - pm[2]) * (pq[2] - pm[2]);
        if (dot < 0) m = j;
      }
      tris.splice(i, 1);
      i--;
      changed = true;
      if (m < 0) continue; // 세 점이 겹치는 경우는 canonicalMesh가 이미 뺐다
      const vm = t[m] as number;
      const p = t[(m + 1) % 3] as number; // 이 삼각형의 긴 변은 q→p 방향(… → m → p → q → m)
      const q = t[(m + 2) % 3] as number;
      // 퇴화 삼각형의 변 (p,q)를 반대 방향 (q,p)로 가진 삼각형을 m에서 나눈다
      const k = tris.findIndex((s) => (s[0] === q && s[1] === p) || (s[1] === q && s[2] === p) || (s[2] === q && s[0] === p));
      if (k < 0) continue;
      const s = tris[k] as [number, number, number];
      const r = s[0] === q && s[1] === p ? 0 : s[1] === q && s[2] === p ? 1 : 2;
      const x = s[(r + 2) % 3] as number;
      tris.splice(k, 1, [q, vm, x], [vm, p, x]);
      if (k <= i) i++;
    }
    // 2) 방향이 반대인 중복 면 쌍 제거
    const byKey = new Map<string, number[]>();
    tris.forEach((t, i) => {
      const k = [...t].sort((a, b) => a - b).join(",");
      byKey.set(k, [...(byKey.get(k) ?? []), i]);
    });
    const drop = new Set<number>();
    for (const idx of byKey.values()) {
      if (idx.length === 2) {
        const [a, b] = idx as [number, number];
        const ta = tris[a] as [number, number, number];
        const tb = tris[b] as [number, number, number];
        const same = [0, 1, 2].some((o) => ta[0] === tb[o] && ta[1] === tb[(o + 1) % 3]);
        if (!same) {
          drop.add(a);
          drop.add(b);
        }
      }
    }
    if (drop.size > 0) {
      tris = tris.filter((_, i) => !drop.has(i));
      changed = true;
    }
    if (!changed) break;
  }
  const out = canonicalMesh(V, tris);
  const issue = closedMeshIssue(out);
  if (issue) throw new SolidError("SOLID_DEGENERATE", `정수화 뒤 솔리드가 닫히지 않습니다: ${issue}`);
  return out;
}
