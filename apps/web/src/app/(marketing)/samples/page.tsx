import type { Metadata } from "next";
import Link from "next/link";
import { SAMPLE_COPY, samplePublicPath } from "../../../server/samples/catalog.ts";
import { loadManifest, type SamplesManifest } from "../../../server/samples/manifest.ts";
import { DownloadButton } from "./DownloadButton.tsx";

export const metadata: Metadata = {
  title: "샘플 도면 | Arch Studio",
  description: "가상 대지로 만든 기획설계 검토용 도면 DXF를 받아 쓰시던 CAD에서 열어 보세요.",
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

async function load(): Promise<SamplesManifest | null> {
  try {
    return await loadManifest();
  } catch {
    return null;
  }
}

export default async function SamplesPage() {
  const manifest = await load();
  return (
    <div data-surface="landing" className="min-h-screen bg-bg text-fg">
      <main className="mx-auto flex w-full max-w-(--layout-max) flex-col gap-10 break-keep px-4 py-10 md:px-8 xl:py-16">
        <header className="flex flex-col gap-4">
          <h1 className="text-display font-semibold">샘플 도면을 받아 쓰시던 CAD에서 열어 보세요</h1>
          <p className="max-w-3xl text-body text-fg-2">
            가상 대지로 만든 기획설계 검토용 도면입니다. 엔진이 실제로 그린 DXF 파일이며, AutoCAD에서 열 수 있습니다.
          </p>
          <p
            role="note"
            className="max-w-3xl rounded-panel border border-line bg-surface p-4 text-body text-fg-2"
          >
            체험용 예시 도면입니다. 가상 대지와 예시 수치로 만들었으며 법규 판정이 아니고 인허가 설계도서가 아닙니다. 최종 확인은 설계자가 합니다.
          </p>
        </header>

        {manifest === null ? (
          <section role="alert" className="rounded-panel border border-danger bg-surface p-6">
            <h2 className="text-h2 font-semibold text-danger">샘플 도면을 불러오지 못했습니다</h2>
            <p className="mt-2 text-body text-fg-2">잠시 뒤 다시 시도해 주세요. 계속 안 되면 새로고침해도 같은 문제가 생기는지 알려 주세요.</p>
          </section>
        ) : manifest.samples.length === 0 ? (
          <section className="rounded-panel border border-line bg-surface p-6">
            <h2 className="text-h2 font-semibold">아직 공개된 샘플이 없습니다</h2>
            <p className="mt-2 text-body text-fg-2">샘플 도면을 준비하고 있습니다. 곧 이곳에서 받아 보실 수 있습니다.</p>
          </section>
        ) : (
          <section aria-label="샘플 도면 목록">
            <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {manifest.samples.map((s) => {
                const copy = SAMPLE_COPY[s.id];
                return (
                  <li key={s.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
                    <p className="text-caption font-semibold text-accent">{copy.site}(가상)</p>
                    <h2 className="text-h1 font-semibold">{copy.title}</h2>
                    <p className="text-body text-fg-2">{copy.description}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption text-fg-3">
                      <dt>형식</dt>
                      <dd className="text-fg-2">DXF</dd>
                      <dt>파일 크기</dt>
                      <dd className="text-fg-2 tabular-nums">{kb(s.bytes)}</dd>
                      <dt>용지</dt>
                      <dd className="text-fg-2">A3 가로</dd>
                    </dl>
                    <div className="mt-auto">
                      <DownloadButton sampleId={s.id} href={samplePublicPath(s.id, "dxf")} label={`${copy.title} DXF 받기`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="flex flex-col gap-2 border-t border-line pt-6 text-body text-fg-2">
          <p>받아 보신 뒤 궁금한 점이 있다면 사전예약 안내를 확인해 보세요.</p>
          <Link href="/pricing" className="focus-ring w-fit text-accent underline underline-offset-4">
            요금 안내 보기
          </Link>
        </footer>
      </main>
    </div>
  );
}
