// 상태 바(03장 3.5절): 매스 수·지상 층·판정 소요·엔진·규칙 팩 버전·판정 아님 고지. 면적 합계는 판정 엔진 값(판정 패널)이 정본이라 여기서 다시 계산하지 않는다.
import { buildRows, countStatuses, type JudgmentData, type StatusCounts } from "../../judgment/index.ts";
import type { Model } from "../state/commands.ts";

export interface StatusSummary {
  readonly masses: number;
  readonly maxLevel: number;
  readonly judgeMs: string | null;
  readonly engine: string | null;
  readonly rulePack: string;
}

/** 상태 바 값(순수). */
export function statusSummary(model: Model, data: JudgmentData | null): StatusSummary {
  let maxLevel = 0;
  for (const m of model.masses) for (const f of m.floors) maxLevel = Math.max(maxLevel, f.level);
  return {
    masses: model.masses.length,
    maxLevel,
    judgeMs: data?.elapsedMs === null || data?.elapsedMs === undefined ? null : `${Math.round(data.elapsedMs)}ms`,
    engine: data?.result.engine_version ?? null,
    rulePack: data?.result.rule_pack_version ?? model.rule_context.rule_pack_version,
  };
}

/** 판정 요약 한 줄(좁은 화면 하단 시트 접힘, 6.4절): 가장 나쁜 상태 + 개수. 판정 패널 머리 요약과 같은 함수(countStatuses)를 쓴다. */
export function verdictSummary(data: JudgmentData | null): { worst: "fail" | "warn" | "unverified" | "pass" | null } & StatusCounts {
  const c = data ? countStatuses(buildRows(data).quant) : { pass: 0, warn: 0, fail: 0, unverified: 0 };
  const worst = c.fail > 0 ? "fail" : c.warn > 0 ? "warn" : c.unverified > 0 ? "unverified" : c.pass > 0 ? "pass" : null;
  return { worst, ...c };
}

export function StatusBar({ summary, notice }: { summary: StatusSummary; notice: string | null }) {
  return (
    <footer className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-panel border border-line bg-surface px-3 py-2 text-caption text-fg-2 tabular-nums">
      <span>매스 {summary.masses}개</span>
      <span>지상 최고 {summary.maxLevel}층</span>
      <span>판정 {summary.judgeMs ?? "-"}</span>
      <span>엔진 {summary.engine ?? "-"}</span>
      <span>규칙 팩 {summary.rulePack || "-"}</span>
      <span className="text-fg-3">판정은 참고 자료입니다</span>
      {notice ? <span className="min-w-0 truncate text-fg">{notice}</span> : null}
    </footer>
  );
}
