// IFC4 내보내기(AR-06-039): 매스 IntMesh → IFC4 STEP(ISO 10303-21) 텍스트. 자체 작성기 — web-ifc는 테스트 왕복 검증에만 쓴다.
// 순수 함수: 시간·난수 없음. FILE_NAME 시각·OwnerHistory 생성 시각은 입력값(없으면 0 = 1970-01-01T00:00:00).
// 구조: IfcProject ─(RelAggregates)→ IfcSite → IfcBuilding → IfcBuildingStorey ─(ContainedInSpatialStructure)→ 매스(IfcBuildingElementProxy).
// 매스 형상은 IfcTriangulatedFaceSet(정수 mm, 길이 단위 mm). GlobalId = hash(project_id + 요소 키) → IFC base64 22자.
import type { IntMesh } from "@arch-studio/geometry";

export interface IfcMass {
  /** 매스 식별 키(GlobalId 입력). 프로젝트 안에서 유일해야 한다. */
  key: string;
  name?: string;
  mesh: IntMesh;
}

export interface IfcExportInput {
  projectId: string;
  projectName?: string;
  /** FILE_NAME의 이름. 기본 "<projectId>.ifc". */
  fileName?: string;
  /** 유닉스 초(정수, 0 이상). FILE_NAME 시각과 IfcOwnerHistory.CreationDate. 기본 0. */
  timestamp?: number;
  author?: string;
  organization?: string;
  masses: readonly IfcMass[];
}

export const IFC_APPLICATION = { name: "Arch Studio", id: "ArchStudio", version: "1" } as const;

const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const FNV128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV128_PRIME = 0x0000000001000000000000000000013bn;
const MASK128 = (1n << 128n) - 1n;

/** FNV-1a 128비트(UTF-16 코드 단위를 작은 끝 2바이트로). 암호용이 아니라 안정 식별자용. */
function fnv1a128(text: string): bigint {
  let h = FNV128_OFFSET;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = ((h ^ BigInt(c & 0xff)) * FNV128_PRIME) & MASK128;
    h = ((h ^ BigInt(c >> 8)) * FNV128_PRIME) & MASK128;
  }
  return h;
}

/** 128비트 → IFC GlobalId 22자(첫 글자 2비트 + 6비트 × 21). */
export function ifcGuid(projectId: string, elementKey: string): string {
  const h = fnv1a128(`${projectId}\u0000${elementKey}`);
  let out = IFC64[Number(h >> 126n)] as string;
  for (let i = 20; i >= 0; i--) out += IFC64[Number((h >> BigInt(i * 6)) & 63n)];
  return out;
}

/** STEP 문자열 리터럴: ' → '', \ → \\, 비 ASCII → \X2\hhhh\X0\(BMP) · \X4\hhhhhhhh\X0\(BMP 밖). 짝 없는 서로게이트는 U+FFFD. */
function str(text: string): string {
  let out = "";
  let run = "";
  let runWidth = 0;
  const flush = () => {
    if (run) out += `\\X${runWidth}\\${run}\\X0\\`;
    run = "";
    runWidth = 0;
  };
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i) as number;
    if (cp > 0xffff) i++;
    else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp >= 0x20 && cp <= 0x7e) {
      flush();
      out += cp === 0x27 ? "''" : cp === 0x5c ? "\\\\" : String.fromCharCode(cp);
      continue;
    }
    const width = cp > 0xffff ? 4 : 2;
    if (width !== runWidth) flush();
    runWidth = width;
    run += cp.toString(16).toUpperCase().padStart(width * 2, "0");
  }
  flush();
  return `'${out}'`;
}

/** 정수 → STEP REAL("1000."). */
function real(n: number): string {
  return `${n + 0}.`;
}

/** 유닉스 초 → "YYYY-MM-DDThh:mm:ss"(UTC, 그레고리력). Date를 쓰지 않는다. */
function isoSeconds(sec: number): string {
  const days = Math.floor(sec / 86400);
  const rem = sec - days * 86400;
  // Howard Hinnant civil_from_days
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}T${p2(Math.floor(rem / 3600))}:${p2(Math.floor((rem % 3600) / 60))}:${p2(rem % 60)}`;
}

/** 꼭짓점 좌표는 정수 mm(안전 정수)여야 한다. */
function assertIntVertices(key: string, mesh: IntMesh): void {
  for (const v of mesh.vertices) {
    if (!Number.isSafeInteger(v[0]) || !Number.isSafeInteger(v[1]) || !Number.isSafeInteger(v[2])) {
      throw new RangeError(`매스 "${key}"의 꼭짓점이 정수 mm가 아닙니다: ${v.join(",")}`);
    }
  }
}

/** 매스 목록 → IFC4 STEP 텍스트(ASCII, 줄 끝 \n). */
export function exportIfc(input: IfcExportInput): string {
  const ts = input.timestamp ?? 0;
  if (!Number.isSafeInteger(ts) || ts < 0) throw new RangeError(`timestamp는 0 이상 정수(유닉스 초)여야 합니다: ${ts}`);
  if (input.masses.length === 0) throw new RangeError("내보낼 매스가 없습니다.");
  const keys = new Set<string>();
  for (const m of input.masses) {
    if (keys.has(m.key)) throw new RangeError(`매스 키가 겹칩니다: ${m.key}`);
    keys.add(m.key);
    if (m.mesh.triangles.length === 0) throw new RangeError(`매스 "${m.key}"에 삼각형이 없습니다.`);
    assertIntVertices(m.key, m.mesh);
  }

  const lines: string[] = [];
  const add = (entity: string): string => {
    lines.push(`#${lines.length + 1}=${entity};`);
    return `#${lines.length}`;
  };
  const guid = (key: string) => str(ifcGuid(input.projectId, key));
  const org = str(input.organization ?? "");

  const person = add(`IFCPERSON($,${str(input.author ?? "")},$,$,$,$,$,$)`);
  const organization = add(`IFCORGANIZATION($,${org},$,$,$)`);
  const devOrg = add(`IFCORGANIZATION($,${str(IFC_APPLICATION.name)},$,$,$)`);
  const pao = add(`IFCPERSONANDORGANIZATION(${person},${organization},$)`);
  const app = add(`IFCAPPLICATION(${devOrg},${str(IFC_APPLICATION.version)},${str(IFC_APPLICATION.name)},${str(IFC_APPLICATION.id)})`);
  const oh = add(`IFCOWNERHISTORY(${pao},${app},$,.NOCHANGE.,$,$,$,${ts})`);

  const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const zDir = add("IFCDIRECTION((0.,0.,1.))");
  const xDir = add("IFCDIRECTION((1.,0.,0.))");
  const axis = add(`IFCAXIS2PLACEMENT3D(${origin},${zDir},${xDir})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-03,${axis},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = [
    add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"),
    add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
    add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
    add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
  ];
  const ua = add(`IFCUNITASSIGNMENT((${units.join(",")}))`);
  const project = add(`IFCPROJECT(${guid("project")},${oh},${str(input.projectName ?? input.projectId)},$,$,$,$,(${ctx}),${ua})`);

  const sitePl = add(`IFCLOCALPLACEMENT($,${axis})`);
  const site = add(`IFCSITE(${guid("site")},${oh},'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingPl = add(`IFCLOCALPLACEMENT(${sitePl},${axis})`);
  const building = add(`IFCBUILDING(${guid("building")},${oh},'Building',$,$,${buildingPl},$,$,.ELEMENT.,$,$,$)`);
  const storeyPl = add(`IFCLOCALPLACEMENT(${buildingPl},${axis})`);
  const storey = add(`IFCBUILDINGSTOREY(${guid("storey")},${oh},'Storey',$,$,${storeyPl},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES(${guid("rel:project-site")},${oh},$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${guid("rel:site-building")},${oh},$,$,${site},(${building}))`);
  add(`IFCRELAGGREGATES(${guid("rel:building-storey")},${oh},$,$,${building},(${storey}))`);

  const elements: string[] = [];
  for (const mass of input.masses) {
    const { vertices, triangles } = mass.mesh;
    const pts = add(`IFCCARTESIANPOINTLIST3D((${vertices.map((v) => `(${real(v[0])},${real(v[1])},${real(v[2])})`).join(",")}))`);
    const tri = triangles.map((t) => `(${t[0] + 1},${t[1] + 1},${t[2] + 1})`).join(",");
    const faceSet = add(`IFCTRIANGULATEDFACESET(${pts},$,$,(${tri}),$)`);
    const shape = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${faceSet}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
    const pl = add(`IFCLOCALPLACEMENT(${storeyPl},${axis})`);
    elements.push(add(`IFCBUILDINGELEMENTPROXY(${guid(`mass:${mass.key}`)},${oh},${str(mass.name ?? mass.key)},$,$,${pl},${pds},$,$)`));
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid("rel:storey-contains")},${oh},$,$,(${elements.join(",")}),${storey})`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME(${str(input.fileName ?? `${input.projectId}.ifc`)},${str(isoSeconds(ts))},(${str(input.author ?? "")}),(${org}),${str(IFC_APPLICATION.name)},${str(IFC_APPLICATION.name)},'');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
  ];
  return `${[...header, ...lines, "ENDSEC;", "END-ISO-10303-21;"].join("\n")}\n`;
}
