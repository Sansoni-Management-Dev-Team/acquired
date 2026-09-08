"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, LogOut, Mail, Settings, FileText, Search, ListChecks, GitBranch, Plus } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const steps = [["brief", "Brief", FileText], ["coverage", "Coverage", Search], ["targets", "Targets", ListChecks], ["pipeline", "Pipeline", GitBranch], ["outreach", "Outreach", Mail]] as const;
type SidebarState = { mandates: { id: string; name: string }[]; selected?: string; tab: string };
const SidebarContext = createContext<(value: string) => void>(() => {});
export function SidebarRegistration({ value }: { value: SidebarState }) {
  const publish = useContext(SidebarContext);
  const serialized = JSON.stringify(value);
  useEffect(() => { publish(serialized); }, [publish, serialized]);
  return null;
}

export function AppShell({ children, providerMode }: { children: React.ReactNode; providerMode: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarJson, setSidebarJson] = useState('{"mandates":[],"tab":"brief"}');
  const sidebar: SidebarState = JSON.parse(sidebarJson);
  const stepHref = (id: string, step: string) => step === "outreach" ? `/outreach?mandateId=${id}` : `/mandates/${id}?tab=${step}`;
  if (["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/onboarding", "/auth/complete"].includes(pathname)) return <main>{children}</main>;

  async function signOut() {
    await authClient.signOut();
    setSidebarJson('{"mandates":[],"tab":"brief"}');
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <SidebarContext.Provider value={setSidebarJson}><div className="min-h-screen lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="border-b border-[var(--border)] bg-black p-6 lg:min-h-screen lg:border-b-0 lg:border-r">
        <Link href="/mandates" className="mb-8 flex items-center gap-3">
          <Image src="/acquired-crown.png" width={42} height={42} alt="Acquired crown" className="size-10 object-contain" priority />
          <span><strong className="block tracking-[.16em]">ACQUIRED</strong><small className="text-[var(--muted)]">Deal intelligence</small></span>
        </Link>
        <div className="space-y-4">
          <label className="block text-xs font-medium text-[var(--muted)]">Active mandate
            <select aria-label="Active mandate" value={sidebar.selected || ""} onChange={e => router.push(stepHref(e.target.value, sidebar.tab))} className="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-3 text-sm text-white">
              <option value="" disabled>Select a mandate</option>
              {sidebar.mandates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="flex gap-4 text-xs text-[var(--muted)]">
            <Link href="/mandates" className="flex min-h-11 items-center gap-2 hover:text-white"><Building2 size={15} />All mandates</Link>
            <Link href="/mandates/new" className="flex min-h-11 items-center gap-2 hover:text-white"><Plus size={15} />New mandate</Link>
          </div>
          {sidebar.selected ? <nav aria-label="Mandate steps" className="flex flex-col gap-1">
            {steps.map(([step, label, Icon]) => {
              const active = sidebar.tab === step && (pathname.startsWith(`/mandates/${sidebar.selected}`) || pathname === "/outreach");
              return <Link key={step} href={stepHref(sidebar.selected!, step)} aria-current={active ? "page" : undefined} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium ${active ? "bg-white text-black" : "text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-white"}`}><Icon size={18} />{label}</Link>;
            })}
          </nav> : <p className="text-xs leading-relaxed text-[var(--muted)]">Select a mandate to open its brief, coverage, targets, pipeline and outreach.</p>}
        </div>
        <nav aria-label="Account" className="mt-8 flex flex-col gap-1 border-t border-[var(--border)] pt-5">
          <Link href="/settings" className="flex min-h-12 items-center gap-3 rounded-md px-3 text-sm text-[var(--muted)] hover:text-white"><Settings size={18} />Settings</Link>
          <button onClick={signOut} className="flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[.11em] text-[var(--muted)] transition hover:bg-[var(--panel-raised)] hover:text-white"><LogOut size={16} />Sign out</button>
        </nav>
        <div className="mt-10 hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)] lg:block">
          <span className="mb-2 block uppercase tracking-[.16em]">Environment</span>
          <span className="flex items-center gap-2 text-white"><i className="size-2 rounded-full bg-lime-400" />{providerMode}</span>
          <span className="mt-1 block">{providerMode === "Fixture providers" ? "No external provider calls" : "Search calls are user-triggered"}</span>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div></SidebarContext.Provider>
  );
}
