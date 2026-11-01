// /projects 대화상자: 새 프로젝트·이름 바꾸기·삭제 확인·저장 충돌(2선택). ui Dialog(네이티브 <dialog>, 포커스 가둠·Esc).
// 입력 검증은 new-project.ts(순수), 문구는 messages.ts. 저장 호출은 index.tsx가 한다(여기는 값만 올린다).
import { Banner, Button, Dialog, Field, Input, Select } from "@arch-studio/ui";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { LOOKUP_TEXT } from "../site/access.ts";
import type { LookupKind, LookupOutcome } from "../site/lookup.ts";
import { formatM } from "../site/model.ts";
import { TEXT } from "./messages.ts";
import { applyLookupFill, NO_FILL, summarizeLookup, type LookupFill, type LookupSummary } from "./site-lookup.ts";
import type { SiteMapSource } from "./site-map-style.ts";
import { lookupArgsFor, type SearchCandidate, type SearchKind, type SearchOutcome } from "./site-search.ts";
import { SiteMap } from "./SiteMap.tsx";
import { SitePreview } from "./SitePreview.tsx";
import { EMPTY_FORM, NAME_MAX_CHARS, USE_DISTRICTS, validateName, validateNewProject, type FormErrors, type NewProjectForm, type NewProjectValues } from "./new-project.ts";

/** 새 프로젝트 창의 대지 찾기 연결(index.tsx가 useApi·권리·온라인으로 만든다). 없으면 찾기 칸을 그리지 않는다. */
export interface SiteLookupPort {
  /** siteAccess().lookup: ok면 검색·조회, offline·locked면 버튼 잠금 + 안내. */
  readonly state: "ok" | "offline" | "locked";
  /** 주소 검색(POST /api/site/search, 명시 제출만) → 후보 목록. */
  readonly search: (kind: SearchKind, value: string) => Promise<SearchOutcome>;
  /** 고른 후보 조회(POST /api/site/lookup). */
  readonly run: (kind: LookupKind, value: string) => Promise<LookupOutcome>;
  /** 지도 배경. null이면 지도 없이 경계 그림(SVG)만(설치형·스위치 꺼짐·타일 원천 없음). */
  readonly map: SiteMapSource | null;
}

export type NewLookupKind = SearchKind;
type Picked = { status: "loading" } | { status: "done"; summary: LookupSummary; ringM: readonly (readonly [number, number])[] } | { status: "failed"; message: string };
type LookupView =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "failed"; message: string }
  | { status: "list"; candidates: readonly SearchCandidate[]; active: number; picked: { index: number; state: Picked } | null };

const LOOKUP_KIND_LABEL: Readonly<Record<NewLookupKind, string>> = { jibun: "지번", road: "도로명 주소" };
const LOOKUP_PLACEHOLDER: Readonly<Record<NewLookupKind, string>> = { jibun: "예: 성남시 분당구 운중동 12-4", road: "예: 경기도 성남시 분당구 운중로 135" };
const LOOKUP_LOCKED = "편집 권리가 확인되어야 대지를 찾습니다. 가로·세로를 직접 넣으세요.";

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
  const listRef = useRef<HTMLUListElement>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [kind, setKind] = useState<NewLookupKind>("jibun");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LookupView>({ status: "idle" });
  const picked = view.status === "list" ? view.picked : null;
  const summary = picked?.state.status === "done" ? picked.state.summary : null;
  const ringM = picked?.state.status === "done" ? picked.state.ringM : null;
  const working = view.status === "searching" || picked?.state.status === "loading";
  const lookupLocked = !lookup || lookup.state !== "ok";
  /** 검색(명시 제출만 — 입력 중 요청 없음): 이전 조회 결과는 버리고 후보 목록을 새로 받는다. */
  const runSearch = async () => {
    if (!lookup || lookup.state !== "ok" || working) return;
    if (summary) refill(null);
    setView({ status: "searching" });
    const r = await lookup.search(kind, query);
    setView(r.ok ? { status: "list", candidates: r.candidates, active: 0, picked: null } : { status: "failed", message: r.failure.message });
  };
  /** 후보 고르기 → 조회(PNU 우선). 결과는 이전 조회가 채운 값만 바꾼다. */
  const pick = async (index: number) => {
    if (!lookup || lookup.state !== "ok" || working || view.status !== "list") return;
    const c = view.candidates[index];
    if (!c) return;
    const setPicked = (st: Picked) => setView((v) => (v.status === "list" ? { ...v, active: index, picked: { index, state: st } } : v));
    setPicked({ status: "loading" });
    const a = lookupArgsFor(c);
    const r = await lookup.run(a.kind, a.value);
    if (!r.ok) {
      setPicked({ status: "failed", message: r.failure.message });
      refill(null);
      return;
    }
    const s = summarizeLookup(r.candidate, r.data.notice);
    setPicked({ status: "done", summary: s, ringM: r.data.boundary_m });
    refill(s);
  };
  /** 검색·조회 결과를 버린다(결과 지우기·찾는 방법·입력값 변경): 이전 필지로 만들지 않게. */
  const dropResult = () => {
    if (working) return;
    if (view.status !== "idle") setView({ status: "idle" });
    if (summary) refill(null);
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (view.status !== "list" || view.candidates.length === 0) return;
    const last = view.candidates.length - 1;
    const move = (to: number) => {
      e.preventDefault();
      const next = Math.min(last, Math.max(0, to));
      setView({ ...view, active: next });
      // 활성 후보가 목록 스크롤 밖이면 보이게.
      document.getElementById(`${id}-cand-${next}`)?.scrollIntoView({ block: "nearest" });
    };
    if (e.key === "ArrowDown") move(view.active + 1);
    else if (e.key === "ArrowUp") move(view.active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(last);
    else if (e.key === "Enter" || e.key === " ") {
      // 목록의 Enter는 프로젝트 만들기가 아니라 후보 고르기다.
      e.preventDefault();
      void pick(view.active);
    }
  };
  // 값은 이벤트 처리 중에 읽는다(갱신 함수 안에서는 currentTarget이 이미 null).
  const set = (k: keyof NewProjectForm) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [k]: value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (working) return;
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
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy} disabled={working}>
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
                <Select id={`${id}-lookup-kind`} value={kind} disabled={lookupLocked || working} onChange={(e) => {
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
                  disabled={lookupLocked || working}
                  onChange={(e) => {
                    setQuery(e.currentTarget.value);
                    dropResult();
                  }}
                  onKeyDown={(e) => {
                    // 검색 칸의 Enter는 프로젝트 만들기가 아니라 검색이다. 아래 화살표는 후보 목록으로.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    } else if (e.key === "ArrowDown" && view.status === "list" && view.candidates.length > 0) {
                      e.preventDefault();
                      listRef.current?.focus();
                    }
                  }}
                />
              </Field>
              <Button icon="send" loading={view.status === "searching"} disabled={lookupLocked || working || query.trim() === ""} onClick={() => void runSearch()}>
                검색
              </Button>
            </div>
            {lookup.state === "offline" ? <p className="text-caption text-fg-2">{LOOKUP_TEXT.offline}</p> : null}
            {lookup.state === "locked" ? <p className="text-caption text-fg-2">{LOOKUP_LOCKED}</p> : null}
            {view.status === "failed" ? (
              <Banner tone="warn" title="대지를 찾지 못했습니다">
                {view.message} 아래 가로·세로를 직접 넣어 만들 수 있습니다.
              </Banner>
            ) : null}
            <p role="status" className="text-caption text-fg-2">
              {view.status === "searching" ? "검색 중입니다" : view.status === "list" ? (view.candidates.length > 0 ? `후보 ${view.candidates.length}건 — 하나를 고르면 지도에 대지를 표시합니다` : "찾은 후보가 없습니다. 표기를 바꿔 다시 검색하거나 아래 가로·세로를 직접 넣으세요.") : ""}
            </p>
            {view.status === "list" && view.candidates.length > 0 ? (
              <ul
                ref={listRef}
                role="listbox"
                tabIndex={0}
                aria-label="검색한 대지 후보"
                aria-activedescendant={`${id}-cand-${view.active}`}
                aria-busy={working}
                onKeyDown={onListKey}
                className="focus-ring flex max-h-48 flex-col overflow-y-auto rounded-control border border-line"
              >
                {view.candidates.map((c, i) => (
                  <li
                    key={`${i}-${c.label}`}
                    id={`${id}-cand-${i}`}
                    role="option"
                    aria-selected={picked?.index === i}
                    onClick={() => void pick(i)}
                    className={`flex cursor-pointer flex-col px-pad py-1 text-body ${i === view.active ? "bg-raised" : ""} hover:bg-raised ${picked?.index === i ? "font-semibold text-fg" : "text-fg-2"}`}
                  >
                    <span className="break-words">{c.label}</span>
                    <span className="text-caption text-fg-3">
                      {LOOKUP_KIND_LABEL[c.kind]}
                      {picked?.index === i ? (picked.state.status === "loading" ? " · 불러오는 중" : picked.state.status === "done" ? " · 선택함" : " · 불러오지 못함") : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {picked?.state.status === "failed" ? (
              <Banner tone="warn" title="대지를 불러오지 못했습니다">
                {picked.state.message} 다른 후보를 고르거나 아래 가로·세로를 직접 넣어 만들 수 있습니다.
              </Banner>
            ) : null}
            {summary ? <LookupResult summary={summary} onClear={dropResult} ringM={ringM} map={lookup.map} /> : null}
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

/** 조회 결과: 지도(대지 색칠, 없으면 경계 그림 SVG) + 주소·PNU·용도지역·면적·가로·세로. 값은 입력 후보(판정 기준 아님). */
export function LookupResult({ summary, onClear, ringM = null, map = null }: { summary: LookupSummary; onClear: () => void; ringM?: readonly (readonly [number, number])[] | null; map?: SiteMapSource | null }) {
  const rows: [string, string][] = [
    ["주소", summary.site.addressLabel ?? "조회한 필지"],
    ["PNU", summary.site.pnu ?? "-"],
    ["용도지역(지적도 기준)", summary.useDistrictText ?? "가져오지 못함 — 아래에서 고르세요"],
    ["대지 면적", `${summary.areaText}㎡`],
    ["가로", `${formatM(summary.widthMm)}m`],
    ["세로", `${formatM(summary.depthMm)}m`],
  ];
  const preview = <SitePreview outer={summary.site.outer} rect={summary.rect} widthMm={summary.widthMm} depthMm={summary.depthMm} />;
  return (
    <div className="flex flex-col gap-2">
      {ringM && map ? (
        <SiteMap ringM={ringM} source={map} label={`지도에 칠한 대지: ${summary.site.addressLabel ?? "조회한 필지"}, 가로 ${formatM(summary.widthMm)}m, 세로 ${formatM(summary.depthMm)}m`} fallback={preview} />
      ) : (
        preview
      )}
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
