import { GRADE_ACTION, GRADE_LABEL, assertProofLink, cx, type ProofLinkProps } from "./rules.ts";

export type { ProofLinkProps } from "./rules.ts";

/**
 * 증거 링크. 증거 ID·등급·주소가 모두 있어야 렌더된다(없으면 MarketingRuleError).
 * 링크 문구는 일어나는 일을 말하며 화살표를 붙이지 않는다.
 */
export function ProofLink(props: ProofLinkProps) {
  assertProofLink("ProofLink", props);
  const { href, evidenceId, grade, label, download, conditions, className } = props;
  return (
    <span className={cx("inline-flex flex-col gap-1", className)}>
      <a
        href={href}
        download={download ? "" : undefined}
        rel={href.startsWith("https://") ? "noopener noreferrer" : undefined}
        data-evidence-id={evidenceId}
        data-evidence-grade={grade}
        className="focus-ring rounded-control text-body font-semibold text-accent underline underline-offset-4"
      >
        {label ?? GRADE_ACTION[grade]}
      </a>
      <span className="text-caption text-fg-3">증거: {GRADE_LABEL[grade]}</span>
      {conditions ? <span className="text-caption text-fg-3">측정 조건: {conditions}</span> : null}
    </span>
  );
}
