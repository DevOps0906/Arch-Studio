import Link from "next/link";
import type { ReactNode } from "react";
import { DISCLAIMER } from "../../../content/legal/legal.ts";

export const CONTAINER = "mx-auto w-full max-w-(--layout-max) px-4 md:px-8";

const NAV = [
  { href: "/samples", label: "샘플 도면" },
  { href: "/pricing", label: "가격" },
  { href: "/download", label: "내려받기" },
] as const;

const LEGAL_LINKS = [
  { href: "/legal/terms", label: "이용약관" },
  { href: "/legal/privacy", label: "개인정보 처리방침" },
  { href: "/legal/disclaimer", label: "고지 사항" },
] as const;

const LINK = "focus-ring rounded-control text-fg-2 hover:text-fg";

/** 마케팅 표면 공통 틀: 랜딩 다크 토큰(data-surface="landing") + 상단 이동줄 + 푸터. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div data-surface="landing" className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="border-b border-line-2 bg-nav">
        <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3`}>
          <Link href="/" className="focus-ring rounded-control text-h2 font-semibold">
            Arch Studio
          </Link>
          <nav aria-label="주요 메뉴">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={LINK}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line-2 bg-bg-deep">
        <div className={`${CONTAINER} flex flex-col gap-4 py-8 text-body text-fg-2`}>
          <nav aria-label="법적 고지">
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {LEGAL_LINKS.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={LINK}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-caption text-fg-3">{DISCLAIMER}.</p>
          <p className="text-caption text-fg-3">© 2026 [회사명 미정]</p>
        </div>
      </footer>
    </div>
  );
}

type LinkButtonProps = { href: string; children: ReactNode; variant?: "primary" | "secondary" };

export function LinkButton({ href, children, variant = "primary" }: LinkButtonProps) {
  const tone =
    variant === "primary"
      ? "bg-accent-strong text-accent-strong-fg hover:opacity-90"
      : "border border-input bg-surface text-fg hover:bg-raised";
  return (
    <Link
      href={href}
      className={`focus-ring inline-flex min-h-control items-center justify-center rounded-control px-5 py-2 text-center text-body font-semibold ${tone}`}
    >
      {children}
    </Link>
  );
}

/** 아직 열리지 않은 행동. 링크가 아니므로 포커스를 받지 않고 보조기기에는 비활성으로 읽힌다. */
export function PendingButton({ children }: { children: ReactNode }) {
  return (
    <span
      aria-disabled="true"
      className="inline-flex min-h-control items-center justify-center rounded-control border border-line bg-surface px-5 py-2 text-center text-body font-semibold text-fg-3"
    >
      {children}
    </span>
  );
}

export function SectionHead({ id, eyebrow, title, lead }: { id: string; eyebrow?: string; title: string; lead?: string }) {
  return (
    <header className="flex max-w-3xl flex-col gap-3">
      {eyebrow ? <p className="text-caption font-semibold text-accent">{eyebrow}</p> : null}
      <h2 id={id} className="text-h2 font-semibold">
        {title}
      </h2>
      {lead ? <p className="text-body text-fg-2">{lead}</p> : null}
    </header>
  );
}

export const SECTION = `${CONTAINER} flex flex-col gap-8 py-12 xl:py-16`;
