// 솔리드(Manifold WASM) 래퍼 공개 면. 정수 mm 일반 데이터만 오간다.
export { loadSolidKernel, type LoadSolidOptions, type RegionNode, type SolidKernel, type SolidNode } from "./kernel.ts";
export { canonicalMesh, closeMesh, closedMeshIssue, meshVolume, meshVolume6, volumeToString, type IntMesh, type Point3 } from "./mesh.ts";
export { SolidError, type SolidErrorCode } from "./errors.ts";
