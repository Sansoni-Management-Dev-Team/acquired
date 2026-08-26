import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Activity, Building2, Mail, Search, Settings } from "lucide-react";
import { Jost, Outfit } from "next/font/google";
import "./globals.css";

const displayFont = Jost({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const bodyFont = Outfit({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Acquired — Deal Pipeline",
  description: "Evidence-led SME acquisition sourcing and outreach",
};

const nav = [
  ["Mandate", "/mandate", Search],
  ["Targets", "/targets", Building2],
  ["Outreach", "/outreach", Mail],
  ["Audit", "/audit", Activity],
  ["Settings", "/settings", Settings],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        <div className="min-h-screen lg:grid lg:grid-cols-[244px_1fr]">
          <aside className="border-b border-[var(--border)] bg-black p-6 lg:min-h-screen lg:border-b-0 lg:border-r">
            <Link href="/targets" className="mb-8 flex items-center gap-3">
              <Image src="/acquired-crown.png" width={42} height={42} alt="Acquired crown" className="size-10 object-contain" priority />
              <span><strong className="block tracking-[.16em]">ACQUIRED</strong><small className="text-[var(--muted)]">Deal intelligence</small></span>
            </Link>
            <nav className="flex gap-2 overflow-auto lg:flex-col">
              {nav.map(([label, href, Icon]) => (
                <Link key={href} href={href} className="flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-xs font-semibold uppercase tracking-[.11em] text-[var(--muted)] transition hover:bg-[var(--panel-raised)] hover:text-white">
                  <Icon size={16} />{label}
                </Link>
              ))}
            </nav>
            <div className="mt-10 hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)] lg:block">
              <span className="mb-2 block uppercase tracking-[.16em]">Environment</span>
              <span className="flex items-center gap-2 text-white"><i className="size-2 rounded-full bg-amber-400" /> Seed adapter</span>
              <span className="mt-1 block">No messages can send</span>
            </div>
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
