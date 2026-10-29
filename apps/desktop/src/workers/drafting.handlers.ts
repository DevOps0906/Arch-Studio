// drafting.worker 핸들러: build_sheet(뷰 생성기 -> buildSheet -> SVG 미리보기), write(DXF·SVG). PDF·PNG 작성기는 워커에 넣지 않는다(2.4절).
import {
  buildAreaPlanView,
  buildSheet,
  buildSitePlanView,
  DraftingError,
  tryBuildFloorPlanView,
  sha256Hex,
  validateDraftingInput,
  type AreaPlanInput,
  type SheetModel,
  type ViewModel,
} from "@arch-studio/drafting";
import { writeDxf } from "@arch-studio/drafting/writers/dxf";
import { writeSvg } from "@arch-studio/drafting/writers/svg";
import { ENGINE_VERSION } from "@arch-studio/rules";
import { exportFileName } from "./fileName.ts";
import type { LaneRequest } from "./protocol.ts";
import { HandlerError, type Handler, type RuntimeOptions } from "./runtime.ts";

const sheetHandler: Handler = async (req: LaneRequest, ctx) => {
  if (req.op !== "build_sheet") throw new HandlerError("AR050", "잘못된 요청입니다");
  const v = validateDraftingInput(req.input);
  if (!v.ok) throw new HandlerError("AR050", v.issues.join("; "));
  await ctx.checkpoint();
  const input = v.input;
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
      // AR-06-027: 평면 개략도. AR051(겹침·외곽 이탈·문창 범위) 위반 모델은 시트를 만들지 않고 AR051로 답한다(생성기 거부를 그대로 전달).
      let built;
      try {
        built = tryBuildFloorPlanView(input);
      } catch (e) {
        if (e instanceof DraftingError) throw new HandlerError("AR050", "평면 시트에 필요한 층·실 배치가 없습니다");
        throw e;
      }
      if (!built.ok) throw new HandlerError("AR051", `실 배치 오류 ${built.issues.length}건(겹침·외곽 이탈·문창 범위)`);
      view = built.view;
      break;
    }
    default:
      // sunlight_section 은 엔벨로프 입력(솔리드 커널)이 필요하고, elevation 뷰 생성기는 아직 없다(후속).
      throw new HandlerError("AR050", "이 시트 종류는 아직 지원하지 않습니다");
  }
  await ctx.checkpoint();
  const built = buildSheet(input, view);
  await ctx.checkpoint();
  const svg_preview = writeSvg(built.sheet);
  return { result: { sheet: built.sheet, svg_preview, unapplied_overrides: built.unapplied_overrides }, engine_version: ENGINE_VERSION };
};

const exportHandler: Handler = async (req: LaneRequest, ctx) => {
  if (req.op !== "write") throw new HandlerError("AR050", "잘못된 요청입니다");
  if (req.format === "pdf" || req.format === "png") {
    // PDF·PNG 는 WebView 캔버스·DOM 이 필요할 수 있어 메인 스레드에서 시트 단위로 쓴다(2.4절).
    throw new HandlerError("AR056", "PDF·PNG 는 메인 스레드 작성기를 사용하세요");
  }
  const enc = new TextEncoder();
  const files: Array<{ name: string; bytes: ArrayBuffer; sha256: string }> = [];
  const transfer: ArrayBuffer[] = [];
  let i = 0;
  for (const sheet of req.sheets as SheetModel[]) {
    await ctx.checkpoint(); // export 레인은 취소 표시가 붙지 않으므로 양보만 한다
    let text: string;
    if (req.format === "dxf") {
      const r = writeDxf(sheet, { layer_map: req.layer_map });
      if (r.too_large) throw new HandlerError("AR052", "DXF 가 상한 크기를 넘습니다");
      text = r.text;
    } else {
      text = writeSvg(sheet);
    }
    const u8 = enc.encode(text);
    const bytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    files.push({ name: exportFileName(req.project_name, sheet.kind, i, sheet.scale, req.date, req.format), bytes, sha256: sha256Hex(text) });
    transfer.push(bytes);
    i++;
  }
  return { result: { files }, engine_version: ENGINE_VERSION, transfer };
};

const importHandler: Handler = () => {
  throw new HandlerError("AR050", "DXF 가져오기는 아직 구현되지 않았습니다");
};

export function createDraftingHandlers(): Pick<RuntimeOptions, "handlers"> {
  return { handlers: { build_sheet: sheetHandler, write: exportHandler, import_dxf: importHandler } };
}
