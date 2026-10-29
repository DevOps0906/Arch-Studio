import type { Metadata } from "next";
import Link from "next/link";
import { CONTAINER } from "../(marketing)/_components/Shell.tsx";
import { LEGAL_DOCS } from "../../content/legal/legal.ts";

export const metadata: Metadata = {
  title: "법적 고지 | Arch Studio",
  description: "이용약관, 개인정보 처리방침, 고지 사항(초안).",
  openGraph: { title: "법적 고지 | Arch Studio", description: "이용약관, 개인정보 처리방침, 고지 사항(초안).", locale: "ko_KR", type: "website" },
};

export default function LegalIndexPage() {
  return (
    <main className={`${CONTAINER} flex flex-col gap-6 break-keep py-10 xl:py-16`}>
      <h1 className="text-display font-semibold">법적 고지</h1>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {LEGAL_DOCS.map((d) => (
          <li key={d.slug} className="rounded-card border border-line bg-surface p-6">
            <h2 className="text-h1 font-semibold">
              <Link href={`/legal/${d.slug}`} className="focus-ring rounded-control text-accent underline underline-offset-4">
                {d.title}
              </Link>
            </h2>
            <p className="mt-2 text-body text-fg-2">{d.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
