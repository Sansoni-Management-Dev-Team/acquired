import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function LegalLinks() {
  return <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-[var(--muted)]">
    <Link href="/privacy" className="underline underline-offset-4 hover:text-[var(--foreground)]">Privacy policy</Link>
    <Link href="/terms-of-service" className="underline underline-offset-4 hover:text-[var(--foreground)]">Terms of service</Link>
  </nav>;
}

export function LegalPage({ title, introduction, children }: { title: string; introduction: string; children: ReactNode }) {
  return <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
    <header className="mb-10 border-b border-[var(--border)] pb-8">
      <Link href="/sign-in" aria-label="Acquired sign in" className="mb-8 inline-flex items-center gap-3">
        <Image src="/acquired-crown.png" width={40} height={40} alt="" className="theme-logo size-10 object-contain" />
        <span className="text-sm font-semibold tracking-[.16em]">ACQUIRED</span>
      </Link>
      <h1 className="text-4xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">Last updated: 7 October 2026</p>
      <p className="mt-6 leading-7 text-[var(--muted)]">{introduction}</p>
    </header>
    <article className="space-y-8 text-sm leading-7 text-[var(--muted)] [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[var(--foreground)] [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</article>
    <footer className="mt-12 border-t border-[var(--border)] pt-6"><LegalLinks /><p className="mt-5 text-center text-xs text-[var(--muted)]">Acquired · Evidence-led business acquisition sourcing and outreach</p></footer>
  </div>;
}

export function LegalContact() {
  return <p>For questions about Acquired, privacy requests, account closure or complaints, contact the Acquired support contact who provided your account or the user support email shown on the Google consent screen. Identify your account and organisation and describe your request. Do not send passwords or access tokens.</p>;
}
