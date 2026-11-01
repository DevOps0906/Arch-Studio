// /projects 대화상자: 새 프로젝트·이름 바꾸기·삭제 확인·저장 충돌(2선택). ui Dialog(네이티브 <dialog>, 포커스 가둠·Esc).
// 입력 검증은 new-project.ts(순수), 문구는 messages.ts. 저장 호출은 index.tsx가 한다(여기는 값만 올린다).
import { Banner, Button, Dialog, Field, Input, Select } from "@arch-studio/ui";
import { useId, useState, type FormEvent } from "react";
import { LOOKUP_TEXT } from "../site/access.ts";
import type { LookupKind, LookupOutcome } from "../site/lookup.ts";
import { formatM } from "../site/model.ts";
import { TEXT } from "./messages.ts";
import { applyLookupFill, NO_FILL, summarizeLookup, type LookupFill, type LookupSummary } from "./site-lookup.ts";
import { SitePreview } from "./SitePreview.tsx";
import { EMPTY_FORM, NAME_MAX_CHARS, USE_DISTRICTS, validateName, validateNewProject, type FormErrors, type NewProjectForm, type NewProjectValues } from "./new-project.ts";

/** 새 프로젝트 창의 대지 조회 연결(index.tsx가 useApi·권리·온라인으로 만든다). 없으면 조회 칸을 그리지 않는다. */
export interface SiteLookupPort {
  /** siteAccess().lookup: ok면 조회, offline·locked면 버튼 잠금 + 안내. */
  readonly state: "ok" | "offline" | "locked";
  readonly run: (kind: NewLookupKind, value: string) => Promise<LookupOutcome>;
}

export type NewLookupKind = Extract<LookupKind, "jibun" | "address">;
type LookupView = { status: "idle" } | { status: "loading" } | { status: "done"; summary: LookupSummary } | { status: "failed"; message: string };

const LOOKUP_KIND_LABEL: Readonly<Record<NewLookupKind, string>> = { jibun: "지번", address: "도로명 주소" };
const LOOKUP_PLACEHOLDER: Readonly<Record<NewLookupKind, string>> = { jibun: "예: 성남시 분당구 운중동 12-4", address: "예: 경기도 성남시 분당구 운중로 135" };
const LOOKUP_LOCKED = "편집 권리가 확인되어야 대지를 조회합니다. 가로·세로를 직접 넣으세요.";

export function NewProjectDialog({
  open,
  busy,
  error,
  lookup,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  lookup?: SiteLookupPort;
  onClose: () => void;
  onSubmit: (values: NewProjectValues) => void;
}) {
  const id = useId();
  // 폼과 "조회가 채운 값"을 한 상태로 둔다(갱신 함수가 순수하게 둘을 같이 바꾸게).
  const [state, setState] = useState<{ form: NewProjectForm; fill: LookupFill }>({ form: EMPTY_FORM, fill: NO_FILL });
  const form = state.form;
  const setForm = (fn: (f: NewProjectForm) => NewProjectForm) => setState((st) => ({ ...st, form: fn(st.form) }));
  /** 조회 결과 반영·되돌리기(applyLookupFill): 이전 조회가 채운 값만 바꾸고 사용자가 고친 값은 둔다. */
  const refill = (s: LookupSummary | null) => setState((st) => applyLookupFill(st.form, st.fill, s));
  const [errors, setErrors] = useState<FormErrors>({});
  const [kind, setKind] = useState<NewLookupKind>("jibun");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LookupView>({ status: "idle" });
  const summary = view.status === "done" ? view.summary : null;
  const lookupLocked = !lookup || lookup.state !== "ok";
  const runLookup = async () => {
    if (!lookup || lookup.state !== "ok" || view.status === "loading") return;
    setView({ status: "loading" });
    const r = await lookup.run(kind, query);
    if (!r.ok) {
      setView({ status: "failed", message: r.failure.message });
      refill(null);
      return;
    }
    const s = summarizeLookup(r.candidate, r.data.notice);
    setView({ status: "done", summary: s });
    refill(s);
  };
  /** 조회 결과를 버린다(결과 지우기·조회 종류·입력값 변경): 이전 필지로 만들지 않게. */
  const dropResult = () => {
    if (view.status === "loading") return;
    if (view.status !== "idle") setView({ status: "idle" });
    if (view.status === "done") refill(null);
  };
  // 값은 이벤트 처리 중에 읽는다(갱신 함수 안에서는 currentTarget이 이미 null).
  const set = (k: keyof NewProjectForm) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [k]: value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (view.status === "loading") return;
    const r = validateNewProject(form, summary);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    onSubmit(r.values);
  };
  const close = () => {
    setState({ form: EMPTY_FORM, fill: NO_FILL });
    setErrors({});
    setQuery("");
    setView({ status: "idle" });
    onClose();
  };
  const describedBy = (k: keyof NewProjectForm) => (errors[k] ? `${id}-${k}-error` : `${id}-${k}-hint`);
  return (
    <Dialog
      open={open}
      onClose={close}
      title={TEXT.newProject}
      description="이름과 대지 정보만 넣으면 이 PC에 새 프로젝트를 만듭니다. 대지 경계는 대지 탭에서 고칩니다."
      footer={
        <>
          <Button onClick={close}>취소</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy} disabled={view.status === "loading"}>
            {summary ? "이 대지로 만들기" : "만들기"}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="만들지 못했습니다">{error}</Banner> : null}
        <Field label="프로젝트 이름" htmlFor={`${id}-name`} hint={`${NAME_MAX_CHARS}자까지`} {...(errors.name ? { error: errors.name } : {})}>
          <Input id={`${id}-name`} value={form.name} onChange={set("name")} required autoComplete="off" invalid={!!errors.name} aria-describedby={describedBy("name")} />
        </Field>
        <Field label="대지 이름(주소·지번, 선택)" htmlFor={`${id}-siteLabel`} hint="목록에 보이는 이름입니다" {...(errors.siteLabel ? { error: errors.siteLabel } : {})}>
          <Input id={`${id}-siteLabel`} value={form.siteLabel} onChange={set("siteLabel")} autoComplete="off" invalid={!!errors.siteLabel} aria-describedby={describedBy("siteLabel")} />
        </Field>
        {lookup ? (
          <section aria-labelledby={`${id}-lookup-title`} className="flex flex-col gap-2 rounded-panel border border-line p-pad">
            <h3 id={`${id}-lookup-title`} className="text-body font-semibold text-fg">
              대지 조회(선택)
            </h3>
            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <Field label="찾는 방법" htmlFor={`${id}-lookup-kind`} className="md:w-32">
                <Select id={`${id}-lookup-kind`} value={kind} disabled={lookupLocked || view.status === "loading"} onChange={(e) => {
                    setKind(e.currentTarget.value as NewLookupKind);
                    dropResult();
                  }}
                >
                  {(Object.keys(LOOKUP_KIND_LABEL) as NewLookupKind[]).map((k) => (
                    <option key={k} value={k}>
                      {LOOKUP_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="지번·도로명" htmlFor={`${id}-lookup-value`} className="min-w-0 flex-1">
                <Input
                  id={`${id}-lookup-value`}
                  value={query}
                  maxLength={200}
                  autoComplete="off"
                  placeholder={LOOKUP_PLACEHOLDER[kind]}
                  disabled={lookupLocked || view.status === "loading"}
                  onChange={(e) => {
                    setQuery(e.currentTarget.value);
                    dropResult();
                  }}
                  onKeyDown={(e) => {
                    // 조회 칸의 Enter는 프로젝트 만들기가 아니라 조회다.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runLookup();
                    }
                  }}
                />
              </Field>
              <Button icon="send" loading={view.status === "loading"} disabled={lookupLocked || query.trim() === ""} onClick={() => void runLookup()}>
                조회
              </Button>
            </div>
            {lookup.state === "offline" ? <p className="text-caption text-fg-2">{LOOKUP_TEXT.offline}</p> : null}
            {lookup.state === "locked" ? <p className="text-caption text-fg-2">{LOOKUP_LOCKED}</p> : null}
            {view.status === "failed" ? (
              <Banner tone="warn" title="대지를 불러오지 못했습니다">
                {view.message} 아래 가로·세로를 직접 넣어 만들 수 있습니다.
              </Banner>
            ) : null}
            {summary ? <LookupResult summary={summary} onClear={dropResult} /> : null}
          </section>
        ) : null}
        <Field
          label="용도지역"
          htmlFor={`${id}-useDistrict`}
          hint={
            summary?.useDistrict
              ? `조회 값(지적도 기준, 입력 후보): ${summary.useDistrict}`
              : summary
                ? `조회한 용도지역${summary.useDistrictText ? `(${summary.useDistrictText})` : ""}을 목록에서 쓸 수 없습니다. 직접 고르세요.`
                : "판정 기준을 고르는 데 씁니다"
          }
          {...(errors.useDistrict ? { error: errors.useDistrict } : {})}
        >
          <Select id={`${id}-useDistrict`} value={form.useDistrict} onChange={set("useDistrict")} required invalid={!!errors.useDistrict} aria-describedby={describedBy("useDistrict")}>
            <option value="">고르세요</option>
            {USE_DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        {summary ? null : (
          <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
            <Field label="대지 가로" htmlFor={`${id}-widthM`} hint="임시 직사각형 대지" {...(errors.widthM ? { error: errors.widthM } : {})}>
              <Input id={`${id}-widthM`} inputMode="decimal" suffix="m" value={form.widthM} onChange={set("widthM")} required invalid={!!errors.widthM} aria-describedby={describedBy("widthM")} />
            </Field>
            <Field label="대지 세로" htmlFor={`${id}-depthM`} hint="대지 탭에서 실제 경계로 바꿉니다" {...(errors.depthM ? { error: errors.depthM } : {})}>
              <Input id={`${id}-depthM`} inputMode="decimal" suffix="m" value={form.depthM} onChange={set("depthM")} required invalid={!!errors.depthM} aria-describedby={describedBy("depthM")} />
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** 조회 결과: 경계 그림 + 주소·PNU·용도지역·면적·가로·세로. 값은 입력 후보(판정 기준 아님). */
export function LookupResult({ summary, onClear }: { summary: LookupSummary; onClear: () => void }) {
  const rows: [string, string][] = [
    ["주소", summary.site.addressLabel ?? "조회한 필지"],
    ["PNU", summary.site.pnu ?? "-"],
    ["용도지역(지적도 기준)", summary.useDistrictText ?? "가져오지 못함 — 아래에서 고르세요"],
    ["대지 면적", `${summary.areaText}㎡`],
    ["가로", `${formatM(summary.widthMm)}m`],
    ["세로", `${formatM(summary.depthMm)}m`],
  ];
  return (
    <div className="flex flex-col gap-2">
      <SitePreview outer={summary.site.outer} rect={summary.rect} widthMm={summary.widthMm} depthMm={summary.depthMm} />
      <dl className="grid grid-cols-1 gap-x-gap gap-y-1 text-caption md:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <dt className="text-fg-3">{k}</dt>
            <dd className="break-words text-fg tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-fg-2">가로·세로는 경계를 감싸는 가장 작은 직사각형의 두 변입니다. {summary.notice}</p>
      {summary.notes.length > 0 ? (
        <ul className="list-disc pl-5 text-caption text-fg-2">
          {summary.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button size="sm" variant="ghost" onClick={onClear}>
          조회 결과 지우고 직접 입력
        </Button>
      </div>
    </div>
  );
}

export function RenameDialog({
  open,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateName(name);
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    onSubmit(name.trim());
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="이름 바꾸기"
      description="새 이름은 새 버전으로 저장됩니다."
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="저장하지 못했습니다">{error}</Banner> : null}
        <Field label="프로젝트 이름" htmlFor={`${id}-name`} hint={`${NAME_MAX_CHARS}자까지`} {...(fieldError ? { error: fieldError } : {})}>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" invalid={!!fieldError} />
        </Field>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({
  open,
  name,
  version,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  version: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={TEXT.deleteTitle}
      description={TEXT.deleteBody}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            삭제
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="삭제하지 못했습니다">{error}</Banner> : null}
        <p className="text-body text-fg">
          <span className="font-semibold">{name}</span> <span className="text-fg-2">· 지금 버전 v{version}</span>
        </p>
        <p className="text-caption text-fg-2">목록에서 본 뒤 다른 곳에서 저장되었다면 삭제하지 않고 알립니다.</p>
      </div>
    </Dialog>
  );
}

/**
 * 저장 충돌(VERSION_CONFLICT·AR041) 대화상자 골격: 두 선택만(ADR-001 3장, 03장 5.2절). "두 버전 비교" 화면은 없다.
 * kind=cloud면 "서버 최신 열기", local이면 "저장된 최신 열기"(로컬 저장소에 서버가 없어서 이름만 바꾼다).
 */
export function ConflictDialog({
  open,
  kind,
  name,
  busy,
  error,
  onClose,
  onSaveCopy,
  onOpenLatest,
}: {
  open: boolean;
  kind: "local" | "cloud";
  name: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSaveCopy: () => void;
  onOpenLatest: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={TEXT.conflictTitle}
      description={TEXT.conflictBody}
      footer={
        <>
          <Button onClick={onOpenLatest} disabled={busy}>
            {kind === "cloud" ? TEXT.conflictLatestCloud : TEXT.conflictLatestLocal}
          </Button>
          <Button variant="primary" loading={busy} onClick={onSaveCopy}>
            {TEXT.conflictCopy}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        {error ? <Banner tone="danger" title="저장하지 못했습니다">{error}</Banner> : null}
        <p className="text-body text-fg">
          <span className="font-semibold">{name}</span>
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-fg-2">
          <li>{TEXT.conflictCopy}: 내 변경을 새 프로젝트 "{name} (내 변경)"으로 저장합니다. 원래 프로젝트는 그대로입니다.</li>
          <li>
            {kind === "cloud" ? TEXT.conflictLatestCloud : TEXT.conflictLatestLocal}: {TEXT.conflictLatestWarn}
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
