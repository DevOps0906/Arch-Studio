import { Banner, Button, Select } from "@arch-studio/ui";
import { useEffect, useState } from "react";
import type { CostCatalog } from "@arch-studio/program";
import { useApi, useOnline, useSession } from "../shell/index.ts";
import { estimateRows, parseCatalog } from "./catalog.ts";
import type { DraftRow } from "./model.ts";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; catalog: CostCatalog; orgId: string };
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export function CostPanel({ rows }: { rows: readonly DraftRow[] }) {
  const api = useApi();
  const online = useOnline();
  const { state: session } = useSession();
  const orgId = session.kind === "ready" ? session.session.org?.id : undefined;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [structure, setStructure] = useState("");
  const [grade, setGrade] = useState("");
  useEffect(() => {
    if (!online || !orgId) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    api.request({ method: "GET", path: "/api/cost-catalogs/latest", parse: parseCatalog, signal: controller.signal }).then(
      (catalog) => { if (!controller.signal.aborted) setState(catalog ? { kind: "ready", catalog, orgId } : { kind: "missing" }); },
      () => { if (!controller.signal.aborted) setState({ kind: "error" }); },
    );
    return () => controller.abort();
  }, [api, online, orgId, attempt]);
  // 조직 변경 시 effect 실행 전 렌더에서도 이전 조직의 단가를 표시하지 않는다.
  const view = state.kind === "ready" && state.orgId !== orgId ? { kind: "loading" as const } : state;
  return <section className="flex flex-col gap-gap rounded-panel border border-line bg-surface p-pad" aria-labelledby="program-cost">
    <h2 id="program-cost" className="text-h2 font-semibold">개략 공사비</h2>
    {!online ? <p className="text-body text-fg-2">인터넷에 연결하면 최신 단가를 조회할 수 있습니다.</p> : !orgId ? <p className="text-body text-fg-2">로그인 후 조직의 단가 이용 권한을 확인할 수 있습니다.</p> : view.kind === "loading" ? <p role="status">단가를 불러오는 중입니다.</p> : view.kind === "error" ? <Banner tone="warn" title="단가를 불러오지 못했습니다" action={<Button onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}>면적표 입력은 계속할 수 있습니다.</Banner> : view.kind === "missing" || !view.catalog.items.length ? <p className="text-body text-fg-2">이용 가능한 단가 자료가 없습니다. 출처와 기준일이 확인된 단가표를 연결하면 공사비를 계산할 수 있습니다.</p> : <Estimate key={`${orgId}:${view.catalog.version}`} catalog={view.catalog} rows={rows} structure={structure} grade={grade} setStructure={setStructure} setGrade={setGrade} />}
  </section>;
}

function Estimate({ catalog, rows, structure, grade, setStructure, setGrade }: {
  catalog: CostCatalog; rows: readonly DraftRow[]; structure: string; grade: string;
  setStructure(value: string): void; setGrade(value: string): void;
}) {
  const structures = [...new Set(catalog.items.map((i) => i.structure))];
  const selected = structures.includes(structure) ? structure : structures[0]!;
  const grades = [...new Set(catalog.items.filter((i) => i.structure === selected).map((i) => i.finish_grade))];
  const selectedGrade = grades.includes(grade) ? grade : grades[0]!;
  const result = estimateRows(catalog, selected, selectedGrade, rows);
  return <>
    <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
      <label>구조<Select value={selected} onChange={(e) => setStructure(e.currentTarget.value)}>{structures.map((s) => <option key={s}>{s}</option>)}</Select></label>
      <label>마감 등급<Select value={selectedGrade} onChange={(e) => setGrade(e.currentTarget.value)}>{grades.map((s) => <option key={s}>{s}</option>)}</Select></label>
    </div>
    <p className="text-caption text-fg-3">단가 기준일 {catalog.basis_date} · 버전 {catalog.version}</p>
    <p className="break-words text-caption text-fg-3">출처: {catalog.source_note}</p>
    {result.kind !== "ready" ? <p className="text-body text-fg-2">{result.kind === "empty" ? "실과 목표 면적을 입력하면 공사비를 계산합니다." : result.kind === "invalid" ? "면적표 입력을 확인하세요." : "입력값이 계산 가능한 범위를 넘었습니다. 면적과 단가를 확인하세요."}</p> : result.estimate.unpriced_rows.length ? <Banner tone="warn" title="일부 실의 단가가 없습니다">{result.estimate.unpriced_rows.join(", ")} — 모든 실의 단가가 있어야 전체 합계를 표시합니다.</Banner> : <dl className="grid grid-cols-1 gap-2 text-body md:grid-cols-3">
      <div><dt>공급가액</dt><dd>{won(result.estimate.supply_won)}</dd></div>
      <div><dt>부가세</dt><dd>{won(result.estimate.vat_won)}</dd></div>
      <div><dt>합계(부가세 포함)</dt><dd className="font-semibold">{won(result.estimate.total_won)}</dd></div>
    </dl>}
    <p className="text-caption text-fg-3">목표 면적과 선택한 단가에 따른 개략 추정입니다. 실제 견적과 다를 수 있습니다.</p>
  </>;
}

