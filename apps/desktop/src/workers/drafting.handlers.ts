// drafting.worker 핸들러: build_sheet(뷰 생성기 -> buildSheet -> SVG 미리보기), write(DXF·SVG·PDF·PNG용 SVG).
// PDF(jsPDF)는 같은 순수 함수를 워커에서 부른다. PNG는 resvg(네이티브)를 워커에 넣지 않고, 래스터화기(shell-bridge Rasterizer,
// AR-06-080)에 넘길 SVG(`png_svg`: 골든 입력과 같은 buildPngSvg 결과)와 목표 폭(px)만 돌려준다.
// 한글 글꼴·폭 표는 앱 자산(packages/drafting/fonts)을 주입된 loadAssets로 읽는다(Node 파일 읽기 금지 — 순수 규칙).
import {
  buildAreaPlanView,
  buildSheet,
  buildSitePlanView,
  sha256Hex,
  tryBuildFloorPlanView,
  validateDraftingInput,
  type AreaPlanInput,
  type Prim,
  type SheetModel,
  type ViewModel,
} from "@arch-studio/drafting";
import { writeDxf } from "@arch-studio/drafting/writers/dxf";
import { BUNDLED_FONT_NAME, parseTtf, writePdf, type FontMetrics, type PdfFont } from "@arch-studio/drafting/writers/pdf";
import { writeSvg } from "@arch-studio/drafting/writers/svg";
import { ENGINE_VERSION } from "@arch-studio/rules";
import { exportFileName, sanitize } from "./fileName.ts";
import type { LaneRequest } from "./protocol.ts";
import { HandlerError, type Handler, type RuntimeOptions } from "./runtime.ts";

/** 앱 자산으로 배포한 번들 글꼴(Noto Sans KR 부분 집합)과 같은 글꼴의 폭 표. */
export interface DraftingAssets {
  readonly font: PdfFont;
  readonly metrics: FontMetrics;
}

export interface DraftingHandlerOptions {
  /** 글꼴·폭 표 읽기(워커: 앱 자산 fetch). 없으면 PDF·PNG는 AR056, SVG·DXF는 폭 표 없이 만든다. */
  readonly loadAssets?: () => Promise<DraftingAssets>;
}

/** 바이너리 sha256(소문자 16진수). 워커·Node 모두 WebCrypto가 있다. */
async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PNG 기본 해상도(writers/png PNG_DEFAULT_DPI와 같다). */
const PNG_DPI = 150;

/** 시트 안 문자열 중 글꼴에 없는 글자 → AR057 경고 한 건(writers/png absentGlyphs와 같은 규칙, 프림 직접 순회). */
export function absentGlyphWarning(sheet: SheetModel, ttf: Uint8Array): { code: "AR057"; detail: string } | null {
  const parsed = parseTtf(ttf);
  if (!parsed.ok) return null;
  const absent = new Set<string>();
  const seen = new Set<number>();
  const scan = (s: string) => {
    for (const ch of s) {
      const cp = ch.codePointAt(0) as number;
      if (cp <= 0x20 || seen.has(cp)) continue;
      seen.add(cp);
      if (parsed.font.glyph(cp) === 0) absent.add(ch);
    }
  };
  const prims = (list: readonly Prim<number>[]) => {
    for (const p of list) {
      if (p.t === "text" || p.t === "mtext") scan(p.s);
    }
  };
  for (const v of sheet.views) prims(v.prims);
  prims(sheet.paper_prims);
  for (const a of sheet.annotations) prims(a.prims);
  for (const b of sheet.blocks) prims(b.entities);
  if (absent.size === 0) return null;
  const list = [...absent].sort();
  return { code: "AR057", detail: `글꼴 ${parsed.font.family}에 없는 글자 ${list.length}종(예: ${list.slice(0, 10).join("")})` };
}

export function createDraftingHandlers(options: DraftingHandlerOptions = {}): Pick<RuntimeOptions, "handlers"> {
  let assets: Promise<DraftingAssets | null> | null = null;
  /** 자산은 워커마다 한 번만 읽는다. 실패하면 null(다음 요청에서 다시 시도하지 않는다 — 같은 워커에서 같은 결과). */
  const getAssets = (): Promise<DraftingAssets | null> => {
    if (!options.loadAssets) return Promise.resolve(null);
    assets ??= options.loadAssets().then(
      (a) => a,
      () => null,
    );
    return assets;
  };

  const sheetHandler: Handler = async (req: LaneRequest, ctx) => {
    if (req.op !== "build_sheet") throw new HandlerError("AR050", "잘못된 요청입니다");
    const v = validateDraftingInput(req.input);
    if (!v.ok) throw new HandlerError("AR050", v.issues.join("; "));
    await ctx.checkpoint();
    // 엔진 버전은 이 워커의 값이 정본이다(호출자가 넘긴 값은 쓰지 않는다 — 시트·SVG·input_hash에 거짓 버전이 남지 않게).
    const input = { ...v.input, engine_version: ENGINE_VERSION };
    let view: ViewModel;
    switch (input.sheet.kind) {
      case "site_plan":
        view = buildSitePlanView(input, (req.site_plan_extras ?? {}) as Parameters<typeof buildSitePlanView>[1]);
        break;
      case "area_plan": {
        const area = { ...input, ...(req.area_breakdown === undefined ? {} : { area_breakdown: req.area_breakdown }) } as AreaPlanInput;
        view = buildAreaPlanView(area);
        break;
      }
      case "floor_plan": {
        const r = tryBuildFloorPlanView(input);
        if (!r.ok) throw new HandlerError("AR051", "실이 겹치거나 층 외곽 밖에 있어 평면 개략도를 만들 수 없습니다");
        view = r.view;
        break;
      }
      default:
        // sunlight_section 은 엔벨로프 입력(솔리드 커널)이 필요하고, elevation 뷰 생성기는 아직 없다(후속).
        throw new HandlerError("AR050", "이 시트 종류는 아직 지원하지 않습니다");
    }
    await ctx.checkpoint();
    const built = buildSheet(input, view);
    await ctx.checkpoint();
    const a = await getAssets();
    const svg_preview = writeSvg(built.sheet, a ? { metrics: a.metrics } : {});
    return { result: { sheet: built.sheet, svg_preview, unapplied: built.unapplied }, engine_version: ENGINE_VERSION };
  };

  const exportHandler: Handler = async (req: LaneRequest, ctx) => {
    if (req.op !== "write") throw new HandlerError("AR050", "잘못된 요청입니다");
    const sheets = req.sheets as SheetModel[];
    const enc = new TextEncoder();
    const toBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    const files: Array<{ name: string; bytes: ArrayBuffer; sha256: string; width_px?: number }> = [];
    const warnings: Array<{ code: string; detail: string }> = [];
    const transfer: ArrayBuffer[] = [];
    const push = (f: { name: string; bytes: ArrayBuffer; sha256: string; width_px?: number }) => {
      files.push(f);
      transfer.push(f.bytes);
    };

    if (req.format === "pdf") {
      const a = await getAssets();
      if (!a) throw new HandlerError("AR056", "PDF 글꼴 자산을 읽지 못했습니다");
      if (sheets.length === 0) throw new HandlerError("AR050", "내보낼 시트가 없습니다");
      const groups = req.bundle ? [sheets] : sheets.map((s) => [s]);
      let i = 0;
      for (const g of groups) {
        await ctx.checkpoint();
        let r;
        try {
          r = writePdf(g, { font: a.font, metrics: a.metrics });
        } catch {
          throw new HandlerError("AR056", "PDF를 만들지 못했습니다");
        }
        for (const w of r.warnings) warnings.push(w);
        const g0 = g[0] as SheetModel;
        const name = req.bundle
          ? sanitize(`${sanitize(req.project_name)}_SET_${String(g.length).padStart(2, "0")}_${req.date.replace(/-/g, "")}.pdf`)
          : exportFileName(req.project_name, g0.kind, i, g0.scale, req.date, "pdf");
        push({ name, bytes: toBuffer(r.bytes), sha256: await sha256Bytes(r.bytes) });
        i++;
      }
      return { result: { files, warnings }, engine_version: ENGINE_VERSION, transfer };
    }

    if (req.format === "png") {
      // 래스터화는 메인 스레드 Rasterizer 몫. 여기서는 골든 입력과 같은 SVG와 목표 폭(150dpi)만 만든다.
      const a = await getAssets();
      if (!a) throw new HandlerError("AR056", "PNG 글꼴 자산을 읽지 못했습니다");
      let i = 0;
      for (const sheet of sheets) {
        await ctx.checkpoint();
        const svg = writeSvg(sheet, { font_family: `'${BUNDLED_FONT_NAME}', sans-serif`, metrics: a.metrics });
        const w = absentGlyphWarning(sheet, a.font.ttf);
        if (w && !warnings.some((x) => x.detail === w.detail)) warnings.push(w);
        const width_px = Math.round((sheet.paper.w / 100 / 25.4) * PNG_DPI);
        push({ name: exportFileName(req.project_name, sheet.kind, i, sheet.scale, req.date, "png"), bytes: toBuffer(enc.encode(svg)), sha256: sha256Hex(svg), width_px });
        i++;
      }
      return { result: { files, warnings }, engine_version: ENGINE_VERSION, transfer };
    }

    const a = await getAssets();
    let i = 0;
    for (const sheet of sheets) {
      await ctx.checkpoint(); // export 레인은 취소 표시가 붙지 않으므로 양보만 한다
      let text: string;
      if (req.format === "dxf") {
        const r = writeDxf(sheet, { layer_map: req.layer_map });
        if (r.too_large) throw new HandlerError("AR052", "DXF 가 상한 크기를 넘습니다");
        text = r.text;
      } else {
        text = writeSvg(sheet, a ? { metrics: a.metrics } : {});
      }
      push({ name: exportFileName(req.project_name, sheet.kind, i, sheet.scale, req.date, req.format), bytes: toBuffer(enc.encode(text)), sha256: sha256Hex(text) });
      i++;
    }
    return { result: { files, warnings }, engine_version: ENGINE_VERSION, transfer };
  };

  const importHandler: Handler = () => {
    throw new HandlerError("AR050", "DXF 가져오기는 아직 구현되지 않았습니다");
  };

  return { handlers: { build_sheet: sheetHandler, write: exportHandler, import_dxf: importHandler } };
}
