// SVG 작성기(AR-F-038 "SVG(화면 미리보기와 같은 결과)", 02_ARCHITECTURE.md 2.3절). 결정적 순수 함수: 같은 입력 → 같은 바이트.
// 화면 미리보기와 내보내기는 이 함수 하나를 쓴다(따로 그리는 경로 없음). 표준 레이어마다 <g id="레이어명">(16개 전부, 빈 그룹 포함),
// layer_map은 적용하지 않는다(DXF 전용, 2.3절 "레이어"). 단위: viewBox 1 = 모델 mm(scene.ts 좌표 규약), width·height는 용지 mm.
// 한글 글꼴은 font-family 이름만 참조하고 글꼴 파일은 넣지 않는다. 줄 끝 \n, XML 선언 없음(HTML 인라인 삽입과 파일이 같은 바이트).
import { assertDisclaimer } from "../../titleblock/index.ts";
import { DraftingError } from "../../sheet/errors.ts";
import type { SheetModel } from "../../sheet/types.ts";
import type { FontMetrics } from "../pdf/metrics.ts";
import { cleanLine, fmt, xmlEscape } from "./format.ts";
import { buildScene, MTEXT_LINE_PITCH, type Pt, type SceneItem } from "./scene.ts";
import { HATCH_LINE_WIDTH, layerStyle, rgbHex, SOLID_OPACITY, TEXT_EM_PER_HEIGHT } from "./style.ts";

/** 출력 형식 버전. SVG 골든(golden/svg-*)은 이 값을 올릴 때만 갱신한다(골든 테스트가 강제). */
export const SVG_WRITER_VERSION = "svg-1.0.0";

/**
 * 기본 font-family(이름만). 제품 번들 글꼴은 사람 확인 대기(fonts/README.md)라 OFL 후보 이름 + 일반 sans-serif.
 * 화면은 앱에 넣은 글꼴을 이 이름으로 등록해 쓴다.
 */
export const DEFAULT_SVG_FONT_FAMILY = "NanumGothic, 'Noto Sans KR', sans-serif";

/** 용지 바탕(흰색). 출력 상수이고 UI 토큰이 아니다. */
const PAPER_FILL = "#ffffff";

export interface SvgOptions {
  /** SVG font-family 값(CSS 목록). 글꼴 파일은 넣지 않는다. */
  font_family?: string;
  /** MTEXT 줄바꿈 폭 계산용 글꼴 폭 표(fonts/*.metrics.json). 없으면 근사 폭(scene.ts). PDF와 같은 값을 넘겨야 줄바꿈이 같다. */
  metrics?: FontMetrics;
}

export function writeSvg(sheet: SheetModel, options: SvgOptions = {}): string {
  // 고지 확인은 출력 직전 필수(지우는 경로 0, AR-F-028).
  assertDisclaimer(sheet.paper_prims);
  const family = options.font_family ?? DEFAULT_SVG_FONT_FAMILY;
  if (typeof family !== "string" || family.trim() === "" || /[\u0000-\u001f\u007f<>&"]/.test(family)) {
    throw new DraftingError("INVALID_ARGUMENT", `font_family가 비었거나 쓸 수 없는 문자가 있습니다: ${JSON.stringify(family)}`);
  }
  const scene = buildScene(sheet, options.metrics === undefined ? {} : { metrics: options.metrics });
  const H = scene.h;
  const X = (p: Pt) => fmt(p[0]);
  const Y = (p: Pt) => fmt(H - p[1]);
  const xy = (p: Pt) => `${X(p)},${Y(p)}`;
  const s = scene.scale;
  const tb = sheet.title_block;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${fmt(sheet.paper.w / 100)}mm" height="${fmt(sheet.paper.h / 100)}mm"` +
      ` viewBox="0 0 ${fmt(scene.w)} ${fmt(scene.h)}" font-family="${xmlEscape(family)}"` +
      ` data-sheet-id="${attr(sheet.sheet_id)}" data-kind="${attr(sheet.kind)}" data-scale="${s}"` +
      ` data-engine-version="${attr(sheet.engine_version)}" data-input-hash="${attr(sheet.input_hash)}" data-writer-version="${SVG_WRITER_VERSION}">`,
  );
  out.push(`<title>${attr(tb.sheet_title)} — ${attr(tb.project_name)}</title>`);
  out.push(`<rect x="0" y="0" width="${fmt(scene.w)}" height="${fmt(scene.h)}" fill="${PAPER_FILL}"/>`);

  for (const { layer, items } of scene.layers) {
    const st = layerStyle(layer);
    const color = rgbHex(st.rgb);
    const dash = st.dash.length > 0 ? ` stroke-dasharray="${st.dash.map((v) => fmt(v * s)).join(" ")}"` : "";
    const head = `<g id="${layer}" fill="none" stroke="${color}" stroke-width="${fmt(st.width * s)}"${dash}`;
    if (items.length === 0) {
      out.push(`${head}/>`);
      continue;
    }
    out.push(`${head}>`);
    for (const it of items) {
      const e = item(it, color);
      if (e !== null) out.push(e);
    }
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n") + "\n";

  function item(it: SceneItem, color: string): string | null {
    switch (it.t) {
      case "line":
        return `<line x1="${X(it.a)}" y1="${Y(it.a)}" x2="${X(it.b)}" y2="${Y(it.b)}"/>`;
      case "pline":
        return `<${it.closed ? "polygon" : "polyline"} points="${it.pts.map(xy).join(" ")}"/>`;
      case "circle":
        return `<circle cx="${X(it.c)}" cy="${Y(it.c)}" r="${fmt(it.r)}"/>`;
      case "arc":
        return `<path d="${arcPath(it.c, it.r, it.a0, it.a1)}"/>`;
      case "text": {
        const anchor = it.align === "c" ? ` text-anchor="middle"` : it.align === "r" ? ` text-anchor="end"` : "";
        return `<text x="${X(it.at)}" y="${Y(it.at)}" font-size="${fmt(it.size * TEXT_EM_PER_HEIGHT)}" fill="${color}" stroke="none"${anchor}${rotate(it.rot, it.at)}>${xmlEscape(it.s)}</text>`;
      }
      case "mtext": {
        const x = X(it.at);
        const spans = it.lines
          .map((l, i) => `<tspan x="${x}" y="${fmt(H - (it.at[1] - it.size - i * it.size * MTEXT_LINE_PITCH))}">${xmlEscape(l)}</tspan>`)
          .join("");
        return `<text font-size="${fmt(it.size * TEXT_EM_PER_HEIGHT)}" fill="${color}" stroke="none"${rotate(it.rot, it.at)}>${spans}</text>`;
      }
      case "hatch": {
        if (it.pattern === "SOLID") {
          const d = it.loops.map((l) => "M" + l.map(xy).join(" L") + " Z").join(" ");
          return `<path d="${d}" fill="${color}" fill-opacity="${fmt(SOLID_OPACITY)}" fill-rule="evenodd" stroke="none"/>`;
        }
        if (it.segs.length === 0) return null;
        const d = it.segs.map(([a, b]) => `M${xy(a)} L${xy(b)}`).join(" ");
        return `<path d="${d}" stroke-width="${fmt(HATCH_LINE_WIDTH * s)}" stroke-dasharray="none"/>`;
      }
    }
  }

  /** 반시계(y 위쪽) 호 → SVG 경로. y를 뒤집으므로 sweep-flag 0. 시작 = 끝이면 원 전체(반원 2개). */
  function arcPath(c: Pt, r: number, a0: number, a1: number): string {
    const at = (deg: number): Pt => {
      const t = (deg * Math.PI) / 180;
      return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
    };
    const span = (((a1 - a0) % 360) + 360) % 360;
    const R = fmt(r);
    const p0 = at(a0);
    if (span === 0) {
      const mid = at(a0 + 180);
      return `M${xy(p0)} A${R} ${R} 0 0 0 ${xy(mid)} A${R} ${R} 0 0 0 ${xy(p0)}`;
    }
    return `M${xy(p0)} A${R} ${R} 0 ${span > 180 ? 1 : 0} 0 ${xy(at(a1))}`;
  }

  function rotate(rot: number, at: Pt): string {
    return rot === 0 ? "" : ` transform="rotate(${fmt(-rot)} ${X(at)} ${Y(at)})"`;
  }
}

/** 속성·제목 값: cleanLine + XML 이스케이프. */
function attr(v: string): string {
  return xmlEscape(cleanLine(String(v)));
}
