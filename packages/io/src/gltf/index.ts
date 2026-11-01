// glTF 2.0 내보내기(AR-06-039): 매스 IntMesh → 단일 .gltf JSON 텍스트(버퍼는 data URI). 순수 함수 — 시간·난수 없음, 같은 입력 → 같은 바이트.
// 좌표: 정수 mm(Z-up) → m(Y-up). (x, y, z) → (x, z, -y)는 회전(행렬식 +1)이라 삼각형 감김 방향이 유지된다.
// 면별 정점 분리: 삼각형마다 꼭짓점 3개를 따로 두고 면 법선을 붙인다(평면 음영). 인덱스 버퍼는 쓰지 않는다.
import type { IntMesh } from "@arch-studio/geometry";

export interface GltfMass {
  /** 매스 식별 키(노드 이름 기본값). */
  key: string;
  name?: string;
  mesh: IntMesh;
}

export interface GltfExportInput {
  masses: readonly GltfMass[];
}

/** 고정 generator(버전·시각을 넣지 않는다 — 결정성). */
export const GLTF_GENERATOR = "Arch Studio io glTF writer 1";

const ARRAY_BUFFER = 34962;
const FLOAT = 5126;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 표준 base64(RFC 4648, 패딩 포함). */
function base64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + "==";
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + "=";
  }
  return out;
}

type Vec3 = [number, number, number];

/** Z-up 정수 mm → Y-up m(float32로 반올림). */
function toYUpMeters(p: readonly number[]): Vec3 {
  const [x, y, z] = p as [number, number, number];
  return [Math.fround(x / 1000), Math.fround(z / 1000), Math.fround(-y / 1000)];
}

/** 면 법선(Y-up, 단위 길이, float32). 넓이 0인 삼각형은 위쪽(+Y). */
function faceNormal(a: readonly number[], b: readonly number[], c: readonly number[]): Vec3 {
  const ux = (b[0] as number) - (a[0] as number);
  const uy = (b[1] as number) - (a[1] as number);
  const uz = (b[2] as number) - (a[2] as number);
  const vx = (c[0] as number) - (a[0] as number);
  const vy = (c[1] as number) - (a[1] as number);
  const vz = (c[2] as number) - (a[2] as number);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return [0, 1, 0];
  return [Math.fround(nx / len), Math.fround(nz / len), Math.fround(-ny / len)];
}

/** 매스 목록 → glTF 2.0 JSON 텍스트. 매스마다 노드·메시 하나, 버퍼는 하나(data URI). */
export function exportGltf(input: GltfExportInput): string {
  if (input.masses.length === 0) throw new RangeError("내보낼 매스가 없습니다.");
  const totalTris = input.masses.reduce((s, m) => s + m.mesh.triangles.length, 0);
  // 매스마다 [위치 float32 xyz × 3꼭짓점][법선 float32 xyz × 3꼭짓점] 블록.
  const bytes = new Uint8Array(totalTris * 3 * 2 * 12);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [];

  input.masses.forEach((mass, mi) => {
    const { vertices, triangles } = mass.mesh;
    if (triangles.length === 0) throw new RangeError(`매스 "${mass.key}"에 삼각형이 없습니다.`);
    for (const v of vertices) {
      if (!Number.isSafeInteger(v[0]) || !Number.isSafeInteger(v[1]) || !Number.isSafeInteger(v[2])) {
        throw new RangeError(`매스 "${mass.key}"의 꼭짓점이 정수 mm가 아닙니다: ${v.join(",")}`);
      }
    }
    const count = triangles.length * 3;
    const posStart = offset;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const normals: Vec3[] = [];
    for (const [i, j, k] of triangles) {
      const a = vertices[i] as Vec3;
      const b = vertices[j] as Vec3;
      const c = vertices[k] as Vec3;
      const n = faceNormal(a, b, c);
      for (const p of [a, b, c]) {
        const q = toYUpMeters(p);
        for (let d = 0; d < 3; d++) {
          view.setFloat32(offset, q[d] as number, true);
          offset += 4;
          if ((q[d] as number) < (min[d] as number)) min[d] = q[d] as number;
          if ((q[d] as number) > (max[d] as number)) max[d] = q[d] as number;
        }
        normals.push(n);
      }
    }
    const normStart = offset;
    for (const n of normals) {
      for (let d = 0; d < 3; d++) {
        view.setFloat32(offset, n[d] as number, true);
        offset += 4;
      }
    }
    const len = count * 12;
    bufferViews.push(
      { buffer: 0, byteOffset: posStart, byteLength: len, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: normStart, byteLength: len, target: ARRAY_BUFFER },
    );
    // -0은 JSON에서 0으로 쓴다(min/max 문자열 결정성).
    const clean = (v: Vec3) => v.map((x) => x + 0);
    accessors.push(
      { bufferView: mi * 2, componentType: FLOAT, count, type: "VEC3", min: clean(min), max: clean(max) },
      { bufferView: mi * 2 + 1, componentType: FLOAT, count, type: "VEC3" },
    );
    meshes.push({ name: mass.name ?? mass.key, primitives: [{ attributes: { POSITION: mi * 2, NORMAL: mi * 2 + 1 }, mode: 4 }] });
    nodes.push({ name: mass.name ?? mass.key, mesh: mi });
  });

  const gltf = {
    asset: { version: "2.0", generator: GLTF_GENERATOR },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${base64(bytes)}` }],
  };
  return JSON.stringify(gltf);
}
