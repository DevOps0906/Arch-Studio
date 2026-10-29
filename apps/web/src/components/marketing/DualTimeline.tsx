import { MarketingRuleError, assertOneLine, cx } from "./rules.ts";

export type DualTimelineStep = {
  title: string;
  /** 사용자(사무소)가 하는 일 */
  user: string;
  /** 제품이 하는 일 */
  product: string;
  /** 승인 지점. 사용자 줄에만 표시된다(제품이 한 일과 사람이 결정한 일을 섞지 않는다). */
  approval?: string;
  /** 단계에 붙는 한 쌍의 값(예: 도입 단계의 요금 칸). 숫자는 호출 쪽이 출처를 책임진다. */
  meta?: { label: string; value: string };
};

export type DualTimelineProps = {
  /** 목록의 접근성 이름. 필수. */
  label: string;
  userLabel?: string;
  productLabel?: string;
  /** 실제 처리 순서대로 1~8단계. 번호가 곧 순서다. */
  steps: readonly DualTimelineStep[];
  className?: string;
};

const C = "DualTimeline";

export function assertDualTimeline(p: DualTimelineProps): void {
  assertOneLine(C, "label", p.label);
  if (p.userLabel !== undefined) assertOneLine(C, "userLabel", p.userLabel);
  if (p.productLabel !== undefined) assertOneLine(C, "productLabel", p.productLabel);
  if (p.steps.length < 1 || p.steps.length > 8) throw new MarketingRuleError(C, "steps: 1~8단계입니다.");
  p.steps.forEach((s, i) => {
    assertOneLine(C, `steps[${i}].title`, s.title);
    assertOneLine(C, `steps[${i}].user`, s.user);
    assertOneLine(C, `steps[${i}].product`, s.product);
    if (s.approval !== undefined) assertOneLine(C, `steps[${i}].approval`, s.approval);
    if (s.meta) {
      assertOneLine(C, `steps[${i}].meta.label`, s.meta.label);
      assertOneLine(C, `steps[${i}].meta.value`, s.meta.value);
    }
  });
}

/**
 * 이중 타임라인: 단계마다 두 줄 — "사용자가 하는 일" / "제품이 하는 일". 승인 지점은 사용자 줄에 표시.
 * 도입 단계(체험 → 영구 라이선스 → 연간 업데이트)와 앱 작업 상세에 쓴다. 클라이언트 JS 없이 모든 단계가 보인다.
 */
export function DualTimeline(props: DualTimelineProps) {
  assertDualTimeline(props);
  const { label, steps, className } = props;
  const userLabel = props.userLabel ?? "사용자가 하는 일";
  const productLabel = props.productLabel ?? "제품이 하는 일";
  return (
    <ol role="list" aria-label={label} className={cx("flex flex-col divide-y divide-line border-y border-line", className)}>
      {steps.map((s, i) => (
        <li key={s.title} className="grid grid-cols-1 gap-4 py-6 md:grid-cols-[calc(var(--spacing)*48)_1fr] md:gap-8">
          <p className="flex items-baseline gap-3 text-h2 font-semibold">
            <span aria-hidden="true" className="font-mono text-caption text-fg-3">{i + 1}</span>
            <span>{s.title}</span>
          </p>
          <dl className="flex flex-col gap-4 text-body">
            <div className="flex flex-col gap-1">
              <dt className="text-caption font-semibold text-fg-3">{userLabel}</dt>
              <dd className="flex flex-col items-start gap-2 text-fg">
                <span>{s.user}</span>
                {s.approval ? (
                  <span className="inline-flex items-start gap-2 rounded-control border border-fg-3 px-2 py-1 text-caption font-semibold">
                    <span aria-hidden="true">✓</span>
                    <span>승인 지점: {s.approval}</span>
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex flex-col gap-1 border-l-2 border-line pl-4">
              <dt className="text-caption font-semibold text-fg-3">{productLabel}</dt>
              <dd className="text-fg-2">{s.product}</dd>
            </div>
            {s.meta ? (
              <div className="flex flex-col gap-1">
                <dt className="text-caption font-semibold text-fg-3">{s.meta.label}</dt>
                <dd className="tabular-nums text-fg-2">{s.meta.value}</dd>
              </div>
            ) : null}
          </dl>
        </li>
      ))}
    </ol>
  );
}
