import type { Metadata } from "next";
import { Banner } from "@arch-studio/ui";
import { ContactCta } from "../_components/contact.tsx";
import { CONTAINER, LinkButton, SECTION, SectionHead, Shell } from "../_components/Shell.tsx";
import { getLatestRelease, type Release } from "./release.ts";

const TITLE = "내려받기 | Arch Studio";
const DESCRIPTION = "Arch Studio Windows용 설치 파일은 준비 중입니다. 시스템 요구사항을 확인하고 알림을 신청해 주세요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, locale: "ko_KR", type: "website" },
};

// 기획 기준 값이다. 출시 전에 바뀔 수 있다(01_PRD.md 5장).
const REQUIREMENTS = [
  ["지원 OS", "Windows 10/11 x64. macOS는 이후 지원을 검토 중이며 시점은 정해지지 않았습니다."],
  ["최소 사양", "RAM 8GB, WebGL2를 지원하는 GPU"],
  ["권장 사양", "RAM 16GB, 외장 GPU"],
  ["설치 파일 크기", "200MB 이하를 목표로 합니다."],
] as const;

async function load(): Promise<{ ok: true; release: Release | null } | { ok: false }> {
  try {
    return { ok: true, release: await getLatestRelease() };
  } catch {
    return { ok: false };
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default async function DownloadPage() {
  const result = await load();
  return (
    <Shell>
      <main className="break-keep">
        <div className={`${CONTAINER} flex flex-col gap-4 pt-10 xl:pt-16`}>
          <h1 className="text-display font-semibold">Windows용 설치 파일</h1>
          <p className="max-w-3xl text-body text-fg-2">
            설치형은 도면 생성과 내보내기를 사용자 PC에서 처리합니다. 웹 스튜디오도 함께 준비 중입니다.
          </p>
        </div>

        <section aria-labelledby="status" className={SECTION}>
          <h2 id="status" className="sr-only">
            설치 파일 상태
          </h2>
          {!result.ok ? (
            <section role="alert" className="rounded-panel border border-danger bg-surface p-6">
              <h3 className="text-h2 font-semibold text-danger">릴리스 정보를 불러오지 못했습니다</h3>
              <p className="mt-2 text-body text-fg-2">잠시 뒤 다시 시도해 주세요.</p>
            </section>
          ) : result.release === null ? (
            <Banner tone="info" title="설치 파일 준비 중">
              아직 내려받을 수 있는 설치 파일이 없습니다. 준비되면 이 자리에 버전과 함께 안내합니다.
            </Banner>
          ) : (
            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6">
              <p className="text-h1 font-semibold">버전 {result.release.version}</p>
              <p className="text-body text-fg-2">
                Windows x64 · {mb(result.release.sizeBytes)} · {result.release.publishedAt}
              </p>
              <p className="break-all text-caption text-fg-3">SHA-256 {result.release.sha256}</p>
              <div>
                <LinkButton href={result.release.downloadUrl}>Windows용 다운로드(x64)</LinkButton>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="requirements" className={SECTION}>
          <SectionHead id="requirements" title="시스템 요구사항" lead="현재 기획 기준이며 출시 때 달라질 수 있습니다." />
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-card border border-line bg-surface p-6 md:grid-cols-[auto_1fr]">
            {REQUIREMENTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-body font-semibold text-fg">{k}</dt>
                <dd className="text-body text-fg-2">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="notify" aria-labelledby="notify-h" className={SECTION}>
          <SectionHead id="notify-h" title="출시 알림 신청" lead="설치 파일이 준비되면 알려 드립니다." />
          <div className="flex flex-col items-start gap-4">
            <ContactCta label="출시 알림 신청" />
            <LinkButton href="/samples" variant="secondary">
              기다리는 동안 샘플 도면 받기
            </LinkButton>
          </div>
        </section>
      </main>
    </Shell>
  );
}
