// 골든 하네스 공용(AR-06-021): 케이스 → 골든 파일 내용, 시각 행 가리기, 줄 끝 정규화.
// 배치: golden/<case-id>/{input.json, sheet-<kind>.dxf, meta.json}. input.json = SheetModel + DxfOptions(작성기만 검사).
// 골든 DXF는 .gitattributes `-text`(바이너리)로 CRLF 그대로 저장하고 원시 바이트로 비교한다. JSON은 eol=lf.
// manifest.json = DXF_WRITER_VERSION + 골든 DXF sha256 목록(갱신 가드, golden.test·update.ts).
import { canonicalJson, type SheetModel } from "../../src/index.ts";
import { DXF_WRITER_VERSION, writeDxf, type DxfOptions } from "../../src/writers/dxf/index.ts";
import type { GoldenCase } from "./cases.ts";

export const GOLDEN = new URL("../", import.meta.url);

export interface GoldenInput {
  sheet: SheetModel;
  options: DxfOptions;
}

export interface GoldenMeta {
  case_id: string;
  note: string;
  writer_version: string;
  engine_version: string;
  features: string[];
}

export const dxfName = (sheet: SheetModel) => `sheet-${sheet.kind}.dxf`;
export const toLf = (s: string) => s.replace(/\r\n/g, "\n");
export const MANIFEST = new URL("manifest.json", import.meta.url);

export interface GoldenManifest {
  writer_version: string;
  /** "<case-id>/<file>.dxf" → 원시 바이트 sha256(16진). */
  sha256: Record<string, string>;
}

/** $TDCREATE·$TDUPDATE 값 줄만 가린다(02_ARCHITECTURE.md 결정성 규칙 "시각"). */
export function maskTimestamps(dxf: string): string {
  return dxf.replace(/(\$TD(?:CREATE|UPDATE)\r?\n 40\r?\n)[^\r\n]*/g, "$1<masked>");
}

/** 케이스 → 골든 파일 이름별 내용(DXF는 작성기 출력 그대로 CRLF, JSON은 LF). */
export function goldenFiles(c: GoldenCase): Record<string, string> {
  const { sheet, options } = c.build();
  const input: GoldenInput = { sheet, options };
  const meta: GoldenMeta = {
    case_id: c.id,
    note: c.note,
    writer_version: DXF_WRITER_VERSION,
    engine_version: sheet.engine_version,
    features: ["AR-F-028", "AR-F-038"],
  };
  return {
    "input.json": canonicalJson(input) + "\n",
    [dxfName(sheet)]: writeDxf(sheet, options).text,
    "meta.json": JSON.stringify(meta, null, 2) + "\n",
  };
}
