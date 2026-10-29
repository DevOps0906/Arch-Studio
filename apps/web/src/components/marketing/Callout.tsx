import { assertOneLine, assertOneSentence, cx } from "./rules.ts";

export type CalloutProps = {
  /** 결론 한 문장. */
  conclusion: string;
  /** 설명 한 줄(선택). */
  detail?: string;
  className?: string;
};

/** 결론 한 줄: 왼쪽 띠 + 결론 한 문장 + 설명 한 줄. 페이지에 1개만 쓴다(LANDING_PERSUASION 4장). */
export function Callout({ conclusion, detail, className }: CalloutProps) {
  assertOneSentence("Callout", "conclusion", conclusion);
  if (detail !== undefined) assertOneLine("Callout", "detail", detail);
  return (
    <div role="note" className={cx("flex max-w-3xl flex-col gap-1 border-l-4 border-accent bg-raised py-3 pr-4 pl-4", className)}>
      <p className="text-h2 font-semibold">{conclusion}</p>
      {detail ? <p className="text-body text-fg-2">{detail}</p> : null}
    </div>
  );
}
