// 로컬 벡터 PDF 작성기(D-23: jsPDF 4.2.1 직접 그리기 = 방식 B, AR-F-038 "벡터, 여러 시트 묶음, 로컬 생성").
// SVG 작성기와 같은 장면(scene.ts: INSERT 펼침·정렬·좌표)과 같은 레이어 스타일 표(style.ts)를 쓴다. DOM·canvas 없이 Web Worker에서 동작.
// 결정성: 같은 입력 → 같은 바이트. 생성 시각은 고정값(options.creation_date로 바꿀 수 있다), 파일 ID는 시트 input_hash에서 만든다.
// 압축(compress, 기본 켬): jsPDF의 FlateDecode(fflate)는 같은 입력에 같은 바이트를 낸다 — 같은 프로세스 2회·별개 프로세스(TZ 다름)
// 결과가 같음을 pdf.test.ts가 시험한다(2026-10-29, jsPDF 4.2.1·fflate 0.8.3). 압축을 꺼도 결정적이다.
// 바이트 골든은 두지 않는다: jsPDF 버전이 바뀌면 같은 그림이어도 바이트가 달라지므로 구조 검사(쪽 수·문자열·결정성)로 대신한다.
// 한글 글꼴은 주입식(options.font). 없거나 읽을 수 없으면 helvetica로 대체하고 AR057(라틴 1 밖 글자는 "?"로 바꾼다).
// jsPDF 내부 오류(파일을 만들지 못함)는 OutputError(AR056). 입력 계약 위반(고지 없음 등)은 DraftingError 그대로.
import { GState, jsPDF } from "jspdf";
import { canonicalJson, sha256Hex } from "../../sheet/hash.ts";
import { DraftingError } from "../../sheet/errors.ts";
import type { SheetModel, SheetWarning } from "../../sheet/types.ts";
import { assertDisclaimer } from "../../titleblock/index.ts";
import { buildScene, MTEXT_LINE_PITCH, type Pt, type Scene, type SceneItem } from "../svg/scene.ts";
import { HATCH_LINE_WIDTH, layerStyle, SOLID_OPACITY, TEXT_EM_PER_HEIGHT } from "../svg/style.ts";
import type { FontMetrics } from "./metrics.ts";
import { OutputError } from "./errors.ts";
import { parseTtf, type TtfInfo } from "./ttf.ts";

export const PDF_WRITER_VERSION = "pdf-1.0.0";
/** 기본 생성 시각(PDF 날짜 문자열, UTC). 엔진은 시각을 읽지 않으므로 실제 값은 호출자가 넣는다. */
export const PDF_DEFAULT_CREATION_DATE = "D:20000101000000+00'00'";
/** 대체 글꼴(jsPDF 표준 14 글꼴, 임베드 없음). 한글을 그리지 못한다. */
export const PDF_FALLBACK_FONT = "helvetica";

const PT_PER_MM = 72 / 25.4;
const PDF_DATE = /^D:\d{14}[+-]\d{2}'\d{2}'$/;

export interface PdfFont {
  /** PDF 글꼴 이름(jsPDF 등록 이름). 제어 문자·공백만은 금지. */
  family: string;
  /** TrueType(glyf) 글꼴 파일 바이트. 재배포 가능한 글꼴(SIL OFL 등)만 넣는다(fonts/README.md). */
  ttf: Uint8Array;
}

export interface PdfOptions {
  font?: PdfFont;
  /** 기본 true(FlateDecode). 압축해도 결정적이다(머리 주석). */
  compress?: boolean;
  /** PDF 날짜 문자열 `D:YYYYMMDDHHmmSS+HH'mm'`. 기본 PDF_DEFAULT_CREATION_DATE. */
  creation_date?: string;
  /** 문서 제목. 기본: 첫 시트 프로젝트명. */
  title?: string;
  /** MTEXT 줄바꿈 폭 표(SvgOptions.metrics와 같은 값을 넘겨야 SVG와 줄바꿈이 같다). */
  metrics?: FontMetrics;
}

export interface PdfResult {
  bytes: Uint8Array;
  page_count: number;
  /** AR057(글꼴 대체·없는 글자). */
  warnings: SheetWarning[];
  /** 실제로 쓴 글꼴. */
  font: { family: string; embedded: boolean };
}

export function writePdf(sheets: readonly SheetModel[], options: PdfOptions = {}): PdfResult {
  if (sheets.length === 0) throw new DraftingError("INVALID_ARGUMENT", "PDF로 묶을 시트가 없습니다");
  for (const s of sheets) assertDisclaimer(s.paper_prims);
  const created = options.creation_date ?? PDF_DEFAULT_CREATION_DATE;
  if (!PDF_DATE.test(created)) throw new DraftingError("INVALID_ARGUMENT", `PDF 날짜 형식이 아닙니다: ${created}`);
  const sceneOpts = options.metrics === undefined ? {} : { metrics: options.metrics };
  const scenes = sheets.map((s) => buildScene(s, sceneOpts));
  const warnings: SheetWarning[] = [];

  // 글꼴 결정: 주입 글꼴을 직접 읽어 확인한다(jsPDF는 잘못된 TTF에서 늦게·불분명하게 실패한다).
  let ttf: TtfInfo | null = null;
  if (options.font === undefined) {
    warnings.push({ code: "AR057", detail: `PDF 한글 글꼴이 주입되지 않아 ${PDF_FALLBACK_FONT}로 대체했습니다` });
  } else {
    const fam = options.font.family;
    if (typeof fam !== "string" || fam.trim() === "" || /[\u0000-\u001f\u007f()<>[\]{}/%]/.test(fam)) {
      throw new DraftingError("INVALID_ARGUMENT", `PDF 글꼴 이름이 비었거나 쓸 수 없는 문자가 있습니다: ${JSON.stringify(fam)}`);
    }
    const parsed = parseTtf(options.font.ttf);
    if (parsed.ok) ttf = parsed.font;
    else warnings.push({ code: "AR057", detail: `글꼴 ${fam}을 읽을 수 없어 ${PDF_FALLBACK_FONT}로 대체했습니다: ${parsed.reason}` });
  }

  // 문자열 준비: 대체 글꼴이면 라틴 1 밖 글자를 "?"로, 주입 글꼴이면 없는 글자를 센다(그대로 두면 .notdef 상자).
  const absent = new Set<string>();
  const covered = new Map<number, boolean>();
  const prep = (s: string): string => {
    if (ttf === null) {
      let out = "";
      for (const ch of s) {
        const cp = ch.codePointAt(0) as number;
        if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out += ch;
        else {
          absent.add(ch);
          out += "?";
        }
      }
      return out;
    }
    for (const ch of s) {
      const cp = ch.codePointAt(0) as number;
      let has = covered.get(cp);
      if (has === undefined) {
        has = cp === 0x20 || (ttf as TtfInfo).glyph(cp) !== 0;
        covered.set(cp, has);
      }
      if (!has) absent.add(ch);
    }
    return s;
  };

  const family = ttf === null ? PDF_FALLBACK_FONT : (options.font as PdfFont).family;
  let doc: jsPDF;
  try {
    doc = new jsPDF({
      unit: "mm",
      format: pageFormat(sheets[0] as SheetModel),
      orientation: orient(sheets[0] as SheetModel),
      compress: options.compress ?? true,
      putOnlyUsedFonts: true,
      floatPrecision: 3,
    });
    doc.setCreationDate(created);
    doc.setFileId(fileId(sheets));
    doc.setDocumentProperties({
      title: options.title ?? (sheets[0] as SheetModel).title_block.project_name,
      subject: (sheets[0] as SheetModel).title_block.disclaimer,
      creator: `Arch Studio drafting ${PDF_WRITER_VERSION}`,
    });
    if (ttf !== null) {
      const file = "arch-font.ttf";
      doc.addFileToVFS(file, base64((options.font as PdfFont).ttf));
      doc.addFont(file, family, "normal", "normal", "Identity-H");
    }
    doc.setFont(family, "normal");
    // jsPDF는 TTF 해석 오류를 내부 이벤트에서 삼키고(콘솔 출력만) 나중에 엉뚱한 곳에서 실패한다 → 여기서 확인한다.
    if (ttf !== null && (doc.getFont() as { metadata?: unknown }).metadata === undefined) {
      throw new OutputError("pdf_failed", `글꼴 ${family}을 PDF에 넣지 못했습니다(jsPDF가 TTF를 해석하지 못함)`);
    }
    scenes.forEach((sc, i) => {
      const sheet = sheets[i] as SheetModel;
      if (i > 0) doc.addPage(pageFormat(sheet), orient(sheet));
      drawScene(doc, sc, prep);
    });
  } catch (e) {
    if (e instanceof OutputError || e instanceof DraftingError) throw e;
    throw new OutputError("pdf_failed", `PDF를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (absent.size > 0) {
    const list = [...absent].sort();
    const sample = list.slice(0, 10).join("");
    warnings.push({
      code: "AR057",
      detail:
        ttf === null
          ? `대체 글꼴에 없는 글자 ${list.length}종을 ?로 바꿨습니다(예: ${sample})`
          : `글꼴 ${family}에 없는 글자 ${list.length}종(예: ${sample})`,
    });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(doc.output("arraybuffer"));
  } catch (e) {
    throw new OutputError("pdf_failed", `PDF를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return { bytes, page_count: scenes.length, warnings, font: { family, embedded: ttf !== null } };
}

function pageFormat(s: SheetModel): [number, number] {
  return [s.paper.w / 100, s.paper.h / 100];
}

function orient(s: SheetModel): "landscape" | "portrait" {
  return s.paper.w > s.paper.h ? "landscape" : "portrait";
}

/** 파일 ID(32자 16진): 시트 묶음의 sheet_id·input_hash·engine_version과 작성기 버전에서. 같은 묶음 → 같은 ID. */
function fileId(sheets: readonly SheetModel[]): string {
  const key = canonicalJson({ v: PDF_WRITER_VERSION, sheets: sheets.map((s) => [s.sheet_id, s.input_hash, s.engine_version]) });
  return sha256Hex(key).slice(0, 32).toUpperCase();
}

function drawScene(doc: jsPDF, sc: Scene, prep: (s: string) => string): void {
  const s = sc.scale;
  const X = (p: Pt) => p[0] / s;
  const Y = (p: Pt) => (sc.h - p[1]) / s;
  for (const { layer, items } of sc.layers) {
    if (items.length === 0) continue;
    const st = layerStyle(layer);
    const [r, g, b] = st.rgb;
    doc.setDrawColor(r, g, b);
    doc.setTextColor(r, g, b);
    doc.setFillColor(r, g, b);
    const base = () => {
      doc.setLineWidth(st.width);
      doc.setLineDashPattern([...st.dash], 0);
    };
    base();
    for (const it of items) draw(it);

    function draw(it: SceneItem): void {
      switch (it.t) {
        case "line":
          doc.line(X(it.a), Y(it.a), X(it.b), Y(it.b), "S");
          return;
        case "pline": {
          if (it.pts.length < 2) return;
          const ops = it.pts.map((p, i) => ({ op: i === 0 ? "m" : "l", c: [X(p), Y(p)] }));
          if (it.closed) ops.push({ op: "h", c: [] });
          doc.path(ops);
          doc.stroke();
          return;
        }
        case "circle":
          doc.circle(X(it.c), Y(it.c), it.r / s, "S");
          return;
        case "arc":
          doc.path(arcOps(it.c, it.r, it.a0, it.a1, X, Y));
          doc.stroke();
          return;
        case "text": {
          const str = prep(it.s);
          if (str === "") return;
          doc.setFontSize(((it.size * TEXT_EM_PER_HEIGHT) / s) * PT_PER_MM);
          const align = it.align === "c" ? "center" : it.align === "r" ? "right" : "left";
          doc.text(str, X(it.at), Y(it.at), { align, baseline: "alphabetic", ...(it.rot !== 0 ? { angle: it.rot } : {}) });
          return;
        }
        case "mtext": {
          doc.setFontSize(((it.size * TEXT_EM_PER_HEIGHT) / s) * PT_PER_MM);
          const t = (it.rot * Math.PI) / 180;
          const cos = it.rot === 0 ? 1 : Math.cos(t);
          const sin = it.rot === 0 ? 0 : Math.sin(t);
          it.lines.forEach((line, i) => {
            const str = prep(line);
            if (str === "") return;
            const down = it.size + i * it.size * MTEXT_LINE_PITCH;
            // 왼쪽 위 부착점에서 아래로 down(회전 적용, y 위쪽 좌표).
            const p: Pt = [it.at[0] + down * sin, it.at[1] - down * cos];
            doc.text(str, X(p), Y(p), { baseline: "alphabetic", ...(it.rot !== 0 ? { angle: it.rot } : {}) });
          });
          return;
        }
        case "hatch": {
          if (it.pattern === "SOLID") {
            const ops: Array<{ op: string; c: number[] }> = [];
            for (const loop of it.loops) {
              if (loop.length < 3) continue;
              loop.forEach((p, i) => ops.push({ op: i === 0 ? "m" : "l", c: [X(p), Y(p)] }));
              ops.push({ op: "h", c: [] });
            }
            if (ops.length === 0) return;
            doc.saveGraphicsState();
            doc.setGState(new GState({ opacity: SOLID_OPACITY }));
            doc.path(ops);
            doc.fillEvenOdd();
            doc.restoreGraphicsState();
            return;
          }
          if (it.segs.length === 0) return;
          doc.setLineWidth(HATCH_LINE_WIDTH);
          doc.setLineDashPattern([], 0);
          for (const [a, c] of it.segs) doc.line(X(a), Y(a), X(c), Y(c), "S");
          base();
          return;
        }
      }
    }
  }
}

/** 반시계(y 위쪽) 호 → 3차 베지어 경로(90° 이하 조각, 조각당 k = 4/3·tan(θ/4)). 시작 = 끝이면 원 전체. */
function arcOps(c: Pt, r: number, a0: number, a1: number, X: (p: Pt) => number, Y: (p: Pt) => number) {
  let span = (((a1 - a0) % 360) + 360) % 360;
  if (span === 0) span = 360;
  const n = Math.ceil(span / 90);
  const step = ((span / n) * Math.PI) / 180;
  const kk = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Pt => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  const t0 = (a0 * Math.PI) / 180;
  const p0 = at(t0);
  const ops: Array<{ op: string; c: number[] }> = [{ op: "m", c: [X(p0), Y(p0)] }];
  for (let i = 0; i < n; i++) {
    const ta = t0 + i * step;
    const tb = ta + step;
    const pa = at(ta);
    const pb = at(tb);
    const c1: Pt = [pa[0] - kk * r * Math.sin(ta), pa[1] + kk * r * Math.cos(ta)];
    const c2: Pt = [pb[0] + kk * r * Math.sin(tb), pb[1] - kk * r * Math.cos(tb)];
    ops.push({ op: "c", c: [X(c1), Y(c1), X(c2), Y(c2), X(pb), Y(pb)] });
  }
  return ops;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 바이트 → base64(jsPDF VFS 입력). btoa는 lib 타입 밖이고 큰 입력에서 느려 직접 만든다. */
export function base64(u8: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  let i = 0;
  for (; i + 2 < u8.length; i += 3) {
    const n = ((u8[i] as number) << 16) | ((u8[i + 1] as number) << 8) | (u8[i + 2] as number);
    chunk += B64[n >> 18] + (B64[(n >> 12) & 63] as string) + (B64[(n >> 6) & 63] as string) + (B64[n & 63] as string);
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  const rest = u8.length - i;
  if (rest === 1) {
    const n = (u8[i] as number) << 16;
    chunk += B64[n >> 18] + (B64[(n >> 12) & 63] as string) + "==";
  } else if (rest === 2) {
    const n = ((u8[i] as number) << 16) | ((u8[i + 1] as number) << 8);
    chunk += B64[n >> 18] + (B64[(n >> 12) & 63] as string) + (B64[(n >> 6) & 63] as string) + "=";
  }
  parts.push(chunk);
  return parts.join("");
}
