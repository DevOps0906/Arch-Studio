// `/projects/:id/program` 체크리스트·면적표·개략 공사비(03장 3.6절, 2.3절). 소유: AR-06-038(program/**, intake/ 제외).
// 대화형 입력 패널은 program/intake/**(AR-06-052). 면적 계산은 packages/program 결정적 함수만(LLM 좌표·수치 금지).
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { Banner, Button, Checkbox, Input } from "@arch-studio/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { DENY_TEXT, EmptyBlock, ErrorState, LoadingState, PageHeader, bridgeErrorCode, bridgeErrorText,
  useAdapters, useCapabilities, useEntitlement, useProject, useShellStatus } from "../shell/index.ts";
import { draftRows, parseModel, validateRows, withRows, type DraftRow } from "./model.ts";
import { CostPanel } from "./CostPanel.tsx";

export function Screen() {
  const { load, reload } = useProject();
  if (load.status === "loading") return <LoadingState label="프로그램을 불러오는 중" />;
  if (load.status !== "ready") return <ErrorState title="프로젝트를 불러오지 못했습니다" onRetry={reload} />;
  return <ProgramScreen key={`${load.record.id}:${load.record.version}`} record={load.record} />;
}

function ProgramScreen({ record }: { record: ProjectRecord }) {
  const model = useMemo(() => parseModel(record.designModel), [record.designModel]);
  const initial = useMemo(() => model ? draftRows(model) : [], [model]);
  const [rows, setRows] = useState<DraftRow[]>(initial);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const { projects } = useAdapters();
  const { reload } = useProject();
  const { by } = useCapabilities();
  const decision = useEntitlement(by("localProjects", "desktop_edit", "web_edit"));
  const editable = decision?.allowed === true && !saving && !conflict;
  const { setSaveLabel } = useShellStatus();
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const issue = validateRows(rows);
  useEffect(() => {
    setSaveLabel(dirty ? "저장하지 않은 변경 있음" : null);
    return () => setSaveLabel(null);
  }, [dirty, setSaveLabel]);
  function change(index: number, value: Partial<DraftRow>) {
    if (editable) setRows((current) => current.map((row, i) => i === index ? { ...row, ...value, locked: value.locked ?? true } : row));
  }
  async function save() {
    if (!editable || !dirty || issue || !model || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await projects.save({ id: record.id, name: record.name, siteLabel: record.siteLabel,
        clientName: record.clientName, clientContact: record.clientContact,
        schemaVersion: record.schemaVersion, engineVersion: record.engineVersion,
        designModel: JSON.stringify(withRows(model, rows)), note: "프로그램 면적표 수정", expectedVersion: record.version });
      reload();
    } catch (e) {
      if (bridgeErrorCode(e) === "VERSION_CONFLICT") setConflict(true);
      else setError(bridgeErrorText(e));
    } finally { busy.current = false; setSaving(false); }
  }
  if (!model) return <ErrorState title="설계 모델을 읽지 못했습니다" description="프로젝트 목록에서 다시 열거나 백업에서 복구하세요." onRetry={reload} />;
  return (
    <div className="flex min-w-0 flex-col gap-gap">
      <PageHeader title="프로그램" description="실별 목표 면적과 요구 사항을 확인합니다." actions={<Button variant="primary" disabled={!editable || !dirty || issue !== null} loading={saving} onClick={() => void save()}>저장</Button>} />
      {decision && !decision.allowed ? <Banner tone="info" title="열람 모드">{DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}</Banner> : null}
      {conflict ? <ErrorState title="다른 곳에서 프로젝트가 변경되었습니다" description="최신 버전을 다시 열면 저장하지 않은 입력은 사라집니다." action={<Button onClick={reload}>최신 버전 다시 열기</Button>} /> : null}
      {error ? <ErrorState title="면적표를 저장하지 못했습니다" description={error} onRetry={() => void save()} /> : null}
      <section className="rounded-panel border border-line bg-surface p-pad" aria-labelledby="program-checklist">
        <h2 id="program-checklist" className="text-h2 font-semibold">요구 체크리스트</h2>
        {Object.keys(model.program.checklist_answers).length ? <dl className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{Object.entries(model.program.checklist_answers).map(([key, value]) => <div key={key} className="min-w-0 break-words"><dt className="text-caption text-fg-3">{key}</dt><dd className="text-body">{Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? value ? "예" : "아니요" : String(value)}</dd></div>)}</dl> : <p className="mt-2 text-body text-fg-2">저장된 요구 사항이 없습니다.</p>}
        <p className="mt-3 text-caption text-fg-3">체크리스트 자동 계산 기준은 준비 중입니다. 면적표는 직접 입력할 수 있습니다.</p>
      </section>
      <section className="flex flex-col gap-gap" aria-labelledby="program-targets">
        <h2 id="program-targets" className="text-h2 font-semibold">목표 면적표</h2>
        <p className="text-caption text-fg-2">직접 수정한 행은 자동으로 잠깁니다. 잠긴 행은 향후 자동 재계산에서도 유지됩니다.</p>
        {rows.length ? <div className="flex flex-col gap-gap">{rows.map((row, index) => <fieldset key={index} disabled={!editable} className="grid min-w-0 grid-cols-1 gap-gap rounded-panel border border-line bg-surface p-pad md:grid-cols-2 xl:grid-cols-4">
          <legend className="text-caption">실 {index + 1}</legend>
          <label className="text-body">실 이름<Input value={row.name} onChange={(e) => change(index, { name: e.currentTarget.value })} /></label>
          <label className="text-body">용도<Input value={row.use} onChange={(e) => change(index, { use: e.currentTarget.value })} /></label>
          <label className="text-body">목표 면적(㎡)<Input inputMode="decimal" value={row.area} onChange={(e) => change(index, { area: e.currentTarget.value })} /></label>
          <div className="flex items-center gap-gap"><Checkbox label="행 잠금" checked={row.locked} onChange={(e) => change(index, { locked: e.currentTarget.checked })} /><Button size="sm" onClick={() => editable && setRows((current) => current.filter((_, i) => i !== index))}>삭제</Button></div>
        </fieldset>)}</div> : <EmptyBlock icon="inbox" title="면적표가 비어 있습니다" description="실 추가를 눌러 목표 면적을 직접 입력하세요." />}
        {issue ? <Banner tone="warn" title="입력 확인">{issue}</Banner> : null}
        <div><Button disabled={!editable} onClick={() => editable && setRows((current) => [...current, { name: "", use: "", area: "", locked: true }])}>실 추가</Button></div>
      </section>
      <CostPanel rows={rows} />
    </div>
  );
}
