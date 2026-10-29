// `/settings/drafting` 표제란·레이어 매핑·기본값(03장 3.14절, DASHBOARD_PATTERNS H: 섹션별 저장). 소유: AR-06-031.
// 데이터: GET|PUT /api/drafting-profile(서버가 역할·입력을 다시 검사, member 저장은 AR042) + 로컬 캐시(cache.ts, 오프라인 읽기·시트 생성).
// 미리보기: 엔진 워커 sheet 레인(build_sheet)의 SVG를 <img src=blob:>로만 그린다(스크립트 실행 경로 없음, preview.ts).
import { Banner, Toast, ToastRegion } from "@arch-studio/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isApiError, type JsonObject } from "../../api-client/index.ts";
import { EmptyBlock, ErrorState, LoadingState, PageHeader, useApi, useOnline, useSession, usePreviewState } from "../../shell/index.ts";
import { SettingsNav } from "../SettingsNav.tsx";
import { screenAccess, syncedLabel, type DataSource } from "./access.ts";
import { readDraftingProfileCache, writeDraftingProfileCache } from "./cache.ts";
import { checkForm, DEFAULT_PROFILE, parseProfileResponse, toForm, type FormErrors, type ProfileForm, type ProfileResponse } from "./profile.ts";
import { DefaultsSection, LayerSection, PreviewSection, TitleBlockSection, type Notice } from "./sections.tsx";
import { saveErrorText } from "./texts.ts";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; source: DataSource; data: ProfileResponse; syncedAt: string | null }
  | { kind: "error"; message: string };

type Section = "titleblock" | "layers" | "defaults";

const SECTION_FIELDS: Readonly<Record<Section, readonly (keyof ProfileForm)[]>> = {
  titleblock: ["office_name", "architect_name", "contact", "logo_storage_path"],
  layers: ["layer_inputs"],
  defaults: ["default_paper", "default_text_height_mm", "font_family"],
};

function merge(base: ProfileForm, draft: ProfileForm, section: Section): ProfileForm {
  const out = { ...base };
  for (const k of SECTION_FIELDS[section]) (out as Record<string, unknown>)[k] = draft[k];
  return out;
}

function sameSection(a: ProfileForm, b: ProfileForm, section: Section): boolean {
  return SECTION_FIELDS[section].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

export function Screen() {
  const api = useApi();
  const online = useOnline();
  const { state } = useSession();
  const forced = usePreviewState("ready");
  const session = state.kind === "ready" ? state.session : null;
  const orgId = session?.org?.id ?? null;
  const role = session?.org?.role ?? null;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [form, setForm] = useState<ProfileForm>(() => toForm(DEFAULT_PROFILE));
  const [saving, setSaving] = useState<Section | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Section, FormErrors & { form?: string }>>>({});
  const [toast, setToast] = useState<Notice | null>(null);

  const applyResponse = useCallback(
    (data: ProfileResponse, source: DataSource, syncedAt: string | null) => {
      setLoad({ kind: "ready", source, data, syncedAt });
      setForm(toForm(data.profile ?? DEFAULT_PROFILE));
      if (source === "server" && data.profile && orgId) {
        writeDraftingProfileCache({ org_id: orgId, profile: data.profile, synced_at: new Date().toISOString(), updated_at: data.updated_at });
      }
    },
    [orgId],
  );

  const fromCache = useCallback(() => {
    const c = orgId ? readDraftingProfileCache(orgId) : null;
    if (!c) return false;
    applyResponse({ profile: c.profile, updated_at: c.updated_at, logo_url: null, can_edit: false, layer_warnings: [] }, "cache", c.synced_at);
    return true;
  }, [orgId, applyResponse]);

  const fetchProfile = useCallback(async () => {
    setLoad({ kind: "loading" });
    if (!online) {
      if (!fromCache()) setLoad({ kind: "error", message: "오프라인이고 이 PC에 저장된 표제란 설정이 없습니다. 인터넷에 연결한 뒤 다시 시도하세요." });
      return;
    }
    try {
      const data = await api.request({ method: "GET", path: "/api/drafting-profile", parse: parseProfileResponse });
      applyResponse(data, "server", new Date().toISOString());
    } catch (e) {
      // 서버에 이 경로가 없으면(데모·구버전 서버) 프로필 없음으로 본다. 저장은 서버가 다시 판정한다.
      if (isApiError(e) && e.code === "not_found") {
        applyResponse({ profile: null, updated_at: null, logo_url: null, can_edit: false, layer_warnings: [] }, "none", null);
        return;
      }
      if (!fromCache()) setLoad({ kind: "error", message: isApiError(e) ? e.userMessage : "표제란 설정을 불러오지 못했습니다. 다시 시도하세요." });
    }
  }, [api, online, applyResponse, fromCache]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    void fetchProfile();
  }, [state.kind, fetchProfile]);

  const saved = useMemo(() => (load.kind === "ready" ? toForm(load.data.profile ?? DEFAULT_PROFILE) : toForm(DEFAULT_PROFILE)), [load]);
  const access = screenAccess(role, online, load.kind === "ready" ? load.source : "none");

  const save = async (section: Section) => {
    const next = merge(saved, form, section);
    const check = checkForm(next);
    if (!check.ok) {
      setErrors((x) => ({ ...x, [section]: check.errors }));
      return;
    }
    setErrors((x) => ({ ...x, [section]: {} }));
    setSaving(section);
    try {
      const data = await api.request({
        method: "PUT",
        path: "/api/drafting-profile",
        body: check.profile as unknown as JsonObject,
        idempotencyKey: api.newIdempotencyKey(),
        parse: parseProfileResponse,
      });
      const keepForm = form;
      applyResponse(data, "server", new Date().toISOString());
      // 다른 섹션의 저장 전 입력은 유지한다(섹션별 저장).
      const savedForm = toForm(data.profile ?? DEFAULT_PROFILE);
      setForm(() => {
        let f = savedForm;
        for (const s of Object.keys(SECTION_FIELDS) as Section[]) if (s !== section) f = merge(f, keepForm, s);
        return f;
      });
      const dropped = check.warnings.filter((w) => w.kind !== "name_conflict").length;
      setToast(
        dropped > 0
          ? { tone: "warn", title: "저장했습니다", body: `레이어 이름 ${dropped}개는 쓸 수 없는 문자가 있어 표준 이름을 씁니다.` }
          : { tone: "ok", title: "저장했습니다", body: "다음에 만드는 시트부터 반영됩니다." },
      );
    } catch (e) {
      setErrors((x) => ({ ...x, [section]: { form: saveErrorText(isApiError(e) ? e.code : null, isApiError(e) ? e.userMessage : null) } }));
    } finally {
      setSaving(null);
    }
  };

  const shown: Load = forced === "loading" ? { kind: "loading" } : forced === "error" ? { kind: "error", message: "표제란 설정을 불러오지 못했습니다. 다시 시도하세요." } : load;
  const empty = forced === "empty" || (shown.kind === "ready" && shown.data.profile === null);

  return (
    <div className="flex flex-col gap-gap">
      <SettingsNav />
      <PageHeader
        title="도면 설정"
        description="표제란·레이어 이름·기본값은 조직의 모든 시트에 들어갑니다."
        actions={
          shown.kind === "ready" ? (
            <span className="text-caption text-fg-2" data-testid="synced">
              마지막 동기화 {syncedLabel(shown.syncedAt)}
              {shown.source === "cache" ? " · 이 PC 캐시" : ""}
            </span>
          ) : undefined
        }
      />
      {shown.kind === "loading" ? <LoadingState label="표제란 설정을 불러오는 중" /> : null}
      {shown.kind === "error" ? <ErrorState title="표제란 설정을 불러오지 못했습니다" description={shown.message} onRetry={() => void fetchProfile()} /> : null}
      {shown.kind === "ready" ? (
        <>
          {access.message ? (
            <Banner tone={access.lock === "role" ? "info" : "warn"} title={access.lock === "role" ? "읽기 전용" : "이 PC에 저장된 설정"}>
              {access.message}
            </Banner>
          ) : null}
          {empty ? (
            <EmptyBlock
              icon="inbox"
              title="표제란이 비어 있습니다"
              description={access.editable ? "사무소 이름·로고·담당자를 넣으면 모든 시트 표제란에 들어갑니다." : "조직 owner·admin이 표제란을 채우면 모든 시트에 들어갑니다."}
            />
          ) : null}
          <div className="grid gap-gap xl:grid-cols-2">
            <TitleBlockSection
              form={form}
              setForm={setForm}
              editable={access.editable}
              dirty={!sameSection(form, saved, "titleblock")}
              saving={saving === "titleblock"}
              errors={errors.titleblock}
              onSave={() => void save("titleblock")}
              orgId={orgId}
              onNotice={setToast}
            />
            <PreviewSection form={form} saved={saved} watermark={session?.plan_code === "trial"} />
          </div>
          <LayerSection
            form={form}
            setForm={setForm}
            editable={access.editable}
            dirty={!sameSection(form, saved, "layers")}
            saving={saving === "layers"}
            errors={errors.layers}
            onSave={() => void save("layers")}
          />
          <DefaultsSection
            form={form}
            setForm={setForm}
            editable={access.editable}
            dirty={!sameSection(form, saved, "defaults")}
            saving={saving === "defaults"}
            errors={errors.defaults}
            onSave={() => void save("defaults")}
          />
        </>
      ) : null}
      <ToastRegion>{toast ? <Toast tone={toast.tone} title={toast.title} onClose={() => setToast(null)}>{toast.body}</Toast> : null}</ToastRegion>
    </div>
  );
}

