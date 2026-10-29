import { cx } from "./rules.ts";

export type SampleTagProps = {
  /** "example" = "예시"(기본), "sample" = "샘플"(내려받는 결과물). 표시 문구는 바꿀 수 없다. */
  kind?: "example" | "sample";
  className?: string;
};

const TEXT = { example: "예시", sample: "샘플" } as const;

/** 예시 데이터·샘플 결과물 옆 작은 표시. 실제 고객 결과물이 생겨도 동의 전에는 유지한다. */
export function SampleTag({ kind = "example", className }: SampleTagProps) {
  return (
    <span
      data-sample-tag={kind}
      className={cx("inline-flex items-center gap-1 rounded-control border border-line px-2 text-caption font-semibold text-fg-2", className)}
    >
      <span aria-hidden="true">◇</span>
      <span>{TEXT[kind]}</span>
    </span>
  );
}
