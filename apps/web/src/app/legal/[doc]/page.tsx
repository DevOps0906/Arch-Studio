import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@arch-studio/ui";
import { CONTAINER } from "../../(marketing)/_components/Shell.tsx";
import { DISCLAIMER, DRAFT_BANNER_BODY, DRAFT_BANNER_TITLE, LEGAL_DOCS, getLegalDoc } from "../../../content/legal/legal.ts";

export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ doc: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const doc = getLegalDoc((await params).doc);
  if (!doc) return {};
  const title = `${doc.title}(초안) | Arch Studio`;
  return { title, description: doc.description, openGraph: { title, description: doc.description, locale: "ko_KR", type: "article" } };
}

export default async function LegalDocPage({ params }: { params: Promise<{ doc: string }> }) {
  const doc = getLegalDoc((await params).doc);
  if (!doc) notFound();
  return (
    <main className={`${CONTAINER} flex max-w-4xl flex-col gap-8 break-keep py-10 xl:py-16`}>
      <Banner tone="warn" title={DRAFT_BANNER_TITLE}>
        {DRAFT_BANNER_BODY}
      </Banner>
      <h1 className="text-display font-semibold">{doc.title}</h1>
      {doc.slug === "disclaimer" ? (
        <p role="note" className="rounded-panel border border-line bg-surface p-4 text-h1 font-semibold">
          {DISCLAIMER}
        </p>
      ) : null}
      {doc.sections.map((s, i) => (
        <section key={s.heading} aria-labelledby={`s-${i}`} className="flex flex-col gap-3">
          <h2 id={`s-${i}`} className="text-h2 font-semibold">
            {s.heading}
          </h2>
          {s.body.map((p) => (
            <p key={p} className="text-body text-fg-2">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
