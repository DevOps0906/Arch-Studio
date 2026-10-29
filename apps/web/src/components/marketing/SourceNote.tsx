import { assertHref, assertIsoDate, assertOneLine, cx } from "./rules.ts";

export type SourceNoteProps = {
  /** 출처 이름(필수). 출처가 없으면 주장을 지운다(LANDING_PERSUASION 4장). */
  source: string;
  /** 확인일 YYYY-MM-DD(필수). */
  checkedAt: string;
  /** 출처 원문 주소(선택). */
  href?: string;
  className?: string;
};

/** 표·주장 아래 작은 글씨 "출처: …, 확인일 …". */
export function SourceNote({ source, checkedAt, href, className }: SourceNoteProps) {
  assertOneLine("SourceNote", "source", source);
  assertIsoDate("SourceNote", "checkedAt", checkedAt);
  if (href !== undefined) assertHref("SourceNote", "href", href);
  return (
    <p className={cx("text-caption text-fg-3", className)}>
      <span>출처: </span>
      {href ? (
        <a
          href={href}
          className="focus-ring rounded-control underline underline-offset-4"
          rel={href.startsWith("https://") ? "noopener noreferrer" : undefined}
        >
          <cite className="not-italic">{source}</cite>
        </a>
      ) : (
        <cite className="not-italic">{source}</cite>
      )}
      <span>, 확인일 </span>
      <time dateTime={checkedAt}>{checkedAt}</time>
    </p>
  );
}
