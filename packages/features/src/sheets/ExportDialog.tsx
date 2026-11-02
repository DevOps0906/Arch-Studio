// 내보내기 대화상자(03장 3.8절 ExportDialog): 시트 · 형식(DXF·PDF·SVG·PNG) · 레이어 이름 → 저장.
// 0 크레딧·오프라인. 저장 위치는 OS 저장 대화상자(파일마다)가 정하며 화면은 경로를 받지 않는다(FileGateway.save).
// 상태 4종: 로딩(권한 판정 중·내보내는 중) · 빈(내보낼 시트 없음) · 오류(만들기·저장 실패 문구) · 권리 거부(view_export 거부 → 잠금).
import { Banner, Button, Checkbox, Dialog } from "@arch-studio/ui";
import { useEffect, useId, useState } from "react";
import { LoadingState, LockedState } from "../shell/index.ts";
import type { ExportOutcome, ExportProgress } from "./runner.ts";
import { AR057_TEXT, FORMAT_LABEL, FORMAT_ORDER, fileCount, orphanNotice, outputErrorText, type OutputFormat, type SheetAccess } from "./model.ts";

export interface ExportItem {
  readonly id: string;
  readonly name: string;
}

export interface ExportSelection {
  readonly ids: readonly string[];
  readonly formats: readonly OutputFormat[];
  readonly layerNames: "office" | "standard";
}

/** 시트를 만든 뒤 내보낸다. 시트를 만들지 못하면 buildFailed(코드)로 돌려준다. */
export type ExportRun = { kind: "done"; outcome: ExportOutcome } | { kind: "build_failed"; code: string };

export interface ExportDialogProps {
  open: boolean;
  onClose(): void;
  items: readonly ExportItem[];
  /** 대화상자를 열 때 먼저 체크할 시트(선택한 시트). */
  initialIds: readonly string[];
  access: SheetAccess;
  png: { ok: true } | { ok: false; reason: string };
  /** 사무소 레이어 매핑이 있는가(없으면 "표준 이름"만 의미가 있다). */
  hasOfficeMap: boolean;
  /** 시트 id별 고아 주석 수(미리보기로 만든 시트만 안다). 고른 시트에 있으면 "출력에서 빠집니다" 안내(막지 않는다, 03장 9.6절). */
  orphans?: Readonly<Record<string, number>>;
  onRun(sel: ExportSelection, onProgress: (p: ExportProgress) => void): Promise<ExportRun>;
}

type Phase = { kind: "form" } | { kind: "running"; progress: ExportProgress | null } | { kind: "result"; run: ExportRun };

export function ExportDialog(p: ExportDialogProps) {
  const id = useId();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [formats, setFormats] = useState<Set<OutputFormat>>(new Set<OutputFormat>(["dxf", "pdf"]));
  const [layerNames, setLayerNames] = useState<"office" | "standard">("office");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  // 열 때마다 처음 상태로(선택한 시트만 체크).
  useEffect(() => {
    if (p.open) {
      setIds(new Set(p.initialIds.filter((x) => p.items.some((i) => i.id === x))));
      setPhase({ kind: "form" });
    }
    // 열릴 때만 초기화한다(시트 목록이 바뀌어도 사용자의 체크를 되돌리지 않는다).
  }, [p.open]);

  const pngOk = p.png.ok;
  const chosenFormats = FORMAT_ORDER.filter((f) => formats.has(f) && (f !== "png" || pngOk));
  const chosenIds = p.items.filter((i) => ids.has(i.id)).map((i) => i.id);
  const total = fileCount(chosenFormats, chosenIds.length);
  const orphanText = orphanNotice(p.orphans, chosenIds);
  const busy = phase.kind === "running";

  const toggle = <T,>(set: Set<T>, v: T, on: boolean): Set<T> => {
    const n = new Set(set);
    if (on) n.add(v);
    else n.delete(v);
    return n;
  };

  async function run() {
    setPhase({ kind: "running", progress: null });
    const result = await p.onRun({ ids: chosenIds, formats: chosenFormats, layerNames }, (progress) => setPhase({ kind: "running", progress }));
    setPhase({ kind: "result", run: result });
  }

  const denied = p.access.exportState === "denied";
  const pending = p.access.exportState === "pending";
  const empty = p.items.length === 0;

  const footer =
    phase.kind === "result" ? (
      <Button variant="primary" onClick={p.onClose}>
        닫기
      </Button>
    ) : (
      <>
        <Button variant="ghost" onClick={p.onClose} disabled={busy}>
          취소
        </Button>
        <Button variant="primary" icon="download" loading={busy} disabled={denied || pending || empty || total === 0} onClick={() => void run()}>
          {total > 0 ? `내보내기(${total}개)` : "내보내기"}
        </Button>
      </>
    );

  return (
    <Dialog open={p.open} onClose={() => (busy ? undefined : p.onClose())} title="도면 내보내기" description="0 크레딧. 이 PC에서 만들며 인터넷 연결이 필요 없습니다." footer={<div className="flex flex-wrap justify-end gap-2">{footer}</div>}>
      <div className="flex flex-col gap-gap" aria-live="polite">
        {denied ? (
          <LockedState title="내보내기를 쓸 수 없습니다" reason={p.access.exportReason ?? "내보내기 권한을 확인하지 못했습니다."} />
        ) : pending ? (
          <LoadingState label="내보내기 권한을 확인하는 중" rows={2} />
        ) : empty ? (
          <p className="text-body text-fg-2">내보낼 시트가 없습니다. 시트를 먼저 만드세요.</p>
        ) : phase.kind === "running" ? (
          <RunningView progress={phase.progress} />
        ) : phase.kind === "result" ? (
          <ResultView run={phase.run} />
        ) : (
          <>
            {p.access.watermark ? (
              <Banner tone="warn" title="체험판 표시">
                표제란에 "체험판"이 표시됩니다. 라이선스나 구독이 있으면 표시되지 않습니다.
              </Banner>
            ) : null}
            {orphanText ? <p className="text-caption text-fg-2">{orphanText}</p> : null}
            {p.access.viewOnly ? <p className="text-caption text-fg-2">편집 권한이 없어 마지막으로 만든 시트를 다시 내보내기만 됩니다.</p> : null}
            <fieldset className="flex flex-col gap-1">
              <legend className="text-caption font-medium text-fg-2">시트</legend>
              {p.items.map((i) => (
                <Checkbox key={i.id} label={i.name} checked={ids.has(i.id)} onChange={(e) => setIds(toggle(ids, i.id, e.target.checked))} />
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-caption font-medium text-fg-2">형식</legend>
              {FORMAT_ORDER.map((f) => {
                const off = f === "png" && !pngOk;
                return (
                  <div key={f} className="flex flex-col">
                    <Checkbox label={FORMAT_LABEL[f]} checked={formats.has(f) && !off} disabled={off} aria-describedby={off ? `${id}-png-why` : undefined} onChange={(e) => setFormats(toggle(formats, f, e.target.checked))} />
                    {off && !p.png.ok ? (
                      <p id={`${id}-png-why`} className="pl-6 text-caption text-fg-3">
                        {p.png.reason}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-caption font-medium text-fg-2">레이어 이름(DXF)</legend>
              <label className="inline-flex items-center gap-2 text-body text-fg">
                <input type="radio" name={`${id}-layer`} className="focus-ring size-4 accent-accent" checked={layerNames === "office"} onChange={() => setLayerNames("office")} />
                사무소 매핑{p.hasOfficeMap ? "" : "(설정한 이름이 없어 표준 이름과 같습니다)"}
              </label>
              <label className="inline-flex items-center gap-2 text-body text-fg">
                <input type="radio" name={`${id}-layer`} className="focus-ring size-4 accent-accent" checked={layerNames === "standard"} onChange={() => setLayerNames("standard")} />
                표준 이름
              </label>
            </fieldset>
            <p className="text-caption text-fg-3">저장 위치는 파일마다 열리는 저장 대화상자에서 고릅니다.</p>
            {total > 0 && chosenFormats.length > 0 ? <p className="text-caption text-fg-2">만들 파일 {total}개</p> : <p className="text-caption text-fg-3">시트와 형식을 하나 이상 고르세요.</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

function RunningView({ progress }: { progress: ExportProgress | null }) {
  const label = !progress ? "내보내는 중" : progress.phase === "make" ? `${FORMAT_LABEL[progress.format]} 만드는 중` : `${FORMAT_LABEL[progress.format]} 저장하는 중 · 저장한 파일 ${progress.saved}개`;
  return <LoadingState label={label} rows={2} />;
}

function ResultView({ run }: { run: ExportRun }) {
  if (run.kind === "build_failed") {
    return (
      <Banner tone="danger" title="시트를 만들지 못했습니다">
        {outputErrorText(run.code)}
      </Banner>
    );
  }
  const { outcome } = run;
  const hasAr057 = outcome.warnings.some((w) => w.code === "AR057");
  return (
    <div className="flex flex-col gap-gap">
      {outcome.saved > 0 ? (
        <Banner tone={outcome.failures.length > 0 || outcome.canceled ? "warn" : "ok"} title={`${outcome.saved}개 파일을 내보냈습니다`}>
          {outcome.canceled ? "저장 대화상자를 닫아 나머지는 저장하지 않았습니다." : outcome.failures.length > 0 ? "일부 형식은 만들지 못했습니다." : "저장한 위치의 파일을 확인하세요."}
        </Banner>
      ) : outcome.canceled ? (
        <Banner tone="info" title="저장을 취소했습니다">
          파일을 저장하지 않았습니다.
        </Banner>
      ) : null}
      {outcome.failures.map((f) => (
        <Banner key={f.format + f.code} tone="danger" title={`${FORMAT_LABEL[f.format]} 실패`}>
          {outputErrorText(f.code, f.format)}
        </Banner>
      ))}
      {hasAr057 ? (
        <Banner tone="warn" title="글꼴 안내">
          {AR057_TEXT}
        </Banner>
      ) : null}
    </div>
  );
}
