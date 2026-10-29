// `/settings/general` 화면·단위·자동 저장·국외 이전·녹음 고지·오픈소스 고지·로그아웃(03장 3.15절). 소유: AR-06-031.
// 화면 테마·밀도(D-34: OS 설정을 따르고 선택)는 셸이 이미 적용하므로 여기서는 useDisplayPrefs()로 값만 바꾼다(자리표시자에 최소 구현).
import { Button, Field, Select } from "@arch-studio/ui";
import { useId } from "react";
import { PageHeader, useDisplayPrefs, useSession, type DensityPref, type ThemePref } from "../../shell/index.ts";
import { SettingsNav } from "../SettingsNav.tsx";

export function Screen() {
  const { prefs, update } = useDisplayPrefs();
  const { signOut, state } = useSession();
  const id = useId();
  return (
    <div className="flex flex-col gap-gap">
      <SettingsNav />
      <PageHeader title="일반 설정" description="명세: 03장 3.15절 · 구현: AR-06-031 (자리표시자, 화면 항목만 동작)" />
      <section aria-labelledby={`${id}-display`} className="flex max-w-xl flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
        <h2 id={`${id}-display`} className="text-h2 font-semibold">
          화면
        </h2>
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
      </section>
      <section className="flex max-w-xl flex-col items-start gap-2 rounded-panel border border-line bg-surface p-pad">
        <h2 className="text-h2 font-semibold">계정</h2>
        <p className="text-body text-fg-2">로그아웃하면 이 PC의 자격 증명 저장소에서 세션을 지웁니다.</p>
        <Button onClick={() => void signOut()} loading={state.kind === "signing_out"}>
          로그아웃
        </Button>
      </section>
    </div>
  );
}
