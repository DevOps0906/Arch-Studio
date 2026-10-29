// 판정 패널 독립 미리보기(개발 전용 라우트 /dev/judgment, apps/desktop/src/routes/index.tsx가 import.meta.env.DEV일 때만 연결).
// 모델러(036)가 생기기 전에 패널을 따로 보기 위한 화면이다. 릴리스 번들에는 들어가지 않는다(check:release로 확인).
// 쿼리: ?state=ready(기본, 실제 엔진 출력: 전부 미확인) | fail | warn | fallback | stale | loading | refreshing | error | empty | nobasis
//       ?open=coverage-0,height-2(처음부터 펼칠 행)  ?project=1|2|3(데모 프로젝트 3개)  ?demo-license=fallback(폴백 배너, 셸 데모 URL과 같은 값)
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { FallbackNotice } from "./fallback.ts";
import { ENGINE_OUTPUTS, PREVIEW_TODAY, exampleConfirmed, toData, withMissingBasis } from "./fixtures.ts";
import { JudgmentPanel } from "./JudgmentPanel.tsx";
import type { JudgmentData } from "./model.ts";

const STATES = [
  ["ready", "미확인(실제 엔진 출력)"],
  ["fail", "기준 초과 포함([예시])"],
  ["warn", "확인 필요·통과 혼합([예시])"],
  ["fallback", "업데이트 만료 폴백"],
  ["stale", "개정 확인 필요"],
  ["loading", "로딩"],
  ["refreshing", "갱신 중"],
  ["error", "오류"],
  ["empty", "빈 상태(매스 없음)"],
  ["nobasis", "근거 없는 행 숨김"],
] as const;
type PreviewKey = (typeof STATES)[number][0];

const FALLBACK: FallbackNotice = { packVersion: "2026.10.0", basisDate: "2026-10-14", pendingChanges: 2 };

export function Component() {
  const [params] = useSearchParams();
  const raw = params.get("state");
  const state: PreviewKey = STATES.some(([k]) => k === raw) ? (raw as PreviewKey) : "ready";
  const projectIndex = Math.min(Math.max(Number(params.get("project") ?? "1") || 1, 1), ENGINE_OUTPUTS.length) - 1;
  const out = ENGINE_OUTPUTS[projectIndex] ?? ENGINE_OUTPUTS[0];
  const [note, setNote] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<readonly string[]>([]);
  if (!out) return null;

  const showFallback = state === "fallback" || params.get("demo-license") === "fallback";
  const pending = showFallback ? FALLBACK.pendingChanges ?? 0 : 0;

  let data: JudgmentData | null = toData(out, { pendingChanges: pending });
  let phase: "idle" | "loading" | "ready" | "error" = "ready";
  let hasMass = true;
  switch (state) {
    case "fail":
      data = exampleConfirmed(out, "fail");
      break;
    case "warn":
      data = exampleConfirmed(out, "warn");
      break;
    case "loading":
      data = null;
      phase = "loading";
      break;
    case "refreshing":
      phase = "loading";
      break;
    case "error":
      data = null;
      phase = "error";
      break;
    case "empty":
      data = null;
      phase = "idle";
      hasMass = false;
      break;
    case "nobasis":
      data = withMissingBasis(data);
      break;
    default:
      break;
  }

  return (
    <main className="min-h-dvh bg-bg p-pad text-fg">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-gap xl:flex-row">
        <div className="flex w-full min-w-0 flex-col gap-gap md:max-w-md xl:shrink-0">
          <h1 className="text-h1 font-semibold text-fg">판정 패널 (개발용)</h1>
          <JudgmentPanel
            phase={phase}
            data={data}
            errorCode={state === "error" ? "AR050" : null}
            onRetry={() => setNote("다시 시도를 눌렀습니다.")}
            hasMass={hasMass}
            massIds={out.massIds}
            onHighlight={(ids) => setHighlighted(ids)}
            fallback={showFallback ? FALLBACK : null}
            onShowRevisions={() => setNote("개정 목록 시트는 044·규칙 팩 API 연결 때 붙습니다.")}
            onExtendUpdates={() => setNote("업데이트 연장은 라이선스 화면(044)으로 이어집니다.")}
            defaultExpanded={(params.get("open") ?? "").split(",").filter(Boolean)}
            revisionCheck={state === "stale" ? { lastCheckedAt: "2026-09-20", today: PREVIEW_TODAY, onCheck: () => setNote("개정 확인을 눌렀습니다.") } : null}
          />
        </div>
        <aside className="flex min-w-0 flex-1 flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
          <h2 className="text-h2 font-semibold text-fg">상태 전환</h2>
          <ul className="flex flex-wrap gap-2">
            {STATES.map(([key, label]) => (
              <li key={key}>
                <Link
                  to={`?state=${key}&project=${projectIndex + 1}`}
                  aria-current={state === key ? "page" : undefined}
                  className="focus-ring inline-flex min-h-control-sm items-center rounded-control border border-line px-2 text-caption text-fg-2 aria-[current=page]:bg-raised aria-[current=page]:font-semibold aria-[current=page]:text-fg"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-caption text-fg-2">데모 프로젝트: {[1, 2, 3].map((n) => (
            <Link key={n} to={`?state=${state}&project=${n}`} className="focus-ring mr-2 text-info underline">
              {n}
            </Link>
          ))}</p>
          <p className="text-caption text-fg-2">강조 요청 매스: {highlighted.length > 0 ? highlighted.join(", ") : "없음"}</p>
          {note ? (
            <p role="status" className="text-caption text-fg-2">
              {note}
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
