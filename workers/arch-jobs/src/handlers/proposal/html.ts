// 제안서 HTML 조립(순수·결정적: 같은 입력 → 같은 문자열). 날짜·난수·로캘 의존 포맷(toLocaleString)을 쓰지 않는다.
// 수치(판정 값·기준·면적·공사비)는 내용 스냅샷 값만 넣는다. 템플릿 문구에는 숫자가 없고, 서술은 checkNarrative가 숫자를 막은 문장만 들어온다.
// 시트 SVG는 svg.ts 허용 목록을 통과한 원문을 인라인한다(XML 선언만 뗀다, 외부 fetch 없음). 모든 텍스트는 HTML 이스케이프.
// 꼬리말: "법적 판정 아님" + 도면 고지(01_PRD.md:382, 04_API.md 4.4절). 서술 섹션에는 "AI 초안" 표시.
import type { ContentFile, DocKind, JudgmentKey, JudgmentUnit, Verdict } from "./content.ts";
import type { NarrativeOutput } from "./narrative.ts";

export const LEGAL_FOOTER = "법적 판정 아님 — 이 문서의 판정·면적·공사비는 설계 도구가 계산한 검토용 값이며, 인허가 판단은 허가권자와 건축사의 검토로 확정됩니다.";
export const DRAWING_NOTICE = "도면 고지 — 첨부 도면은 검토용 개략도이며 인허가·시공 도면이 아닙니다.";
export const AI_DRAFT_LABEL = "AI 초안";

const DOC_TITLES: Readonly<Record<DocKind, string>> = {
  proposal: "설계 제안서",
  overview: "설계 개요서",
  area_table: "면적표",
  cost: "개략 공사비",
};

const KEY_LABELS: Readonly<Record<JudgmentKey, string>> = {
  coverage: "건폐율",
  far: "용적률",
  height: "높이",
  sunlight: "일조 사선",
  setback: "이격 거리",
  parking: "주차",
  seismic: "내진",
  zero_energy: "제로에너지",
  supervision: "감리",
};

const VERDICT_LABELS: Readonly<Record<Verdict, string>> = { PASS: "적합", FAIL: "부적합", WARN: "확인 필요", NA: "해당 없음" };
const UNIT_LABELS: Readonly<Record<JudgmentUnit, string>> = { pct: "%", mm: "mm", m2: "㎡", count: "", bool: "" };

// 인쇄용 고정 스타일(웹 UI 토큰 대상 아님). 색은 이름 키워드, 크기는 mm·pt만.
const STYLE = [
  "@page { size: A4; margin: 18mm 16mm 22mm 16mm; @bottom-center { content: element(footer); } }",
  "body { font-family: 'Noto Sans KR', sans-serif; font-size: 10pt; color: black; }",
  "h1 { font-size: 18pt; margin: 0 0 4mm 0; } h2 { font-size: 13pt; margin: 6mm 0 2mm 0; }",
  "table { width: 100%; border-collapse: collapse; } th, td { border: 0.3mm solid gray; padding: 1.2mm 2mm; text-align: left; }",
  "td.num { text-align: right; } .ai-label { font-size: 8pt; border: 0.3mm solid gray; padding: 0.5mm 1.5mm; }",
  ".sheet { page-break-before: always; } .sheet svg { width: 100%; height: auto; }",
  "footer { position: running(footer); font-size: 7.5pt; color: dimgray; }",
].join("\n");

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 소수 자리 고정 + 천 단위 쉼표(로캘 무관). */
export function formatDecimal(v: number, digits: number): string {
  const fixed = Math.abs(v).toFixed(digits);
  const [i, f] = fixed.split(".") as [string, string | undefined];
  const sign = v < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${sign}${group(i)}${f ? `.${f}` : ""}`;
}

export function formatKrw(v: number): string {
  return `${group(String(v))}원`;
}

export function formatJudgmentValue(v: number | undefined, unit: JudgmentUnit): string {
  if (v === undefined) return "—";
  if (unit === "bool") return v !== 0 ? "예" : "아니오";
  if (unit === "count") return formatDecimal(v, Number.isInteger(v) ? 0 : 2);
  return `${formatDecimal(v, unit === "mm" ? 0 : 2)}${UNIT_LABELS[unit]}`;
}

export function formatArea(v: number): string {
  return `${formatDecimal(v, 2)}㎡`;
}

function row(cells: readonly string[], numCols: ReadonlySet<number> = new Set()): string {
  return `<tr>${cells.map((c, i) => (numCols.has(i) ? `<td class="num">${c}</td>` : `<td>${c}</td>`)).join("")}</tr>`;
}

function overviewSection(file: ContentFile): string {
  const o = file.content.overview;
  const rows: string[] = [];
  if (o.address !== undefined) rows.push(row(["대지 위치", escapeHtml(o.address)]));
  if (o.use !== undefined) rows.push(row(["용도", escapeHtml(o.use)]));
  if (o.zone !== undefined) rows.push(row(["용도지역", escapeHtml(o.zone)]));
  if (o.site_area_m2 !== undefined) rows.push(row(["대지 면적", formatArea(o.site_area_m2)], new Set([1])));
  return rows.length === 0 ? "" : `<section><h2>개요</h2><table><tbody>${rows.join("")}</tbody></table></section>`;
}

function judgmentSection(file: ContentFile): string {
  const j = file.content.judgment;
  const body = j.items
    .map((it) =>
      row(
        [
          escapeHtml(KEY_LABELS[it.key]),
          escapeHtml(VERDICT_LABELS[it.verdict]),
          formatJudgmentValue(it.value, it.unit),
          formatJudgmentValue(it.limit, it.unit),
          it.basis.map((b) => escapeHtml(`${b.law} ${b.article}`)).join("<br>"),
        ],
        new Set([2, 3]),
      ),
    )
    .join("");
  const meta = `<p>판정 기준: ${escapeHtml(j.rule_pack_version)} · 적용일 ${escapeHtml(j.application_date)} · 엔진 ${escapeHtml(j.engine_version)}</p>`;
  return `<section><h2>법규 판정</h2>${meta}<table><thead><tr><th>항목</th><th>판정</th><th>계획</th><th>기준</th><th>근거</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function areaSection(file: ContentFile): string {
  const a = file.content.area_table;
  const body = a.rows.map((r) => row([escapeHtml(r.floor ?? ""), escapeHtml(r.name), formatArea(r.area_m2)], new Set([2]))).join("");
  return `<section><h2>면적표</h2><table><thead><tr><th>층</th><th>실</th><th>면적</th></tr></thead><tbody>${body}${row(["", "합계", formatArea(a.total_m2)], new Set([2]))}</tbody></table></section>`;
}

function costSection(file: ContentFile): string {
  const c = file.content.cost;
  if (!c) return "";
  const body = c.items.map((it) => row([escapeHtml(it.label), formatKrw(it.amount_krw)], new Set([1]))).join("");
  const basis = c.basis !== undefined ? `<p>산정 기준: ${escapeHtml(c.basis)}</p>` : "";
  return `<section><h2>개략 공사비</h2>${basis}<table><thead><tr><th>항목</th><th>금액</th></tr></thead><tbody>${body}${row(["합계", formatKrw(c.total_krw)], new Set([1]))}</tbody></table></section>`;
}

function narrativeSection(n: NarrativeOutput): string {
  const parts = n.sections.map((s) => `<h3>${escapeHtml(s.heading)}</h3><p>${escapeHtml(s.body)}</p>`).join("");
  return `<section class="narrative"><h2>제안 설명 <span class="ai-label">${AI_DRAFT_LABEL}</span></h2>${parts}</section>`;
}

function notesSection(file: ContentFile): string {
  const n = file.content.notes;
  return n === undefined || n === "" ? "" : `<section><h2>비고</h2><p>${escapeHtml(n)}</p></section>`;
}

const XML_DECL_RE = /^﻿?<\?xml[^?<>]*\?>\s*/;

function sheetsSection(sheets: readonly string[]): string {
  return sheets.map((svg) => `<section class="sheet">${svg.replace(XML_DECL_RE, "")}</section>`).join("");
}

export interface AssembleInput {
  file: ContentFile;
  /** svg.ts 검사를 통과한 시트 원문(drawing_sheets 순서). */
  sheets: readonly string[];
  /** kind='proposal'만. checkNarrative를 통과한 값. */
  narrative: NarrativeOutput | null;
}

export function assembleProposalHtml(input: AssembleInput): string {
  const { file } = input;
  const kind = file.kind;
  const sections: string[] = [];
  if (kind === "proposal" || kind === "overview") sections.push(overviewSection(file));
  if (kind === "proposal" && input.narrative) sections.push(narrativeSection(input.narrative));
  if (kind === "proposal" || kind === "overview") sections.push(judgmentSection(file));
  if (kind === "proposal" || kind === "overview" || kind === "area_table") sections.push(areaSection(file));
  if (kind === "proposal" || kind === "cost") sections.push(costSection(file));
  if (kind === "proposal" || kind === "overview") sections.push(notesSection(file));
  const title = `${DOC_TITLES[kind]} — ${file.content.overview.title}`;
  return [
    "<!DOCTYPE html>",
    `<html lang="ko"><head><meta charset="utf-8"><meta name="template-version" content="${escapeHtml(file.template_version)}">`,
    `<title>${escapeHtml(title)}</title><style>\n${STYLE}\n</style></head><body>`,
    `<footer><p>${escapeHtml(LEGAL_FOOTER)}</p><p>${escapeHtml(DRAWING_NOTICE)}</p></footer>`,
    `<header><h1>${escapeHtml(title)}</h1></header>`,
    sections.filter((s) => s !== "").join("\n"),
    sheetsSection(input.sheets),
    "</body></html>",
    "",
  ].join("\n");
}
