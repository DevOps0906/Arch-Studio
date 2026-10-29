import { ProofLink } from "./ProofLink.tsx";
import {
  MarketingRuleError,
  assertCategoryName,
  assertOneLine,
  assertProofLink,
  cx,
  type ProofLinkProps,
} from "./rules.ts";

/** ○ 된다, △ 일부·조건부, ✕ 안 된다. 기호와 글자를 함께 쓰고 색만으로 구분하지 않는다. */
export type Mark = "yes" | "partial" | "no";

export const MARK_GLYPH: Record<Mark, string> = { yes: "○", partial: "△", no: "✕" };
export const MARK_TEXT: Record<Mark, string> = { yes: "된다", partial: "일부·조건부", no: "안 된다" };

export type AlternativeCell = { mark: Mark; /** 직접 해 보면 알 수 있는 사실 한 줄 */ reason: string };

/** 우리 열: ○ 이면 증거(`proof`)가 타입으로 필수다. △·✕ 는 선택. */
export type OurCell =
  | { mark: "yes"; reason: string; proof: ProofLinkProps }
  | { mark: "partial" | "no"; reason: string; proof?: ProofLinkProps };

export type AlternativesRow = {
  criterion: string;
  /** `alternativeNames` 와 같은 순서·같은 개수 */
  alternatives: readonly AlternativeCell[];
  ours: OurCell;
};

export type UnfitCase = { situation: string; instead: string };

export type AlternativesTableProps = {
  /** 표 제목(캡션). 필수. */
  caption: string;
  /** 대안 범주 이름만(2~5개). 회사·서비스 이름 금지(D-27). */
  alternativeNames: readonly string[];
  /** 우리 열 머리글 */
  ourName?: string;
  /** 기준 4~6행(LANDING_PERSUASION 3.2절) */
  rows: readonly AlternativesRow[];
  /** "이런 경우엔 다른 방법이 낫습니다" 2~4행 */
  unfit: readonly UnfitCase[];
  className?: string;
};

const C = "AlternativesTable";

/** 렌더 전에 규칙을 검사한다. 위반하면 MarketingRuleError. */
export function assertAlternativesTable(p: AlternativesTableProps): void {
  assertOneLine(C, "caption", p.caption);
  if (p.alternativeNames.length < 2 || p.alternativeNames.length > 5) {
    throw new MarketingRuleError(C, "alternativeNames: 대안 범주는 2~5개입니다.");
  }
  p.alternativeNames.forEach((n, i) => assertCategoryName(C, `alternativeNames[${i}]`, n));
  if (new Set(p.alternativeNames).size !== p.alternativeNames.length) {
    throw new MarketingRuleError(C, "alternativeNames: 중복된 범주가 있습니다.");
  }
  if (p.rows.length < 4 || p.rows.length > 6) throw new MarketingRuleError(C, "rows: 판정 기준은 4~6행입니다.");
  p.rows.forEach((r, i) => {
    assertOneLine(C, `rows[${i}].criterion`, r.criterion);
    if (r.alternatives.length !== p.alternativeNames.length) {
      throw new MarketingRuleError(C, `rows[${i}].alternatives: 대안 범주 수(${p.alternativeNames.length})와 같아야 합니다.`);
    }
    r.alternatives.forEach((a, j) => {
      assertMark(`rows[${i}].alternatives[${j}].mark`, a.mark);
      assertOneLine(C, `rows[${i}].alternatives[${j}].reason`, a.reason);
    });
    assertMark(`rows[${i}].ours.mark`, r.ours.mark);
    assertOneLine(C, `rows[${i}].ours.reason`, r.ours.reason);
    if (r.ours.mark === "yes" && !r.ours.proof) {
      throw new MarketingRuleError(C, `rows[${i}].ours: ○ 에는 증거(proof)가 필요합니다. 증거가 없으면 △ 로 내리거나 행을 지웁니다.`);
    }
    if (r.ours.proof) assertProofLink(C, r.ours.proof);
  });
  if (!p.rows.some((r) => r.ours.mark === "partial" || r.ours.mark === "no")) {
    throw new MarketingRuleError(C, "우리 열에 △ 또는 ✕ 가 1개 이상 있어야 합니다(전부 ○ 인 판정표는 게시하지 않습니다).");
  }
  if (p.unfit.length < 2 || p.unfit.length > 4) throw new MarketingRuleError(C, "unfit: 맞지 않는 경우는 2~4행입니다.");
  p.unfit.forEach((u, i) => {
    assertOneLine(C, `unfit[${i}].situation`, u.situation);
    assertOneLine(C, `unfit[${i}].instead`, u.instead);
  });
}

function assertMark(field: string, mark: unknown): void {
  if (mark !== "yes" && mark !== "partial" && mark !== "no") {
    throw new MarketingRuleError(C, `${field}: "yes" | "partial" | "no" 중 하나여야 합니다.`);
  }
}

function MarkText({ mark, reason }: { mark: Mark; reason: string }) {
  return (
    <span className="flex items-start gap-2">
      <span aria-hidden="true" className="shrink-0 font-mono">
        {MARK_GLYPH[mark]}
      </span>
      <span>
        <span className="sr-only">{MARK_TEXT[mark]}: </span>
        {reason}
      </span>
    </span>
  );
}

function Proof({ cell }: { cell: OurCell }) {
  return cell.proof ? <ProofLink {...cell.proof} /> : <span className="text-caption text-fg-3">증거 링크 없음</span>;
}

const TH = "p-4 align-bottom font-semibold text-fg-3";
const TD = "p-4 align-top text-fg-2";

/**
 * 대안 판정표. 768 이상은 `<table>`(scope·캡션, 표 안에서만 가로 스크롤),
 * 767 이하는 "기준 하나 = 블록 하나"로 접어 가로 스크롤이 필요 없다. 둘 중 하나만 보이고 접근성 트리에도 하나만 남는다.
 */
export function AlternativesTable(props: AlternativesTableProps) {
  assertAlternativesTable(props);
  const { caption, alternativeNames, rows, unfit, className } = props;
  const ourName = props.ourName ?? "Arch Studio";
  return (
    <div className={cx("flex flex-col gap-6", className)}>
      <p className="text-caption text-fg-2">
        <span className="font-mono">{MARK_GLYPH.yes}</span> {MARK_TEXT.yes} · <span className="font-mono">{MARK_GLYPH.partial}</span> {MARK_TEXT.partial} ·{" "}
        <span className="font-mono">{MARK_GLYPH.no}</span> {MARK_TEXT.no}
      </p>

      <p className="hidden text-caption text-fg-3 md:block xl:hidden">표는 좌우로 밀어 전체를 볼 수 있습니다.</p>

      <div
        role="region"
        aria-label={`${caption} (표 안에서 좌우로 이동)`}
        tabIndex={0}
        className="focus-ring hidden overflow-x-auto rounded-card border border-line md:block"
      >
        <table className="w-full min-w-3xl border-collapse text-left text-body">
          <caption className="p-4 text-left text-caption text-fg-2">{caption}</caption>
          <thead className="bg-raised">
            <tr>
              <th scope="col" className={TH}>기준</th>
              {alternativeNames.map((n) => (
                <th key={n} scope="col" className={TH}>{n}</th>
              ))}
              <th scope="col" className={cx(TH, "text-accent")}>{ourName}</th>
              <th scope="col" className={TH}>증거</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.criterion} className="border-t border-line">
                <th scope="row" className="p-4 text-left align-top font-semibold">{r.criterion}</th>
                {r.alternatives.map((a, j) => (
                  <td key={alternativeNames[j]} className={TD}>
                    <MarkText mark={a.mark} reason={a.reason} />
                  </td>
                ))}
                <td className={cx(TD, "bg-raised text-fg")}>
                  <MarkText mark={r.ours.mark} reason={r.ours.reason} />
                </td>
                <td className={TD}>
                  <Proof cell={r.ours} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="flex flex-col divide-y divide-line border-y border-line md:hidden">
        {rows.map((r) => (
          <li key={r.criterion} className="flex flex-col gap-3 py-4">
            <p className="text-body font-semibold">{r.criterion}</p>
            <dl className="flex flex-col gap-3 text-body text-fg-2">
              {r.alternatives.map((a, j) => (
                <div key={alternativeNames[j]} className="flex flex-col gap-1">
                  <dt className="text-caption text-fg-3">{alternativeNames[j]}</dt>
                  <dd><MarkText mark={a.mark} reason={a.reason} /></dd>
                </div>
              ))}
              <div className="flex flex-col gap-1 bg-raised p-3 text-fg">
                <dt className="text-caption font-semibold text-accent">{ourName}</dt>
                <dd className="flex flex-col gap-2">
                  <MarkText mark={r.ours.mark} reason={r.ours.reason} />
                  <Proof cell={r.ours} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <table className="w-full border-collapse text-left text-body">
        <caption className="pb-2 text-left text-body font-semibold">이런 경우엔 다른 방법이 낫습니다</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">이런 경우</th>
            <th scope="col">다른 방법</th>
          </tr>
        </thead>
        <tbody>
          {unfit.map((u) => (
            <tr key={u.situation} className="border-t border-line">
              <th scope="row" className="w-1/2 py-3 pr-3 text-left align-top font-semibold md:w-1/3">{u.situation}</th>
              <td className="py-3 align-top text-fg-2">{u.instead}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
