"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, LogOut, Mail, Settings } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const nav = [
  ["Mandates", "/mandates", Building2],
  ["Outreach", "/outreach", Mail],
  ["Settings", "/settings", Settings],
] as const;

export function AppShell({ children, providerMode }: { children: React.ReactNode; providerMode: string }) {
  const pathname = usePathname();
  const router = useRouter();
  if (["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/onboarding", "/auth/complete"].includes(pathname)) return <main>{children}</main>;

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[244px_1fr]">
      <aside className="border-b border-[var(--border)] bg-black p-6 lg:min-h-screen lg:border-b-0 lg:border-r">
        <Link href="/mandates" className="mb-8 flex items-center gap-3">
          <Image src="/acquired-crown.png" width={42} height={42} alt="Acquired crown" className="size-10 object-contain" priority />
          <span><strong className="block tracking-[.16em]">ACQUIRED</strong><small className="text-[var(--muted)]">Deal intelligence</small></span>
        </Link>
        <nav className="flex gap-2 overflow-auto lg:flex-col">
          {nav.map(([label, href, Icon]) => (
            <Link key={href} href={href} className="flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-xs font-semibold uppercase tracking-[.11em] text-[var(--muted)] transition hover:bg-[var(--panel-raised)] hover:text-white">
              <Icon size={16} />{label}
            </Link>
          ))}
          <button onClick={signOut} className="flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[.11em] text-[var(--muted)] transition hover:bg-[var(--panel-raised)] hover:text-white"><LogOut size={16} />Sign out</button>
        </nav>
        <div className="mt-10 hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)] lg:block">
          <span className="mb-2 block uppercase tracking-[.16em]">Environment</span>
          <span className="flex items-center gap-2 text-white"><i className="size-2 rounded-full bg-lime-400" />{providerMode}</span>
          <span className="mt-1 block">{providerMode === "Fixture providers" ? "No external provider calls" : "Search calls are user-triggered"}</span>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
