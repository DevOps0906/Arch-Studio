// 테스트 공용 .3dm 픽스처 생성(원시 rhino3dm 모듈로 단위·사각형 면·메시 아닌 객체가 있는 파일을 만든다).
import type { RhinoModule } from "./module.ts";

/** 원시 모듈로 .3dm 픽스처를 만든다. unit = UnitSystem 이름, meshes = [꼭짓점, 면(3개면 삼각형·4개면 사각형)], extra = 메시 아닌 객체 추가. */
export function makeFile(
  r: RhinoModule,
  unit: string,
  meshes: { name?: string; vertices: number[][]; faces: number[][] }[],
  extra: (f: InstanceType<RhinoModule["File3dm"]>) => void = () => {},
): Uint8Array {
  const f = new r.File3dm();
  f.settings().modelUnitSystem = (r.UnitSystem as unknown as Record<string, typeof r.UnitSystem.Millimeters>)[unit] as typeof r.UnitSystem.Millimeters;
  for (const m of meshes) {
    const mesh = new r.Mesh();
    for (const [x, y, z] of m.vertices) mesh.vertices().add(x as number, y as number, z as number);
    for (const face of m.faces) {
      if (face.length === 4) mesh.faces().addQuadFace(face[0] as number, face[1] as number, face[2] as number, face[3] as number);
      else mesh.faces().addTriFace(face[0] as number, face[1] as number, face[2] as number);
    }
    const a = new r.ObjectAttributes();
    if (m.name) a.name = m.name;
    f.objects().addMesh(mesh, a);
  }
  extra(f);
  return new Uint8Array(f.toByteArray());
}

/** 단위 상자(사각형 면 6개, 바깥 반시계). */
export function quadBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  return {
    vertices: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  };
}
