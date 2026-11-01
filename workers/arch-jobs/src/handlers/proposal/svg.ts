// proposal_sheet SVG 검사(04_API.md 6.2절). 웹(apps/web/src/server/ai/proposal/svg.ts)과 같은 규칙의 사본 — 인라인 직전 재검사용.
// 업로드 뒤 객체가 바뀌었거나 DB 직접 enqueue여도 허용 목록 밖 SVG를 HTML에 넣지 않는다. 바꾸면 양쪽 함께(테스트 표 SVG_CASES).

export const SHEET_MAX_BYTES = 2 * 1024 * 1024;

const ELEMENTS = new Set(["svg", "g", "title", "desc", "rect", "line", "polyline", "polygon", "circle", "ellipse", "path", "text", "tspan"]);

const ATTRIBUTES = new Set([
  "xmlns", "version", "width", "height", "viewBox", "id", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "opacity", "transform", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline",
]);

const DATA_ATTR_RE = /^data-[a-z][a-z0-9-]{0,40}$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
// 허용 엔티티: XML 기본 5개와 숫자 참조만(DTD 정의 엔티티 없음).
const ENTITY_RE = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});)/;
const XML_DECL_RE = /^﻿?<\?xml[^?<>]*\?>/;
const ATTR_RE = /\s+([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;

export type SvgVerdict = { ok: true } | { ok: false; reason: string };

// 속성 값에서는 숫자 문자 참조(&#…;)와 CSS 이스케이프(\)를 아예 받지 않는다 — "&#117;rl(" 같은 우회로 url(·javascript: 검사를 피하지 못하게.
function badValue(value: string): boolean {
  const v = value.toLowerCase();
  return value.includes("&#") || value.includes("\\") || ENTITY_RE.test(value) || v.includes("url(") || v.includes("javascript:") || v.includes("expression(") || v.includes("@import");
}

/** 텍스트 → 검사 결과. 이유는 고정 단어만(원문을 담지 않는다). */
export function checkSheetSvg(text: string): SvgVerdict {
  let src = text;
  const decl = XML_DECL_RE.exec(src);
  if (decl) src = src.slice(decl[0].length);
  const stack: string[] = [];
  let seenRoot = false;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const chunk = lt === -1 ? src.slice(i) : src.slice(i, lt);
    if (chunk.includes(">") || ENTITY_RE.test(chunk)) return { ok: false, reason: "text" };
    if (stack.length === 0 && chunk.trim() !== "") return { ok: false, reason: "text" };
    if (lt === -1) break;
    const gt = src.indexOf(">", lt);
    if (gt === -1) return { ok: false, reason: "tag" };
    const raw = src.slice(lt + 1, gt);
    if (raw.startsWith("!") || raw.startsWith("?")) return { ok: false, reason: "markup" }; // 주석·DOCTYPE·ENTITY·CDATA·처리 명령
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      if (stack.pop() !== name) return { ok: false, reason: "nesting" };
    } else {
      const selfClose = raw.endsWith("/");
      const body = selfClose ? raw.slice(0, -1) : raw;
      const nameEnd = body.search(/\s|$/);
      const name = body.slice(0, nameEnd);
      if (!NAME_RE.test(name) || !ELEMENTS.has(name)) return { ok: false, reason: "element" };
      if (stack.length === 0) {
        if (seenRoot || name !== "svg") return { ok: false, reason: "root" };
        seenRoot = true;
      }
      let pos = nameEnd;
      const seen = new Set<string>();
      for (;;) {
        ATTR_RE.lastIndex = pos;
        const m = ATTR_RE.exec(body);
        if (!m) break;
        const attr = m[1] as string;
        const value = m[2] ?? m[3] ?? "";
        if (seen.has(attr)) return { ok: false, reason: "attribute" };
        seen.add(attr);
        if (!ATTRIBUTES.has(attr) && !DATA_ATTR_RE.test(attr)) return { ok: false, reason: "attribute" };
        if (attr === "xmlns" && value !== "http://www.w3.org/2000/svg") return { ok: false, reason: "attribute" };
        if (badValue(value)) return { ok: false, reason: "value" };
        pos = ATTR_RE.lastIndex;
      }
      if (body.slice(pos).trim() !== "") return { ok: false, reason: "attribute" };
      if (!selfClose) stack.push(name);
      else if (stack.length === 0) return { ok: false, reason: "root" }; // 빈 루트 <svg/>는 시트가 아님
    }
    i = gt + 1;
  }
  if (!seenRoot || stack.length !== 0) return { ok: false, reason: "nesting" };
  return { ok: true };
}

/** 바이트 → 검사 결과. UTF-8이 아니면 거부. */
export function checkSheetSvgBytes(bytes: Uint8Array): SvgVerdict {
  if (bytes.byteLength === 0 || bytes.byteLength > SHEET_MAX_BYTES) return { ok: false, reason: "size" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "encoding" };
  }
  return checkSheetSvg(text);
}
