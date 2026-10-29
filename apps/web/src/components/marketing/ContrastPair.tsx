import { MarketingRuleError, assertOneLine, cx } from "./rules.ts";

export type ContrastRow = { attribute: string; before: string; after: string };

export type ContrastPairProps = {
  /** 영역 이름(접근성 이름). 필수. */
  label: string;
  /** 기존 방식 머리글(예: 손으로 작도·검토) */
  beforeLabel: string;
  /** 제품 방식 머리글 */
  afterLabel: string;
  /** 같은 속성을 같은 줄에 놓은 2~6행 */
  rows: readonly ContrastRow[];
  className?: string;
};

const C = "ContrastPair";

export function assertContrastPair(p: ContrastPairProps): void {
  assertOneLine(C, "label", p.label);
  assertOneLine(C, "beforeLabel", p.beforeLabel);
  assertOneLine(C, "afterLabel", p.afterLabel);
  if (p.rows.length < 2 || p.rows.length > 6) throw new MarketingRuleError(C, "rows: 속성은 2~6행입니다.");
  p.rows.forEach((r, i) => {
    assertOneLine(C, `rows[${i}].attribute`, r.attribute);
    assertOneLine(C, `rows[${i}].before`, r.before);
    assertOneLine(C, `rows[${i}].after`, r.after);
  });
}

/**
 * 기존 방식 / 제품 방식 비교 1쌍. 페이지에 1쌍만 쓴다.
 * 빨강·초록 대비 대신 중립색 + 기호(− / +)와 글자 머리글로 구분한다.
 * 768 이상은 속성·기존·제품 3칸, 767 이하는 속성마다 위아래로 쌓는다(가로 스크롤 없음).
 */
export function ContrastPair(props: ContrastPairProps) {
  assertContrastPair(props);
  const { label, beforeLabel, afterLabel, rows, className } = props;
  return (
    <section aria-label={label} className={cx("flex flex-col", className)}>
      <div aria-hidden="true" className="hidden grid-cols-[calc(var(--spacing)*40)_1fr_1fr] gap-6 border-b border-line pb-3 text-caption font-semibold text-fg-3 md:grid">
        <span />
        <span>{beforeLabel}</span>
        <span className="text-fg">{afterLabel}</span>
      </div>
      <dl className="flex flex-col divide-y divide-line border-b border-line md:border-b-0">
        {rows.map((r) => (
          <div key={r.attribute} className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[calc(var(--spacing)*40)_1fr_1fr] md:gap-6">
            <dt className="text-body font-semibold">{r.attribute}</dt>
            <dd className="flex items-start gap-2 text-body text-fg-2">
              <span aria-hidden="true" className="shrink-0 font-mono">−</span>
              <span>
                <span className="mb-1 block text-caption text-fg-3 md:sr-only">{beforeLabel}</span>
                {r.before}
              </span>
            </dd>
            <dd className="flex items-start gap-2 bg-raised p-3 text-body text-fg md:bg-transparent md:p-0">
              <span aria-hidden="true" className="shrink-0 font-mono">+</span>
              <span>
                <span className="mb-1 block text-caption font-semibold text-accent md:sr-only">{afterLabel}</span>
                {r.after}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
