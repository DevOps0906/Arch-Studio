// 스파이크 자동 점검: ?auto=1 로 시작하면 projects -> (Link 클릭) site -> (navigate) plans 를 지나 결과를 /__result 로 보낸다.
const KEY = "spike-smoke";
type Step = { at: string; pathname: string; params: unknown; data: unknown; href: string };

/** 이번 호출에서 점검을 시작했으면 true(한 번만 클릭하도록) */
export function smokeStart(search: URLSearchParams): boolean {
  if (search.get("auto") !== "1" || sessionStorage.getItem(KEY) !== null || sessionStorage.getItem(KEY + "-done")) return false;
  sessionStorage.setItem(KEY, JSON.stringify({ steps: [] }));
  return true;
}
export function smokeActive(): boolean {
  return sessionStorage.getItem(KEY) !== null;
}
export function smokeStep(step: Omit<Step, "href">) {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return;
  const s = JSON.parse(raw) as { steps: Step[] };
  s.steps.push({ ...step, href: location.href });
  sessionStorage.setItem(KEY, JSON.stringify(s));
}
export function smokeFinish() {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return;
  sessionStorage.removeItem(KEY);
  sessionStorage.setItem(KEY + "-done", "1");
  // 지연 청크가 실제로 이동 시점에 받아졌는지 보려고 리소스 시각을 함께 보낸다.
  const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const scripts = res
    .filter((r) => r.initiatorType === "script" || r.initiatorType === "link" || new URL(r.name).pathname.endsWith(".js"))
    .map((r) => ({ name: new URL(r.name).pathname, start: Math.round(r.startTime), type: r.initiatorType }));
  const fetches = res.filter((r) => r.initiatorType === "fetch").map((r) => new URL(r.name).pathname + new URL(r.name).search);
  const domContentLoaded = Math.round((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domContentLoadedEventEnd);
  void fetch("/__result", { method: "POST", body: JSON.stringify({ ...JSON.parse(raw), scripts, fetches, domContentLoaded, documentNavigations: performance.getEntriesByType("navigation").length }) });
}
