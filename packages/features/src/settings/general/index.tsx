// `/settings/general` 화면·국외 이전·녹음 고지·오픈소스 고지·로그아웃(03장 3.15절, DASHBOARD_PATTERNS H). 소유: AR-06-031.
// 테마·밀도는 셸 useDisplayPrefs(즉시 적용·보관). 국외 이전 동의는 ConsentStore(지금은 미지원 구현, consent.ts) — 상태 표시·잠금까지.
// 로그아웃은 셸 useSession().signOut()(008 경로: 키체인 세션 삭제) + 이 PC의 표제란 캐시 삭제. 로컬 프로젝트는 지우지 않는다.
// 치수 단위·자동 저장 간격·저장 위치(3.15절)는 저장할 어댑터(local_settings)가 아직 없어 이 작업에서 만들지 않는다(로그 참고).
import { Badge, Banner, Button, Dialog, Field, Select, Switch } from "@arch-studio/ui";
import { useEffect, useId, useState, type ReactNode } from "react";
import { PageHeader, useDisplayPrefs, useSession, type DensityPref, type ThemePref } from "../../shell/index.ts";
import { SettingsNav } from "../SettingsNav.tsx";
import { clearDraftingProfileCache } from "../drafting/cache.ts";
import { consentView, unsupportedConsentStore, type ConsentStatus, type ConsentStore } from "./consent.ts";
import { CROSS_BORDER_NOT_SENT, CROSS_BORDER_NOTE, CROSS_BORDER_SENT, OSS_SUMMARY, RECORDING_NOTICE, SIGN_OUT_CONFIRM } from "./texts.ts";
import { THIRD_PARTY_NOTICES } from "./third-party-notices.ts";

/** 연결 전 저장소(미지원). 서버 경로가 생기면 이 한 줄만 바꾼다. */
const consentStore: ConsentStore = unsupportedConsentStore;
const STORE_SUPPORTED = false;

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
      <h2 id={id} className="text-h2 font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Screen() {
  const { prefs, update } = useDisplayPrefs();
  const { signOut, state } = useSession();
  const id = useId();
  const role = state.kind === "ready" ? (state.session.org?.role ?? null) : null;
  const [consent, setConsent] = useState<ConsentStatus>({ kind: "unknown" });
  const [noticeVersion, setNoticeVersion] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);

  useEffect(() => {
    let alive = true;
    void consentStore.crossBorder().then((s) => alive && setConsent(s));
    void consentStore.recordingNoticeVersion().then((v) => alive && setNoticeVersion(v));
    return () => {
      alive = false;
    };
  }, []);

  const view = consentView(consent, role, STORE_SUPPORTED);
  const [consentError, setConsentError] = useState<string | null>(null);
  const changeConsent = async (ack: boolean) => {
    if (!view.changeable) return;
    setConsentError(null);
    const ok = await consentStore.setCrossBorder(ack).catch(() => false);
    if (ok) setConsent(await consentStore.crossBorder());
    else setConsentError("동의 상태를 저장하지 못했습니다. 다시 시도하세요.");
  };
  const doSignOut = async () => {
    setConfirmOut(false);
    clearDraftingProfileCache();
    await signOut();
  };

  return (
    <div className="flex flex-col gap-gap">
      <SettingsNav />
      <PageHeader title="일반 설정" description="화면 표시, AI 국외 이전, 고지, 계정을 관리합니다." />
      <div className="grid gap-gap xl:grid-cols-2">
        <Card id={`${id}-display`} title="화면">
          <div className="grid gap-gap md:grid-cols-2">
            <Field label="테마" htmlFor={`${id}-theme`} hint="기본은 OS 설정을 따릅니다.">
              <Select id={`${id}-theme`} value={prefs.theme} onChange={(e) => update({ theme: e.target.value as ThemePref })}>
                <option value="system">OS 설정 따름</option>
                <option value="light">라이트(트레이싱지)</option>
                <option value="dark">다크(흑판)</option>
              </Select>
            </Field>
            <Field label="밀도" htmlFor={`${id}-density`}>
              <Select id={`${id}-density`} value={prefs.density} onChange={(e) => update({ density: e.target.value as DensityPref })}>
                <option value="default">기본</option>
                <option value="compact">컴팩트</option>
              </Select>
            </Field>
          </div>
          <p className="text-caption text-fg-2">바로 적용되고 이 PC에만 저장됩니다.</p>
        </Card>

        <Card id={`${id}-ai`} title="AI 국외 이전 동의">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-fg-2">현재 상태</span>
            <Badge tone={consent.kind === "acked" ? "ok" : "neutral"} icon={consent.kind === "acked" ? "circle-check" : "info"}>
              {view.label}
            </Badge>
          </div>
          <Switch checked={consent.kind === "acked"} onChange={(v) => void changeConsent(v)} label="상용 AI 제공자로 보내는 것에 동의" disabled={!view.changeable} />
          {consentError ? <Banner tone="danger" title={consentError} /> : null}
          {view.reason ? (
            <p className="flex items-start gap-2 text-caption text-fg-2" data-testid="consent-lock">
              {view.reason}
            </p>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="text-caption font-semibold text-fg">보내는 것</p>
              <ul className="list-disc pl-5 text-caption text-fg-2">
                {CROSS_BORDER_SENT.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-caption font-semibold text-fg">보내지 않는 것</p>
              <ul className="list-disc pl-5 text-caption text-fg-2">
                {CROSS_BORDER_NOT_SENT.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-caption text-fg-2">{CROSS_BORDER_NOTE}</p>
        </Card>

        <Card id={`${id}-rec`} title="상담 녹음 고지">
          <Banner tone="info" title="녹음할 때마다 이 고지를 보여 줍니다">
            {RECORDING_NOTICE}
          </Banner>
          <p className="text-caption text-fg-2">고지문 버전: {noticeVersion ?? "서버 연결 후 표시"}</p>
        </Card>

        <Card id={`${id}-oss`} title="오픈소스 고지">
          <p className="text-body text-fg-2">{OSS_SUMMARY}</p>
          <details className="rounded-control border border-line">
            <summary className="focus-ring cursor-pointer rounded-control px-3 py-2 text-body font-medium text-fg">전체 고지 보기</summary>
            <pre className="max-h-96 overflow-auto px-3 pb-3 font-sans text-caption break-words whitespace-pre-wrap text-fg-2">{THIRD_PARTY_NOTICES}</pre>
          </details>
        </Card>
      </div>

      <Card id={`${id}-account`} title="계정">
        <p className="text-body text-fg-2">로그아웃하면 이 PC의 자격 증명 저장소에서 세션을 지웁니다. 이 PC의 프로젝트는 그대로 남습니다.</p>
        <div>
          <Button onClick={() => setConfirmOut(true)} loading={state.kind === "signing_out"}>
            로그아웃
          </Button>
        </div>
      </Card>
      <Dialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title={SIGN_OUT_CONFIRM.title}
        footer={
          <>
            <Button onClick={() => setConfirmOut(false)}>취소</Button>
            <Button variant="primary" onClick={() => void doSignOut()}>
              로그아웃
            </Button>
          </>
        }
      >
        <p className="text-body text-fg-2">{SIGN_OUT_CONFIRM.body}</p>
      </Dialog>
    </div>
  );
}
