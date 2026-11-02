// /settings/drafting 섹션 컴포넌트(표제란·미리보기·레이어 매핑·기본값). 화면 상태는 index.tsx가 갖고 여기는 그리기만 한다
// (settings.render.test.ts가 renderToStaticMarkup으로 구조·권한별 상태를 확인한다).
import type { DraftingProfile, StdLayer } from "@arch-studio/domain";
import { Badge, Banner, Button, Field, Input, Select, Table, cn } from "@arch-studio/ui";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isApiError } from "../../api-client/index.ts";
import { LoadingState, useApi, useEngine } from "../../shell/index.ts";
import { layerTable, LINETYPE_LABEL, LOCKED_LAYER_TEXT, WARNING_TEXT, type SaveLayerWarning } from "./layer-map.ts";
import { LOGO_FAILURE_TEXT, parseTicket, sha256Hex, stripPng } from "./logo.ts";
import { BUNDLED_FONTS, checkForm, DEFAULT_PROFILE, PAPERS, type FormErrors, type Paper, type ProfileForm } from "./profile.ts";
import { nextSheetSeq } from "../../sheets/seq.ts";
import { buildSheetRequest, localDate, previewInput, readPreviewResponse } from "./preview.ts";
import { DISCLAIMER_TEXT, saveErrorText } from "./texts.ts";

export type Notice = { tone: "ok" | "warn" | "danger"; title: string; body?: string };

export interface SectionProps {
  form: ProfileForm;
  setForm: (f: (prev: ProfileForm) => ProfileForm) => void;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  errors: (FormErrors & { form?: string }) | undefined;
  onSave: () => void;
}

export function Card({ id, title, description, action, children }: { id: string; title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 id={id} className="text-h2 font-semibold text-fg">
            {title}
          </h2>
          {description ? <p className="text-body text-fg-2">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SaveButton({ editable, dirty, saving, onSave, label }: { editable: boolean; dirty: boolean; saving: boolean; onSave: () => void; label: string }) {
  return (
    <Button variant="primary" onClick={onSave} disabled={!editable || !dirty} loading={saving} aria-label={label}>
      저장
    </Button>
  );
}

export function FormError({ text }: { text: string | undefined }) {
  return text ? <Banner tone="danger" title={text} /> : null;
}

export function TitleBlockSection({ form, setForm, editable, dirty, saving, errors, onSave, orgId, onNotice }: SectionProps & { orgId: string | null; onNotice: (t: Notice) => void }) {
  const id = useId();
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const set = (k: "office_name" | "architect_name" | "contact") => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const upload = async (file: File) => {
    if (!orgId) return;
    setUploading(true);
    try {
      const stripped = stripPng(new Uint8Array(await file.arrayBuffer()));
      if (!stripped.ok) {
        onNotice({ tone: "danger", title: "로고를 올리지 못했습니다", body: LOGO_FAILURE_TEXT[stripped.reason] });
        return;
      }
      const bytes = stripped.bytes;
      const ticket = await api.request({
        method: "POST",
        path: "/api/drafting-profile/logo-upload-url",
        body: { ext: "png", bytes: bytes.byteLength, sha256: await sha256Hex(bytes) },
        idempotencyKey: api.newIdempotencyKey(),
        parse: (d) => parseTicket(d, orgId),
      });
      const res = await fetch(ticket.signed_upload_url, { method: "PUT", headers: { "content-type": "image/png", "x-upsert": "false" }, body: bytes as unknown as BodyInit });
      if (!res.ok) throw new Error("upload");
      setForm((f) => ({ ...f, logo_storage_path: ticket.path }));
      onNotice({ tone: "ok", title: "로고를 올렸습니다", body: "표제란 [저장]을 누르면 반영됩니다." });
    } catch (e) {
      onNotice({ tone: "danger", title: "로고를 올리지 못했습니다", body: isApiError(e) ? saveErrorText(e.code, e.userMessage) : "업로드가 끊겼습니다. 다시 시도하세요." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card
      id={`${id}-h`}
      title="표제란"
      description="owner·admin만 저장합니다."
      action={<SaveButton editable={editable} dirty={dirty} saving={saving} onSave={onSave} label="표제란 저장" />}
    >
      <div className="grid gap-gap md:grid-cols-3">
        <Field label="사무소명" htmlFor={`${id}-office`} error={errors?.office_name}>
          <Input id={`${id}-office`} value={form.office_name} onChange={set("office_name")} disabled={!editable} invalid={!!errors?.office_name} maxLength={100} autoComplete="organization" />
        </Field>
        <Field label="건축사 이름(선택)" htmlFor={`${id}-architect`} error={errors?.architect_name}>
          <Input id={`${id}-architect`} value={form.architect_name} onChange={set("architect_name")} disabled={!editable} invalid={!!errors?.architect_name} maxLength={50} />
        </Field>
        <Field label="연락처(선택)" htmlFor={`${id}-contact`} error={errors?.contact}>
          <Input id={`${id}-contact`} value={form.contact} onChange={set("contact")} disabled={!editable} invalid={!!errors?.contact} maxLength={100} />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-body font-medium text-fg">로고</p>
        <div className="flex flex-wrap items-center gap-2">
          {form.logo_storage_path ? (
            <Badge tone="ok" icon="circle-check">
              로고 등록됨
            </Badge>
          ) : (
            <Badge tone="neutral">로고 없음</Badge>
          )}
          <input
            ref={fileRef}
            id={`${id}-logo`}
            type="file"
            accept="image/png"
            className="sr-only"
            disabled={!editable || uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button size="sm" disabled={!editable} loading={uploading} onClick={() => fileRef.current?.click()}>
            올리기
          </Button>
          {form.logo_storage_path ? (
            <Button size="sm" variant="ghost" disabled={!editable} onClick={() => setForm((f) => ({ ...f, logo_storage_path: "" }))}>
              로고 빼기
            </Button>
          ) : null}
        </div>
        <p className="text-caption text-fg-2">PNG 1MB 이하. 위치·작성자 같은 파일 정보는 올리기 전에 지웁니다. SVG는 받지 않습니다.</p>
      </div>
      <div className="flex flex-col gap-1 rounded-control border border-line bg-raised p-3">
        <p className="text-caption text-fg-2">고정 문구(지울 수 없음)</p>
        <p className="text-body text-fg">{DISCLAIMER_TEXT}</p>
        <p className="text-caption text-fg-2">날인·서명란은 만들지 않습니다.</p>
      </div>
      <FormError text={errors?.form} />
    </Card>
  );
}

export type PreviewState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; text: string } | { kind: "unavailable" };

export function PreviewSection({ form, saved, watermark }: { form: ProfileForm; saved: ProfileForm; watermark: boolean }) {
  const id = useId();
  const engine = useEngine();
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  const seq = useRef(0);
  // 편집 중 값이 유효하면 그 값으로, 아니면 저장된 값으로(사무소명이 비면 견본 이름).
  const profile = useMemo<DraftingProfile>(() => {
    const now = checkForm(form);
    const prev = checkForm(saved);
    const base = now.ok ? now.profile : prev.ok ? prev.profile : DEFAULT_PROFILE;
    return { ...base, office_name: base.office_name || "사무소명" };
  }, [form, saved]);
  const key = JSON.stringify([profile, watermark]);

  useEffect(() => {
    if (!engine) {
      setState({ kind: "unavailable" });
      return;
    }
    seq.current = nextSheetSeq(); // 워커 sheet 레인 seq는 화면 간 단조 증가여야 한다(sheets/seq.ts)
    const reqId = `ttlb-preview-${seq.current}`;
    let url: string | null = null;
    setState({ kind: "loading" });
    const unsub = engine.subscribe((res) => {
      const r = readPreviewResponse(res, reqId);
      if (r.kind === "ok") {
        url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" }));
        setState({ kind: "ready", url });
      } else if (r.kind === "error") setState({ kind: "error", text: "미리보기를 만들지 못했습니다. 값을 확인하고 다시 시도하세요." });
    });
    const timer = setTimeout(() => {
      try {
        engine.send(buildSheetRequest(reqId, seq.current, previewInput(profile, watermark, localDate(new Date()))));
      } catch {
        setState({ kind: "error", text: "미리보기를 만들지 못했습니다." });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      unsub();
      if (url) URL.revokeObjectURL(url);
    };
    // key(JSON)가 profile·watermark를 대표한다(객체 정체성이 아니라 값이 바뀔 때만 다시 만든다).
  }, [engine, key]);

  return (
    <Card id={`${id}-h`} title={`표제란 미리보기 ${profile.default_paper}`} description="도면 엔진이 만든 실제 시트(견본 대지)입니다. 내보내는 SVG와 같습니다.">
      <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-control border border-line bg-bg">
        {state.kind === "ready" ? (
          <img src={state.url} alt={`표제란 미리보기: ${profile.office_name}, 고정 고지 포함${watermark ? ", 체험판 표시" : ""}`} className="h-auto w-full" />
        ) : state.kind === "error" ? (
          <p className="p-pad text-body text-danger">{state.text}</p>
        ) : state.kind === "unavailable" ? (
          <p className="p-pad text-body text-fg-2">이 환경에서는 도면 엔진을 쓸 수 없어 미리보기를 만들 수 없습니다.</p>
        ) : (
          <LoadingState label="미리보기를 만드는 중" rows={1} />
        )}
      </div>
      {watermark ? <p className="text-caption text-fg-2">체험판: 출력하면 표제란에 "체험판"이 표시됩니다. 라이선스나 구독이 있으면 표시되지 않습니다.</p> : null}
    </Card>
  );
}

export function LayerSection({ form, setForm, editable, dirty, saving, errors, onSave }: SectionProps) {
  const id = useId();
  const { rows } = layerTable(form.layer_inputs);
  const set = (k: StdLayer, v: string) => setForm((f) => ({ ...f, layer_inputs: { ...f.layer_inputs, [k]: v } }));
  const warnCount = rows.filter((r) => r.warning || r.blocked).length;
  const input = (r: (typeof rows)[number], suffix: string) => (
    <Input
      id={`${id}-${r.name}-${suffix}`}
      aria-label={`${r.name} 사무소 이름`}
      value={r.input}
      onChange={(e) => set(r.name, e.target.value)}
      disabled={!editable || r.locked}
      invalid={r.blocked || r.warning !== null}
      maxLength={64}
      spellCheck={false}
    />
  );
  const status = (r: (typeof rows)[number]) =>
    r.blocked ? (
      <Badge tone="danger" icon="circle-x">
        줄바꿈·제어 문자·64자 초과
      </Badge>
    ) : r.warning ? (
      <span className="flex flex-col gap-1">
        <Badge tone="warn" icon="triangle-alert">
          표준 이름 유지
        </Badge>
        <span className="text-caption whitespace-normal text-fg-2">{WARNING_TEXT[r.warning as SaveLayerWarning["kind"]]}</span>
      </span>
    ) : r.locked ? (
      <span className="flex flex-col gap-1">
        <span className="text-caption text-fg-2">{r.output}</span>
        <span className="text-caption whitespace-normal text-fg-2">{LOCKED_LAYER_TEXT}</span>
      </span>
    ) : (
      <span className="text-caption text-fg-2">{r.output}</span>
    );
  return (
    <Card
      id={`${id}-h`}
      title="레이어 이름 매핑"
      description="DXF로 내보낼 때 표준 이름을 사무소 이름으로 바꿉니다. 비워 두면 표준 이름을 씁니다."
      action={<SaveButton editable={editable} dirty={dirty} saving={saving} onSave={onSave} label="레이어 이름 저장" />}
    >
      {warnCount > 0 ? <Banner tone="warn" title={`레이어 ${warnCount}개는 표준 이름으로 내보냅니다`}>입력 칸 옆 안내를 확인하세요.</Banner> : null}
      <div className="hidden md:block">
        <Table
          caption="표준 레이어와 사무소 이름"
          columns={[
            { key: "std", header: "표준 이름" },
            { key: "desc", header: "내용" },
            { key: "aci", header: "색", numeric: true },
            { key: "lt", header: "선 종류" },
            { key: "input", header: "사무소 이름" },
            { key: "out", header: "내보낼 이름" },
          ]}
          rows={rows.map((r) => ({
            id: r.name,
            std: <code className="text-caption">{r.name}</code>,
            desc: r.description,
            aci: r.aci,
            lt: LINETYPE_LABEL[r.linetype],
            input: input(r, "t"),
            out: status(r),
          }))}
        />
      </div>
      <ul className="flex flex-col gap-2 md:hidden" aria-label="표준 레이어와 사무소 이름">
        {rows.map((r) => (
          <li key={r.name} className={cn("flex flex-col gap-2 rounded-control border border-line p-3", (r.warning || r.blocked) && "border-warn")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="text-caption font-semibold">{r.name}</code>
              <span className="text-caption text-fg-2">
                색 {r.aci} · {LINETYPE_LABEL[r.linetype]}
              </span>
            </div>
            <p className="text-caption text-fg-2">{r.description}</p>
            {input(r, "m")}
            {status(r)}
          </li>
        ))}
      </ul>
      <FormError text={errors?.layer_map ?? errors?.form} />
    </Card>
  );
}

export function DefaultsSection({ form, setForm, editable, dirty, saving, errors, onSave }: SectionProps) {
  const id = useId();
  const fonts = BUNDLED_FONTS.includes(form.font_family as (typeof BUNDLED_FONTS)[number]) ? [...BUNDLED_FONTS] : [...BUNDLED_FONTS, form.font_family];
  return (
    <Card
      id={`${id}-h`}
      title="기본값"
      description="새 시트의 용지·글자 높이·글꼴입니다. DXF에는 글꼴 이름만 적습니다."
      action={<SaveButton editable={editable} dirty={dirty} saving={saving} onSave={onSave} label="기본값 저장" />}
    >
      <div className="grid gap-gap md:grid-cols-3">
        <Field label="용지" htmlFor={`${id}-paper`}>
          <Select id={`${id}-paper`} value={form.default_paper} onChange={(e) => setForm((f) => ({ ...f, default_paper: e.target.value as Paper }))} disabled={!editable}>
            {PAPERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="글자 높이" htmlFor={`${id}-height`} hint="2.0~5.0mm(제안 2.5)" error={errors?.default_text_height_mm}>
          <Input
            id={`${id}-height`}
            inputMode="decimal"
            suffix="mm"
            value={form.default_text_height_mm}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, default_text_height_mm: v }));
            }}
            disabled={!editable}
            invalid={!!errors?.default_text_height_mm}
          />
        </Field>
        <Field label="글꼴" htmlFor={`${id}-font`} error={errors?.font_family}>
          <Select id={`${id}-font`} value={form.font_family} onChange={(e) => setForm((f) => ({ ...f, font_family: e.target.value }))} disabled={!editable}>
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormError text={errors?.form} />
    </Card>
  );
}
