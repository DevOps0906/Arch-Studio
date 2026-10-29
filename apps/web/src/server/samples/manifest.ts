// public/samples/manifest.json 읽기(scripts/samples/build.ts 가 만든 파일). 읽기 실패·형식 불일치는 호출자가 "오류" 상태로 보인다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SAMPLE_IDS } from "./catalog.ts";

const manifestSchema = z.object({
  schema_version: z.literal(1),
  notice: z.string(),
  engine_version: z.string(),
  dxf_writer_version: z.string(),
  samples: z.array(
    z.object({
      id: z.enum(SAMPLE_IDS),
      file: z.string(),
      title: z.string(),
      site: z.string(),
      sheet_kind: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      input_hash: z.string(),
    }),
  ),
});
export type SamplesManifest = z.infer<typeof manifestSchema>;

export function parseManifest(text: string): SamplesManifest {
  return manifestSchema.parse(JSON.parse(text));
}

export const SAMPLES_DIR = (): string => path.join(process.cwd(), "public", "samples");

export async function loadManifest(dir: string = SAMPLES_DIR()): Promise<SamplesManifest> {
  return parseManifest(await readFile(path.join(dir, "manifest.json"), "utf8"));
}
