import { BLOCKS, SAMPLES, buildSheets } from './model.ts';
import { writeDxf } from './dxf.ts';
import { sheetToSvg } from './svg.ts';

export function generate(id: string) {
  const s = SAMPLES.find((x) => x.id === id)!;
  const r = buildSheets(s);
  const dxf = writeDxf(BLOCKS, r.sheets.flatMap((sh) => sh.ents));
  return { ...r, dxf, svgs: r.sheets.map((sh) => sheetToSvg(sh)) };
}
