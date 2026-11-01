// .3dm 내보내기(AR-06-039): 매스 IntMesh → Rhino 메시 객체(단위 mm, 정수 좌표 그대로).
// 결정적 식별자는 사용자 문자열에 넣는다: arch_studio.id = hash(project_id + 키) UUID(ifcGuid와 같은 FNV-1a 128), arch_studio.key = 매스 키.
// (rhino3dm은 ObjectAttributes.id가 읽기 전용이라 객체 id를 지정할 수 없다 — [DECISION] tasks/logs/AR-06-039.md)
import type { IntMesh } from "@arch-studio/geometry";
import { ifcGuid } from "../ifc/index.ts";
import { embindDeleter, type RhinoModule } from "./module.ts";

export interface Rhino3dmMass {
  /** 매스 식별 키(arch_studio.id 입력). 프로젝트 안에서 유일해야 한다. */
  key: string;
  name?: string;
  mesh: IntMesh;
}

export interface Rhino3dmExportInput {
  projectId: string;
  masses: readonly Rhino3dmMass[];
}

export const RHINO_USER_KEY = "arch_studio.key";
export const RHINO_USER_ID = "arch_studio.id";
const APPLICATION_NAME = "Arch Studio";

const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** hash(project_id + 요소 키) → UUID 문자열(8-4-4-4-12, 소문자). ifcGuid 22자를 128비트로 되돌려 같은 해시를 쓴다. */
export function rhinoObjectId(projectId: string, elementKey: string): string {
  const g = ifcGuid(projectId, elementKey);
  let h = 0n;
  for (const ch of g) h = (h << 6n) | BigInt(IFC64.indexOf(ch));
  const hex = h.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validate(input: Rhino3dmExportInput): void {
  if (input.masses.length === 0) throw new RangeError("내보낼 매스가 없습니다.");
  const keys = new Set<string>();
  for (const m of input.masses) {
    if (keys.has(m.key)) throw new RangeError(`매스 키가 겹칩니다: ${m.key}`);
    keys.add(m.key);
    if (m.mesh.triangles.length === 0) throw new RangeError(`매스 "${m.key}"에 삼각형이 없습니다.`);
    for (const v of m.mesh.vertices) {
      if (!Number.isSafeInteger(v[0]) || !Number.isSafeInteger(v[1]) || !Number.isSafeInteger(v[2])) {
        throw new RangeError(`매스 "${m.key}"의 꼭짓점이 정수 mm가 아닙니다: ${v.join(",")}`);
      }
    }
  }
}

/** 매스 목록 → .3dm 바이트(Rhino 8 형식, 모델 단위 mm). embind 객체는 finally에서 모두 지운다. */
export function export3dmWith(rhino: RhinoModule, input: Rhino3dmExportInput): Uint8Array {
  validate(input);
  const del = embindDeleter(rhino);
  const owned: object[] = [];
  const keep = <T extends object>(x: T): T => {
    owned.push(x);
    return x;
  };
  try {
    const file = keep(new rhino.File3dm());
    const settings = keep(file.settings());
    settings.modelUnitSystem = rhino.UnitSystem.Millimeters;
    file.applicationName = APPLICATION_NAME;
    const objects = keep(file.objects());
    for (const m of input.masses) {
      const mesh = keep(new rhino.Mesh());
      const verts = keep(mesh.vertices());
      for (const [x, y, z] of m.mesh.vertices) verts.add(x, y, z);
      const faces = keep(mesh.faces());
      for (const [a, b, c] of m.mesh.triangles) faces.addTriFace(a, b, c);
      const attrs = keep(new rhino.ObjectAttributes());
      attrs.name = m.name ?? m.key;
      attrs.setUserString(RHINO_USER_KEY, m.key);
      attrs.setUserString(RHINO_USER_ID, rhinoObjectId(input.projectId, m.key));
      objects.addMesh(mesh, attrs);
    }
    return new Uint8Array(file.toByteArray());
  } finally {
    for (let i = owned.length - 1; i >= 0; i--) {
      try {
        del(owned[i] as object);
      } catch {
        // 트랩 뒤에는 delete도 실패할 수 있다 — 원래 예외를 보존한다.
      }
    }
  }
}
