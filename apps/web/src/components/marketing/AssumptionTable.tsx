import { SourceNote } from "./SourceNote.tsx";
import { MarketingRuleError, assertIsoDate, assertOneLine, cx } from "./rules.ts";

/** 가정 한 행. 값은 사용자가 넣었거나 출처가 있는 것뿐이다(출처 없는 기본값은 타입으로 막는다). */
export type Assumption = { label: string; value: string } & (
  | { by: "user" }
  | { by: "source"; source: string; /** YYYY-MM-DD */ checkedAt: string; href?: string }
);

export type AssumptionTableProps = {
  caption: string;
  rows: readonly Assumption[];
  className?: string;
};

const C = "AssumptionTable";

export function assertAssumptionTable(p: AssumptionTableProps): void {
  assertOneLine(C, "caption", p.caption);
  if (p.rows.length < 1) throw new MarketingRuleError(C, "rows: 가정이 1행 이상 필요합니다.");
  p.rows.forEach((r, i) => {
    assertOneLine(C, `rows[${i}].label`, r.label);
    assertOneLine(C, `rows[${i}].value`, r.value);
    if (r.by === "source") {
      assertOneLine(C, `rows[${i}].source`, r.source);
      assertIsoDate(C, `rows[${i}].checkedAt`, r.checkedAt);
    } else if (r.by !== "user") {
      throw new MarketingRuleError(C, `rows[${i}].by: "user" 또는 "source" 여야 합니다(출처 없는 기본값 금지).`);
    }
  });
}

const TH = "p-4 align-bottom font-semibold text-fg-3";

/**
 * 가정 조건 표: 계산에 쓴 가정을 행으로 — 값, 누가 넣었나, 출처·확인일.
 * 좁은 화면에서는 표 영역 안에서 좌우로 이동한다(키보드로 포커스해 화살표로 이동 가능).
 */
export function AssumptionTable(props: AssumptionTableProps) {
  assertAssumptionTable(props);
  const { caption, rows, className } = props;
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <p className="text-caption text-fg-3 md:hidden">표는 좌우로 밀어 전체를 볼 수 있습니다.</p>
      <div
        role="region"
        aria-label={`${caption} (표 안에서 좌우로 이동)`}
        tabIndex={0}
        className="focus-ring overflow-x-auto rounded-card border border-line"
      >
        <table className="w-full min-w-2xl border-collapse text-left text-body">
          <caption className="p-4 text-left text-caption text-fg-2">{caption}</caption>
          <thead className="bg-raised">
            <tr>
              <th scope="col" className={TH}>가정</th>
              <th scope="col" className={TH}>값</th>
              <th scope="col" className={TH}>입력 주체</th>
              <th scope="col" className={TH}>출처·확인일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <th scope="row" className="p-4 text-left align-top font-semibold">{r.label}</th>
                <td className="p-4 align-top tabular-nums text-fg">{r.value}</td>
                <td className="p-4 align-top text-fg-2">{r.by === "user" ? "사용자 입력" : "출처 값"}</td>
                <td className="p-4 align-top text-fg-2">
                  {r.by === "source" ? (
                    <SourceNote source={r.source} checkedAt={r.checkedAt} href={r.href} />
                  ) : (
                    <span className="text-caption text-fg-3">사용자가 넣은 값이라 출처 없음</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
