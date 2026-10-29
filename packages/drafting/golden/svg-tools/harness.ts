// SVG 골든 하네스(AR-06-022). 입력은 DXF 골든 케이스(golden/_harness/cases.ts, golden/writer-*/input.json)를 읽기 전용으로 재사용한다.
// 배치: golden/svg-<케이스 이름에서 writer- 뺀 것>/{sheet-<kind>.svg, meta.json}. SVG는 LF(.gitattributes golden/** eol=lf), 원시 바이트 비교.
// manifest.json(이 폴더) = SVG_WRITER_VERSION + 골든 SVG sha256 목록(갱신 가드: 테스트·update.ts).
// layer_map 옵션은 SVG에 적용하지 않으므로(02_ARCHITECTURE.md 2.3절) 케이스 옵션은 읽지 않는다.
import type { GoldenCase } from "../_harness/cases.ts";
import type { SheetModel } from "../../src/index.ts";
import { SVG_WRITER_VERSION, writeSvg } from "../../src/writers/svg/index.ts";

export const GOLDEN = new URL("../", import.meta.url);
export const SVG_MANIFEST = new URL("manifest.json", import.meta.url);

export interface SvgGoldenMeta {
  case_id: string;
  /** 입력을 가져오는 DXF 골든 케이스(golden/<source_case>/input.json). */
  source_case: string;
  note: string;
  writer_version: string;
  engine_version: string;
  features: string[];
}

export interface SvgGoldenManifest {
  writer_version: string;
  /** "<svg-case>/<file>.svg" → sha256(16진). */
  sha256: Record<string, string>;
}

export const svgCaseId = (sourceCase: string) => `svg-${sourceCase.replace(/^writer-/, "")}`;
export const svgName = (sheet: SheetModel) => `sheet-${sheet.kind}.svg`;

/** 케이스 → 골든 파일 이름별 내용. */
export function svgGoldenFiles(c: GoldenCase): Record<string, string> {
  const { sheet } = c.build();
  const meta: SvgGoldenMeta = {
    case_id: svgCaseId(c.id),
    source_case: c.id,
    note: c.note,
    writer_version: SVG_WRITER_VERSION,
    engine_version: sheet.engine_version,
    features: ["AR-F-028", "AR-F-038"],
  };
  return { [svgName(sheet)]: writeSvg(sheet), "meta.json": JSON.stringify(meta, null, 2) + "\n" };
}
